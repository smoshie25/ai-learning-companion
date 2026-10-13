const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID,randomBytes,createCipheriv,createDecipheriv}=require('node:crypto')
const {mkdtempSync,readFileSync,rmSync}=require('node:fs')
const path=require('node:path')
const {tmpdir}=require('node:os')
const {openDatabase}=require('../dist-electron/electron/persistence/database.cjs')
const {WorkspaceRepository}=require('../dist-electron/electron/persistence/repositories.cjs')
const {IntelligenceRepository}=require('../dist-electron/electron/persistence/session-repository.cjs')
const {InterviewRepository}=require('../dist-electron/electron/persistence/interview-repository.cjs')
const {LearningRepository}=require('../dist-electron/electron/persistence/learning-repository.cjs')
const {ActionRepository}=require('../dist-electron/electron/actions/repository.cjs')
const {ActionEngine}=require('../dist-electron/electron/actions/engine.cjs')
const {validateAction}=require('../dist-electron/electron/actions/validation.cjs')
const {GmailAdapter,GoogleCalendarAdapter,buildEmail,ProviderError}=require('../dist-electron/electron/integrations/google-adapters.cjs')
const {ProviderVault}=require('../dist-electron/electron/integrations/vault.cjs')
const {GoogleOAuth,scopes}=require('../dist-electron/electron/integrations/google-oauth.cjs')
const {googleTokenSchema}=require('../dist-electron/shared/action-contracts.cjs')
const {createLearningMCP}=require('../dist-electron/electron/mcp/server.cjs')
const {seed}=require('./fixtures.cjs')
function setup(){const db=openDatabase(':memory:');const repo=new ActionRepository(db);const grant=randomUUID();let calls=0;const provider={grantId:async()=>grant,execute:async()=>{calls++;return {providerId:'mock-id',message:'Mock execution'}}};const engine=new ActionEngine(repo,provider,provider);return {db,repo,engine,provider,grant,calls:()=>calls}}
const email={kind:'email',data:{to:['learner@example.org'],subject:'Study follow-up',body:'Please review this practice example.'}}
const event=()=>({kind:'calendar_event',data:{title:'Study time',description:'Read notes.',start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+88200000).toISOString(),timeZone:'UTC',reminderMinutes:10}})
const proposal=action=>({idempotencyKey:randomUUID(),rationale:'A learning follow-up.',action})
const review=(a,grantId=null)=>({digest:a.digest,revision:a.revision,grantId})
test('external action validation rejects recipient injection, offset mismatches, invalid dates and unknown fields',()=>{
 assert.equal(validateAction(email).data.to[0],'learner@example.org')
 for(const input of [{...email,data:{...email.data,to:['bad@example.org\r\nBcc: hidden@example.org']}},{...email,data:{...email.data,subject:'Subject\r\nBcc: x@example.org'}},{...email,data:{...email.data,cc:['hidden@example.org']}},{...event(),data:{...event().data,timeZone:'Not/AZone'}},{...event(),data:{...event().data,end:'2020-01-01T00:00:00Z'}},{...event(),data:{...event().data,timeZone:'Africa/Lagos'}}])assert.throws(()=>validateAction(input))
 assert.throws(()=>validateAction({kind:'calendar_event',data:{...event().data,start:'2027-03-14T02:30:00-05:00',end:'2027-03-14T04:30:00-04:00',timeZone:'America/New_York'}}),{code:'INVALID_TIME_ZONE'})
})
test('idempotency prevents duplicate proposals and approval is tied to revision and connected grant',async()=>{
 const x=setup()
 try{
 const p=proposal(email);let a=x.engine.propose(p)
 assert.equal(x.engine.propose(p).id,a.id);assert.equal(x.engine.propose({...p,idempotencyKey:randomUUID()}).id,a.id)
 assert.throws(()=>x.engine.propose({...p,action:{...email,data:{...email.data,subject:'Different'}}}),{code:'IDEMPOTENCY_CONFLICT'})
 await assert.rejects(x.engine.execute(a.id),{code:'APPROVAL_REQUIRED'})
 await assert.rejects(x.engine.approve(a.id,review(a,randomUUID())),{code:'AUTHORIZATION_CHANGED'})
 a=await x.engine.approve(a.id,review(a,x.grant))
 a=x.engine.edit(a.id,{...email,data:{...email.data,body:'An edited follow-up.'}},'Changed after review')
 await assert.rejects(x.engine.execute(a.id),{code:'APPROVAL_REQUIRED'})
 await assert.rejects(x.engine.approve(a.id,{...review(a,x.grant),revision:a.revision-1}),{code:'STALE_APPROVAL'})
 a=await x.engine.approve(a.id,review(a,x.grant));await x.engine.execute(a.id);await x.engine.execute(a.id);assert.equal(x.calls(),1)
 }finally{x.db.close()}
})
test('atomic claims prevent concurrent executions from separate engine instances',async()=>{
 const x=setup()
 try{
 let resolve;x.provider.execute=()=>new Promise(r=>resolve=r)
 const a=x.engine.propose(proposal(email));await x.engine.approve(a.id,review(a,x.grant))
 const pending=x.engine.execute(a.id)
 const second=new ActionEngine(x.repo,x.provider,x.provider)
 await assert.rejects(second.execute(a.id),{code:'BUSY'})
 resolve({providerId:'sent-once',message:'Sent once'});assert.equal((await pending).state,'succeeded')
 }finally{x.db.close()}
})
test('calendar adapter reconciles ambiguous creation by deterministic event ID without a second POST',async()=>{
 const x=setup();let posts=0;const events=new Map()
 const oauth={authorization:async()=>({grantId:x.grant}),access:async(_feature,grant)=>{assert.equal(grant,x.grant);return {accessToken:'mock-access'}}}
 const adapter=new GoogleCalendarAdapter(oauth,async(url,request)=>{
 if(request.method==='GET'){const id=url.split('/').at(-1);return events.has(id)?new Response(JSON.stringify(events.get(id)),{status:200}):new Response('',{status:404})}
 posts++;const body=JSON.parse(request.body);assert.equal(body.attendees,undefined);assert.equal(body.reminders.overrides[0].method,'popup');events.set(body.id,body);throw new Error('Connection lost after provider committed')
 })
 const engine=new ActionEngine(x.repo,adapter,x.provider)
 try{
 let a=engine.propose(proposal(event()));a=await engine.approve(a.id,review(a,x.grant))
 a=await engine.execute(a.id);assert.equal(a.state,'uncertain')
 a=await engine.execute(a.id);assert.equal(a.state,'succeeded');assert.equal(posts,1);assert.ok(/^[a-v0-9]+$/.test(a.outcome.providerId))
 assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM action_attempts').get().n,2)
 }finally{x.db.close()}
})
test('Gmail adapter encodes reviewed recipients and content and blocks ambiguous delivery retry',async()=>{
 const x=setup();let calls=0
 const oauth={authorization:async()=>({grantId:x.grant,accountEmail:'sender@example.org'}),access:async()=>({accessToken:'mock-token',accountEmail:'sender@example.org'})}
 const gmail=new GmailAdapter(oauth,async(url,request)=>{calls++;assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');const mime=Buffer.from(JSON.parse(request.body).raw,'base64url').toString();assert.ok(mime.includes('To: learner@example.org'));assert.ok(mime.includes('From: sender@example.org'));assert.ok(mime.includes('Content-Transfer-Encoding: base64'));return new Response('',{status:503})})
 const engine=new ActionEngine(x.repo,x.provider,gmail)
 try{
 let a=engine.propose(proposal(email));a=await engine.approve(a.id,review(a,x.grant));a=await engine.execute(a.id);assert.equal(a.state,'uncertain')
 await assert.rejects(engine.execute(a.id),{code:'UNCERTAIN_DELIVERY'});assert.equal(calls,1);assert.equal(a.errorCode,'EMAIL_UNCERTAIN')
 assert.ok(!JSON.stringify(a).includes('mock-token'))
 }finally{x.db.close()}
})
test('revoked permissions fail before provider mutation and interrupted email claims stay uncertain',async()=>{
 const x=setup()
 try{
 const provider={grantId:async()=>x.grant,execute:async()=>{throw new ProviderError('SCOPE_REQUIRED','Reconnect Google.')}}
 const engine=new ActionEngine(x.repo,provider,provider);let a=engine.propose(proposal(email));await engine.approve(a.id,review(a,x.grant));a=await engine.execute(a.id);assert.equal(a.state,'failed');assert.equal(a.errorCode,'SCOPE_REQUIRED')
 await engine.approve(a.id,review(a,x.grant));x.repo.claim(a.id)
 x.repo.update(a.id,s=>({...s,updatedAt:new Date(Date.now()-180000).toISOString()}));x.repo.recoverStale()
 assert.equal(x.repo.get(a.id).state,'uncertain');await assert.rejects(engine.execute(a.id),{code:'UNCERTAIN_DELIVERY'})
 }finally{x.db.close()}
})
test('local tasks and watch registrations execute only after approval and survive repeat calls',async()=>{
 const x=setup()
 try{
 let a=x.engine.propose(proposal({kind:'learning_task',data:{title:'Practice SQL',subject:'SQL',deadline:null,durationMinutes:20,priority:'Medium'}}))
 await x.engine.approve(a.id,review(a));await x.engine.execute(a.id);await x.engine.execute(a.id);assert.equal(x.repo.tasks().length,1);x.repo.completeTask(a.id);assert.equal(x.repo.tasks()[0].done,true)
 a=x.engine.propose(proposal({kind:'opportunity_watch',data:{query:'Free data courses',categories:['Data'],intervalHours:24,freeOnly:true}}))
 await x.engine.approve(a.id,review(a));await x.engine.execute(a.id);assert.equal(x.repo.watches().length,1);assert.ok(x.repo.get(a.id).outcome.message.includes('not enabled'))
 }finally{x.db.close()}
})
function encryption(){const key=randomBytes(32);return {available:async()=>true,encrypt:async text=>{const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text),cipher.final(),cipher.getAuthTag()])},decrypt:async data=>{const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(-16));return {result:Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString()}}}}
test('Google OAuth uses loopback state, PKCE, minimal scopes and encrypted refresh credentials',async()=>{
 const x=setup();const dir=mkdtempSync(path.join(tmpdir(),'alc-google-'));const vault=new ProviderVault(dir,encryption());let authURL;let tokenBody
 const network=async(url,request)=>{
 if(url.includes('/token')){tokenBody=new URLSearchParams(request.body);return new Response(JSON.stringify({access_token:'mock-access-secret',refresh_token:'mock-refresh-secret',expires_in:3600,scope:scopes.gmail+' openid email'}),{status:200})}
 if(url.includes('/userinfo'))return new Response(JSON.stringify({email:'sender@example.org',email_verified:true}),{status:200})
 return new Response('',{status:200})
 }
 const oauth=new GoogleOAuth(vault,x.repo,async url=>{
 authURL=new URL(url);const redirect=authURL.searchParams.get('redirect_uri');const wrong=new URL(redirect);wrong.search=new URLSearchParams({state:'wrong',code:'bad'}).toString();assert.equal((await fetch(wrong)).status,400);wrong.search=new URLSearchParams({state:'é'.repeat(43),code:'bad'}).toString();assert.equal((await fetch(wrong)).status,400)
 const callback=new URL(redirect);callback.search=new URLSearchParams({state:authURL.searchParams.get('state'),code:'mock-code'}).toString();assert.equal((await fetch(callback)).status,200)
 },network)
 try{
 await oauth.saveClient({clientId:'test-client.apps.googleusercontent.com',clientSecret:'mock-client-secret'})
 const status=await oauth.connect('gmail');assert.equal(status.gmailConnected,true);assert.equal(status.gmailAccount,'sender@example.org');assert.equal(authURL.searchParams.get('code_challenge_method'),'S256');assert.equal(authURL.searchParams.get('scope'),scopes.gmail+' openid email');assert.ok(!authURL.href.includes('client_secret'));assert.equal(tokenBody.get('code_verifier').length,43)
 const encrypted=readFileSync(path.join(dir,'google-gmail.enc')).toString();assert.ok(!encrypted.includes('mock-refresh-secret'));assert.ok(!JSON.stringify(status).includes('mock-access-secret'))
 assert.equal((await oauth.authorization('gmail')).refreshToken,'mock-refresh-secret')
 await oauth.disconnect('gmail');assert.equal((await oauth.status()).gmailConnected,false)
 }finally{x.db.close();rmSync(dir,{recursive:true,force:true})}
})
test('official MCP client discovers tools, receives schemas, and cannot self-approve actions',async()=>{
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js')
 const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js')
 const x=setup();const workspace=new WorkspaceRepository(x.db);workspace.bootstrap(seed())
 const server=createLearningMCP(x.engine,workspace,new IntelligenceRepository(x.db),new InterviewRepository(x.db),new LearningRepository(x.db))
 const client=new Client({name:'integration-test',version:'1.0.0'});const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair()
 try{
 await Promise.all([server.connect(serverTransport),client.connect(clientTransport)])
 const tools=(await client.listTools()).tools;const names=tools.map(t=>t.name)
 for(const name of ['learning.sessions.list','learning.sessions.get','learning.actions.list','learning.actions.create','learning.progress.get','opportunities.search','opportunities.watch','learning.actions.execute'])assert.ok(names.includes(name))
 assert.ok(!names.some(n=>n.includes('approve')||n.includes('oauth')||n.includes('authorize')))
 const created=await client.callTool({name:'gmail.followup.draft',arguments:{idempotencyKey:'mcp-email',rationale:'Follow up on learning.',email:email.data}})
 assert.equal(created.isError,false);const a=created.structuredContent;assert.equal(a.state,'proposed')
 const blocked=await client.callTool({name:'learning.actions.execute',arguments:{id:a.id}});assert.equal(blocked.isError,true);assert.ok(blocked.content[0].text.includes('APPROVAL_REQUIRED'));assert.equal(x.calls(),0)
 await x.engine.approve(a.id,review(a,x.grant));const sent=await client.callTool({name:'learning.actions.execute',arguments:{id:a.id}});assert.equal(sent.structuredContent.state,'succeeded')
 const invalid=await client.callTool({name:'learning.actions.create',arguments:{...proposal(email),approve:true}});assert.equal(invalid.isError,true)
 }finally{await client.close();await server.close();x.db.close()}
})

