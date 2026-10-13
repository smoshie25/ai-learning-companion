const { test }=require('node:test')
const assert=require('node:assert/strict')
const { randomUUID }=require('node:crypto')
const { EventEmitter }=require('node:events')
const { mkdtempSync, rmSync }=require('node:fs')
const { tmpdir }=require('node:os')
const path=require('node:path')
const { openDatabase }=require('../dist-electron/electron/persistence/database.cjs')
const { InterviewRepository }=require('../dist-electron/electron/persistence/interview-repository.cjs')
const { InterviewService }=require('../dist-electron/electron/ai/interview-service.cjs')
const { validateAssessment }=require('../dist-electron/electron/ai/interview-evaluation.cjs')
const { interviewConfigSchema, assessmentSchema }=require('../dist-electron/shared/interview-contracts.cjs')
const { validatePayload }=require('../dist-electron/electron/ipc/validation.cjs')
const cfg={role:'Data Analyst',experience:'Mid-level',type:'Technical',durationMinutes:5,jobDescription:'SQL and analytics',language:'French',mode:'text',consent:false}
const key='sk-test-only-interview-secret'
function assessment(session) {
 const turn=session.turns.find(t=>t.role==='user'&&t.status==='final')
 const dimension={score:3,explanation:'The example demonstrates relevant reasoning.',evidence:[{turnId:turn.id,quote:turn.text.slice(0,40)}]}
 return {rubricVersion:'1',knowledge:dimension,communication:dimension,reasoning:dimension,completeness:dimension,strengths:[{text:'A concrete example.',evidence:dimension.evidence}],improvements:[],practiceTopics:['SQL query plans']}
}
function setup(file=':memory:',factory) {
 const db=openDatabase(file);const repo=new InterviewRepository(db);const seen=[];const usage=[]
 const ai={config:{apiKey:key,realtimeModel:'test-realtime',transcriptionModel:'test-transcribe',timeoutMs:500},status:()=>({selected:'standard'}),getClient:()=>({}),interviewQuestion:async s=>{seen.push(s);return {question:s.turns.length?'Why did you choose that approach?':'Describe a query optimization.'}},interviewAssessment:async s=>validateAssessment(assessment(s),s)}
 const service=new InterviewService(repo,ai,{record:x=>usage.push(x)},factory)
 return {db,repo,ai,service,seen,usage,close:()=>{service.closeAll();db.close()}}
}
class Socket extends EventEmitter {
 socket=new EventEmitter(); sent=[]; closed=false
 constructor(){super();this.socket.bufferedAmount=0;setImmediate(()=>this.emit('session.created',{}))}
 send(event){this.sent.push(event);if(event.type==='session.update')setImmediate(()=>this.emit('session.updated',{}))}
 close(){this.closed=true;this.socket.emit('close')}
}
test('interview configuration and evaluation schemas reject invalid or arbitrary inputs',()=>{
 assert.deepEqual(validatePayload(interviewConfigSchema,cfg),cfg)
 for(const value of [{...cfg,mode:'voice',consent:false},{...cfg,durationMinutes:0},{...cfg,model:'arbitrary'},{...cfg,jobDescription:'x'.repeat(8001)}])assert.throws(()=>validatePayload(interviewConfigSchema,value),{code:'VALIDATION'})
 assert.equal(assessmentSchema.safeParse({hiringProbability:99}).success,false)
})
test('adaptive text lifecycle preserves context, answer-before-request, and evaluation',async()=>{
 const x=setup()
 try {
 let s=await x.service.start(1,cfg);assert.equal(s.turns.length,1)
 await assert.rejects(x.service.answer(2,s.id,'Not allowed'),{code:'FORBIDDEN'})
 s=await x.service.answer(1,s.id,'I examined the query plan and added an index.')
 assert.equal(x.seen[1].turns[1].text,'I examined the query plan and added an index.')
 assert.equal(s.turns[2].text,'Why did you choose that approach?')
 await assert.rejects(x.service.evaluate(s.id),{code:'INVALID_STATE'})
 s=await x.service.pause(1,s.id);assert.equal(s.state,'paused')
 await assert.rejects(x.service.answer(1,s.id,'Paused answer'),{code:'INVALID_STATE'})
 s=await x.service.resume(1,s.id,'text',false);assert.equal(s.turns.length,3)
 s=await x.service.end(1,s.id);assert.equal(s.state,'ended')
 s=await x.service.evaluate(s.id);assert.equal(s.assessment.knowledge.score,3)
 await assert.rejects(x.service.resume(1,s.id,'text',false),{code:'INVALID_STATE'})
 }finally{x.close()}
})
test('failed follow-up retains the answer and resume never submits it twice',async()=>{
 const x=setup()
 try{
 let s=await x.service.start(1,cfg);x.ai.interviewQuestion=async()=>{throw {status:500,message:key}}
 await assert.rejects(x.service.answer(1,s.id,'I used an index.'),e=>!e.message.includes(key))
 s=x.repo.get(s.id);assert.equal(s.state,'interrupted');assert.equal(s.turns.filter(t=>t.role==='user').length,1)
 x.ai.interviewQuestion=async()=>({question:'Which index and why?'})
 s=await x.service.resume(1,s.id,'text',false);assert.equal(s.turns.filter(t=>t.role==='user').length,1);assert.equal(s.turns.at(-1).text,'Which index and why?')
 }finally{x.close()}
})
test('rubric requires real final candidate evidence and permits insufficient-evidence dimensions',async()=>{
 const x=setup()
 try{
 let s=await x.service.start(1,cfg);s=await x.service.answer(1,s.id,'I compared index costs.')
 const valid=assessment(s);assert.deepEqual(validateAssessment(valid,s),valid)
 for(const change of [v=>v.knowledge.score=6,v=>v.knowledge.evidence=[],v=>v.knowledge.evidence=[{turnId:s.turns[0].id,quote:s.turns[0].text}],v=>v.knowledge.evidence[0].quote='invented',v=>v.hiringProbability=90,v=>v.knowledge.explanation='Your chance of being hired is 90%.']){
 const bad=structuredClone(valid);change(bad);assert.throws(()=>validateAssessment(bad,s),{code:'INVALID_RESPONSE'})
 }
 const partial={...s,turns:s.turns.map(t=>t.role==='user'?{...t,status:'partial'}:t)}
 assert.throws(()=>validateAssessment(valid,partial),{code:'INVALID_RESPONSE'})
 const insufficient=structuredClone(valid);insufficient.knowledge={score:null,explanation:'Not enough subject evidence.',evidence:[]};assert.equal(validateAssessment(insufficient,s).knowledge.score,null)
 }finally{x.close()}
})
test('restart recovery retains partial transcripts and checkpointed active time without replay',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'alc-interview-'));const file=path.join(dir,'db.sqlite');let db
 try {
 const x=setup(file);let s=await x.service.start(1,cfg)
 x.repo.save({...s,elapsedMs:4200,activeSince:new Date().toISOString()})
 x.repo.turn(s.id,{id:randomUUID(),itemId:'partial-answer',role:'user',text:'An unfinished answer',status:'partial',at:new Date().toISOString()})
 x.db.close() // Simulate a crash, not graceful shutdown.
 db=openDatabase(file);const repo=new InterviewRepository(db);repo.recover()
 s=repo.get(s.id);assert.equal(s.state,'interrupted');assert.equal(s.elapsedMs,4200);assert.equal(s.turns.at(-1).status,'partial')
 assert.ok(s.notices.at(-1).includes('Resume explicitly'))
 // Dispose the old duration timer without touching the closed database.
 x.service.disposed=true;for(const timer of x.service.deadlines.values())clearTimeout(timer)
 }finally{db?.close();rmSync(dir,{recursive:true,force:true})}
})
test('voice protocol persists duplicate-safe transcripts, bounded audio, context and interruptions',async()=>{
 let socket;const x=setup(':memory:',()=>socket=new Socket())
 try {
 let s=await x.service.start(1,{...cfg,mode:'voice',consent:true})
 assert.equal(x.service.canCapture(1),true);assert.equal(x.service.canCapture(2),false)
 await x.service.connect(1,s.id)
 assert.equal(socket.sent[0].type,'session.update');assert.ok(socket.sent[0].session.instructions.includes('French'))
 socket.emit('input_audio_buffer.committed',{item_id:'answer-1'})
 socket.emit('response.output_item.added',{item:{id:'follow-up-1',role:'assistant'}})
 socket.emit('conversation.item.input_audio_transcription.delta',{item_id:'answer-1',delta:'I used '})
 socket.emit('conversation.item.input_audio_transcription.completed',{item_id:'answer-1',transcript:'I used an index. '+key})
 socket.emit('conversation.item.input_audio_transcription.completed',{item_id:'answer-1',transcript:'Duplicate'})
 s=x.repo.get(s.id);assert.equal(s.turns.length,2);assert.equal(s.turns[0].role,'user');assert.equal(s.turns[1].role,'assistant');assert.equal(s.turns[0].text,'I used an index. [redacted]')
 socket.emit('response.output_audio.delta',{delta:Buffer.alloc(480).toString('base64')})
 let poll=x.service.poll(1,s.id,0);assert.equal(poll.audio.length,1);assert.equal(x.service.poll(1,s.id,poll.cursor).audio.length,0)
 const pcm=Buffer.alloc(4800).toString('base64');x.service.audio(1,s.id,0,pcm)
 assert.throws(()=>x.service.audio(1,s.id,0,pcm),{code:'AUDIO_LIMIT'})
 assert.equal(x.repo.get(s.id).state,'interrupted');assert.equal(socket.closed,true)
 s=await x.service.resume(1,s.id,'voice',true);await x.service.connect(1,s.id)
 assert.ok(socket.sent.some(e=>e.type==='conversation.item.create'&&e.item.content[0].text==='I used an index. [redacted]'))
 assert.equal(socket.sent.some(e=>e.type==='input_audio_buffer.append'),false)
 socket.socket.emit('close');assert.equal(x.repo.get(s.id).state,'interrupted')
 }finally{x.close()}
})
test('voice answers allow thinking pauses without client commits or follow-ups and retain patient detection on resume',async()=>{
 let socket;const x=setup(':memory:',()=>socket=new Socket())
 try{
  let s=await x.service.start(1,{...cfg,mode:'voice',consent:true});await x.service.connect(1,s.id)
  const update=socket.sent.find(e=>e.type==='session.update');assert.deepEqual(update.session.audio.input.turn_detection,{type:'semantic_vad',eagerness:'low',create_response:true,interrupt_response:false});assert.ok(update.session.instructions.includes('Brief pauses, hesitation'))
  const pcm=Buffer.alloc(4800).toString('base64');x.service.audio(1,s.id,0,pcm)
  socket.emit('input_audio_buffer.speech_started',{item_id:'thinking-answer'})
  socket.emit('input_audio_buffer.speech_stopped',{item_id:'thinking-answer'})
  socket.emit('conversation.item.input_audio_transcription.delta',{item_id:'thinking-answer',delta:'I would start by '})
  x.service.audio(1,s.id,1,pcm);socket.emit('input_audio_buffer.speech_started',{item_id:'thinking-answer'})
  socket.emit('conversation.item.input_audio_transcription.delta',{item_id:'thinking-answer',delta:'comparing the query plans.'})
  assert.equal(socket.sent.filter(e=>e.type==='response.create').length,1,'Only the opening question is requested by the client')
  assert.equal(socket.sent.filter(e=>e.type==='input_audio_buffer.commit').length,0,'Thinking pauses must not force submission')
  assert.equal(x.repo.get(s.id).turns[0].text,'I would start by comparing the query plans.');assert.equal(x.repo.get(s.id).turns[0].status,'partial')
  socket.emit('input_audio_buffer.committed',{item_id:'thinking-answer'});socket.emit('conversation.item.input_audio_transcription.completed',{item_id:'thinking-answer',transcript:'I would start by comparing the query plans.'})
  await x.service.pause(1,s.id);s=await x.service.resume(1,s.id,'voice',true);await x.service.connect(1,s.id)
  assert.equal(socket.sent.find(e=>e.type==='session.update').session.audio.input.turn_detection.eagerness,'low');assert.equal(socket.sent.some(e=>e.type==='input_audio_buffer.append'),false)
 }finally{x.close()}
})
test('duration enforcement and overlapping operations cannot add late answers',async()=>{
 const x=setup()
 try {
 let s=await x.service.start(1,cfg)
 x.repo.save({...s,elapsedMs:300000,activeSince:new Date().toISOString()})
 await assert.rejects(x.service.answer(1,s.id,'Late answer'),{code:'DURATION_LIMIT'})
 assert.equal(x.repo.get(s.id).state,'ended');assert.equal(x.repo.get(s.id).turns.length,1)
 s=await x.service.start(1,cfg)
 let complete;x.ai.interviewQuestion=()=>new Promise(resolve=>{complete=resolve})
 const pending=x.service.answer(1,s.id,'An answer in progress.')
 await assert.rejects(x.service.answer(1,s.id,'Duplicate answer'),{code:'BUSY'})
 await assert.rejects(x.service.pause(1,s.id),{code:'BUSY'})
 complete({question:'A follow-up?'});await pending
 assert.equal(x.repo.get(s.id).turns.filter(t=>t.role==='user').length,1)
 }finally{x.close()}
})
test('interview SDK requests use strict schemas and reject fabricated answer evidence',async()=>{
 const { AIService }=require('../dist-electron/electron/ai/service.cjs')
 const { WorkspaceRepository }=require('../dist-electron/electron/persistence/repositories.cjs')
 const { seed,config,response }=require('./fixtures.cjs')
 const db=openDatabase(':memory:');const repo=new WorkspaceRepository(db);repo.bootstrap(seed());repo.update({field:'aiProfile',value:'standard'})
 const requests=[];let output
 const ai=new AIService(config,repo,()=>({responses:{create:async body=>{requests.push(body);return response(JSON.stringify(output))}}}))
 const id=randomUUID();const turn={id:randomUUID(),itemId:'user-1',role:'user',text:'I explained the index tradeoff.',status:'final',at:new Date().toISOString()}
 const session={id,config:cfg,state:'ended',startedAt:new Date().toISOString(),activeSince:null,endedAt:new Date().toISOString(),elapsedMs:1000,turns:[turn],notices:[],assessment:null,evaluatedAt:null}
 try {
 output={question:'How did you measure query latency?'};assert.equal((await ai.interviewQuestion(session)).question,output.question)
 assert.equal(requests[0].store,false);assert.equal(requests[0].text.format.strict,true);assert.ok(requests[0].instructions.includes('French'));assert.ok(requests[0].input.includes(turn.text))
 output=assessment(session);await ai.interviewAssessment(session);assert.equal(requests[1].text.format.name,'interview_assessment')
 output=structuredClone(output);output.reasoning.evidence[0].quote='A fabricated excerpt'
 await assert.rejects(ai.interviewAssessment(session),{code:'INVALID_RESPONSE'})
 assert.equal(repo.usage.list().at(-1)?.operation==='interview_assessment'||repo.usage.list()[0].operation==='interview_assessment',true)
 assert.equal(JSON.stringify(repo.usage.list()).includes(turn.text),false)
 }finally{db.close()}
})

