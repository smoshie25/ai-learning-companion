import { ActionEngine } from '../actions/engine.cjs'
import { watchPayloadSchema,type WatchPayload } from '../../shared/action-contracts.cjs'
import { opportunitySchema,type Opportunity } from '../../shared/monitoring-contracts.cjs'
import { MonitoringRepository } from './repository.cjs'
import { AppError } from '../ai/errors.cjs'
export class OpportunityWorker {
 constructor(readonly repository:MonitoringRepository,private engine:ActionEngine,private search:(query:string)=>Promise<Opportunity[]>,private now=Date.now){}
 async run(){const outcomes:Array<{watchId:string;state:string;message:string}>=[];let checked=0
  for(const candidate of this.engine.repository.watches().filter(w=>w.enabled)){
   const watch=watchPayloadSchema.parse({query:candidate.query,categories:candidate.categories,intervalHours:candidate.intervalHours,freeOnly:candidate.freeOnly,...(candidate.notificationTo?{notificationTo:candidate.notificationTo}:{})});const id=candidate.id
   const at=this.now();const token=checked<20?this.repository.claim(id,at):null;if(token)checked++
   if(token){let state='success',message='';const heartbeat=setInterval(()=>{try{this.repository.renew(id,token,this.now())}catch{}},30000)
    try{const results=(await this.search([watch.query,...watch.categories,watch.freeOnly?'explicitly free learning access':''].join(' '))).slice(0,6);let changes=0
     if(!this.repository.enabled(id))throw new AppError('WATCH_DISABLED','The watch was disabled during search.')
     for(const item of results){const o=this.repository.save(opportunitySchema.parse(item));if(watch.freeOnly&&o.free!==true)continue;if(this.repository.observe(id,o))changes++}
     message=`Checked ${results.length} sources; ${changes} new or changed matches. Email proposals require review.`
    }catch(error){state='failed';message=error instanceof AppError?error.code+': Monitoring could not complete.':'MONITORING_FAILED: Search or result validation failed; no fabricated matches were substituted.'}
    clearInterval(heartbeat);this.repository.finish(id,token,this.now(),watch.intervalHours,state,message);outcomes.push({watchId:id,state,message})
   }
   await this.notifications(id,watch,outcomes)
  }return {outcomes,note:'One worker invocation completed. This process does not install a background scheduler.'}
 }
 private async notifications(id:string,watch:WatchPayload,outcomes:Array<{watchId:string;state:string;message:string}>){
  if(!this.repository.enabled(id))return
  for(const alert of this.repository.alerts(id)){
   try{
    let actionId=alert.actionId
    if(!actionId&&watch.notificationTo){const o=alert.opportunity;const fact=(name:string,f:Opportunity['cost'])=>`${name}: ${f?f.value+'\nSource excerpt: '+f.quote:'Unverified'}`
     const action=this.engine.propose({idempotencyKey:'alert_'+alert.id,rationale:'New or changed result for approved watch: '+watch.query,action:{kind:'email',data:{to:[watch.notificationTo],subject:'Learning opportunity: '+o.title.slice(0,120),body:[o.title,o.url,`Provider: ${o.provider}`,fact('Cost',o.cost),fact('Eligibility',o.eligibility),fact('Deadline',o.deadline),`Checked: ${o.checkedAt}`,o.note,'This is a source match, not an eligibility or admission guarantee.'].join('\n\n')}}});this.repository.attach(alert.id,action.id);actionId=action.id
    }
    if(!actionId)continue
    let action=this.engine.repository.get(actionId)
    // A worker never grants approval or retries failed/uncertain Gmail sends.
    if(action.state==='approved'&&this.repository.enabled(id))action=await this.engine.execute(actionId)
    this.repository.state(alert.id,action.state==='succeeded'?'sent':action.state)
    if(action.state==='succeeded'&&alert.state!=='sent'){this.repository.record(id,'sent','Approved opportunity notification sent.',this.now());outcomes.push({watchId:id,state:'sent',message:'Approved notification sent.'})}
    if(['failed','uncertain'].includes(action.state)&&action.state!==alert.state){this.repository.record(id,action.state,'Notification execution did not confirm delivery. Review its Action Center outcome.',this.now());outcomes.push({watchId:id,state:action.state,message:'Notification delivery was not confirmed. Review its Action Center outcome.'})}
   }catch(error){const message=error instanceof AppError?error.code+': Notification requires review or authorization.':'NOTIFICATION_FAILED: Notification could not be prepared.';this.repository.record(id,'failed',message,this.now());outcomes.push({watchId:id,state:'failed',message})}
  }
 }
}
