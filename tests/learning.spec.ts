import { test,expect,_electron as electron,type ElectronApplication } from '@playwright/test'
import path from 'node:path'
const root=path.resolve('.')
const env={...process.env,NODE_ENV:'production',OPENAI_API_KEY:''};delete env.ELECTRON_RUN_AS_NODE
async function mock(app:ElectronApplication){
 await app.evaluate((_electron,root)=>{
  const load=process.getBuiltinModule('module').createRequire(root+'/package.json')
  const AI=load(root+'/dist-electron/electron/ai/service.cjs').AIService
  AI.prototype.searchLearningSources=async()=>[{url:'https://react.dev/learn?utm_source=test',title:'React Learn'},{url:'https://react.dev/learn#duplicate',title:'Duplicate'}]
  AI.prototype.resourceMetadata=async()=>({items:[{sourceId:0,difficulty:'Beginner',estimatedMinutes:20,relevance:'A useful starting point for React state.'}]})
  AI.prototype.proposeStudyPlan=async function(input:any,gaps:any,resources:any){const task=(key:string,dependencies:string[])=>({key,title:key==='read'?'Read about React state':'Apply state updates',description:'Use a small counter example.',durationMinutes:15,priority:'High',deadline:input.deadline,dependencies,resourceIds:resources.map((r:any)=>r.id),activity:'Write a text explanation of queued state updates.',assessmentQuestion:'Why pass an updater function?',assessmentCriteria:'Mention prior state and queued updates.'});return {title:'Build confidence with state',rationale:'Short activities that connect concepts to examples.',tasks:[task('read',[]),task('apply',['read'])]}}
  AI.prototype.assessStudyTask=async function(task:any,answer:string){return {score:answer.includes('queued')?4:2,explanation:'Your explanation addresses the submitted question.',excerpt:answer.slice(0,30)}}
  const Service=load(root+'/dist-electron/electron/ai/learning-service.cjs').LearningService
  const original=Service.prototype.discover
  Service.prototype.discover=async function(input:any){this.verify=async(url:string)=>({state:'reachable',checkedAt:new Date().toISOString(),finalUrl:url,textReadable:true,message:'Synthetic verification for an isolated automated test.'});return original.call(this,input)}
 },root)
}
test('real-source pipeline mock, saved library, editable plan approval, dependencies and assessments survive restart',async()=>{
 const directory=path.resolve('test-results','learning-'+Date.now())
 let app=await electron.launch({args:[root,'--user-data-dir='+directory],env})
 try{
 await mock(app);let page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 await page.getByRole('button',{name:'Learning Resources',exact:true}).click()
 await page.getByLabel('Learning goal',{exact:true}).fill('Learn React state')
 await page.getByRole('button',{name:'Search learning resources',exact:true}).click()
 await expect(page.getByRole('heading',{name:'React Learn',exact:true})).toHaveCount(1)
 await expect(page.getByText('Beginner · estimate',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Save resource',exact:true}).click()
 await expect(page.getByRole('button',{name:'Unsave resource',exact:true})).toBeVisible()
 await page.evaluate(()=>window.scrollTo(0,0))
 await page.screenshot({path:path.join(directory,'resources.png'),fullPage:true})
 await page.getByRole('button',{name:'Learning Planner',exact:true}).click()
 await page.getByRole('button',{name:'Personalized plans',exact:true}).click()
 await page.getByLabel('Learning goal',{exact:true}).fill('Learn React state')
 await page.getByLabel('Plan deadline (optional)').fill('2026-11-01')
 await page.getByRole('button',{name:'Generate study proposal',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Build confidence with state',exact:true})).toBeVisible()
 const first=page.locator('.study-task').filter({has:page.getByRole('heading',{name:'Read about React state',exact:true})})
 const second=page.locator('.study-task').filter({has:page.getByRole('heading',{name:'Apply state updates',exact:true})})
 await first.getByRole('button',{name:'Edit task',exact:true}).click()
 await expect(page.getByRole('dialog')).toBeVisible()
 expect(errors).toEqual([])
 await page.getByRole('dialog').getByRole('combobox').selectOption('Medium')
 await page.getByLabel('Short learning activity',{exact:true}).fill('Compare two queued state updates in a short text example.')
 await page.getByRole('button',{name:'Save task edits',exact:true}).click()
 await expect(first.getByText('Medium priority',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Approve study plan',exact:true}).click()
 await expect(second.getByRole('button',{name:'Complete task',exact:true})).toBeDisabled()
 await first.getByText('Learning activity & practice check',{exact:true}).click()
 await first.getByLabel('Your practice answer',{exact:true}).fill('An updater receives previous state.')
 await first.getByRole('button',{name:'Assess practice answer',exact:true}).click()
 await first.getByLabel('Your practice answer',{exact:true}).fill('An updater receives previous state for queued updates.')
 await first.getByRole('button',{name:'Assess practice answer',exact:true}).click()
 await expect(first.getByText(/Change across 2 checks/)).toBeVisible()
 await first.getByRole('button',{name:'Complete task',exact:true}).click()
 await expect(second.getByRole('button',{name:'Complete task',exact:true})).toBeEnabled()
 await second.getByRole('button',{name:'Reject task',exact:true}).click()
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(second.getByRole('button',{name:'Complete task',exact:true})).toBeEnabled()
 await second.getByRole('button',{name:'Complete task',exact:true}).click()
 await expect(page.getByText('2 / 2 tasks completed',{exact:true})).toBeVisible()
 await page.screenshot({path:path.join(directory,'plan.png'),fullPage:true})
 await app.close()
 app=await electron.launch({args:[root,'--user-data-dir='+directory],env});await mock(app);page=await app.firstWindow()
 await page.getByRole('button',{name:'Learning Resources',exact:true}).click()
 await expect(page.getByRole('heading',{name:'React Learn',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Unsave resource',exact:true})).toBeVisible()
 const invalid=await page.evaluate(()=>window.companion!.learning.propose({goal:'React',gapIds:[],textOnly:true,minutesPerDay:30,deadline:'2026-02-30'}))
 expect(invalid).toMatchObject({ok:false,error:{code:'VALIDATION'}})
 await page.getByRole('button',{name:'Learning Planner',exact:true}).click()
 await page.getByRole('button',{name:'Personalized plans',exact:true}).click()
 await expect(page.getByText('2 / 2 tasks completed',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:/Build confidence with state.*approved/}).click()
 await expect(page.getByRole('button',{name:'Reopen task',exact:true})).toHaveCount(2)
 expect(errors).toEqual([])
 }finally{await app.close()}
})
