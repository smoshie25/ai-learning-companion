import { test,expect,_electron as electron } from '@playwright/test'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const root=path.resolve('.')
const env={...process.env,NODE_ENV:'production',OPENAI_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE
test('desktop review binds edited emails to approval and mocked sending occurs once',async()=>{
 const directory=path.resolve('test-results','action-center-'+Date.now())
 const app=await electron.launch({args:[root,'--user-data-dir='+directory],env})
 try{
 await app.evaluate((_electron,root)=>{
  const load=process.getBuiltinModule('module').createRequire(root+'/package.json')
  const grant='00000000-0000-4000-8000-000000000001'
  const OAuth=load(root+'/dist-electron/electron/integrations/google-oauth.cjs').GoogleOAuth
  OAuth.prototype.status=async()=>({clientConfigured:true,secureStorage:true,calendarConnected:true,gmailConnected:true,gmailAccount:'sender@example.org',calendarGrantId:grant,gmailGrantId:grant,calendarScope:'calendar.events.owned',gmailScope:'gmail.send'})
  const Gmail=load(root+'/dist-electron/electron/integrations/google-adapters.cjs').GmailAdapter
  Gmail.prototype.grantId=async()=>grant
  ;(globalThis as any).sendCount=0
  Gmail.prototype.execute=async(a:any)=>{(globalThis as any).sendCount++;if(a.action.data.to[0]!=='mentor@example.org'||a.action.data.body!=='Please review my revised practice example.')throw new Error('Unreviewed email contents');return {providerId:'mock-mail-id',message:'Mock email sent once.'}}
 },root)
 const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('button',{name:'Action Center',exact:true}).click()
 await page.getByRole('button',{name:'Propose an action',exact:true}).click()
 await page.getByLabel('Action type',{exact:true}).selectOption('email')
 await page.getByLabel('Recipients',{exact:true}).fill('mentor@example.org')
 await page.getByLabel('Email subject',{exact:true}).fill('Practice follow-up')
 await page.getByLabel('Email body',{exact:true}).fill('Please review my practice example.')
 await page.getByRole('button',{name:'Save proposal',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Practice follow-up',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Review & approve',exact:true}).click()
 await expect(page.getByRole('dialog').getByText('To: mentor@example.org',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Confirm approval',exact:true}).click()
 await expect(page.getByRole('button',{name:'Send approved email',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Edit proposal',exact:true}).click()
 await page.getByLabel('Email body',{exact:true}).fill('Please review my revised practice example.')
 await page.getByRole('button',{name:'Save proposal',exact:true}).click()
 await expect(page.getByRole('button',{name:'Send approved email',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Review & approve',exact:true}).click()
 await page.getByRole('button',{name:'Confirm approval',exact:true}).click()
 await page.getByRole('button',{name:'Send approved email',exact:true}).click()
 await page.getByRole('button',{name:'Confirm send',exact:true}).click()
 await expect(page.getByText('Mock email sent once.',{exact:true}).first()).toBeVisible()
 const action=await page.evaluate(async()=>{const r=await window.companion!.actions.list();return r.ok?r.data[0]:null})
 expect(action?.state).toBe('succeeded')
 await page.evaluate(async id=>window.companion!.actions.execute({id}),action!.id)
 expect(await app.evaluate(()=>(globalThis as any).sendCount)).toBe(1)
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:path.join(directory,'actions.png'),fullPage:true,animations:'disabled'})
 expect(errors).toEqual([])
 }finally{await app.close()}
})
test('real stdio MCP client shares desktop proposals and never interrupts active learning',async()=>{
 const directory=path.resolve('test-results','mcp-profile-'+Date.now())
 const app=await electron.launch({args:[root,'--user-data-dir='+directory],env})
 let client:Client|undefined
 try{
 const page=await app.firstWindow()
 await expect(page.getByRole('heading',{name:/Good morning/})).toBeVisible()
 const recording=await page.evaluate(()=>window.companion!.intelligence.start({title:'Concurrent desktop learning',topic:'MCP',goals:'',source:'notes',consent:false}))
 expect(recording.ok).toBe(true);if(!recording.ok)throw new Error('Notes could not start')
 client=new Client({name:'codex-compatible-test',version:'1.0.0'})
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/mcp-launcher.cjs'),'--user-data-dir='+directory],env:env as Record<string,string>,stderr:'pipe'})
 const stderr:string[]=[];transport.stderr?.on('data',b=>stderr.push(String(b)))
 await client.connect(transport)
 const tools=await client.listTools();expect(tools.tools.map(t=>t.name)).toContain('learning.actions.create')
 expect(tools.tools.map(t=>t.name).some(n=>n.includes('approve'))).toBe(false)
 const current=await page.evaluate(id=>window.companion!.intelligence.get({id}),recording.data.id);expect(current).toMatchObject({ok:true,data:{state:'recording'}})
 const created=await client.callTool({name:'learning.actions.create',arguments:{idempotencyKey:'native-mcp-task',rationale:'Practice the protocol.',action:{kind:'learning_task',data:{title:'Read MCP tool schemas',subject:'MCP',deadline:null,durationMinutes:20,priority:'Medium'}}}})
 const action=created.structuredContent as {id:string;state:string};expect(action.state).toBe('proposed')
 const blocked=await client.callTool({name:'learning.actions.execute',arguments:{id:action.id}});expect(blocked.isError).toBe(true)
 await page.getByRole('button',{name:'Action Center',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Read MCP tool schemas',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Review & approve',exact:true}).click()
 await page.getByRole('button',{name:'Confirm approval',exact:true}).click()
 const executed=await client.callTool({name:'learning.actions.execute',arguments:{id:action.id}})
 expect(executed.structuredContent).toMatchObject({state:'succeeded'})
 await expect(page.getByRole('button',{name:'Complete learning task',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Complete learning task',exact:true}).click()
 await expect(page.getByText('Learning task completed',{exact:true})).toBeVisible()
 const progress=await client.callTool({name:'learning.progress.get',arguments:{}});expect(progress.structuredContent).toMatchObject({mcpTasks:{completed:1,total:1}})
 expect(stderr.join('')).not.toContain('client_secret')
 }finally{await client?.close();await app.close()}
})