test('voice synchronous transport failure rejects safely and cleans up pending readiness',async()=>{
 let socket;const x=setup(':memory:',()=>{socket=new Socket();socket.send=()=>{throw new Error(key)};return socket})
 try {
 const s=await x.service.start(1,{...cfg,mode:'voice',consent:true})
 await assert.rejects(x.service.connect(1,s.id),e=>!e.message.includes(key))
 assert.equal(x.repo.get(s.id).state,'interrupted');assert.equal(socket.closed,true)
 assert.equal(socket.listenerCount('session.updated'),0)
 }finally{x.close()}
})

test('ending voice drains the final committed answer while retaining partial exclusions',async()=>{
 let socket;const x=setup(':memory:',()=>socket=new Socket())
 try {
 let s=await x.service.start(1,{...cfg,mode:'voice',consent:true});await x.service.connect(1,s.id)
 socket.emit('conversation.item.input_audio_transcription.delta',{item_id:'last-answer',delta:'I compared '})
 const original=socket.send.bind(socket)
 socket.send=e=>{original(e);if(e.type==='input_audio_buffer.commit')setImmediate(()=>{socket.emit('input_audio_buffer.committed',{item_id:'last-answer'});socket.emit('conversation.item.input_audio_transcription.completed',{item_id:'last-answer',transcript:'I compared two approaches.'})})}
 x.service.audio(1,s.id,0,Buffer.alloc(4800).toString('base64'))
 s=await x.service.end(1,s.id)
 assert.equal(s.state,'ended');assert.equal(s.turns[0].status,'final');assert.equal(s.turns[0].text,'I compared two approaches.')
 assert.equal(socket.closed,true);assert.equal(x.service.canCapture(1),false)
 }finally{x.close()}
})

test('voice microphone activation approval is invalidated by pause, text mode and view closure',async()=>{const x=setup();try{const s=await x.service.start(1,{...cfg,mode:'voice',consent:true});const first=x.service.capturePermissionKey(1);assert.ok(first);assert.equal(x.service.capturePermissionKey(2),null);await x.service.pause(1,s.id);assert.equal(x.service.capturePermissionKey(1),null);await x.service.resume(1,s.id,'voice',true);x.repo.save({...x.repo.get(s.id),activeSince:s.activeSince});assert.notEqual(x.service.capturePermissionKey(1),first);await x.service.pause(1,s.id);await x.service.resume(1,s.id,'text',false);assert.equal(x.service.capturePermissionKey(1),null);await x.service.pause(1,s.id);await x.service.resume(1,s.id,'voice',true);x.service.closeOwner(1);assert.equal(x.service.capturePermissionKey(1),null)}finally{x.close()}})
