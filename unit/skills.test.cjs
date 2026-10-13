const {test}=require('node:test')
const assert=require('node:assert/strict')
const {readFileSync}=require('node:fs')
const {openDatabase}=require('../dist-electron/electron/persistence/database.cjs')
const {WorkspaceRepository}=require('../dist-electron/electron/persistence/repositories.cjs')
const {IntelligenceRepository}=require('../dist-electron/electron/persistence/session-repository.cjs')
const {InterviewRepository}=require('../dist-electron/electron/persistence/interview-repository.cjs')
const {LearningRepository}=require('../dist-electron/electron/persistence/learning-repository.cjs')
const {ActionEngine}=require('../dist-electron/electron/actions/engine.cjs')
const {ActionRepository}=require('../dist-electron/electron/actions/repository.cjs')
const {MonitoringRepository}=require('../dist-electron/electron/monitoring/repository.cjs')
const {createLearningMCP}=require('../dist-electron/electron/mcp/server.cjs')
const {seed}=require('./fixtures.cjs')
async function fixture(){const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');const db=openDatabase(':memory:'),workspace=new WorkspaceRepository(db);workspace.bootstrap(seed());const repo=new ActionRepository(db),monitoring=new MonitoringRepository(db);let mutations=0;const provider={grantId:async()=>null,execute:async()=>{mutations++;throw new Error('Forbidden in skill test')}};const engine=new ActionEngine(repo,provider,provider);const learning={gaps:()=>[],discover:async()=>[],propose:async input=>({id:'proposal-test',state:'proposed',goal:input.goal,tasks:[]})};const server=createLearningMCP(engine,workspace,new IntelligenceRepository(db),new InterviewRepository(db),new LearningRepository(db),undefined,{learning,monitoring,opportunitySearch:async()=>[]});const [a,b]=InMemoryTransport.createLinkedPair();const client=new Client({name:'skill-fixture',version:'1'});await server.connect(a);await client.connect(b);return {db,repo,client,mutations:()=>mutations,call:async(name,args={})=>client.callTool({name,arguments:args}),close:async()=>{await client.close();await server.close();db.close()}}}
for(const name of ['learning-session-followup','learning-opportunity-discovery','learning-progress-review'])test(name+' has a valid entrypoint and independently exercises MCP review boundaries',async()=>{
 const text=readFileSync('skills/'+name+'/SKILL.md','utf8');assert.ok(text.startsWith('---\nname: '+name+'\n'));assert.ok(text.includes('\ndescription: '));const x=await fixture()
 try{const tools=(await x.client.listTools()).tools.map(t=>t.name);for(const match of text.matchAll(/`([a-z]+\.[a-z]+\.[a-z]+|opportunities\.(?:search|watch))`/g))assert.ok(tools.includes(match[1]),'Referenced tool available: '+match[1]);const context=await x.call('learning.context.get');assert.equal(context.isError,false)
 if(name==='learning-session-followup'){const session=await x.call('learning.sessions.get',{id:'guided:s1',includeTranscript:false});assert.equal(session.structuredContent.transcript,undefined);assert.equal((await x.call('learning.resources.discover',{goal:'React state',gapIds:[],textOnly:true})).isError,false);const plan=await x.call('learning.plans.propose',{goal:'React state',gapIds:[],textOnly:true,minutesPerDay:30,deadline:null});assert.equal(plan.structuredContent.state,'proposed')}
 if(name==='learning-opportunity-discovery'){assert.equal((await x.call('opportunities.search',{query:'React',online:true})).structuredContent.items.length,0);const watch=await x.call('opportunities.watch',{idempotencyKey:'skill-watch',query:'React',categories:[],intervalHours:24,freeOnly:true});assert.equal(watch.structuredContent.state,'proposed');const blocked=await x.call('learning.actions.execute',{id:watch.structuredContent.id});assert.equal(blocked.isError,true);assert.equal(x.repo.watches().length,0)}
 if(name==='learning-progress-review'){const before=x.db.prepare('SELECT COUNT(*) AS n FROM execution_actions').get().n;const progress=await x.call('learning.progress.get');assert.equal(progress.structuredContent.legacyPlanner.completed,0);await x.call('learning.actions.list',{});assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM execution_actions').get().n,before)}
 assert.equal(x.mutations(),0)
 }finally{await x.close()}
})
