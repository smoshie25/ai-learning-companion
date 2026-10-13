import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'

let devServer: {close():Promise<void>}|undefined
test.beforeAll(async()=>{
 const {createServer}=await import('vite')
 const server=await createServer({root:path.resolve('.'),logLevel:'silent',server:{host:'127.0.0.1',port:5173,strictPort:true}})
 try{await server.listen();devServer=server}catch(error){await server.close();if(!(error instanceof Error)||!error.message.includes('already in use'))throw error;const response=await fetch('http://127.0.0.1:5173/');if(!response.ok||!(await response.text()).includes('/src/main.tsx'))throw new Error('Port 5173 is occupied by another app.')}
})
test.afterAll(async()=>{await devServer?.close()})
for(const {development,source} of [{development:false,source:'microphone'},{development:true,source:'microphone'},{development:true,source:'microphone_system'}])test('consented '+source+' approval and PCM recovery in '+(development?'Vite development':'built renderer'), async () => {
  test.skip(source==='microphone_system'&&process.platform!=='win32','Windows system audio workflow')
  const root = path.resolve('.')
  const env = { ...process.env, OPENAI_API_KEY: 'sk-test-only-no-network', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root, ...(development?['--dev']:[]), '--use-fake-device-for-media-stream', '--user-data-dir=' + path.resolve('test-results', 'fake-audio-' + Date.now())], env })
  try {
    // Patch only the test process transport. Production consent/permission/IPC and AudioWorklet remain real.
    await app.evaluate((_electron, root) => {
      const load = process.getBuiltinModule('module').createRequire(root + '/package.json')
      const Service = load(root + '/dist-electron/electron/ai/session-intelligence.cjs').SessionIntelligence
      const native=load('electron');let approvals=0
      native.systemPreferences.getMediaAccessStatus=()=> 'granted'
      native.dialog.showMessageBox=async()=>{await new Promise(r=>setTimeout(r,1200));return {response:++approvals===1?0:1}}
      const counters = { chunks: 0, bytes: 0 }
      ;(globalThis as unknown as { audioTest: typeof counters }).audioTest = counters
      Service.prototype.connect = async function (owner: number, id: string) { this.owned(owner, id); return null }
      Service.prototype.audio = function (owner: number, id: string, sequence: number, pcm: string) {
        if (!this.canCapture(owner)) throw new Error('Capture is not authorized')
        const session = this.owned(owner, id)
        if (sequence !== counters.chunks) throw new Error('PCM packets arrived out of order')
        const buffer = Buffer.from(pcm, 'base64')
        counters.chunks++; counters.bytes += buffer.length
        this.repository.save({ ...session, elapsedMs: session.elapsedMs + Math.round(buffer.length / 48) })
        return null
      }
    }, root)
    const page = await app.firstWindow()
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByLabel('OpenAI API key', { exact: true }).fill('sk-test-only-no-network')
    await page.getByRole('button', { name: 'Save API key', exact: true }).click()
    await expect(page.getByText('API key configured securely', { exact: true })).toBeVisible()
    await page.getByLabel('Application configuration').selectOption('standard')
    await page.getByRole('button', { name: 'Learning Sessions', exact: true }).click()
    await page.getByRole('button', { name: 'Record & reflect', exact: true }).click()
    await page.getByLabel('Session title', { exact: true }).fill('Synthetic microphone test')
    await page.getByLabel('Learning topic', { exact: true }).fill('Audio processing')
    await page.getByLabel('Capture source', { exact: true }).selectOption(source)
    if(source==='microphone_system')await page.evaluate(()=>{
      let attempts=0
      navigator.mediaDevices.getDisplayMedia=async()=>{
        if(++attempts===1)throw new DOMException('Synthetic display denial','NotAllowedError')
        // Synthetic video and fake-device audio only; never capture the real screen.
        const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16
        const video=canvas.captureStream(1).getVideoTracks()[0]
        const audio=(await navigator.mediaDevices.getUserMedia({audio:true,video:false})).getAudioTracks()[0]
        return new MediaStream([video,audio])
      }
    })
    await expect(page.getByRole('button', { name: 'Start learning session', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: /All participants consent/ }).check()
    await page.getByRole('button', { name: 'Start learning session', exact: true }).click()
    await expect(page.getByText('Microphone access was denied.', { exact: false })).toBeVisible()
    await expect(page.getByText('Interrupted · audio is off', { exact: true })).toBeVisible()
    expect(await app.evaluate(() => (globalThis as unknown as { audioTest: { chunks:number } }).audioTest.chunks)).toBe(0)
    await page.getByRole('button', { name:'Resume session', exact:true }).click()
    if(source==='microphone_system'){
      await expect(page.getByText('System audio sharing was denied.',{exact:false})).toBeVisible()
      expect(await app.evaluate(() => (globalThis as unknown as { audioTest: { chunks:number } }).audioTest.chunks)).toBe(0)
      await page.getByRole('button',{name:'Resume session',exact:true}).click()
    }
    await expect(page.getByText('Recording · sending audio to OpenAI', { exact: true })).toBeVisible()
    expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'microphone' as PermissionName})).state)).toBe('granted')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { audioTest: { chunks: number } }).audioTest.chunks)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Pause session', exact: true }).click()
    await expect(page.getByText('Paused · audio is off', { exact: true })).toBeVisible()
    expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'microphone' as PermissionName})).state)).toBe('denied')
    const stopped = await app.evaluate(() => (globalThis as unknown as { audioTest: { chunks: number; bytes: number } }).audioTest)
    expect(stopped.bytes % 2).toBe(0)
    // Wait through several producer ticks: paused capture must not send new audio packets.
    await page.waitForTimeout(650)
    expect(await app.evaluate(() => (globalThis as unknown as { audioTest: { chunks: number } }).audioTest.chunks)).toBe(stopped.chunks)
    await page.getByRole('button', { name: 'End session', exact: true }).click()
    await expect(page.getByText('Session ended · saved locally', { exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally { await app.close() }
})
