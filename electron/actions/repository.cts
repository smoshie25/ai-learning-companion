import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { actionSchema,type ActionRecord,type GoogleFeature } from '../../shared/action-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
import { transaction } from '../persistence/database.cjs'
export class ActionRepository {
 constructor(private db:DatabaseSync){}
 recoverStale(){for(const row of this.db.prepare("SELECT id FROM execution_actions WHERE state='executing' AND json_extract(data,'$.updatedAt')<=?").all(new Date(Date.now()-120000).toISOString()))this.finish(row.id as string,'uncertain','A previous execution stopped before recording its outcome. Check the provider; email resending is blocked.',null,'PROCESS_INTERRUPTED')}
 list(state?:ActionRecord['state'],limit=50){const rows=state?this.db.prepare('SELECT data FROM execution_actions WHERE state=? ORDER BY created_at DESC LIMIT ?').all(state,limit):this.db.prepare('SELECT data FROM execution_actions ORDER BY created_at DESC LIMIT ?').all(limit);return rows.map(r=>actionSchema.parse(JSON.parse(r.data as string)))}
 get(id:string){const row=this.db.prepare('SELECT data FROM execution_actions WHERE id=?').get(id);if(!row)throw new AppError('NOT_FOUND','This action is unavailable.');return actionSchema.parse(JSON.parse(row.data as string))}
 find(key:string,digest:string){const row=this.db.prepare('SELECT data FROM execution_actions WHERE idempotency_key=? OR digest=? ORDER BY created_at LIMIT 1').get(key,digest);return row?actionSchema.parse(JSON.parse(row.data as string)):null}
 insert(action:ActionRecord){return transaction(this.db,()=>{const old=this.find(action.idempotencyKey,action.digest);if(old){if(old.idempotencyKey===action.idempotencyKey&&old.digest!==action.digest)throw new AppError('IDEMPOTENCY_CONFLICT','This idempotency key already belongs to a different action.');return old}this.write(action);return action})}
 private write(value:ActionRecord){const a=actionSchema.parse(value);this.db.prepare('INSERT INTO execution_actions VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET digest=excluded.digest,state=excluded.state,data=excluded.data').run(a.id,a.idempotencyKey,a.digest,a.state,a.createdAt,JSON.stringify(a))}
 update(id:string,work:(a:ActionRecord)=>ActionRecord){return transaction(this.db,()=>{const a=work(this.get(id));const other=this.find('',a.digest);if(other&&other.id!==id)throw new AppError('IDEMPOTENCY_CONFLICT','An equivalent action already exists.');this.write(a);return a})}
 claim(id:string){return this.update(id,a=>{if(a.state==='succeeded')return a;if(a.state==='executing')throw new AppError('BUSY','This action is already executing.');
  if(a.state==='uncertain'&&a.action.kind==='email')throw new AppError('UNCERTAIN_DELIVERY','This email may already have been sent. Check Sent mail; automatic resending is blocked.')
  if(!['approved','failed','uncertain'].includes(a.state)||a.approvedDigest!==a.digest||!a.approvedAt)throw new AppError('APPROVAL_REQUIRED','Review and approve the current action in the desktop app before executing it.')
  return {...a,state:'executing',updatedAt:new Date().toISOString(),outcome:null,errorCode:null}
 })}
 finish(id:string,state:'succeeded'|'failed'|'uncertain',message:string,providerId:string|null=null,errorCode:string|null=null){return this.update(id,a=>{if(a.state!=='executing')throw new AppError('INVALID_STATE','The execution is no longer active.');const now=new Date().toISOString();this.db.prepare('INSERT INTO action_attempts VALUES (?,?,?,?,?,?)').run(randomUUID(),id,state,now,errorCode,JSON.stringify({providerId,message,revision:a.revision,digest:a.digest}));return {...a,state,updatedAt:now,outcome:{providerId,message},errorCode}})}
 hasExecuting(){return !!this.db.prepare("SELECT id FROM execution_actions WHERE state='executing' AND json_extract(data,'$.updatedAt')>? LIMIT 1").get(new Date(Date.now()-120000).toISOString())}
 grant(feature:GoogleFeature){return (this.db.prepare('SELECT grant_id FROM provider_grants WHERE feature=?').get(feature)?.grant_id as string|undefined)??null}
 setGrant(feature:GoogleFeature,id:string|null){this.db.prepare('INSERT INTO provider_grants VALUES (?,?) ON CONFLICT(feature) DO UPDATE SET grant_id=excluded.grant_id').run(feature,id)}
 createTask(a:ActionRecord){if(a.action.kind!=='learning_task')throw new AppError('INVALID_ACTION','Not a learning task.');this.db.prepare('INSERT OR IGNORE INTO mcp_learning_tasks VALUES (?,?,?)').run(a.id,0,JSON.stringify(a.action.data));return a.id}
 tasks(){return this.db.prepare('SELECT id,done,data FROM mcp_learning_tasks').all().map(r=>({id:r.id as string,done:!!r.done,...JSON.parse(r.data as string)}))}
 completeTask(id:string){const changed=this.db.prepare('UPDATE mcp_learning_tasks SET done=1 WHERE id=?').run(id);if(!changed.changes)throw new AppError('NOT_FOUND','This approved learning task is unavailable.')}
 registerWatch(a:ActionRecord){if(a.action.kind!=='opportunity_watch')throw new AppError('INVALID_ACTION','Not a monitoring preference.');this.db.prepare('INSERT OR IGNORE INTO opportunity_watches VALUES (?,?,?)').run(a.id,1,JSON.stringify(a.action.data));return a.id}
 watches(){return this.db.prepare('SELECT id,enabled,data FROM opportunity_watches').all().map(r=>({id:r.id as string,enabled:!!r.enabled,...JSON.parse(r.data as string)}))}
}
