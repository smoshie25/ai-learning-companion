import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

test('Settings securely saves, restores, replaces and removes an API key', async () => {
 const root = path.resolve('.')
 const directory = path.resolve('test-results', 'credentials-' + Date.now())
 const key = 'sk-test-only-settings-credential'
 const env = { ...process.env, OPENAI_API_KEY: key, NODE_ENV: 'production' }
 delete env.ELECTRON_RUN_AS_NODE
 let app = await electron.launch({ args: [root, '--user-data-dir=' + directory], env })
 try {
 let page = await app.firstWindow()
 await page.getByRole('button', { name: 'Settings', exact: true }).click()
 await expect(page.getByText('No API key configured', { exact: true })).toBeVisible()
 await page.getByLabel('OpenAI API key', { exact: true }).fill(key)
 await page.getByRole('button', { name: 'Save API key', exact: true }).click()
 await expect(page.getByText('API key configured securely', { exact: true })).toBeVisible()
 await expect(page.getByLabel('OpenAI API key', { exact: true })).toHaveValue('')
 const file = await app.evaluate(({ app }) => app.getPath('userData') + '/openai-key.enc')
 expect((await readFile(file)).includes(Buffer.from(key))).toBe(false)
 expect(await page.evaluate(async () => JSON.stringify(await window.companion!.ai.status()))).not.toContain(key)
 await page.screenshot({path: path.join(directory,'settings.png'),fullPage:true})
 await app.close()
 app = await electron.launch({args:[root,'--user-data-dir='+directory],env})
 page = await app.firstWindow()
 await page.getByRole('button',{name:'Settings',exact:true}).click()
 await expect(page.getByText('API key configured securely',{exact:true})).toBeVisible()
 await expect(page.getByLabel('OpenAI API key',{exact:true})).toHaveValue('')
 await page.getByLabel('OpenAI API key',{exact:true}).fill(key+'-replacement')
 await page.getByRole('button',{name:'Replace API key',exact:true}).click()
 await expect(page.getByText('API key saved securely. You can now validate connectivity.',{exact:true})).toBeVisible()
 expect((await readFile(file)).includes(Buffer.from(key))).toBe(false)
 await page.getByRole('button',{name:'Remove API key',exact:true}).click()
 await page.getByRole('button',{name:'Cancel',exact:true}).click()
 await expect(page.getByText('API key configured securely',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Remove API key',exact:true}).click()
 await page.getByRole('button',{name:'Confirm removal',exact:true}).click()
 await expect(page.getByText('No API key configured',{exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'Validate AI connectivity',exact:true})).toBeDisabled()
 await expect(readFile(file)).rejects.toThrow()
 } finally { await app.close() }
})
