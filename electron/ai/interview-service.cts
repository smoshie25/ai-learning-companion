import { randomUUID } from 'node:crypto'
import { OpenAIRealtimeWS } from 'openai/realtime/ws'
import { interviewConfigSchema, type InterviewConfig, type InterviewSession } from '../../shared/interview-contracts.cjs'
import { InterviewRepository } from '../persistence/interview-repository.cjs'
import type { AIService } from './service.cjs'
import type { UsageRepository } from '../persistence/repositories.cjs'
import { AppError, safeError } from './errors.cjs'
import { interviewInstructions } from './interview-evaluation.cjs'
type Socket = { on(event:string,callback:(event:any)=>void):unknown; off(event:string,callback:(event:any)=>void):unknown; send(event:any):void; close():void; socket:{on(event:string,callback:()=>void):unknown;off(event:string,callback:()=>void):unknown;bufferedAmount:number} }
const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?Math.min(value,1000000000):0
type Run = { owner:number; socket?:Socket; sequence:number; bytes:number; started:number; captureAt:number; uncommitted:number; packets:number[]; audio:{sequence:number;pcm:string}[]; cursor:number; timer?:ReturnType<typeof setTimeout>; responseTimer?:ReturnType<typeof setTimeout> }
export class InterviewService {
 private owners=new Map<string,number>()
 private runs=new Map<string,Run>()
 private busy=new Set<string>()
 private deadlines=new Map<string,ReturnType<typeof setTimeout>>()
 private disposed=false
 constructor(readonly repository:InterviewRepository,private ai:AIService,private usage:UsageRepository,private factory:()=>Socket=()=>new OpenAIRealtimeWS({model:ai.config.realtimeModel,options:{handshakeTimeout:ai.config.timeoutMs,maxPayload:1024*1024}},ai.getClient()) as unknown as Socket) {repository.recover()}
 hasAIWork() {return this.runs.size>0||this.busy.size>0}
 canCapture(owner:number) {return [...this.owners].some(([id,o])=>o===owner&&this.repository.get(id).state==='active'&&this.repository.get(id).config.mode==='voice'&&this.repository.get(id).config.consent)}
 private owned(owner:number,id:string) {if(this.owners.get(id)!==owner) throw new AppError('FORBIDDEN','Resume this interview in the application window before continuing.'); return this.repository.get(id)}
 private live() {if(this.ai.status().selected==='offline') throw new AppError('OFFLINE_MODE','Select an OpenAI configuration in Settings before starting an AI interview.'); this.ai.getClient()}
 private elapsed(s:InterviewSession) {return s.elapsedMs+(s.activeSince?Math.max(0,Date.now()-Date.parse(s.activeSince)):0)}
 private notice(id:string,text:string) {const s=this.repository.get(id);this.repository.save({...s,notices:[...s.notices.slice(-29),text]})}
 private stopSocket(id:string) {clearTimeout(this.deadlines.get(id));this.deadlines.delete(id);const run=this.runs.get(id);if(!run)return;this.runs.delete(id);clearTimeout(run.timer);clearTimeout(run.responseTimer);try {run.socket?.close()} catch {}}
 private interrupt(id:string,message:string) {if(this.disposed)return;const s=this.repository.get(id);this.stopSocket(id);if(s.state!=='active')return;this.repository.save({...s,state:'interrupted',elapsedMs:this.elapsed(s),activeSince:null,notices:[...s.notices.slice(-29),message]})}
 private arm(id:string) {clearTimeout(this.deadlines.get(id));const s=this.repository.get(id);this.deadlines.set(id,setTimeout(()=>this.finish(id),Math.max(1,s.config.durationMinutes*60000-this.elapsed(s))))}
 private finish(id:string) {const s=this.repository.get(id);this.stopSocket(id);return this.repository.save({...s,state:'ended',elapsedMs:Math.min(this.elapsed(s),s.config.durationMinutes*60000),activeSince:null,endedAt:new Date().toISOString()})}
 private async exclusive<T>(id:string,work:()=>Promise<T>) {if(this.busy.has(id))throw new AppError('BUSY','Wait for this interview operation to finish.');this.busy.add(id);try{return await work()}finally{this.busy.delete(id)}}
 async start(owner:number,input:InterviewConfig) {
  const config=interviewConfigSchema.parse(input);this.live()
  if([...this.owners].some(([id,o])=>o===owner&&this.repository.get(id).state==='active'))throw new AppError('BUSY','Pause or end your current interview first.')
  const now=new Date().toISOString();const id=randomUUID()
  this.repository.save({id,config,state:'active',startedAt:now,activeSince:now,endedAt:null,elapsedMs:0,turns:[],notices:[],assessment:null,evaluatedAt:null});this.owners.set(id,owner)
  this.arm(id);if(config.mode==='text')await this.next(id)
  return this.repository.get(id)
 }
 private async next(id:string) {
  return this.exclusive(id,async()=>{try{const question=await this.ai.interviewQuestion(this.repository.get(id));const s=this.repository.get(id);if(s.state==='active')this.repository.turn(id,{id:randomUUID(),itemId:randomUUID(),role:'assistant',text:question.question,status:'final',at:new Date().toISOString()})}
  catch(error){this.interrupt(id,'The interviewer could not respond. Your submitted answer was saved. Resume to request the next question.');throw safeError(error)}})
 }
 async answer(owner:number,id:string,text:string) {
  const s=this.owned(owner,id);if(s.state!=='active'||s.config.mode!=='text')throw new AppError('INVALID_STATE','Text answers need an active text interview.')
  if(this.busy.has(id))throw new AppError('BUSY','Wait for the interviewer to respond.')
  if(this.elapsed(s)>=s.config.durationMinutes*60000){this.finish(id);throw new AppError('DURATION_LIMIT','The interview duration has ended. Request feedback on your saved answers.')}
  if(s.turns.at(-1)?.role!=='assistant'||s.turns.at(-1)?.status!=='final')throw new AppError('INVALID_STATE','Wait for a complete interview question before answering.')
  this.repository.turn(id,{id:randomUUID(),itemId:randomUUID(),role:'user',text,status:'final',at:new Date().toISOString()})
  await this.next(id);return this.repository.get(id)
 }
 private async drain(id:string) {const run=this.runs.get(id);if(!run?.socket||run.uncommitted<4800)return;const socket=run.socket;await new Promise<void>(resolve=>{const timer=setTimeout(done,1200);const completed=()=>done();function done(){clearTimeout(timer);socket.off('conversation.item.input_audio_transcription.completed',completed);resolve()}socket.on('conversation.item.input_audio_transcription.completed',completed);try{socket.send({type:'input_audio_buffer.commit'})}catch{done()}})}
 get(id:string) {const s=this.repository.get(id);if(s.state!=='active')return s;return this.repository.save({...s,elapsedMs:this.elapsed(s),activeSince:new Date().toISOString()})}
 async pause(owner:number,id:string) {return this.exclusive(id,async()=>{this.owned(owner,id);await this.drain(id);const s=this.owned(owner,id);if(s.state==='ended')throw new AppError('INVALID_STATE','This interview has ended.');this.stopSocket(id);return this.repository.save({...s,state:'paused',elapsedMs:this.elapsed(s),activeSince:null,notices:s.config.mode==='voice'?[...s.notices.slice(-29),'Voice paused. Unsaved speech and unfinished interviewer audio are not replayed.']:s.notices})})}
 async resume(owner:number,id:string,mode:'text'|'voice',consent:boolean) {
  if(this.busy.has(id))throw new AppError('BUSY','Wait for the current interview operation to finish.');const s=this.repository.get(id);if(!['paused','interrupted'].includes(s.state))throw new AppError('INVALID_STATE','Only paused or interrupted interviews can resume.')
  this.live();if(mode==='voice'&&!consent)throw new AppError('CONSENT_REQUIRED','Consent is required for microphone audio sent to OpenAI.')
  if([...this.owners].some(([other,o])=>o===owner&&other!==id&&this.repository.get(other).state==='active'))throw new AppError('BUSY','Pause the current interview first.')
  if(this.elapsed(s)>=s.config.durationMinutes*60000)return this.finish(id)
  this.owners.set(id,owner);this.repository.save({...s,config:{...s.config,mode,consent},state:'active',activeSince:new Date().toISOString()})
  this.arm(id);if(mode==='text'&&!(s.turns.at(-1)?.role==='assistant'&&s.turns.at(-1)?.status==='final'))await this.next(id)
  return this.repository.get(id)
 }
 async end(owner:number,id:string) {return this.exclusive(id,async()=>{this.owned(owner,id);await this.drain(id);return this.finish(id)})}
 async evaluate(id:string) {
  const s=this.repository.get(id);if(s.state!=='ended')throw new AppError('INVALID_STATE','End the interview before requesting feedback.')
  return this.exclusive(id,async()=>{const assessment=await this.ai.interviewAssessment(s);return this.repository.save({...this.repository.get(id),assessment,evaluatedAt:new Date().toISOString()})})
 }
 private wait(socket:Socket,event:string) {return new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>finish(new AppError('TIMEOUT','The voice connection timed out.')),this.ai.config.timeoutMs);const done=()=>finish();const failed=()=>finish(new AppError('REALTIME_UNAVAILABLE','The voice connection could not be established.'));const finish=(error?:AppError)=>{clearTimeout(timer);socket.off(event,done);socket.off('error',failed);socket.socket.off('close',failed);error?reject(error):resolve()};socket.on(event,done);socket.on('error',failed);socket.socket.on('close',failed)})}
 async connect(owner:number,id:string) {
  const s=this.owned(owner,id);if(s.state!=='active'||s.config.mode!=='voice'||!s.config.consent)throw new AppError('INVALID_STATE','Start a consented voice interview first.')
  this.live();if(this.runs.has(id))throw new AppError('BUSY','This voice interview is already connected.')
  const socket=this.factory();const run:Run={owner,socket,sequence:0,bytes:0,started:Date.now(),captureAt:Date.now(),uncommitted:0,packets:[],audio:[],cursor:0};this.runs.set(id,run)
  const current=()=>this.runs.get(id)===run&&!this.disposed
  const redacted=(text:string)=>text.split(this.ai.config.apiKey).join('[redacted]')
  const transcript=(event:any,role:'user'|'assistant',final:boolean)=>{
   if(!current()||typeof event.item_id!=='string')return
   try{const old=this.repository.get(id).turns.find(t=>t.itemId===event.item_id&&t.role===role);const text=final?(event.transcript??event.text??old?.text??''):(old?.text??'')+(event.delta??'')
   if(typeof text!=='string'||text.length>12000)throw new Error()
   this.repository.turn(id,{id:old?.id??randomUUID(),itemId:event.item_id,role,text:redacted(text),status:final?'final':'partial',at:old?.at??new Date().toISOString()})
   }catch{this.interrupt(id,'The transcript limit was reached. Received answers were retained.')}
  }
  socket.on('error',()=>this.interrupt(id,'Voice connection interrupted. Saved text was retained; resume explicitly or switch to text.'))
  socket.socket.on('close',()=>{if(current())this.interrupt(id,'Voice connection closed. Received transcripts were saved; unsent audio may be missing.')})
  socket.on('input_audio_buffer.committed',e=>{run.uncommitted=0;transcript({...e,delta:''},'user',false)})
  socket.on('response.output_item.added',e=>{if(e.item?.role==='assistant')transcript({item_id:e.item.id,delta:''},'assistant',false)})
  socket.on('conversation.item.input_audio_transcription.delta',e=>transcript(e,'user',false))
  socket.on('conversation.item.input_audio_transcription.completed',e=>transcript(e,'user',true))
  socket.on('conversation.item.input_audio_transcription.failed',()=>{if(current())this.notice(id,'One spoken answer could not be transcribed and will not be evaluated. Switch to text if needed.')})
  socket.on('response.output_audio_transcript.delta',e=>transcript(e,'assistant',false))
  socket.on('response.output_audio_transcript.done',e=>transcript(e,'assistant',true))
  socket.on('response.output_audio.delta',e=>{
   if(!current())return
   if(typeof e.delta!=='string'||e.delta.length>64000||run.audio.length>=100){this.interrupt(id,'Audio playback fell behind. Resume to reconnect; received transcripts were retained.');return}
   run.audio.push({sequence:++run.cursor,pcm:e.delta})
  })
  socket.on('response.created',()=>{if(!current())return;clearTimeout(run.responseTimer);run.responseTimer=setTimeout(()=>this.interrupt(id,'The voice response timed out. Resume to continue.'),Math.max(this.ai.config.timeoutMs,45000))})
  socket.on('response.done',e=>{if(!current())return;clearTimeout(run.responseTimer);this.record('interview_voice_turn',run.started,e.response?.usage,e.response?.status==='completed'?undefined:'INCOMPLETE_RESPONSE');run.started=Date.now();if(e.response?.status!=='completed'&&e.response?.status!=='cancelled')this.notice(id,'An interviewer response was incomplete. Ask for clarification or switch to text.')})
  try {
   await this.wait(socket,'session.created')
   if(!current())throw new AppError('INVALID_STATE','The interview was paused while connecting.')
   const updated=this.wait(socket,'session.updated');void updated.catch(()=>{})
   socket.send({type:'session.update',session:{type:'realtime',instructions:interviewInstructions(s),output_modalities:['audio'],audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:this.ai.config.transcriptionModel},turn_detection:{type:'server_vad',create_response:true,interrupt_response:false}},output:{format:{type:'audio/pcm',rate:24000},voice:'marin'}}}})
   await updated
   if(!current())throw new AppError('INVALID_STATE','The interview was paused while connecting.')
   for(const turn of s.turns.filter(t=>t.status==='final'))socket.send({type:'conversation.item.create',item:{type:'message',role:turn.role,content:[turn.role==='user'?{type:'input_text',text:turn.text}:{type:'output_text',text:turn.text}]}})
   socket.send({type:'response.create',response:{instructions:interviewInstructions(s)+' Continue the interview using the restored conversation. If there is an unanswered question, briefly repeat it. Otherwise ask the next relevant question.'}})
   this.arm(id);this.record('interview_voice_connect',Date.now());return this.repository.get(id)
  }catch(error){this.interrupt(id,'Voice could not connect. Check model access and connectivity, then resume or use text.');this.record('interview_voice_connect',Date.now(),undefined,'REALTIME_UNAVAILABLE');throw safeError(error)}
 }
 audio(owner:number,id:string,sequence:number,pcm:string) {
  const s=this.owned(owner,id);const run=this.runs.get(id)
  if(s.state!=='active'||!run||run.owner!==owner||!run.socket)throw new AppError('INVALID_STATE','Voice capture is unavailable.')
  const bytes=Buffer.from(pcm,'base64');const now=Date.now()
  run.packets=run.packets.filter(t=>now-t<1000)
  if(sequence!==run.sequence||bytes.length<2||bytes.length%2||bytes.length>12000||run.packets.length>=16||run.socket.socket.bufferedAmount>256000||run.bytes+bytes.length>48000*(now-run.captureAt)/1000+96000){this.interrupt(id,'Audio capture was interrupted by a format or connection limit. Resume without replaying audio.');throw new AppError('AUDIO_LIMIT','Audio could not be sent safely. Resume or switch to text.')}
  run.sequence++;run.bytes+=bytes.length;run.uncommitted+=bytes.length;run.packets.push(now)
  try{run.socket.send({type:'input_audio_buffer.append',audio:pcm})}catch{this.interrupt(id,'Audio connection interrupted. Received transcripts were saved.');throw new AppError('REALTIME_UNAVAILABLE','Voice audio could not be sent.')}
  return null
 }
 poll(owner:number,id:string,after:number) {this.owned(owner,id);const run=this.runs.get(id);if(run)run.audio=run.audio.filter(a=>a.sequence>after);return {session:this.get(id),audio:run?.audio??[],cursor:run?.cursor??after}}
 closeOwner(owner:number) {for(const [id,o] of this.owners)if(o===owner){const s=this.repository.get(id);if(s.state==='active')this.interrupt(id,'The interview view closed. Received answers were retained.');this.owners.delete(id)}}
 closeAll() {for(const [id] of this.owners){const s=this.repository.get(id);if(s.state==='active')this.interrupt(id,'The app closed during an interview. Received answers were retained.')}this.disposed=true;for(const id of this.runs.keys())this.stopSocket(id);this.owners.clear()}
 private record(operation:string,started:number,usage?:{input_tokens?:number;output_tokens?:number;total_tokens?:number}|null,errorCode?:string) {if(!this.disposed)this.usage.record({id:randomUUID(),operation,model:this.ai.config.realtimeModel,status:errorCode?'error':'success',inputTokens:count(usage?.input_tokens),outputTokens:count(usage?.output_tokens),totalTokens:count(usage?.total_tokens),latencyMs:Date.now()-started,createdAt:new Date().toISOString(),errorCode:errorCode??null})}
}
