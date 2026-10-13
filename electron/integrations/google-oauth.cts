import { createServer } from 'node:http'
import { randomBytes,randomUUID,createHash,timingSafeEqual } from 'node:crypto'
import { googleClientSchema,googleTokenSchema,type GoogleFeature,type GoogleToken,type IntegrationStatus } from '../../shared/action-contracts.cjs'
import { ActionRepository } from '../actions/repository.cjs'
import { ProviderVault } from './vault.cjs'
import { AppError } from '../ai/errors.cjs'
export const scopes={calendar:'https://www.googleapis.com/auth/calendar.events.owned',gmail:'https://www.googleapis.com/auth/gmail.send'} as const
export type ProviderFetch=(url:string,options:RequestInit)=>Promise<Response>
export const providerFetch:ProviderFetch=(url,options)=>fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)})
export class GoogleOAuth {
 private connecting=false
 private cancelCurrent?:()=>void
 cancelConnect(){this.cancelCurrent?.();return null}
 constructor(private vault:ProviderVault,private repository:ActionRepository,private open:(url:string)=>Promise<void>,private network:ProviderFetch=providerFetch){}
 private async client(){const client=await this.vault.read('client',googleClientSchema);if(!client)throw new AppError('OAUTH_CLIENT_REQUIRED','Configure a Google Desktop OAuth client in Settings first.');return client}
 async status():Promise<IntegrationStatus>{let clientConfigured=false;let calendarConnected=false;let gmailConnected=false;let gmailAccount:string|null=null;let calendarGrantId:string|null=null;let gmailGrantId:string|null=null;try{clientConfigured=!!await this.vault.read('client',googleClientSchema);const calendar=await this.authorization('calendar');calendarConnected=!!calendar;calendarGrantId=calendar?.grantId??null;const token=await this.authorization('gmail');gmailConnected=!!token;gmailAccount=token?.accountEmail??null;gmailGrantId=token?.grantId??null}catch{}return {clientConfigured,secureStorage:await this.vault.available(),calendarConnected,gmailConnected,gmailAccount,calendarGrantId,gmailGrantId,calendarScope:scopes.calendar,gmailScope:scopes.gmail}}
 async saveClient(input:unknown){if(this.connecting||this.repository.hasExecuting())throw new AppError('BUSY','Wait for authorization or active actions before changing the OAuth client.');const client=googleClientSchema.parse(input);this.repository.setGrant('calendar',null);this.repository.setGrant('gmail',null);await this.vault.write('client',client);await this.vault.remove('calendar');await this.vault.remove('gmail');return this.status()}
 async authorization(feature:GoogleFeature){const token=await this.vault.read(feature,googleTokenSchema);if(!token||token.grantId!==this.repository.grant(feature))return null;const client=await this.client();if(token.clientId!==client.clientId||!token.scopes.includes(scopes[feature]))return null;return token}
 private async tokenRequest(body:URLSearchParams){let response:Response;try{response=await this.network('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:body.toString()})}catch{throw new AppError('OAUTH_UNAVAILABLE','Google authorization could not complete. Try again.')}if(!response.ok)throw new AppError('OAUTH_REJECTED','Google rejected authorization. Check the Desktop OAuth client, permissions, and account.');let data:any;try{data=await response.json()}catch{throw new AppError('OAUTH_REJECTED','Google returned an invalid token response.')}if(typeof data.access_token!=='string'||data.access_token.length>5000||typeof data.expires_in!=='number'||!Number.isInteger(data.expires_in)||data.expires_in<=0||data.expires_in>604800||!data.access_token||data.scope!==undefined&&typeof data.scope!=='string'||data.refresh_token!==undefined&&(typeof data.refresh_token!=='string'||!data.refresh_token||data.refresh_token.length>5000))throw new AppError('OAUTH_REJECTED','Google returned an invalid token response.');return data}
 async connect(feature:GoogleFeature){
  if(this.connecting||this.repository.hasExecuting())throw new AppError('BUSY','Wait for the active authorization or execution to finish.')
  this.connecting=true
  let cancelled=false
  try{
   const client=await this.client();const verifier=randomBytes(32).toString('base64url');const state=randomBytes(32).toString('base64url');const callbackPath='/oauth/'+randomBytes(16).toString('hex')
   let redirect='';let accept:(code:string)=>void=()=>{};let decline:(error:AppError)=>void=()=>{};let timer:ReturnType<typeof setTimeout>|undefined
   const server=createServer((req,res)=>{
    const reply=(status:number,text:string)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'"});res.end(text)}
    if(!redirect){reply(503,'Authorization is starting.');return}
    let url:URL;try{url=new URL(req.url??'/',redirect)}catch{reply(400,'Invalid request.');return}
    const candidate=url.searchParams.get('state')??''
    if(req.method!=='GET'||url.pathname!==callbackPath||req.headers.host!==new URL(redirect).host||Buffer.byteLength(candidate)!==Buffer.byteLength(state)||!timingSafeEqual(Buffer.from(candidate),Buffer.from(state))){reply(400,'Invalid authorization callback.');return}
    if(url.searchParams.has('error')){reply(400,'Authorization was not granted. Return to Companion.');decline(new AppError('OAUTH_DENIED','Google authorization was cancelled or denied.'));return}
    const code=url.searchParams.get('code');if(!code||code.length>2000){reply(400,'Invalid authorization code.');return}
    reply(200,'Authorization received. You can return to AI Learning Companion.');accept(code)
   })
   server.maxHeadersCount=30;server.requestTimeout=5000
   try{
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve())})
    const address=server.address();if(!address||typeof address==='string')throw new AppError('OAUTH_UNAVAILABLE','Loopback authorization could not start.')
    redirect='http://127.0.0.1:'+address.port+callbackPath
    const codePromise=new Promise<string>((resolve,reject)=>{accept=resolve;decline=reject;timer=setTimeout(()=>reject(new AppError('OAUTH_TIMEOUT','Google authorization timed out. Reconnect to try again.')),120000)})
    this.cancelCurrent=()=>{cancelled=true;decline(new AppError('OAUTH_CANCELLED','Google authorization was cancelled.'))}
    void codePromise.catch(()=>{})
    const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:client.clientId,redirect_uri:redirect,response_type:'code',scope:feature==='gmail'?scopes.gmail+' openid email':scopes.calendar,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false'}).toString()
    await this.open(auth.href);const code=await codePromise
    const result=await this.tokenRequest(new URLSearchParams({client_id:client.clientId,...(client.clientSecret?{client_secret:client.clientSecret}:{}),code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:redirect}))
    const granted=typeof result.scope==='string'?result.scope.split(' '):[]
    if(!granted.includes(scopes[feature])||typeof result.refresh_token!=='string'||!result.refresh_token)throw new AppError('SCOPE_REQUIRED','Google did not grant the requested permission or offline access. Reconnect and approve the displayed scope.')
    let accountEmail:string|null=null
    if(feature==='gmail'){
     const identity=await this.network('https://openidconnect.googleapis.com/v1/userinfo',{method:'GET',headers:{Authorization:'Bearer '+result.access_token}})
     if(!identity.ok)throw new AppError('SCOPE_REQUIRED','Google sender identity could not be verified.')
     const user=await identity.json() as any
     if(user.email_verified!==true||typeof user.email!=='string')throw new AppError('SCOPE_REQUIRED','A verified sender email is required.')
     accountEmail=user.email
    }
    const token=googleTokenSchema.parse({accountEmail,accessToken:result.access_token,refreshToken:result.refresh_token,expiresAt:Date.now()+result.expires_in*1000,scopes:granted,grantId:randomUUID(),clientId:client.clientId})
    if(cancelled)throw new AppError('OAUTH_CANCELLED','Google authorization was cancelled.')
    await this.vault.write(feature,token);if(cancelled)throw new AppError('OAUTH_CANCELLED','Google authorization was cancelled.');this.repository.setGrant(feature,token.grantId)
    return this.status()
   }finally{clearTimeout(timer);server.close();server.closeAllConnections()}
  }finally{this.connecting=false;this.cancelCurrent=undefined}
 }
 async access(feature:GoogleFeature,grantId:string){
  let token=await this.authorization(feature);if(!token||token.grantId!==grantId)throw new AppError('AUTHORIZATION_CHANGED','Connect Google and approve this action for the current account before executing.')
  if(token.expiresAt<=Date.now()+60000){
   const client=await this.client();const result=await this.tokenRequest(new URLSearchParams({client_id:client.clientId,...(client.clientSecret?{client_secret:client.clientSecret}:{}),grant_type:'refresh_token',refresh_token:token.refreshToken}))
   if(result.scope&&!(result.scope as string).split(' ').includes(scopes[feature]))throw new AppError('SCOPE_REQUIRED','The required Google permission is no longer granted.')
   token=googleTokenSchema.parse({...token,accessToken:result.access_token,refreshToken:result.refresh_token??token.refreshToken,expiresAt:Date.now()+result.expires_in*1000})
   if(this.repository.grant(feature)!==grantId)throw new AppError('AUTHORIZATION_CHANGED','Google authorization changed during execution.')
   await this.vault.write(feature,token)
  }
  return token
 }
 async disconnect(feature:GoogleFeature){if(this.connecting||this.repository.hasExecuting())throw new AppError('BUSY','Wait for active authorization and actions before disconnecting.');let token:GoogleToken|null=null;try{token=await this.authorization(feature)}catch{}this.repository.setGrant(feature,null);await this.vault.remove(feature);if(token)try{await this.network('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:token.refreshToken}).toString()})}catch{}return this.status()}
}
