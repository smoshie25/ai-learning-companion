const {test}=require('node:test')
const assert=require('node:assert/strict')
const {randomUUID}=require('node:crypto')
const {mkdtempSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const path=require('node:path')
const {openDatabase}=require('../dist-electron/electron/persistence/database.cjs')
const {ActionRepository}=require('../dist-electron/electron/actions/repository.cjs')
const {ActionEngine}=require('../dist-electron/electron/actions/engine.cjs')
const {MonitoringRepository}=require('../dist-electron/electron/monitoring/repository.cjs')
const {OpportunityWorker}=require('../dist-electron/electron/monitoring/worker.cjs')
const {OpportunityDiscovery,validateOpportunityFacts}=require('../dist-electron/electron/monitoring/discovery.cjs')
const {readableText}=require('../dist-electron/electron/monitoring/page-reader.cjs')
const {ProviderError}=require('../dist-electron/electron/integrations/google-adapters.cjs')
const result=(title='React course')=>({url:'https://react.dev/learn',title,provider:'react.dev',cost:{value:'Free learning access (synthetic test)',quote:'Free learning access'},eligibility:null,deadline:null,free:true,checkedAt:new Date().toISOString(),verification:'evidence-checked',relevance:70,note:'Synthetic test source facts, not a verified live offer.'})
async function setup(file=':memory:'){
 const db=openDatabase(file),repo=new ActionRepository(db),monitor=new MonitoringRepository(db);const grant=randomUUID();let sends=0,searches=0,time=Date.now();let found=[result()]
 const provider={grantId:async()=>grant,execute:async()=>{sends++;return {providerId:'mock-mail',message:'Mock sent'}}};const engine=new ActionEngine(repo,provider,provider)
 const watch=engine.propose({idempotencyKey:'watch-test',rationale:'Watch approved in test.',action:{kind:'opportunity_watch',data:{query:'React',categories:['course'],intervalHours:6,freeOnly:true,notificationTo:'learner@example.org'}}});await engine.approve(watch.id,{digest:watch.digest,revision:1,grantId:null});await engine.execute(watch.id)
 const worker=new OpportunityWorker(monitor,engine,async()=>{searches++;return found},()=>time)
 return {db,repo,monitor,engine,worker,watch,grant,provider,sends:()=>sends,searches:()=>searches,tick:()=>time+=21600001,setFound:x=>found=x}
}
test('facts require exact retrieved evidence; inaccessible sources keep all facts unknown',async()=>{
 const text=readableText('<script>Free</script><p>Free learning access</p>');assert.equal(text,'Free learning access')
 assert.throws(()=>validateOpportunityFacts({...result(),cost:{value:'Free',quote:'Fabricated'}} ,text))
 assert.throws(()=>validateOpportunityFacts({cost:null,eligibility:null,deadline:null,free:true},text),{code:'INVALID_EVIDENCE'})
 const ai={searchLearningSources:async()=>[{url:'https://react.dev/learn?utm_source=x',title:'React'},{url:'https://react.dev/learn#same',title:'Duplicate'}],opportunityFacts:async()=>({cost:{value:'Free access',quote:text},eligibility:null,deadline:null,free:true})}
 const discovery=new OpportunityDiscovery(ai,async()=>text);assert.equal((await discovery.search('React')).length,1)
 const unavailable=new OpportunityDiscovery(ai,async()=>{throw new Error('offline')});assert.equal((await unavailable.search('React'))[0].free,null)
})
test('due scheduling deduplicates timestamp-only changes and sends only an exact reviewed alert once',async()=>{
 const x=await setup();try{
 await x.worker.run();assert.equal(x.sends(),0);let alerts=x.monitor.alerts(x.watch.id);assert.equal(alerts.length,1);const a=x.repo.get(alerts[0].actionId);assert.equal(a.state,'proposed')
 await x.worker.run();assert.equal(x.searches(),1);assert.equal(x.sends(),0)
 await x.engine.approve(a.id,{digest:a.digest,revision:a.revision,grantId:x.grant});await x.worker.run();assert.equal(x.sends(),1)
 x.tick();x.setFound([{...result(),checkedAt:new Date(Date.now()+1000).toISOString()}]);await x.worker.run();assert.equal(x.monitor.alerts(x.watch.id).length,1);assert.equal(x.sends(),1)
 x.tick();x.setFound([result('React course changed')]);await x.worker.run();assert.equal(x.monitor.alerts(x.watch.id).length,2);assert.equal(x.sends(),1)
 assert.equal(x.monitor.snapshot().runs.filter(r=>r.state==='sent').length,1)
 }finally{x.db.close()}
})
test('unapproved and disabled watches cannot search or send; strict free filter excludes unknown cost',async()=>{
 const x=await setup();try{const p=x.engine.propose({idempotencyKey:'unapproved',rationale:'Unapproved',action:{kind:'opportunity_watch',data:{query:'SQL',categories:[],intervalHours:6,freeOnly:false}}});assert.equal(p.state,'proposed')
 x.setFound([{...result(),free:null,cost:null}]);await x.worker.run();assert.equal(x.monitor.alerts(x.watch.id).length,0);assert.equal(x.searches(),1)
 x.monitor.disable(x.watch.id);x.tick();await x.worker.run();assert.equal(x.searches(),1);assert.equal(x.sends(),0)
 }finally{x.db.close()}
})
test('worker leases prevent overlapping searches and become reclaimable after expiry',async()=>{
 const x=await setup();try{const now=Date.now();const token=x.monitor.claim(x.watch.id,now);assert.ok(token);assert.equal(x.monitor.claim(x.watch.id,now),null);const replacement=x.monitor.claim(x.watch.id,now+600001);assert.ok(replacement);x.monitor.finish(x.watch.id,token,now,6,'success','Stale');assert.equal(x.monitor.snapshot().runs.length,0)}finally{x.db.close()}
})
test('interrupted and failed notification sends stay recorded and are never resent by a worker',async()=>{
 const x=await setup();try{await x.worker.run();const a=x.repo.get(x.monitor.alerts(x.watch.id)[0].actionId);await x.engine.approve(a.id,{digest:a.digest,revision:1,grantId:x.grant});let attempts=0;x.provider.execute=async()=>{attempts++;throw new ProviderError('UNKNOWN_DELIVERY','Check Sent mail.',true)};await x.worker.run();await x.worker.run();assert.equal(attempts,1);assert.equal(x.repo.get(a.id).state,'uncertain');assert.ok(x.monitor.snapshot().runs.some(r=>r.state==='uncertain'))}finally{x.db.close()}
})
test('watch results, due times and alert approvals survive database reopening',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'companion-monitor-'));let x
 try{x=await setup(path.join(directory,'db.sqlite'));await x.worker.run();const id=x.watch.id;const a=x.repo.get(x.monitor.alerts(id)[0].actionId);await x.engine.approve(a.id,{digest:a.digest,revision:1,grantId:x.grant});x.db.close();const db=openDatabase(path.join(directory,'db.sqlite'));try{const monitor=new MonitoringRepository(db),repo=new ActionRepository(db);assert.equal(monitor.results().length,1);assert.equal(monitor.claim(id,Date.now()),null);assert.equal(repo.get(a.id).state,'approved');assert.equal(monitor.alerts(id).length,1)}finally{db.close()}}finally{rmSync(directory,{recursive:true,force:true})}
})
test('older approved alerts are not starved by more than fifty newer detections',async()=>{
 const x=await setup();try{await x.worker.run();const first=x.monitor.alerts(x.watch.id)[0];const a=x.repo.get(first.actionId);await x.engine.approve(a.id,{digest:a.digest,revision:1,grantId:x.grant});for(let i=0;i<55;i++)x.monitor.observe(x.watch.id,result('Newer detection '+i));await x.worker.run();assert.equal(x.repo.get(a.id).state,'succeeded');assert.equal(x.sends(),1);assert.equal(x.monitor.alerts(x.watch.id).length,56)}finally{x.db.close()}
})
