const {randomUUID}=require('node:crypto')
const {openDatabase}=require('../dist-electron/electron/persistence/database.cjs')
const {WorkspaceRepository}=require('../dist-electron/electron/persistence/repositories.cjs')
const {IntelligenceRepository}=require('../dist-electron/electron/persistence/session-repository.cjs')
const {InterviewRepository}=require('../dist-electron/electron/persistence/interview-repository.cjs')
const {LearningRepository}=require('../dist-electron/electron/persistence/learning-repository.cjs')
const {SessionIntelligence}=require('../dist-electron/electron/ai/session-intelligence.cjs')
const {InterviewService}=require('../dist-electron/electron/ai/interview-service.cjs')
const {LearningService}=require('../dist-electron/electron/ai/learning-service.cjs')
const {validateSessionSummary}=require('../dist-electron/electron/ai/session-extraction.cjs')
const {validateAssessment}=require('../dist-electron/electron/ai/interview-evaluation.cjs')
const {ActionEngine}=require('../dist-electron/electron/actions/engine.cjs')
const {ActionRepository}=require('../dist-electron/electron/actions/repository.cjs')
const {MonitoringRepository}=require('../dist-electron/electron/monitoring/repository.cjs')
const {OpportunityDiscovery}=require('../dist-electron/electron/monitoring/discovery.cjs')
const {OpportunityWorker}=require('../dist-electron/electron/monitoring/worker.cjs')
const {createLearningMCP}=require('../dist-electron/electron/mcp/server.cjs')
const {sample,seedWorkspace:seed}=require('./sample-data.cjs')
exports.runScenario=async function(file=':memory:',onStep=()=>{}){
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js')
 const db=openDatabase(file),workspace=new WorkspaceRepository(db);workspace.bootstrap(seed());workspace.update({field:'preferences',value:{...seed().preferences,goal:'Build a career in technology'}})
 const recordings=new IntelligenceRepository(db),interviewData=new InterviewRepository(db),library=new LearningRepository(db);const steps=[];const step=(label,data)=>{steps.push({step:steps.length+1,label,...data});onStep(steps.at(-1))}
 const ai={config:{apiKey:'',timeoutMs:1000},status:()=>({selected:'standard'}),getClient:()=>({}),sessionInsights:async()=>({highlights:[]}),sessionSummary:async s=>validateSessionSummary({overview:'Practiced queued state updates.',topics:['React state'],concepts:[{name:'State snapshot',explanation:'Each render sees its own state snapshot.'}],conclusions:['Use functional updates when depending on previous state.'],actions:[{title:'Practice queued updates',kind:'explicit_assignment',evidence:[{segmentId:s.segments[0].id,quote:'Please practice two queued functional state updates.'}]}],knowledgeGaps:['Explain stale closures.'],nextSteps:['Read the official queued updates guide.']},s.segments),searchLearningSources:async()=>[sample.source],resourceMetadata:async()=>({items:[{sourceId:0,difficulty:'Intermediate',estimatedMinutes:20,relevance:'Addresses queued state updates.'}]}),opportunityFacts:async()=>sample.facts,proposeStudyPlan:async(_i,_g,resources)=>({title:'React state practice',rationale:'Build from evidence and a short daily budget.',tasks:[{key:'read',title:'Read queued updates',description:'Read the official text guide.',durationMinutes:20,priority:'High',deadline:null,dependencies:[],resourceIds:resources.map(r=>r.id),activity:'Trace two functional updates on paper.',assessmentQuestion:'Why use functional updates?',assessmentCriteria:'Explain previous state and queued execution.'}]}),interviewQuestion:async s=>({question:s.turns.length?'What happens if the closure reads an old snapshot?':'Explain two queued state updates.'}),interviewAssessment:async s=>{const a=s.turns.find(t=>t.role==='user');const dimension={score:3,explanation:'The answer explains queued previous state; a worked example would strengthen it.',evidence:[{turnId:a.id,quote:'each queued update receives previous state'}]};return validateAssessment({rubricVersion:'1',knowledge:dimension,communication:dimension,reasoning:dimension,completeness:dimension,strengths:[{text:'Connects updates to previous state.',evidence:dimension.evidence}],improvements:[{text:'Practice a worked stale-closure example.',evidence:dimension.evidence}],practiceTopics:['Stale closures']},s)}}
 const intelligence=new SessionIntelligence(recordings,ai,workspace.usage),interviews=new InterviewService(interviewData,ai,workspace.usage)
 const learning=new LearningService(library,workspace,recordings,interviewData,ai,async url=>({state:'reachable',checkedAt:new Date().toISOString(),finalUrl:url,textReadable:true,message:'Synthetic demo reachability; no network request.'}))
 const repo=new ActionRepository(db),monitoring=new MonitoringRepository(db);const grant=randomUUID();const deliveries=[]
 const provider={grantId:async()=>grant,execute:async a=>{deliveries.push({id:a.id,kind:a.action.kind});return {providerId:'demo-'+a.id,message:'Simulated provider execution; no external change.'}}};const engine=new ActionEngine(repo,provider,provider)
 const discovery=new OpportunityDiscovery(ai,async()=>sample.page);const server=createLearningMCP(engine,workspace,recordings,interviewData,library,undefined,{learning,monitoring,opportunitySearch:q=>discovery.search(q)})
 const [a,b]=InMemoryTransport.createLinkedPair();const client=new Client({name:'mvp-demo',version:'1'});await server.connect(a);await client.connect(b)
 const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw new Error(JSON.stringify(r.content));return r.structuredContent}
 const approve=async a=>engine.approve(a.id,{digest:a.digest,revision:a.revision,grantId:a.action.kind==='email'||a.action.kind.startsWith('calendar_')?grant:null})
 try{
  let s=intelligence.start(1,{title:sample.title,topic:sample.topic,goals:sample.goal,source:'notes',consent:false});s=intelligence.note(1,s.id,sample.note);await intelligence.end(1,s.id);step('Attend a notes learning session',{sessionId:s.id})
  s=await intelligence.summarize(s.id);intelligence.pin(s.id,s.segments[0].id,true);step('Save highlights and evidence-backed gaps',{gaps:s.summary.knowledgeGaps})
  const resources=await call('learning.resources.discover',{goal:sample.goal,gapIds:[],textOnly:true});learning.saveResource(resources.items[0].id,true);step('Discover and approve an official source',{url:resources.items[0].url})
  const context=await call('learning.context.get');const plan=await call('learning.plans.propose',{goal:sample.goal,gapIds:context.gaps.slice(0,1).map(g=>g.id),minutesPerDay:30,deadline:null,textOnly:true});learning.planAction(plan.id,'approve');step('Review a personalized study plan',{planId:plan.id,tasks:plan.tasks.length})
  let interview=await interviews.start(1,{role:'Frontend Developer',experience:'Entry-level',type:'Technical',durationMinutes:5,jobDescription:'React state',language:'English',mode:'text',consent:false});await interviews.answer(1,interview.id,sample.answer);await interviews.end(1,interview.id);step('Conduct a text mock interview',{interviewId:interview.id})
  interview=await interviews.evaluate(interview.id);step('Generate evidence-backed improvement feedback',{topics:interview.assessment.practiceTopics})
  const opportunities=await call('opportunities.search',{query:'React training',online:true});step('Discover a training opportunity (synthetic terms)',{url:opportunities.items[0].url,verification:opportunities.items[0].verification})
  const email=await call('gmail.followup.draft',{idempotencyKey:'demo-email',rationale:'Share practice progress.',email:{to:['learner@example.org'],subject:'Demo follow-up',body:sample.answer}})
  const event=await call('calendar.study.propose',{idempotencyKey:'demo-event',rationale:'Practice queued updates.',event:{title:'React study practice',description:'Use the approved reading task.',start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+88200000).toISOString(),timeZone:'UTC',reminderMinutes:10}})
  await approve(email);await approve(event);step('Simulate human review of calendar and email',{actionIds:[event.id,email.id]})
  await call('learning.actions.execute',{id:email.id});await call('learning.actions.execute',{id:event.id});step('Execute reviewed actions through official MCP',{simulatedDeliveries:deliveries.length})
  const watch=await call('opportunities.watch',{idempotencyKey:'demo-watch',query:'React training',categories:['course'],intervalHours:6,freeOnly:true,notificationTo:'learner@example.org'});await approve(watch);await call('learning.actions.execute',{id:watch.id})
  let clock=Date.now();const worker=new OpportunityWorker(monitoring,engine,q=>discovery.search(q),()=>clock);await worker.run();const alert=monitoring.alerts(watch.id)[0];await approve(repo.get(alert.actionId));await worker.run();clock+=21600001;await worker.run();step('Scheduled tick detects, reviews, sends and deduplicates an alert',{alerts:monitoring.alerts(watch.id).length,state:monitoring.alerts(watch.id)[0].state,simulatedDeliveries:deliveries.length})
  return {steps,deliveries,sessionId:s.id,interviewId:interview.id,planId:plan.id,monitoring:monitoring.snapshot()}
 }finally{await client.close();await server.close();intelligence.closeAll();interviews.closeAll();db.close()}
}
