import { createHash } from 'node:crypto'
import type { ActionRecord,EmailAction,CalendarAction } from '../../shared/action-contracts.cjs'
import { GoogleOAuth,providerFetch,type ProviderFetch } from './google-oauth.cjs'
import { AppError } from '../ai/errors.cjs'
import { validateCalendar } from '../actions/validation.cjs'
export class ProviderError extends AppError {constructor(code:string,message:string,readonly uncertain=false){super(code,message)}}
export interface ExternalProvider {grantId():Promise<string>;execute(action:ActionRecord):Promise<{providerId:string;message:string}>}
export class GoogleCalendarAdapter implements ExternalProvider {
 constructor(private oauth:GoogleOAuth,private network:ProviderFetch=providerFetch){}
 async grantId(){const token=await this.oauth.authorization('calendar');if(!token)throw new AppError('AUTHORIZATION_REQUIRED','Connect Google Calendar in Settings before approving this event.');return token.grantId}
 async execute(action:ActionRecord){
  if(action.action.kind!=='calendar_event'&&action.action.kind!=='calendar_reminder')throw new AppError('INVALID_ACTION','Not a calendar event.')
  const token=await this.oauth.access('calendar',action.grantId!);const id='alc'+createHash('sha256').update(action.id+action.digest).digest('hex');const url='https://www.googleapis.com/calendar/v3/calendars/primary/events'
  const existing=async()=>{let res:Response;try{res=await this.network(url+'/'+id,{method:'GET',headers:{Authorization:'Bearer '+token.accessToken}})}catch{throw new ProviderError('PROVIDER_UNAVAILABLE','Calendar could not be checked. No new event was attempted.')}if(res.status===404)return null;if(!res.ok)throw new ProviderError('PROVIDER_PERMISSION','Google Calendar could not be read with the granted permission.');const data=await res.json() as any;if(data.id!==id||data.extendedProperties?.private?.companionDigest!==action.digest)throw new ProviderError('PROVIDER_CONFLICT','The calendar event ID is already associated with different content.');const approved=action.action.data as CalendarAction;if(data.summary!==approved.title||data.description!==approved.description||Date.parse(data.start?.dateTime)!==Date.parse(approved.start)||Date.parse(data.end?.dateTime)!==Date.parse(approved.end))throw new ProviderError('PROVIDER_CONFLICT','The existing calendar event was changed. Review it in Calendar before reconciling this action.');return {providerId:id,message:'Study event exists in the connected primary calendar.'}}
  const found=await existing();if(found)return found
  validateCalendar(action.action.data);const data:CalendarAction=action.action.data
  let response:Response
  try{response=await this.network(url+'?sendUpdates=none',{method:'POST',headers:{Authorization:'Bearer '+token.accessToken,'content-type':'application/json'},body:JSON.stringify({id,summary:data.title,description:data.description,start:{dateTime:data.start,timeZone:data.timeZone},end:{dateTime:data.end,timeZone:data.timeZone},reminders:{useDefault:false,overrides:[{method:'popup',minutes:data.reminderMinutes}]},extendedProperties:{private:{companionDigest:action.digest}}})})}
  catch{throw new ProviderError('CALENDAR_UNCERTAIN','Calendar creation was interrupted. Retry reconciliation using the same action; do not create a duplicate proposal.',true)}
  if(response.status===409){const found=await existing();if(found)return found;throw new ProviderError('PROVIDER_CONFLICT','Calendar returned an event conflict.')}
  if(!response.ok)throw new ProviderError(response.status>=500?'CALENDAR_UNCERTAIN':'PROVIDER_REJECTED',response.status>=500?'Calendar may have created the event. Reconcile this action before creating another.':'Google rejected this event. Review dates and permissions.',response.status>=500)
  let result:any;try{result=await response.json()}catch{throw new ProviderError('CALENDAR_UNCERTAIN','Calendar accepted the request but the response could not be read.',true)}
  if(result.id!==id)throw new ProviderError('CALENDAR_UNCERTAIN','Calendar returned an unexpected event identifier.',true)
  return {providerId:id,message:'Study event created in the connected primary calendar. No invitations were sent.'}
 }
}
export function buildEmail(data:EmailAction,sender:string,actionId:string){
 const chunks:string[]=[];let chunk='';for(const character of data.subject){if(Buffer.byteLength(chunk+character)>40){chunks.push(chunk);chunk=''}chunk+=character}if(chunk)chunks.push(chunk)
 const subject=chunks.map(s=>'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?=').join('\r\n ')
 const body=Buffer.from(data.body.replace(/\r?\n/g,'\r\n')).toString('base64').match(/.{1,76}/g)?.join('\r\n')??''
 return Buffer.from('From: '+sender+'\r\nTo: '+data.to.join(', ')+'\r\nSubject: '+subject+'\r\nDate: '+new Date().toUTCString()+'\r\nMessage-ID: <'+actionId+'@ai-learning-companion.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+body+'\r\n').toString('base64url')
}
export class GmailAdapter implements ExternalProvider {
 constructor(private oauth:GoogleOAuth,private network:ProviderFetch=providerFetch){}
 async grantId(){const token=await this.oauth.authorization('gmail');if(!token?.accountEmail)throw new AppError('AUTHORIZATION_REQUIRED','Connect Gmail in Settings before approving this email.');return token.grantId}
 async execute(action:ActionRecord){
  if(action.action.kind!=='email')throw new AppError('INVALID_ACTION','Not an email draft.')
  const token=await this.oauth.access('gmail',action.grantId!);if(!token.accountEmail)throw new AppError('AUTHORIZATION_REQUIRED','A verified Gmail sender identity is required.')
  let response:Response
  try{response=await this.network('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+token.accessToken,'content-type':'application/json'},body:JSON.stringify({raw:buildEmail(action.action.data,token.accountEmail,action.id)})})}
  catch{throw new ProviderError('EMAIL_UNCERTAIN','Email delivery is uncertain. Check the connected account’s Sent folder. Automatic resend is blocked.',true)}
  if(!response.ok)throw new ProviderError(response.status>=500?'EMAIL_UNCERTAIN':'PROVIDER_REJECTED',response.status>=500?'Gmail may have sent this email. Check Sent mail; automatic resend is blocked.':'Gmail rejected this email. Check permissions and recipients before retrying.',response.status>=500)
  let result:any;try{result=await response.json()}catch{throw new ProviderError('EMAIL_UNCERTAIN','Gmail accepted the send but its response could not be read. Check Sent mail.',true)}
  if(typeof result.id!=='string'||!result.id||result.id.length>300)throw new ProviderError('EMAIL_UNCERTAIN','Gmail accepted the send without a valid message ID. Check Sent mail.',true)
  return {providerId:result.id,message:'Email sent from '+token.accountEmail+'.'}
 }
}
