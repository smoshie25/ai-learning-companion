import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { proposeActionSchema,actionRefSchema,listActionsSchema,watchInputSchema,calendarActionSchema,emailActionSchema } from '../../shared/action-contracts.cjs'
import type { ActionEngine } from '../actions/engine.cjs'
import type { WorkspaceRepository } from '../persistence/repositories.cjs'
import type { IntelligenceRepository } from '../persistence/session-repository.cjs'
import type { InterviewRepository } from '../persistence/interview-repository.cjs'
import type { LearningRepository } from '../persistence/learning-repository.cjs'
import { AppError } from '../ai/errors.cjs'
const listSchema=z.object({query:z.string().max(200).default(''),limit:z.number().int().min(1).max(100).default(30)}).strict()
export function createLearningMCP(engine:ActionEngine,workspace:WorkspaceRepository,recordings:IntelligenceRepository,interviews:InterviewRepository,learning:LearningRepository,onlineSearch?:(query:string)=>Promise<unknown>) {
 const server=new McpServer({name:'ai-learning-companion',version:'0.1.0'},{maxToolInputElements:2000})
 const wrap=(work:(input:any)=>unknown|Promise<unknown>)=>async(input:any)=>{
  try{if(JSON.stringify(input).length>64000)throw new AppError('VALIDATION','Tool arguments exceed the allowed size.');const value=await work(input);const result=Array.isArray(value)?{items:value}:value as any;return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result,isError:result?.state==='failed'||result?.state==='uncertain'}}
  catch(error){const safe=error instanceof AppError?error:new AppError('MCP_OPERATION_FAILED','The learning operation could not complete. No credentials or provider details are exposed.');return {isError:true,content:[{type:'text' as const,text:JSON.stringify({code:safe.code,message:safe.message})}]}}
 }
 const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
 const write={readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}
 server.registerTool('learning.sessions.list',{description:'List local learning and interview metadata. No transcript bodies are returned. Profile access is local and user-authorized.',inputSchema:listSchema,annotations:read},wrap(({query,limit})=>{
  const items=[...workspace.sessions.list().map(s=>({id:'guided:'+s.id,title:s.title,type:'guided',date:s.date})),...recordings.search(query).map(s=>({id:'recorded:'+s.id,title:s.title,type:'recorded',state:s.state,date:s.startedAt})),...interviews.list().map(s=>({id:'interview:'+s.id,title:s.config.role+' · '+s.config.type,type:'interview',state:s.state,date:s.startedAt}))]
  return {items:items.filter(s=>s.title.toLowerCase().includes(query.toLowerCase())).slice(0,limit)}
 }))
 server.registerTool('learning.sessions.get',{description:'Get one saved learning/interview session. Set includeTranscript only when the user authorizes sharing its text with this MCP client.',inputSchema:z.object({id:z.string().min(1).max(150).regex(/^(guided|recorded|interview):[A-Za-z0-9_-]+$/),includeTranscript:z.boolean().default(false)}).strict(),annotations:read},wrap(({id,includeTranscript})=>{
  const [kind,key]=id.split(':')
  if(kind==='recorded'){const s=recordings.get(key);const {segments,...metadata}=s;return {...metadata,segments:includeTranscript?segments:undefined}}
  if(kind==='interview'){const s=interviews.get(key);const {turns,...metadata}=s;return {...metadata,turns:includeTranscript?turns:undefined}}
  const s=workspace.sessions.list().find(s=>s.id===key);if(!s)throw new AppError('NOT_FOUND','This session is unavailable.');const {transcript,...metadata}=s;return {...metadata,transcript:includeTranscript?transcript:undefined}
 }))
 server.registerTool('learning.actions.list',{description:'List action proposals and recorded outcomes. Approval is available only in the desktop Action Center.',inputSchema:listActionsSchema,annotations:read},wrap(({state,limit})=>{engine.repository.recoverStale();return {items:engine.repository.list(state,limit)}}))
 server.registerTool('learning.actions.create',{description:'Propose a learning task, calendar study event/reminder, local email draft, or opportunity monitoring preference. Does not approve or execute. Use a stable idempotencyKey.',inputSchema:proposeActionSchema,annotations:write},wrap(input=>engine.propose(input)))
 server.registerTool('learning.actions.execute',{description:'Execute only the unchanged action previously approved by a human in the desktop app. Cannot grant approval or authorization. Never retry uncertain email delivery.',inputSchema:actionRefSchema,annotations:{...write,destructiveHint:true,openWorldHint:true}},wrap(({id})=>engine.execute(id)))
 server.registerTool('learning.progress.get',{description:'Report local completion and practice data; does not infer mastery or hiring probability.',inputSchema:z.object({}).strict(),annotations:read},wrap(()=>{
  const plans=learning.plans().filter(p=>p.state==='approved');const tasks=plans.flatMap(p=>p.tasks.filter(t=>t.state==='approved'||t.state==='completed'));const local=engine.repository.tasks();const legacy=workspace.tasks.list()
  return {studyPlans:{approved:plans.length,tasks:tasks.length,completed:tasks.filter(t=>t.state==='completed').length},mcpTasks:{total:local.length,completed:local.filter(t=>t.done).length},legacyPlanner:{total:legacy.length,completed:legacy.filter(t=>t.done).length},practiceChecks:tasks.flatMap(t=>t.attempts.map(a=>({taskId:t.id,at:a.at,score:a.score,revision:a.revision}))),note:'Completion is user-confirmed. Practice scores describe submitted answers only.'}
 }))
 let searches:number[]=[]
 server.registerTool('opportunities.search',{description:'Search saved real learning sources. Optional online search uses the configured OpenAI web-search capability. Demo opportunities are excluded unless includeIllustrative is true; enrollment and pricing remain unverified.',inputSchema:listSchema.extend({online:z.boolean().default(false),includeIllustrative:z.boolean().default(false)}).strict(),annotations:{...read,openWorldHint:true}},wrap(async({query,limit,online,includeIllustrative})=>{
  if(online){if(!onlineSearch)throw new AppError('SEARCH_UNAVAILABLE','Online search is unavailable in this runtime.');searches=searches.filter(t=>Date.now()-t<60000);if(searches.length>=12)throw new AppError('RATE_LIMIT','Wait before more online searches.');searches.push(Date.now());await onlineSearch(query||'free learning opportunities')}
  const sources=learning.resources().filter(r=>[r.title,r.query,r.relevance].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0,limit)
  return {sources,note:'These are searched educational source links, not verified enrollment offers. Pricing/access are unverified.',illustrative:includeIllustrative?workspace.opportunities.list().filter(o=>[o.title,o.category].join(' ').toLowerCase().includes(query.toLowerCase())).slice(0,limit).map(o=>({...o,illustrative:true})):[]}
 }))
 server.registerTool('opportunities.watch',{description:'Propose opportunity monitoring preferences for desktop approval. Registration stores preferences only; background polling/notifications are not scheduled.',inputSchema:watchInputSchema,annotations:write},wrap(({idempotencyKey,...data})=>engine.propose({idempotencyKey,rationale:'Register the requested opportunity monitoring preferences.',action:{kind:'opportunity_watch',data}})))
 const external={...write,openWorldHint:false}
 const basic={idempotencyKey:z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/),rationale:z.string().min(1).max(2000)}
 server.registerTool('calendar.study.propose',{description:'Propose a study event on the authorized primary Google calendar. Explicit offset must match the IANA timeZone. No invitees. Desktop review is required.',inputSchema:z.object({...basic,event:calendarActionSchema}).strict(),annotations:external},wrap(({idempotencyKey,rationale,event})=>engine.propose({idempotencyKey,rationale,action:{kind:'calendar_event',data:event}})))
 server.registerTool('calendar.reminder.propose',{description:'Propose a study reminder implemented as a calendar event with a popup reminder. Desktop approval is required.',inputSchema:z.object({...basic,event:calendarActionSchema}).strict(),annotations:external},wrap(({idempotencyKey,rationale,event})=>engine.propose({idempotencyKey,rationale,action:{kind:'calendar_reminder',data:event}})))
 server.registerTool('gmail.followup.draft',{description:'Save a local follow-up email draft for review. Does not create a Gmail draft or send anything. Sending uses only gmail.send plus verified sender identity after desktop approval.',inputSchema:z.object({...basic,email:emailActionSchema}).strict(),annotations:external},wrap(({idempotencyKey,rationale,email})=>engine.propose({idempotencyKey,rationale,action:{kind:'email',data:email}})))
 return server
}
