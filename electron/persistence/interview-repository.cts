import type { DatabaseSync } from 'node:sqlite'
import { interviewSessionSchema, type InterviewSession, type InterviewTurn } from '../../shared/interview-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
export class InterviewRepository {
 constructor(private db: DatabaseSync) {}
 save(value: InterviewSession) {
  const session = interviewSessionSchema.parse(value)
  if (session.turns.reduce((n,t)=>n+t.text.length,0)>100000) throw new AppError('INTERVIEW_LIMIT','This interview reached its transcript limit. End it and request feedback.')
  this.db.prepare('INSERT INTO ai_interviews VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(session.id,session.state,session.startedAt,JSON.stringify(session))
  return session
 }
 get(id:string) { const row=this.db.prepare('SELECT data FROM ai_interviews WHERE id=?').get(id); if(!row) throw new AppError('NOT_FOUND','This interview is unavailable.'); return interviewSessionSchema.parse(JSON.parse(row.data as string)) }
 turn(id:string,turn:InterviewTurn) { const session=this.get(id); const old=session.turns.find(t=>t.itemId===turn.itemId&&t.role===turn.role); if(old?.status==='final') return session; return this.save({...session,turns:old?session.turns.map(t=>t.id===old.id?{...turn,id:old.id}:t):[...session.turns,turn]}) }
 list() { return this.db.prepare('SELECT data FROM ai_interviews ORDER BY started_at DESC LIMIT 100').all().map(row=>interviewSessionSchema.parse(JSON.parse(row.data as string))) }
 recover() { for(const row of this.db.prepare("SELECT id FROM ai_interviews WHERE state='active'").all()) { const s=this.get(row.id as string); this.save({...s,state:'interrupted',activeSince:null,notices:[...s.notices.slice(-29),'The app closed. Saved answers were retained; unsent audio may be missing. Resume explicitly to continue.']}) } }
}
