const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const {mkdtempSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const path=require('node:path')
const {normalizeResourceURL,normalizeSources,extractSearchSources,verifySource,publicIPv4}=require('../dist-electron/electron/ai/resource-retrieval.cjs')
const {validateProposal}=require('../dist-electron/electron/ai/study-planning.cjs')
const {LearningRepository}=require('../dist-electron/electron/persistence/learning-repository.cjs')
const {LearningService}=require('../dist-electron/electron/ai/learning-service.cjs')
const {openDatabase}=require('../dist-electron/electron/persistence/database.cjs')
const {WorkspaceRepository}=require('../dist-electron/electron/persistence/repositories.cjs')
const {IntelligenceRepository}=require('../dist-electron/electron/persistence/session-repository.cjs')
const {InterviewRepository}=require('../dist-electron/electron/persistence/interview-repository.cjs')
const {seed,config,response}=require('./fixtures.cjs')
const {planInputSchema}=require('../dist-electron/shared/learning-contracts.cjs')
const {validatePayload}=require('../dist-electron/electron/ipc/validation.cjs')
const input={goal:'Learn React state',gapIds:[],textOnly:true,minutesPerDay:30,deadline:'2026-11-01'}
const task=(key,dependencies=[],resourceIds=[])=>({key,title:'Practice '+key,description:'Explain state transitions.',durationMinutes:15,priority:'High',deadline:'2026-10-25',dependencies,resourceIds,activity:'Write a state transition example.',assessmentQuestion:'Why use a functional update?',assessmentCriteria:'Explain previous state and queued updates.'})
const reachable={state:'reachable',checkedAt:new Date().toISOString(),finalUrl:'https://react.dev/learn',textReadable:true,message:'Link responds; estimates are unverified.'}
function setup(file=':memory:'){
 const db=openDatabase(file);const workspace=new WorkspaceRepository(db);workspace.bootstrap(seed())
 const repo=new LearningRepository(db)
 const ai={searchLearningSources:async()=>[{url:'https://react.dev/learn?utm_source=test',title:'React Learn'},{url:'https://react.dev/learn#state',title:'Duplicate'},{url:'https://www.youtube.com/watch?v=test',title:'Video'}],resourceMetadata:async()=>({items:[{sourceId:0,difficulty:'Beginner',estimatedMinutes:20,relevance:'Supports learning state.'}]}),proposeStudyPlan:async(_input,_gaps,resources)=>({title:'Understand state',rationale:'Short text activities.',tasks:[task('read',[],resources.map(r=>r.id)),task('apply',['read'])]}),assessStudyTask:async(_t,answer)=>({score:3,explanation:'Demonstrates a concrete idea.',excerpt:answer.slice(0,20)}),analyzeLearningGaps:async()=>({gaps:[]})}
 const service=new LearningService(repo,workspace,new IntelligenceRepository(db),new InterviewRepository(db),ai,async()=>reachable,async()=>{})
 return {db,repo,workspace,ai,service}
}
test('resource URLs normalize, deduplicate, and rank actual citation sources',()=>{
 assert.equal(normalizeResourceURL('https://React.dev:443/learn?utm_source=x&b=2&a=1#state'),'https://react.dev/learn?a=1&b=2#state')
 const normalized=normalizeSources([{url:'https://unknown.example.org/course',title:'Other'},{url:'https://react.dev/learn#state',title:'Official'},{url:'https://react.dev/learn?utm_campaign=x',title:'Duplicate'}])
 assert.equal(normalized.length,2);assert.equal(normalized[0].title,'Official')
 for(const url of ['http://react.dev','https://user:pass@react.dev','https://127.0.0.1','https://[::1]','https://host.local','https://react.dev:8443'])assert.throws(()=>normalizeResourceURL(url),{code:'INVALID_SOURCE'})
 const result={status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Invented https://fabricated.example.org',annotations:[{type:'url_citation',url:'https://react.dev/learn',title:'React'}]}]}]}
 assert.deepEqual(extractSearchSources(result),[{url:'https://react.dev/learn',title:'React'}])
 assert.throws(()=>extractSearchSources({...result,output:result.output.slice(1)}),{code:'SEARCH_UNAVAILABLE'})
 assert.throws(()=>extractSearchSources({...result,status:'incomplete'}),{code:'SEARCH_UNAVAILABLE'})
})
test('verification pins public addresses and rejects private DNS and unsafe redirects',async()=>{
 let requests=0
 const network={resolve:async()=>['8.8.8.8'],head:async(_url,address)=>{assert.equal(address,'8.8.8.8');requests++;return {status:200,contentType:'text/html'}}}
 assert.equal((await verifySource('https://react.dev/learn',network)).state,'reachable')
 assert.equal((await verifySource('https://react.dev/learn',{...network,resolve:async()=>['127.0.0.1']})).state,'unverified');assert.equal(requests,1)
 assert.equal((await verifySource('https://react.dev/learn',{...network,head:async()=>({status:302,location:'https://169.254.169.254/secret',contentType:''})})).state,'unverified')
 assert.equal((await verifySource('https://react.dev/learn',{...network,head:async()=>({status:403,contentType:''})})).state,'unverified')
 for(const ip of ['0.1.2.3','10.0.0.1','100.64.0.1','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','::1'])assert.equal(publicIPv4(ip),false)
})
test('planning schemas reject unknown fields, cycles, fabricated sources, and impossible task timing',()=>{
 assert.deepEqual(validatePayload(planInputSchema,input),input)
 assert.throws(()=>validatePayload(planInputSchema,{...input,deadline:'2026-02-30'}),{code:'VALIDATION'})
 assert.throws(()=>validatePayload(planInputSchema,{...input,apiKey:'no'}),{code:'VALIDATION'})
 const proposal={title:'Plan',rationale:'Practice',tasks:[task('read'),task('apply',['read'])]}
 assert.equal(validateProposal(proposal,input,[]).tasks.length,2)
 for(const mutate of [p=>p.tasks[1].dependencies=['missing'],p=>p.tasks[0].dependencies=['apply'],p=>p.tasks[1].key='read',p=>p.tasks[0].resourceIds=[randomUUID()],p=>p.tasks[0].deadline='2026-11-02',p=>p.tasks[0].durationMinutes=90,p=>p.tasks[0].activity='Read https://invented.example.org']){const p=structuredClone(proposal);mutate(p);assert.throws(()=>validateProposal(p,input,[]),{code:'INVALID_PLAN'})}
})
test('discovery deduplicates, preserves approvals, filters video, and never substitutes generated URLs',async()=>{
 const x=setup()
 try{
 let found=await x.service.discover(input);assert.equal(found.length,1);assert.equal(found[0].url,'https://react.dev/learn');assert.equal(found[0].approved,false)
 const saved=x.service.saveResource(found[0].id,true);found=await x.service.discover(input)
 assert.equal(found[0].id,saved.id);assert.equal(found[0].approved,true);assert.equal(x.repo.resources().length,1)
 x.ai.searchLearningSources=async()=>[];assert.deepEqual(await x.service.discover(input),[])
 x.ai.searchLearningSources=async()=>{throw new Error('search unavailable')};await assert.rejects(x.service.discover(input));assert.equal(x.repo.resources().length,1)
 }finally{x.db.close()}
})
test('task lifecycle enforces approval and prerequisites, preserves history on edits, and records improvement',async()=>{
 const x=setup()
 try{
 const [resource]=await x.service.discover(input);x.service.saveResource(resource.id,true)
 let p=await x.service.propose(input);const [first,second]=p.tasks
 assert.equal(p.state,'proposed')
 assert.throws(()=>x.service.taskAction(p.id,first.id,'complete'),{code:'INVALID_STATE'})
 p=x.service.planAction(p.id,'approve')
 assert.throws(()=>x.service.taskAction(p.id,second.id,'complete'),{code:'DEPENDENCY_PENDING'})
 assert.throws(()=>x.service.saveResource(resource.id,false),{code:'RESOURCE_IN_USE'})
 p=await x.service.assess(p.id,first.id,'Previous state matters for queued updates.')
 x.ai.assessStudyTask=async(_task,answer)=>({score:4,explanation:'Clearer reasoning.',excerpt:answer.slice(0,10)})
 p=await x.service.assess(p.id,first.id,'Queued updates must receive prior state.')
 assert.deepEqual(p.tasks[0].attempts.map(a=>a.score),[3,4])
 p=x.service.editTask(p.id,first.id,{...task('read',[],[resource.id]),title:'Edited reading'})
 assert.equal(p.tasks[0].attempts.length,2)
 p=x.service.taskAction(p.id,first.id,'complete');p=x.service.taskAction(p.id,second.id,'complete')
 assert.throws(()=>x.service.taskAction(p.id,first.id,'reopen'),{code:'DEPENDENCY_IN_USE'})
 p=x.service.taskAction(p.id,second.id,'reopen');p=x.service.taskAction(p.id,first.id,'reopen')
 p=x.service.taskAction(p.id,second.id,'reject')
 p=x.service.planAction(p.id,'reject');assert.equal(p.state,'rejected');assert.equal(p.tasks[0].attempts.length,2)
 assert.throws(()=>x.service.planAction(p.id,'approve'),{code:'INVALID_STATE'})
 }finally{x.db.close()}
})
test('resources, proposals, approved decisions and practice results survive database restart',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'alc-learning-'));const file=path.join(dir,'db.sqlite');let db
 try{
 const x=setup(file);const [r]=await x.service.discover(input);x.service.saveResource(r.id,true)
 let p=await x.service.propose(input);p=x.service.planAction(p.id,'approve');p=await x.service.assess(p.id,p.tasks[0].id,'Use previous state.')
 x.db.close();db=openDatabase(file);const restored=new LearningRepository(db)
 assert.equal(restored.resource(r.id).approved,true);assert.equal(restored.plan(p.id).state,'approved');assert.equal(restored.plan(p.id).tasks[0].attempts.length,1)
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
})
test('assessment protects against unsupported excerpts and edits made during pending AI work',async()=>{
 const x=setup()
 try{
 let p=await x.service.propose(input);p=x.service.planAction(p.id,'approve');const t=p.tasks[0]
 x.ai.assessStudyTask=async()=>({score:3,explanation:'Invalid',excerpt:'invented evidence'})
 await assert.rejects(x.service.assess(p.id,t.id,'Real answer'),{code:'INVALID_RESPONSE'})
 let resolve;x.ai.assessStudyTask=()=>new Promise(r=>resolve=r)
 const pending=x.service.assess(p.id,t.id,'Real answer')
 x.service.editTask(p.id,t.id,{...task(t.key),assessmentQuestion:'A changed question?'})
 resolve({score:3,explanation:'Old criteria',excerpt:'Real answer'})
 await assert.rejects(pending,{code:'STALE_TASK'});assert.equal(x.repo.plan(p.id).tasks[0].attempts.length,0)
 }finally{x.db.close()}
})
test('hosted search SDK requires a real completed search and never accepts prose URLs',async()=>{
 const {AIService}=require('../dist-electron/electron/ai/service.cjs')
 const x=setup();x.workspace.update({field:'aiProfile',value:'standard'})
 let body;let output={...response('Sourced result'),output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'See https://fake.invalid',annotations:[{type:'url_citation',url:'https://react.dev/learn',title:'React'}]}]}]}
 const ai=new AIService(config,x.workspace,()=>({responses:{create:async input=>{body=input;return output}}}))
 try{
 assert.equal((await ai.searchLearningSources('React state'))[0].url,'https://react.dev/learn')
 assert.equal(body.tools[0].type,'web_search');assert.equal(body.tool_choice,'required');assert.equal(body.store,false);assert.deepEqual(body.include,['web_search_call.action.sources'])
 output=response('An invented https://fake.invalid link')
 await assert.rejects(ai.searchLearningSources('React'),{code:'SEARCH_UNAVAILABLE'})
 }finally{x.db.close()}
})

