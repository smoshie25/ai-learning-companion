const { test } = require('node:test')
const assert = require('node:assert/strict')
const OpenAI = require('openai').default
const { parseText, parseStructured } = require('../dist-electron/electron/ai/parsing.cjs')
const { summarySchema } = require('../dist-electron/shared/contracts.cjs')
const { AIService } = require('../dist-electron/electron/ai/service.cjs')
const { loadAIConfig } = require('../dist-electron/electron/ai/config.cjs')
const { openDatabase } = require('../dist-electron/electron/persistence/database.cjs')
const { WorkspaceRepository } = require('../dist-electron/electron/persistence/repositories.cjs')
const { seed, config, response } = require('./fixtures.cjs')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

test('development environment overrides models but never loads API keys', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'alc-env-'))
  try {
    mkdirSync(path.join(root, 'config'))
    writeFileSync(path.join(root, 'config', 'development.env'), `OPENAI_API_KEY=${config.apiKey}\nOPENAI_RESPONSE_MODEL=gpt-4.1-mini\nOPENAI_MAX_RETRIES=1\n`)
    assert.equal(loadAIConfig(root, true, {}).apiKey, '')
    assert.equal(loadAIConfig(root, true, {}).responseModel, 'gpt-4.1-mini')
    assert.equal(loadAIConfig(root, true, { OPENAI_MAX_RETRIES: '0' }).maxRetries, 0)
    assert.equal(loadAIConfig(root, false, {}).apiKey, '')
    assert.throws(() => loadAIConfig(root, true, { OPENAI_RESPONSE_MODEL: config.apiKey }), error => !error.message.includes(config.apiKey))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('parsing detects refusal, incomplete, empty, and invalid JSON/schema output', () => {
  assert.equal(parseText(response('Hello')), 'Hello')
  const valid = { summary: 'Practiced hooks.', highlights: ['State remembers values.'] }
  assert.deepEqual(parseStructured(response(JSON.stringify(valid)), summarySchema), valid)
  assert.throws(() => parseText({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'private refusal' }] }] }), { code: 'REFUSED' })
  assert.throws(() => parseText({ ...response('Partial'), status: 'incomplete' }), { code: 'INCOMPLETE_RESPONSE' })
  assert.throws(() => parseText(response(' ')), { code: 'INVALID_RESPONSE' })
  for (const text of ['not JSON', '{"summary":1,"highlights":[]}', JSON.stringify({ ...valid, unknown: 'unexpected' })]) assert.throws(() => parseStructured(response(text), summarySchema), { code: 'INVALID_RESPONSE' })
})
test('SDK requests use server configuration, strict schemas, retries, and sanitized usage', async () => {
  const db = openDatabase(':memory:'); const repository = new WorkspaceRepository(db); repository.bootstrap(seed()); repository.update({ field: 'aiProfile', value: 'standard' })
  let calls = 0; let requestBody
  const client = new OpenAI({ apiKey: config.apiKey, maxRetries: 1, timeout: 1000, logLevel: 'off', fetch: async (_url, init) => {
    calls++; requestBody = JSON.parse(init.body)
    if (calls === 1) return new Response(JSON.stringify({ error: { message: 'quota temporarily limited', type: 'rate_limit_error' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } })
    return new Response(JSON.stringify(response(JSON.stringify({ summary: 'Good progress', highlights: ['Practice daily'] }))), { headers: { 'content-type': 'application/json' } })
  } })
  try {
    const ai = new AIService(config, repository, () => client)
    const result = await ai.summarize({ topic: 'React', mode: 'Guided learning', messages: [{ role: 'user', text: 'Explain state.' }] })
    assert.equal(result.summary, 'Good progress'); assert.equal(calls, 2)
    assert.equal(requestBody.model, config.responseModel); assert.equal(requestBody.store, false)
    assert.equal(requestBody.text.format.type, 'json_schema'); assert.equal(requestBody.text.format.strict, true)
    assert.equal(repository.usage.totals().totalTokens, 20); assert.equal(repository.usage.totals().requests, 1)
    assert.ok(!JSON.stringify(ai.status()).includes(config.apiKey)); assert.ok(!JSON.stringify(repository.usage.list()).includes('Explain state'))
  } finally { db.close() }
})
test('missing keys and provider failures are tracked without secret leakage', async () => {
  const db = openDatabase(':memory:'); const repository = new WorkspaceRepository(db); repository.bootstrap(seed()); repository.update({ field: 'aiProfile', value: 'standard' })
  try {
    const missing = new AIService({ ...config, apiKey: '' }, repository)
    await assert.rejects(() => missing.tutor({ topic: 'React', mode: 'Guided learning', messages: [] }), { code: 'NOT_CONFIGURED' })
    const bad = new AIService(config, repository, () => ({ responses: { create: async () => { throw { status: 401, message: config.apiKey } } } }))
    await assert.rejects(() => bad.tutor({ topic: 'React', mode: 'Guided learning', messages: [] }), error => error.code === 'AUTHENTICATION' && !error.message.includes(config.apiKey))
    assert.equal(repository.usage.totals().requests, 2)
    assert.ok(!JSON.stringify(repository.usage.list()).includes(config.apiKey))
  } finally { db.close() }
})
test('even a provider response containing the key is redacted', async () => {
  const db = openDatabase(':memory:'); const repository = new WorkspaceRepository(db); repository.bootstrap(seed()); repository.update({ field: 'aiProfile', value: 'standard' })
  try {
    const ai = new AIService(config, repository, () => ({ responses: { create: async () => response(`Secret: ${config.apiKey}`) } }))
    assert.equal((await ai.tutor({ topic: 'React', mode: 'Guided learning', messages: [] })).text, 'Secret: [redacted]')
  } finally { db.close() }
})
test('configuration ignores arbitrary environment fields and returns no public key', () => {
  const parsed = loadAIConfig('.', false, { OPENAI_API_KEY: config.apiKey, OPENAI_TIMEOUT_MS: '1500', VITE_SECRET: 'private' })
  assert.equal(parsed.timeoutMs, 1500); assert.equal(parsed.apiKey, ''); assert.equal(parsed.VITE_SECRET, undefined)
  assert.throws(() => loadAIConfig('.', false, { OPENAI_TIMEOUT_MS: 'bad', OPENAI_API_KEY: config.apiKey }), error => !error.message.includes(config.apiKey))
})

test('changing Settings credentials immediately resets the SDK client and removal disables AI', async () => {
 const db = openDatabase(':memory:'); const repository = new WorkspaceRepository(db); repository.bootstrap(seed()); repository.update({field:'aiProfile',value:'standard'})
 let current = ''; let created = 0
 const vault = { getKey:()=>current, status:()=>({keyStorageAvailable:true,keySaved:!!current,keyWarning:null}), set:async key=>{current=key},remove:async()=>{current=''} }
 const local = {...config,apiKey:''}
 const ai = new AIService(local, repository,()=>{ created++; const used = local.apiKey; return {responses:{create:async()=>response(used)}} },vault)
 const input = {topic:'React',mode:'Guided learning',messages:[]}
 try {
 await ai.saveKey('sk-test-first-settings-key'); assert.equal((await ai.tutor(input)).text,'[redacted]')
 await ai.saveKey('sk-test-second-settings-key'); assert.equal((await ai.tutor(input)).text,'[redacted]'); assert.equal(created,2)
 assert.equal(JSON.stringify(ai.status()).includes(current),false)
 await ai.removeKey(); assert.equal(ai.status().keyConfigured,false)
 await assert.rejects(ai.tutor(input),{code:'NOT_CONFIGURED'})
 } finally {db.close()}
})
