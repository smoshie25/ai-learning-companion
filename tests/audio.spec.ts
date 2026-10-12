import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'

test('consented microphone capture produces PCM and releases fake device tracks on pause', async () => {
  const root = path.resolve('.')
  const env = { ...process.env, OPENAI_API_KEY: 'sk-test-only-no-network', NODE_ENV: 'production' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [root, '--use-fake-device-for-media-stream', '--user-data-dir=' + path.resolve('test-results', 'fake-audio-' + Date.now())], env })
  try {
    // Patch only the test process transport. Production consent/permission/IPC and AudioWorklet remain real.
    await app.evaluate((_electron, root) => {
      const load = process.getBuiltinModule('module').createRequire(root + '/package.json')
      const Service = load(root + '/dist-electron/electron/ai/session-intelligence.cjs').SessionIntelligence
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
    await page.getByLabel('Application configuration').selectOption('standard')
    await page.getByRole('button', { name: 'Learning Sessions', exact: true }).click()
    await page.getByRole('button', { name: 'Record & reflect', exact: true }).click()
    await page.getByLabel('Session title', { exact: true }).fill('Synthetic microphone test')
    await page.getByLabel('Learning topic', { exact: true }).fill('Audio processing')
    await page.getByLabel('Capture source', { exact: true }).selectOption('microphone')
    await expect(page.getByRole('button', { name: 'Start learning session', exact: true })).toBeDisabled()
    await page.getByRole('checkbox', { name: /All participants consent/ }).check()
    await page.getByRole('button', { name: 'Start learning session', exact: true }).click()
    await expect(page.getByText('Recording · sending audio to OpenAI', { exact: true })).toBeVisible()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { audioTest: { chunks: number } }).audioTest.chunks)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Pause session', exact: true }).click()
    await expect(page.getByText('Paused · audio is off', { exact: true })).toBeVisible()
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