test('gap analysis uses finalized saved text and persists exact provenance',async()=>{
 const x=setup()
 try{
 const source={...seed().sessions[0],id:'real-session',transcript:[{role:'user',text:'How do queued updates work?'}]}
 x.workspace.update({field:'sessions',value:[source]})
 x.ai.analyzeLearningGaps=async sources=>{assert.equal(sources[0].id,'guided:real-session');return {gaps:[{sourceId:sources[0].id,text:'Understand queued state updates.',excerpt:'How do queued updates work?'}]}}
 const gaps=await x.service.analyzeGaps()
 assert.equal(gaps[0].basis,'AI-identified');assert.equal(gaps[0].excerpt,source.transcript[0].text)
 assert.equal(x.repo.gaps()[0].sourceTitle,source.title)
 assert.equal(x.service.gaps()[0].id,gaps[0].id)
 await assert.rejects(x.service.propose({...input,gapIds:['unknown-gap']}),{code:'STALE_GAP'})
 }finally{x.db.close()}
})
test('AI planning, metadata and gap outputs use strict schemas with reference validation',async()=>{
 const {AIService}=require('../dist-electron/electron/ai/service.cjs')
 const x=setup();x.workspace.update({field:'aiProfile',value:'standard'})
 let output;let body
 const ai=new AIService(config,x.workspace,()=>({responses:{create:async value=>{body=value;return response(JSON.stringify(output))}}}))
 try{
 output={gaps:[{sourceId:'guided:real',text:'Queued state updates',excerpt:'Real source text'}]}
 await ai.analyzeLearningGaps([{id:'guided:real',title:'Learning',text:'Real source text.'}])
 assert.equal(body.text.format.strict,true)
 output.gaps[0].excerpt='Invented evidence'
 await assert.rejects(ai.analyzeLearningGaps([{id:'guided:real',title:'Learning',text:'Real source text.'}]),{code:'INVALID_RESPONSE'})
 output={items:[{sourceId:1,difficulty:'Beginner',estimatedMinutes:20,relevance:'Useful'}]}
 await assert.rejects(ai.resourceMetadata('React',[{url:'https://react.dev/learn',title:'React'}]),{code:'INVALID_RESPONSE'})
 output={title:'Study React',rationale:'Short activities',tasks:[task('read')]}
 await ai.proposeStudyPlan(input,[],[])
 assert.equal(body.text.format.strict,true);assert.equal(body.store,false)
 assert.equal(JSON.parse(body.input).preferences.name,undefined)
 output.tasks[0].resourceIds=[randomUUID()]
 await assert.rejects(ai.proposeStudyPlan(input,[],[]),{code:'INVALID_PLAN'})
 }finally{x.db.close()}
})
