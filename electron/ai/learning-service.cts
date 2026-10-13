import { createHash,randomUUID } from 'node:crypto'
import type { WorkspaceRepository } from '../persistence/repositories.cjs'
import type { IntelligenceRepository } from '../persistence/session-repository.cjs'
import type { InterviewRepository } from '../persistence/interview-repository.cjs'
import { LearningRepository } from '../persistence/learning-repository.cjs'
import type { AIService } from './service.cjs'
import { normalizeSources,normalizeResourceURL,sourceKind,verifySource } from './resource-retrieval.cjs'
import { validateTasks,validateProposal,requireDependencies } from './study-planning.cjs'
import { proposedTaskSchema, type Gap,type PlanInput,type DiscoveryInput,type ProposedTask,type StudyTask,type StudyPlan,type DiscoveredResource } from '../../shared/learning-contracts.cjs'
import { AppError } from './errors.cjs'
const taskRevision=(task:StudyTask)=>{const {id,state,completedAt,attempts,...proposal}=task;return createHash('sha256').update(JSON.stringify(proposedTaskSchema.parse(proposal))).digest('hex')}
const gapId=(source:string,text:string)=>createHash('sha256').update(source+'\0'+text).digest('hex')
export class LearningService {
 constructor(readonly repository:LearningRepository,private workspace:WorkspaceRepository,private recordings:IntelligenceRepository,private interviews:InterviewRepository,private ai:AIService,private verify=verifySource,private open:(url:string)=>Promise<void>=async()=>{}){}
 gaps():Gap[]{
  const gaps:Gap[]=[]
  const add=(source:Gap['source'],sourceId:string,sourceTitle:string,text:string,excerpt:string|null=null)=>gaps.push({id:gapId(sourceId,text),text:text.slice(0,2000),sourceId,sourceTitle:sourceTitle.slice(0,200),source,basis:'AI-identified',excerpt})
  for(const s of this.recordings.search(''))for(const text of s.summary?.knowledgeGaps??[])add('session','session:'+s.id,s.title,text)
  for(const s of this.interviews.list()){for(const text of s.assessment?.practiceTopics??[])add('interview','interview:'+s.id,s.config.role+' · '+s.config.type,text);for(const item of s.assessment?.improvements??[])add('interview','interview:'+s.id,s.config.role,item.text,item.evidence[0]?.quote??null)}
  for(const s of this.workspace.interviews.list())for(const text of s.feedback?.improvements??[])add('practice','practice:'+s.id,s.career,text)
  gaps.push(...this.repository.gaps())
  return [...new Map(gaps.map(g=>[g.id,g])).values()].slice(0,100)
 }
 load(){return {gaps:this.gaps(),resources:this.repository.resources(),plans:this.repository.plans()}}
 private selected(ids:string[]){const gaps=this.gaps();const selected=ids.map(id=>gaps.find(g=>g.id===id));if(selected.some(g=>!g))throw new AppError('STALE_GAP','A selected gap is no longer available. Refresh the list.');return selected as Gap[]}
 async analyzeGaps(){
  const sources=[
   ...this.recordings.search('').filter(s=>s.state==='ended').map(s=>({id:'session:'+s.id,title:s.title,text:s.segments.filter(t=>t.status==='final').map(t=>t.text).join('\n').slice(0,6000)})),
   ...this.interviews.list().filter(s=>s.state==='ended').map(s=>({id:'interview:'+s.id,title:s.config.role,text:s.turns.filter(t=>t.role==='user'&&t.status==='final').map(t=>t.text).join('\n').slice(0,6000)})),
   ...this.workspace.sessions.list().map(s=>({id:'guided:'+s.id,title:s.title,text:(s.transcript??[]).filter(t=>t.role==='user').map(t=>t.text).join('\n').slice(0,6000)})),
  ].filter(s=>s.text.trim()).slice(0,12)
  if(!sources.length)throw new AppError('NO_CONTENT','Complete a learning session or interview with saved text before analyzing gaps.')
  const result=await this.ai.analyzeLearningGaps(sources)
  this.repository.saveGaps(result.gaps.map(g=>({id:gapId(g.sourceId,g.text),text:g.text,sourceId:g.sourceId,sourceTitle:sources.find(s=>s.id===g.sourceId)!.title.slice(0,200),source:g.sourceId.startsWith('interview:')?'interview':'session',basis:'AI-identified',excerpt:g.excerpt})))
  return this.gaps()
 }
 async discover(input:DiscoveryInput):Promise<DiscoveredResource[]>{
  const gaps=this.selected(input.gapIds)
  const query=(input.goal+' '+gaps.map(g=>g.text).join(' ').slice(0,450)+(input.textOnly?' Free text documentation and reading resources; no video-only courses.':' Free educational resources.')).slice(0,1000)
  const sources=normalizeSources(await this.ai.searchLearningSources(query)).filter(s=>!input.textOnly||!/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/.test(new URL(s.url).hostname)&&! /\.(mp4|webm|mov)(?:$|\?)/i.test(s.url)).slice(0,8)
  if(!sources.length)return []
  let estimates:Awaited<ReturnType<AIService['resourceMetadata']>>={items:[]}
  try{estimates=await this.ai.resourceMetadata(input.goal,sources)}catch{/* Real source links remain usable when estimates cannot be generated. Unknown fields stay explicit. */}
  const results:DiscoveredResource[]=[]
  for(let offset=0;offset<sources.length;offset+=3){
   const batch=await Promise.all(sources.slice(offset,offset+3).map(async(source,i)=>{
    const index=offset+i;const metadata=estimates.items.find(m=>m.sourceId===index);const verification=await this.verify(source.url)
    return this.repository.saveResource({id:randomUUID(),url:source.url,title:source.title,provider:new URL(source.url).hostname,sourceKind:sourceKind(new URL(source.url).hostname),difficulty:metadata?.difficulty??'Unknown',estimatedMinutes:metadata?.estimatedMinutes??null,relevance:metadata?.relevance??'Retrieved for your learning query. Relevance and study-time estimates were not available.',query,verification,approved:false,createdAt:new Date().toISOString()})
   }));results.push(...batch)
  }
  return results
 }
 saveResource(id:string,approved:boolean){
  if(!approved&&this.repository.plans().some(p=>p.state!=='rejected'&&p.tasks.some(t=>t.resourceIds.includes(id))))throw new AppError('RESOURCE_IN_USE','This resource is attached to a study task. Remove the attachment or reject the plan first.')
  return this.repository.approveResource(id,approved)
 }
 async verifyResource(id:string){const r=this.repository.resource(id);return this.repository.saveResource({...r,verification:await this.verify(r.url)})}
 async openResource(id:string){const r=this.repository.resource(id);await this.open(normalizeResourceURL(r.verification.finalUrl??r.url));return null}
 async propose(input:PlanInput){
  const gaps=this.selected(input.gapIds);const resources=this.repository.resources().filter(r=>r.approved)
  const generated=validateProposal(await this.ai.proposeStudyPlan(input,gaps,resources),input,resources.map(r=>r.id))
  return this.repository.savePlan({id:randomUUID(),goal:input.goal,title:generated.title,rationale:generated.rationale,gapIds:input.gapIds,gapContext:gaps,minutesPerDay:input.minutesPerDay,deadline:input.deadline,textOnly:input.textOnly,state:'proposed',createdAt:new Date().toISOString(),approvedAt:null,tasks:generated.tasks.map(t=>({...t,id:randomUUID(),state:'proposed',completedAt:null,attempts:[]}))})
 }
 private validate(plan:StudyPlan){validateTasks(plan.tasks,this.repository.resources().filter(r=>r.approved).map(r=>r.id),plan.deadline)}
 planAction(id:string,action:'approve'|'reject'){
  const plan=this.repository.plan(id)
  if(action==='reject')return this.repository.savePlan({...plan,state:'rejected',tasks:plan.tasks.map(t=>t.state==='completed'?t:{...t,state:'rejected'})})
  if(plan.state==='rejected')throw new AppError('INVALID_STATE','Rejected plans remain in history. Generate a new proposal to continue.')
  this.validate(plan)
  const tasks=plan.tasks.map(t=>t.state==='proposed'?{...t,state:'approved' as const}:t)
  if(!tasks.some(t=>t.state==='approved'||t.state==='completed'))throw new AppError('INVALID_STATE','Approve at least one task before activating this plan.')
  if(tasks.some(t=>t.state!=='rejected'&&t.dependencies.some(key=>tasks.find(d=>d.key===key)?.state==='rejected')))throw new AppError('DEPENDENCY_REJECTED','Edit or reject tasks that depend on a rejected task before approving the plan.')
  return this.repository.savePlan({...plan,state:'approved',approvedAt:plan.approvedAt??new Date().toISOString(),tasks})
 }
 editTask(planId:string,taskId:string,input:ProposedTask){
  const plan=this.repository.plan(planId);const task=plan.tasks.find(t=>t.id===taskId)
  if(!task)throw new AppError('NOT_FOUND','This task is unavailable.')
  if(plan.state==='rejected'||task.state==='completed')throw new AppError('INVALID_STATE','Reopen a completed task before editing; rejected plans are read-only.')
  if(input.key!==task.key)throw new AppError('INVALID_PLAN','Task keys are stable dependency identifiers and cannot be changed.')
  const tasks=plan.tasks.map(t=>t.id===taskId?{...t,...input}:t);const changed={...plan,tasks};this.validate(changed)
  if(input.durationMinutes>plan.minutesPerDay)throw new AppError('INVALID_PLAN','Keep the task duration within your daily study budget.')
  return this.repository.savePlan(changed)
 }
 taskAction(planId:string,taskId:string,action:'approve'|'reject'|'complete'|'reopen'){
  const plan=this.repository.plan(planId);const task=plan.tasks.find(t=>t.id===taskId);if(!task)throw new AppError('NOT_FOUND','This task is unavailable.')
  if(plan.state==='rejected')throw new AppError('INVALID_STATE','This plan was rejected and is read-only.')
  let state=task.state;let completedAt=task.completedAt
  if(action==='approve'){if(!['proposed','rejected'].includes(task.state))throw new AppError('INVALID_STATE','Only proposed or rejected tasks can be approved.');if(task.dependencies.some(key=>plan.tasks.find(t=>t.key===key)?.state==='rejected'))throw new AppError('DEPENDENCY_REJECTED','Approve or remove rejected prerequisites first.');state='approved'}
  if(action==='reject'){if(task.state==='completed')throw new AppError('INVALID_STATE','Reopen the completed task before rejecting it.');if(plan.tasks.some(t=>t.state!=='rejected'&&t.dependencies.includes(task.key)))throw new AppError('DEPENDENCY_IN_USE','Reject or edit dependent tasks first.');state='rejected'}
  if(action==='complete'){if(plan.state!=='approved'||task.state!=='approved')throw new AppError('INVALID_STATE','Only approved tasks in an approved plan can be completed.');requireDependencies(plan,taskId);state='completed';completedAt=new Date().toISOString()}
  if(action==='reopen'){if(task.state!=='completed')throw new AppError('INVALID_STATE','Only completed tasks can be reopened.');if(plan.tasks.some(t=>t.state==='completed'&&t.dependencies.includes(task.key)))throw new AppError('DEPENDENCY_IN_USE','Reopen completed dependent tasks first.');state='approved';completedAt=null}
  return this.repository.savePlan({...plan,tasks:plan.tasks.map(t=>t.id===taskId?{...t,state,completedAt}:t)})
 }
 async assess(planId:string,taskId:string,answer:string){
  const plan=this.repository.plan(planId);const task=plan.tasks.find(t=>t.id===taskId)
  if(!task||plan.state!=='approved'||!['approved','completed'].includes(task.state))throw new AppError('INVALID_STATE','Approve this plan and task before submitting a practice check.')
  requireDependencies(plan,taskId)
  if(task.attempts.length>=30)throw new AppError('ASSESSMENT_LIMIT','This task reached its practice-check limit.')
  const result=await this.ai.assessStudyTask(task,answer)
  if(!answer.includes(result.excerpt))throw new AppError('INVALID_RESPONSE','The practice feedback cited an excerpt absent from your answer.')
  const current=this.repository.plan(planId);const saved=current.tasks.find(t=>t.id===taskId)!
  if(current.state!=='approved'||!['approved','completed'].includes(saved.state)||taskRevision(saved)!==taskRevision(task))throw new AppError('STALE_TASK','The task changed during assessment. Your answer was not attached to a different task.')
  return this.repository.savePlan({...current,tasks:current.tasks.map(t=>t.id===taskId?{...t,attempts:[...t.attempts,{id:randomUUID(),at:new Date().toISOString(),question:task.assessmentQuestion,criteria:task.assessmentCriteria,revision:taskRevision(task),answer,...result}]}:t)})
 }
}