test('provider vault fails closed and cancelled authorization stores no provider token',async()=>{
 const x=setup();const dir=mkdtempSync(path.join(tmpdir(),'alc-google-cancel-'))
 try{
 const unsafe=new ProviderVault(dir,{available:async()=>false,encrypt:async()=>Buffer.from('plaintext'),decrypt:async()=>({result:'plaintext'})})
 await assert.rejects(unsafe.write('gmail',{refreshToken:'secret'}),{code:'SECURE_STORAGE'})
 const vault=new ProviderVault(dir,encryption());let oauth;let calls=0
 oauth=new GoogleOAuth(vault,x.repo,async()=>{setImmediate(()=>oauth.cancelConnect())},async()=>{calls++;throw new Error('A cancelled flow must not exchange tokens')})
 await oauth.saveClient({clientId:'cancel-client.apps.googleusercontent.com',clientSecret:''})
 await assert.rejects(oauth.connect('gmail'),{code:'OAUTH_CANCELLED'})
 assert.equal(calls,0);assert.equal(await vault.read('gmail',googleTokenSchema),null);assert.equal(x.repo.grant('gmail'),null)
 }finally{x.db.close();rmSync(dir,{recursive:true,force:true})}
})
test('refresh rejects missing permissions and changed grant bindings before provider execution',async()=>{
 const x=setup();const dir=mkdtempSync(path.join(tmpdir(),'alc-google-refresh-'));const vault=new ProviderVault(dir,encryption())
 try{
 await vault.write('client',{clientId:'refresh-client.apps.googleusercontent.com',clientSecret:''})
 const token={accountEmail:'sender@example.org',accessToken:'old-access',refreshToken:'refresh-secret',expiresAt:0,scopes:[scopes.gmail],grantId:x.grant,clientId:'refresh-client.apps.googleusercontent.com'}
 await vault.write('gmail',token);x.repo.setGrant('gmail',x.grant)
 const revoked=new GoogleOAuth(vault,x.repo,async()=>{},async()=>new Response(JSON.stringify({access_token:'new-access',expires_in:3600,scope:scopes.calendar}),{status:200}))
 await assert.rejects(revoked.access('gmail',x.grant),{code:'SCOPE_REQUIRED'})
 const changed=new GoogleOAuth(vault,x.repo,async()=>{},async()=>{x.repo.setGrant('gmail',randomUUID());return new Response(JSON.stringify({access_token:'new-access',expires_in:3600,scope:scopes.gmail}),{status:200})})
 await assert.rejects(changed.access('gmail',x.grant),{code:'AUTHORIZATION_CHANGED'})
 assert.equal((await vault.read('gmail',googleTokenSchema)).accessToken,'old-access')
 }finally{x.db.close();rmSync(dir,{recursive:true,force:true})}
})
