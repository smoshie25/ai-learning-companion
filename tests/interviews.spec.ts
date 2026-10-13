import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import path from 'node:path'
const root=path.resolve('.')
const env={...process.env,NODE_ENV:'production',OPENAI_API_KEY:''}
delete env.ELECTRON_RUN_AS_NODE
async function mock(app:ElectronApplication) {
 await app.evaluate((_electron,root)=>{
  const load=process.getBuiltinModule('module').createRequire(root+'/package.json')
  const AI=load(root+'/dist-electron/electron/ai/service.cjs').AIService
  AI.prototype.interviewQuestion=async function(s:any){return {question:s.turns.some((t:any)=>t.role==='user')?'Which tradeoff did you consider?':'Describe how you solve a challenging problem.'}}
  AI.prototype.interviewAssessment=async function(s:any){const t=s.turns.find((t:any)=>t.role==='user'&&t.status==='final');const d={score:3,explanation:'Your example explains a concrete approach.',evidence:[{turnId:t.id,quote:t.text.slice(0,45)}]};return {rubricVersion:'1',knowledge:d,communication:d,reasoning:d,completeness:d,strengths:[{text:'A specific example.',evidence:d.evidence}],improvements:[{text:'Explain the alternatives.',evidence:d.evidence}],practiceTopics:['Comparing tradeoffs']}}
 },root)
}
async function configure(app:ElectronApplication) {
 const page=await app.firstWindow()
 await page.getByRole('button',{name:'Settings',exact:true}).click()
 await page.getByLabel('OpenAI API key',{exact:true}).fill('sk-test-only-interview-no-network')
 await page.getByRole('button',{name:'Save API key',exact:true}).click()
 await expect(page.getByText('API key configured securely',{exact:true})).toBeVisible()
 await page.getByLabel('Application configuration').selectOption('standard')
 await page.getByRole('button',{name:'Mock Interviews',exact:true}).click()
 await page.getByRole('button',{name:'AI interview',exact:true}).click()
 return page
}
test('adaptive text interview, evidence feedback, comparison and restart recovery',async()=>{
 const directory=path.resolve('test-results','interview-'+Date.now())
 let app=await electron.launch({args:[root,'--user-data-dir='+directory],env})
 try {
 await mock(app);let page=await configure(app)
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.getByLabel('Job description (optional)').fill('Build accessible interfaces and reason about performance.')
 await page.screenshot({path:path.join(directory,'setup.png'),fullPage:true})
 const bad=await page.evaluate(()=>window.companion!.interviews.start({role:'Engineer',experience:'Senior',type:'Technical',durationMinutes:5,jobDescription:'',language:'English',mode:'voice',consent:false}))
 expect(bad).toMatchObject({ok:false,error:{code:'VALIDATION'}})
 for(let i=0;i<2;i++){
 await page.getByRole('button',{name:'Start AI interview',exact:true}).click()
 await expect(page.getByText('Describe how you solve a challenging problem.',{exact:true})).toBeVisible()
 await page.getByLabel('Your AI interview answer').fill('I measured the bottleneck and compared two designs before choosing an index.')
 await page.getByRole('button',{name:'Send answer',exact:true}).click()
 await expect(page.getByText('Which tradeoff did you consider?',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Pause interview',exact:true}).click()
 await expect(page.getByText('paused · microphone off',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Continue with text',exact:true}).click()
 await page.getByRole('button',{name:'End AI interview',exact:true}).click()
 await expect(page.getByText('Interview ended · saved locally',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Request interview feedback',exact:true}).click()
 await expect(page.getByText('3 / 5',{exact:true})).toHaveCount(4)
 if(i===1){
 const opts=await page.getByLabel('Compare with a previous interview').locator('option').all()
 expect(opts.length).toBe(2);const value=await opts[1].getAttribute('value')
 await page.getByLabel('Compare with a previous interview').selectOption(value!)
 await expect(page.getByRole('table')).toBeVisible()
 await page.screenshot({path:path.join(directory,'assessment.png'),fullPage:true})
 }
 await page.getByRole('button',{name:'Back to interviews',exact:true}).click()
 }
 await page.getByRole('button',{name:'Start AI interview',exact:true}).click()
 await page.getByLabel('Your AI interview answer').fill('I used a saved example to evaluate performance.')
 await page.getByRole('button',{name:'Send answer',exact:true}).click()
 await expect(page.getByText('Which tradeoff did you consider?',{exact:true})).toBeVisible()
 await app.close()
 app=await electron.launch({args:[root,'--user-data-dir='+directory],env});await mock(app);page=await app.firstWindow()
 await page.getByRole('button',{name:'Mock Interviews',exact:true}).click()
 await page.getByRole('button',{name:'AI interview',exact:true}).click()
 await page.getByRole('button',{name:/Frontend Developer · Technical.*interrupted/}).click()
 await expect(page.getByText('I used a saved example to evaluate performance.',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Continue with text',exact:true}).click()
 await expect(page.getByLabel('Your AI interview answer')).toBeVisible()
 expect(errors).toEqual([])
 }finally{await app.close()}
})

test('consented Realtime voice uses PCM playback and capture, pauses and switches to text',async()=>{
 const directory=path.resolve('test-results','interview-voice-'+Date.now())
 const app=await electron.launch({args:[root,'--user-data-dir='+directory,'--use-fake-device-for-media-stream'],env})
 try {
 await mock(app)
 await app.evaluate((_electron,root)=>{
  const load=process.getBuiltinModule('module').createRequire(root+'/package.json')
  const {EventEmitter}=load('node:events')
  const native=load('electron');native.systemPreferences.getMediaAccessStatus=()=> 'granted';native.dialog.showMessageBox=async()=>({response:1})
  const Service=load(root+'/dist-electron/electron/ai/interview-service.cjs').InterviewService
  const original=Service.prototype.connect
  const counters={chunks:0,turnDetection:null as any}
  ;(globalThis as any).interviewAudio=counters
  Service.prototype.connect=async function(owner:number,id:string){
   this.factory=()=>{
    const socket=new EventEmitter() as any;socket.socket=new EventEmitter();socket.socket.bufferedAmount=0
    socket.close=()=>socket.socket.emit('close')
    socket.send=(e:any)=>{
     if(e.type==='session.update'){counters.turnDetection=e.session.audio.input.turn_detection;setImmediate(()=>socket.emit('session.updated',{}))}
     if(e.type==='response.create')setImmediate(()=>{
      socket.emit('response.created',{})
      socket.emit('response.output_audio_transcript.done',{item_id:'question-1',transcript:'Tell me about a problem you solved.'})
      socket.emit('response.output_audio.delta',{delta:Buffer.alloc(4800).toString('base64')})
      socket.emit('response.done',{response:{status:'completed',usage:{input_tokens:2,output_tokens:2,total_tokens:4}}})
     })
     if(e.type==='input_audio_buffer.append'){
      counters.chunks++
      if(counters.chunks===3){
       socket.emit('input_audio_buffer.committed',{})
       socket.emit('conversation.item.input_audio_transcription.completed',{item_id:'answer-1',transcript:'I compared two approaches to solve the problem.'})
      }
     }
     if(e.type==='input_audio_buffer.commit')setImmediate(()=>socket.emit('conversation.item.input_audio_transcription.completed',{item_id:'answer-1',transcript:'I compared two approaches to solve the problem.'}))
    }
    setImmediate(()=>socket.emit('session.created',{}));return socket
   }
   return original.call(this,owner,id)
  }
 },root)
 const page=await configure(app)
 await page.getByLabel('Conversation mode').selectOption('voice')
 await expect(page.getByRole('button',{name:'Start AI interview',exact:true})).toBeDisabled()
 await page.getByRole('checkbox',{name:'I consent to microphone audio being sent to OpenAI.'}).check()
 await page.getByRole('button',{name:'Start AI interview',exact:true}).click()
 await expect(page.getByText('Tell me about a problem you solved.',{exact:true})).toBeVisible()
 await expect(page.getByText('I compared two approaches to solve the problem.',{exact:true})).toBeVisible()
 await expect.poll(()=>app.evaluate(()=>(globalThis as any).interviewAudio.chunks)).toBeGreaterThan(3)
 expect(await app.evaluate(()=>(globalThis as any).interviewAudio.turnDetection)).toEqual({type:'semantic_vad',eagerness:'low',create_response:true,interrupt_response:false})
 await page.getByRole('button',{name:'Pause interview',exact:true}).click()
 await expect(page.getByText('paused · microphone off',{exact:true})).toBeVisible()
 const count=await app.evaluate(()=>(globalThis as any).interviewAudio.chunks)
 await page.waitForTimeout(500)
 expect(await app.evaluate(()=>(globalThis as any).interviewAudio.chunks)).toBe(count)
 await page.getByRole('button',{name:'Continue with text',exact:true}).click()
 await expect(page.getByText('Which tradeoff did you consider?',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'End AI interview',exact:true}).click()
 await page.getByRole('button',{name:'Request interview feedback',exact:true}).click()
 await expect(page.getByText('3 / 5',{exact:true})).toHaveCount(4)
 }finally{await app.close()}
})
