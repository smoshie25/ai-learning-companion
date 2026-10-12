import { useEffect, useRef, useState } from 'react'
import { Mic, MessageSquare, Pause, Play, Square, ArrowRight, Trophy } from 'lucide-react'
import { Button } from './ui/button'
import { Badge, SectionHeading, EmptyState, PageHeader } from './shared'
import { rubric, type InterviewConfig, type InterviewSession } from '../../shared/interview-contracts.cts'
import type { Result } from '../../shared/contracts.cts'
import { captureSessionAudio, type AudioCapture } from '@/lib/audio-capture'
import { InterviewAudioPlayer } from '@/lib/interview-audio'
import { usePersistence } from '@/lib/workspace'

const initial: InterviewConfig = {role:'Frontend Developer',experience:'Entry-level',type:'Technical',durationMinutes:15,jobDescription:'',language:'English',mode:'text',consent:false}
const metric=(s:InterviewSession,id:typeof rubric[number]['id'])=>s.assessment?.[id].score
export function AIInterviewView() {
 const {flush}=usePersistence()
 const [config,setConfig]=useState(initial)
 const [session,setSession]=useState<InterviewSession|null>(null)
 const latest=useRef<InterviewSession|null>(null)
 const [history,setHistory]=useState<InterviewSession[]>([])
 const [answer,setAnswer]=useState('')
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const [speaking,setSpeaking]=useState(false)
 const [connected,setConnected]=useState(false)
 const [compare,setCompare]=useState('')
 const [now,setNow]=useState(Date.now())
 const transcript=useRef<HTMLDivElement|null>(null)
 const follow=useRef(true)
 const audio=useRef<AudioCapture|null>(null)
 const player=useRef<InterviewAudioPlayer|null>(null)
 const cursor=useRef(0)
 const alive=useRef(true)
 const update=(s:InterviewSession)=>{latest.current=s;if(alive.current)setSession(s)}
 const refresh=async()=>{const r=await window.companion?.interviews.list();if(r?.ok&&alive.current)setHistory(r.data)}
 const stop=async()=>{const a=audio.current;audio.current=null;await a?.stop();const p=player.current;player.current=null;await p?.stop();if(alive.current){setConnected(false);setSpeaking(false)}}
 const unwrap=<T,>(r:Result<T>)=>{if(!r.ok)throw new Error(r.error.message);return r.data}
 const operation=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await flush();await work()}catch(e){if(alive.current)setError(e instanceof Error?e.message:'The interview could not finish. Your saved answers are retained.')}finally{if(alive.current)setBusy(false);await refresh()}}
 const failure=()=>{void stop().then(async()=>{const s=latest.current;if(s?.state==='active'){const r=await window.companion!.interviews.pause({id:s.id});if(r.ok)update(r.data)}if(alive.current)setError('Voice was interrupted. Your received transcript is saved; resume or continue with text.')})}
 const voice=async(s:InterviewSession)=>{
  cursor.current=0
  const playback=new InterviewAudioPlayer();player.current=playback;await playback.start()
  let sequence=0
  try {
   audio.current=await captureSessionAudio({id:s.id,source:'microphone'},failure,{
    connect: input=>window.companion!.interviews.connect(input),
    audio: async input=>{
     // Turn taking avoids speaking over a question. Silence maintains VAD timing.
     const pcm=playback.speaking?btoa('\0'.repeat(atob(input.pcm).length)):input.pcm
     return window.companion!.interviews.audio({...input,sequence:sequence++,pcm})
    },
   })
   setConnected(true)
  }catch(e){await stop();const r=await window.companion!.interviews.pause({id:s.id});if(r.ok)update(r.data);throw e}
 }
 useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false;const s=latest.current;void stop().then(()=>{if(s?.state==='active')void window.companion?.interviews.pause({id:s.id})})}},[])
 useEffect(()=>{
  if(!session||session.state!=='active')return
  let stopped=false;let pending=false
  const timer=setInterval(()=>{setNow(Date.now());if(pending)return;pending=true;const s=latest.current;if(!s){pending=false;return}
   const poll=s.config.mode==='voice'?window.companion!.interviews.poll({id:s.id,after:cursor.current}):window.companion!.interviews.get({id:s.id})
   void poll.then(r=>{if(stopped||!r.ok)return;if('session' in r.data){update(r.data.session);for(const chunk of r.data.audio){if(chunk.sequence>cursor.current){player.current?.play(chunk.pcm);cursor.current=chunk.sequence}}setSpeaking(!!player.current?.speaking)}else update(r.data);if(latest.current?.state!=='active')void stop()}).catch(failure).finally(()=>{pending=false})
  },session.config.mode==='voice'?150:1000)
  return()=>{stopped=true;clearInterval(timer)}
 },[session?.id,session?.state,session?.config.mode])
 useEffect(()=>{if(follow.current&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight},[session?.turns])
 const elapsed=session?session.elapsedMs+(session.activeSince?Math.max(0,now-Date.parse(session.activeSince)):0):0
 const remaining=session?Math.max(0,session.config.durationMinutes*60-Math.floor(elapsed/1000)):0
 const comparable=history.filter(s=>s.id!==session?.id&&s.assessment&&s.config.role.toLowerCase()===session?.config.role.toLowerCase()&&s.config.experience===session?.config.experience&&s.config.type===session?.config.type&&s.config.language===session?.config.language&&s.assessment.rubricVersion===session?.assessment?.rubricVersion)
 const previous=comparable.find(s=>s.id===compare)
 return <div className="ai-interviews">
 <PageHeader eyebrow="PRACTICE BUILDS CONFIDENCE" title={session?.state==='ended'?'Reflect. Refine. Try again.':'Your next role starts here.'} description="Practice a thoughtful conversation, then learn from your own answers."/>
 {!window.companion&&<p className="ai-status-message">AI interviews require the Electron desktop app. Offline practice remains available.</p>}
 {error&&<p role="alert" className="ai-status-message">{error}</p>}
 {!session?<div className="interview-layout"><section className="card interview-setup">
 <span className="icon-tile"><MessageSquare size={25}/></span><h2>Practice a real conversation.</h2><p>An adaptive interviewer, tailored to your next role.</p>
 <form onSubmit={e=>{e.preventDefault();void operation(async()=>{const s=unwrap(await window.companion!.interviews.start(config));update(s);setAnswer('');if(s.config.mode==='voice')await voice(s)})}}>
 <label>Job role or career field<input list="interview-roles" required maxLength={150} value={config.role} onChange={e=>setConfig({...config,role:e.target.value})}/></label><datalist id="interview-roles">{['Frontend Developer','Data Analyst','UX Designer','Product Manager','Software Engineer'].map(v=><option key={v} value={v}/>)}</datalist>
 <label>AI experience level<select value={config.experience} onChange={e=>setConfig({...config,experience:e.target.value as InterviewConfig['experience']})}>{['Entry-level','Mid-level','Senior'].map(v=><option key={v}>{v}</option>)}</select></label>
 <div className="interview-form-row"><label>AI interview type<select value={config.type} onChange={e=>setConfig({...config,type:e.target.value as InterviewConfig['type']})}>{['Technical','Behavioral','General'].map(v=><option key={v}>{v}</option>)}</select></label>
 <label>Interview duration<select value={config.durationMinutes} onChange={e=>setConfig({...config,durationMinutes:Number(e.target.value)})}>{[5,15,30,45,60].map(v=><option key={v} value={v}>{v} minutes</option>)}</select></label></div>
 <label>Preferred interview language<input list="interview-languages" required maxLength={80} value={config.language} onChange={e=>setConfig({...config,language:e.target.value})}/></label><datalist id="interview-languages">{['English','French','Spanish','Portuguese','German','Arabic','Hindi','Japanese'].map(v=><option key={v} value={v}/>)}</datalist>
 <label>Job description (optional)<textarea rows={3} maxLength={8000} value={config.jobDescription} onChange={e=>setConfig({...config,jobDescription:e.target.value})} placeholder="Responsibilities, skills, and context"/></label>
 <label>Conversation mode<select value={config.mode} onChange={e=>setConfig({...config,mode:e.target.value as 'text'|'voice',consent:false})}><option value="text">Text · low bandwidth</option><option value="voice">Voice · Realtime conversation</option></select></label>
 {config.mode==='voice'&&<label className="interview-consent"><input type="checkbox" checked={config.consent} onChange={e=>setConfig({...config,consent:e.target.checked})}/>I consent to microphone audio being sent to OpenAI.</label>}
 <p className="form-note left">Questions, answers, and optional job context are sent to OpenAI. Transcripts and feedback stay saved locally. Voice is AI-generated; headphones are recommended.</p>
 <Button className="full-width" disabled={busy||!window.companion||(config.mode==='voice'&&!config.consent)}>{busy?'Preparing…':'Start AI interview'}<ArrowRight size={16}/></Button></form>
 </section><aside className="interview-aside"><div className="quote-card"><span className="eyebrow">THINK OUT LOUD</span><h2>Your reasoning is part of your answer.</h2><div className="quote-art"><Trophy size={65}/></div></div><section className="card tips-card"><h3>A consistent practice rubric</h3>{rubric.map(r=><div key={r.id}><strong>{r.label}</strong><p>{r.description}</p></div>)}<p>Scores use a 0–5 scale. Missing evidence stays unscored. Feedback assesses this practice, without predicting hiring outcomes.</p></section></aside></div>:<section className="card interview-active">
 <div className="section-heading"><div><Badge tone="green">{session.config.role} · {session.config.type}</Badge><p className="form-note left">{session.config.experience} · {session.config.language} · {session.config.mode==='voice'?'Voice':'Text'} · {session.state==='ended'?Math.floor(elapsed/60000)+' min active':Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0')+' remaining'}</p></div><Button variant="ghost" disabled={busy} onClick={()=>void operation(async()=>{await stop();if(session.state==='active')update(unwrap(await window.companion!.interviews.pause({id:session.id})));latest.current=null;setSession(null)})}>Back to interviews</Button></div>
 <div className="interview-controls">
 <Badge tone={session.state==='active'?'green':'orange'}>{session.state==='active'&&session.config.mode==='voice'?(connected?(speaking?'Interviewer speaking · microphone muted':'Listening · audio sent to OpenAI'):'Connecting · microphone authorized'):session.state==='active'?'Interview in progress':session.state==='ended'?'Interview ended · saved locally':session.state+' · microphone off'}</Badge>
 {session.state==='active'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void operation(async()=>{await stop();update(unwrap(await window.companion!.interviews.pause({id:session.id})))})}><Pause size={15}/>Pause interview</Button>}
 {['paused','interrupted'].includes(session.state)&&<><Button size="sm" disabled={busy} onClick={()=>void operation(async()=>{const s=unwrap(await window.companion!.interviews.resume({id:session.id,mode:'text',consent:false}));update(s);setAnswer('')})}><Play size={15}/>Continue with text</Button><Button size="sm" variant="outline" disabled={busy} onClick={()=>void operation(async()=>{const s=unwrap(await window.companion!.interviews.resume({id:session.id,mode:'voice',consent:true}));update(s);if(s.state==='active')await voice(s)})}><Mic size={15}/>Resume voice with consent</Button><span className="form-note">Resuming voice authorizes microphone audio to OpenAI.</span></>}
 {session.state!=='ended'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void operation(async()=>{await stop();update(unwrap(await window.companion!.interviews.end({id:session.id})))})}><Square size={15}/>End AI interview</Button>}
 </div>
 {session.notices.length>0&&<details className="interview-notices"><summary>Connection and recovery notes ({session.notices.length})</summary>{session.notices.map((n,i)=><p key={i}>{n}</p>)}</details>}
 <div className="interview-transcript" role="region" ref={transcript} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80}} aria-label="Interview conversation">{session.turns.length?session.turns.map(turn=><article className={'interview-turn '+turn.role} key={turn.id}><span className="eyebrow">{turn.role==='user'?'YOUR ANSWER':'INTERVIEWER'}{turn.status==='partial'?' · PARTIAL':''}</span><p>{turn.text||'Transcribing…'}</p></article>):<p className="muted">The interviewer is preparing your first question.</p>}</div>
 {session.state==='active'&&session.config.mode==='text'&&<form onSubmit={e=>{e.preventDefault();const text=answer;void operation(async()=>{const s=unwrap(await window.companion!.interviews.answer({id:session.id,text}));update(s);setAnswer('')})}}><label>Your AI interview answer<textarea rows={5} maxLength={12000} required value={answer} onChange={e=>setAnswer(e.target.value)} disabled={busy} placeholder="Explain your approach, examples, and tradeoffs…"/></label><Button disabled={busy||!answer.trim()||session.turns.at(-1)?.role!=='assistant'}>{busy?'Interviewer thinking…':'Send answer'}<ArrowRight size={16}/></Button></form>}
 {session.state==='ended'&&<div className="interview-assessment"><SectionHeading title="Your practice assessment" subtitle="Evidence from your saved answers"/><Button disabled={busy||!session.turns.some(t=>t.role==='user'&&t.status==='final'&&t.text.trim())} onClick={()=>void operation(async()=>update(unwrap(await window.companion!.interviews.evaluate({id:session.id}))))}>{busy?'Reviewing answers…':session.assessment?'Regenerate feedback':'Request interview feedback'}</Button>
 {session.assessment&&<><p className="form-note left">0–5 rubric scores reflect this interview only. Partial answers are excluded; differences in question difficulty, duration, or conversation mode can affect comparisons.</p><div className="interview-score-grid">{rubric.map(r=>{const d=session.assessment![r.id];return <article className="interview-score" key={r.id}><h3>{r.label}</h3><strong>{d.score===null?'Not enough evidence':d.score+' / 5'}</strong><p>{d.explanation}</p>{d.evidence.map((e,i)=><blockquote key={i}>{e.quote}<small>Answer {session.turns.filter(t=>t.role==='user').findIndex(t=>t.id===e.turnId)+1}</small></blockquote>)}</article>})}</div><div className="interview-score-grid">{(['strengths','improvements'] as const).map(kind=><div key={kind}><h3>{kind==='strengths'?'Strengths':'Areas to improve'}</h3>{session.assessment![kind].map((item,i)=><article key={i}><p>{item.text}</p>{item.evidence.map((e,j)=><blockquote key={j}>{e.quote}</blockquote>)}</article>)}</div>)}</div><h3>Recommended practice topics</h3><ul>{session.assessment.practiceTopics.map((topic,i)=><li key={i}>{topic}</li>)}</ul>
 <label>Compare with a previous interview<select value={compare} onChange={e=>setCompare(e.target.value)}><option value="">Select a comparable session</option>{comparable.map(s=><option key={s.id} value={s.id}>{new Date(s.startedAt).toLocaleString()} · {s.config.durationMinutes} min · {s.config.mode}</option>)}</select></label>
 {previous?<table className="interview-comparison"><caption>Same role, level, type, language, and rubric. Scores are practice signals.</caption><thead><tr><th>Dimension</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>{rubric.map(r=>{const a=metric(previous,r.id);const b=metric(session,r.id);const delta=a!=null&&b!=null?b-a:null;return <tr key={r.id}><th>{r.label}</th><td>{a??'—'}</td><td>{b??'—'}</td><td>{delta===null?'—':(delta>0?'+':'')+delta}</td></tr>})}</tbody></table>:!comparable.length&&<p className="form-note left">Complete another interview for the same role, level, type, and language to compare scores.</p>}</>}
 </div>}
 </section>}
 {!session&&<section className="card interview-history"><SectionHeading title="AI interview history" subtitle="Saved conversations, recoverable sessions, and feedback"/>{history.length?history.map(s=><button key={s.id} disabled={busy} onClick={()=>{update(s);setCompare('');setAnswer('');setError('')}}><span><strong>{s.config.role} · {s.config.type}</strong><small className="task-subject">{new Date(s.startedAt).toLocaleString()} · {s.config.experience} · {s.state} · {s.assessment?'Assessed':s.turns.filter(t=>t.role==='user'&&t.status==='final').length+' answers'}</small></span><ArrowRight size={17}/></button>):<EmptyState title="Your next conversation starts here" description="Completed and interrupted interviews will appear here, with your saved answers."/>}</section>}
 </div>
}
