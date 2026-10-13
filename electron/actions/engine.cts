import { randomUUID } from 'node:crypto'
import { proposeActionSchema,type ActionProposal,type ActionPayload,type ActionRecord } from '../../shared/action-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
import { ActionRepository } from './repository.cjs'
import { actionDigest,validateAction } from './validation.cjs'
import { ProviderError,type ExternalProvider } from '../integrations/google-adapters.cjs'
export class ActionEngine {
 constructor(readonly repository:ActionRepository,private calendar:ExternalProvider,private gmail:ExternalProvider){}
 propose(input:ActionProposal){const proposal=proposeActionSchema.safeParse(input);if(!proposal.success)throw new AppError('VALIDATION','The action proposal is invalid.');const action=validateAction(proposal.data.action,false);const digest=actionDigest(action);const existing=this.repository.find(input.idempotencyKey,digest);if(existing){if(existing.idempotencyKey===input.idempotencyKey&&existing.digest!==digest)throw new AppError('IDEMPOTENCY_CONFLICT','This idempotency key belongs to a different action.');return existing}validateAction(action);const now=new Date().toISOString();return this.repository.insert({id:randomUUID(),idempotencyKey:input.idempotencyKey,digest:actionDigest(action),revision:1,rationale:input.rationale,action,state:'proposed',createdAt:now,updatedAt:now,approvedAt:null,approvedDigest:null,grantId:null,outcome:null,errorCode:null})}
 edit(id:string,payload:ActionPayload,rationale:string){const action=validateAction(payload);return this.repository.update(id,a=>{if(!['proposed','approved','failed','rejected'].includes(a.state))throw new AppError('INVALID_STATE','Only unexecuted proposals or definitively failed actions can be edited.');return {...a,action,rationale,digest:actionDigest(action),revision:a.revision+1,state:'proposed',updatedAt:new Date().toISOString(),approvedAt:null,approvedDigest:null,grantId:null,outcome:null,errorCode:null}})}
 /** Called only from trusted desktop IPC. There is intentionally no MCP approval tool. */
 async approve(id:string,review:{digest:string;revision:number;grantId:string|null}){const current=this.repository.get(id);if(current.digest!==review.digest||current.revision!==review.revision)throw new AppError('STALE_APPROVAL','The proposal changed after you opened its review. Review it again.');if(!['proposed','approved','failed'].includes(current.state))throw new AppError('INVALID_STATE','This action cannot be approved in its current state.');validateAction(current.action);const grantId=current.action.kind==='email'?await this.gmail.grantId():current.action.kind.startsWith('calendar_')?await this.calendar.grantId():null;if(grantId!==review.grantId)throw new AppError('AUTHORIZATION_CHANGED','The connected Google account changed after review. Refresh and review this action again.');return this.repository.update(id,a=>{if(a.digest!==current.digest||a.revision!==current.revision||!['proposed','approved','failed'].includes(a.state))throw new AppError('STALE_APPROVAL','The proposal changed during review. Review its current contents.');const now=new Date().toISOString();return {...a,state:'approved',approvedAt:now,updatedAt:now,approvedDigest:a.digest,grantId,outcome:null,errorCode:null}})}
 reject(id:string){return this.repository.update(id,a=>{if(!['proposed','approved','failed'].includes(a.state))throw new AppError('INVALID_STATE','Executed or uncertain actions cannot be rejected as though they never happened.');return {...a,state:'rejected',updatedAt:new Date().toISOString(),approvedAt:null,approvedDigest:null,grantId:null}})}
 async execute(id:string){
  this.repository.recoverStale();const action=this.repository.claim(id);if(action.state==='succeeded')return action
  try{
   if(actionDigest(validateAction(action.action,false))!==action.digest)throw new AppError('STALE_APPROVAL','The stored action no longer matches its approved payload.')
   let result:{providerId:string;message:string}
   if(action.action.kind==='email')result=await this.gmail.execute(action)
   else if(action.action.kind==='calendar_event'||action.action.kind==='calendar_reminder')result=await this.calendar.execute(action)
   else if(action.action.kind==='learning_task')result={providerId:this.repository.createTask(action),message:'Approved learning task created locally.'}
   else result={providerId:this.repository.registerWatch(action),message:'Opportunity monitoring preference registered locally. Background polling is not enabled.'}
   return this.repository.finish(id,'succeeded',result.message,result.providerId)
  }catch(error){const known=error instanceof AppError;const uncertain=error instanceof ProviderError?error.uncertain:!known;return this.repository.finish(id,uncertain?'uncertain':'failed',known?error.message:'Execution was interrupted. The provider result is uncertain; check it before attempting another action.',null,known?error.code:'EXECUTION_UNCERTAIN')}
 }
}
