const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { openDatabase } = require('../dist-electron/electron/persistence/database.cjs')
const { IntelligenceRepository } = require('../dist-electron/electron/persistence/session-repository.cjs')
const { WorkspaceRepository } = require('../dist-electron/electron/persistence/repositories.cjs')
const { SessionIntelligence } = require('../dist-electron/electron/ai/session-intelligence.cjs')
const { AIService } = require('../dist-electron/electron/ai/service.cjs')
const { validateSessionSummary } = require('../dist-electron/electron/ai/session-extraction.cjs')
const { startRecordingSchema, audioChunkSchema, intelligenceSummarySchema } = require('../dist-electron/shared/session-contracts.cjs')
const { seed, config } = require('./fixtures.cjs')
const setup = (overrides = {}, factory) => {
  const db = openDatabase(':memory:'); const repo = new IntelligenceRepository(db); const usage = []
  const ai = { config: { ...config, transcriptionModel: 'gpt-live-transcribe', timeoutMs: 200 }, status: () => ({ selected: 'standard' }), getClient: () => ({}), learningLanguage: () => 'en', sessionInsights: async () => ({ highlights: [] }), ...overrides }
  return { db, repo, usage, service: new SessionIntelligence(repo, ai, { record: item => usage.push(item) }, factory) }
}
const input = (source = 'notes') => ({ title: 'Hooks workshop', topic: 'React state', goals: 'Understand dependencies', source, consent: source !== 'notes' })
const segment = text => ({ id: randomUUID(), itemId: 'item-test', text, status: 'final', source: 'note', offsetMs: 0, highlighted: false })
const summaryFor = segment => ({ overview: 'Discussed React state.', topics: ['State'], concepts: [{ name: 'State', explanation: 'Stores component data.' }], conclusions: [], actions: [{ title: 'Write a custom hook', kind: 'explicit_assignment', evidence: [{ segmentId: segment.id, quote: 'Please write a custom hook.' }] }, { title: 'Practice explaining the hook', kind: 'ai_suggested', evidence: [{ segmentId: segment.id, quote: 'custom hook' }] }], knowledgeGaps: ['When do dependencies change?'], nextSteps: ['Explain the dependency array.'] })
class Socket extends EventEmitter {
  socket = Object.assign(new EventEmitter(), { bufferedAmount: 0 }); sent = []
  constructor() { super(); queueMicrotask(() => this.emit('session.created', {})) }
  send(event) { this.sent.push(event); if (event.type === 'session.update') queueMicrotask(() => this.emit('session.updated', {})) }
  close() { this.socket.emit('close') }
}
test('notes lifecycle rejects invalid transitions, excludes paused notes, and saves before summary', async () => {
  const { db, service, repo } = setup({ sessionSummary: async session => summaryFor(session.segments[0]) })
  try {
    const session = service.start(1, input())
    assert.throws(() => service.start(1, input()), { code: 'BUSY' })
    assert.throws(() => service.note(2, session.id, 'Other owner'), { code: 'FORBIDDEN' })
    await assert.rejects(() => service.summarize(session.id), { code: 'INVALID_STATE' })
    service.note(1, session.id, 'Please write a custom hook.')
    assert.equal((await service.pause(1, session.id)).state, 'paused')
    assert.throws(() => service.note(1, session.id, 'Paused'), { code: 'INVALID_STATE' })
    assert.equal(service.resume(1, session.id, false).state, 'recording')
    const ended = await service.end(1, session.id)
    assert.equal(ended.state, 'ended'); assert.ok(ended.endedAt); assert.equal(ended.segments.length, 1)
    assert.throws(() => service.resume(1, session.id, false), { code: 'INVALID_STATE' })
    const completed = await service.summarize(session.id)
    assert.equal(completed.summary.actions[0].kind, 'explicit_assignment')
    assert.equal(repo.get(session.id).summary.actions[1].kind, 'ai_suggested')
    assert.equal(service.start(1, input()).state, 'recording')
  } finally { service.closeAll(); db.close() }
})
test('audio consent, ownership, format and sequence are enforced; interruption never replays audio', async () => {
  let socket; const { db, service } = setup({}, () => socket = new Socket())
  try {
    assert.throws(() => service.start(1, { ...input('microphone'), consent: false }), { code: 'CONSENT_REQUIRED' })
    assert.equal(startRecordingSchema.safeParse({ ...input('microphone'), consent: false }).success, false)
    const session = service.start(1, input('microphone'))
    assert.equal(service.canCapture(1), true); assert.equal(service.canCapture(2), false); assert.equal(service.canCapture(1, true), false)
    await service.connect(1, session.id)
    assert.equal(socket.sent[0].session.type, 'transcription'); assert.equal(socket.sent[0].session.audio.input.format.rate, 24000)
    assert.equal(audioChunkSchema.safeParse({ id: session.id, pcm: '!!!', sequence: 0 }).success, false)
    const pcm = Buffer.alloc(9600).toString('base64')
    service.audio(1, session.id, 0, pcm)
    assert.throws(() => service.audio(1, session.id, 0, pcm), { code: 'AUDIO_SEQUENCE' })
    assert.equal(service.repository.get(session.id).state, 'interrupted'); assert.equal(service.canCapture(1), false)
    assert.throws(() => service.resume(1, session.id, false), { code: 'CONSENT_REQUIRED' })
    service.resume(1, session.id, true); await service.connect(1, session.id)
    assert.equal(socket.sent.filter(item => item.type === 'input_audio_buffer.append').length, 0)
  } finally { service.closeAll(); db.close() }
})
test('Realtime item ordering, duplicate events, partial text, key redaction, and disconnect persistence', async () => {
  let socket; const { db, service, usage } = setup({}, () => socket = new Socket())
  try {
    const session = service.start(1, input('microphone')); await service.connect(1, session.id)
    socket.emit('input_audio_buffer.committed', { item_id: 'a' }); socket.emit('input_audio_buffer.committed', { item_id: 'b' })
    socket.emit('conversation.item.input_audio_transcription.delta', { event_id: 'delta1', item_id: 'a', delta: 'Partial idea' })
    socket.emit('conversation.item.input_audio_transcription.delta', { event_id: 'delta1', item_id: 'a', delta: 'Partial idea' })
    socket.emit('conversation.item.input_audio_transcription.completed', { item_id: 'b', transcript: `Second ${config.apiKey}`, usage: { type: 'tokens', input_tokens: 2, output_tokens: 3, total_tokens: 5 } })
    socket.emit('conversation.item.input_audio_transcription.completed', { item_id: 'b', transcript: 'Duplicate' })
    socket.socket.emit('close')
    const saved = service.repository.get(session.id)
    assert.equal(saved.state, 'interrupted'); assert.equal(saved.segments[0].text, 'Partial idea'); assert.equal(saved.segments[0].status, 'partial')
    assert.equal(saved.segments[1].text, 'Second [redacted]'); assert.equal(usage.length, 1)
    assert.ok(saved.gaps.length); assert.ok(!JSON.stringify(saved).includes(config.apiKey))
    assert.equal((await service.end(1, session.id)).segments.length, 2)
  } finally { service.closeAll(); db.close() }
})

test('main rejects an audio packet flood before sending unlimited realtime audio', async () => {
  let socket; const { db, service } = setup({}, () => socket = new Socket())
  try {
    const session = service.start(1, input('microphone')); await service.connect(1, session.id)
    for (let sequence = 0; sequence < 10; sequence++) service.audio(1, session.id, sequence, Buffer.alloc(9600).toString('base64'))
    assert.throws(() => service.audio(1, session.id, 10, Buffer.alloc(9600).toString('base64')), { code: 'AUDIO_RATE_LIMIT' })
    assert.equal(socket.sent.filter(event => event.type === 'input_audio_buffer.append').length, 10)
    assert.equal(service.repository.get(session.id).state, 'interrupted')
  } finally { service.closeAll(); db.close() }
})

test('pause drains the last committed audio turn and resume opens a clean stream', async () => {
  let socket; const { db, service } = setup({}, () => {
    socket = new Socket(); const send = socket.send.bind(socket)
    socket.send = event => { send(event); if (event.type === 'input_audio_buffer.commit') queueMicrotask(() => {
      socket.emit('input_audio_buffer.committed', { item_id: 'last-turn' })
      socket.emit('conversation.item.input_audio_transcription.completed', { item_id: 'last-turn', transcript: 'A durable final thought.' })
    }) }
    return socket
  })
  try {
    const session = service.start(1, input('microphone')); await service.connect(1, session.id)
    service.audio(1, session.id, 0, Buffer.alloc(9600).toString('base64'))
    const paused = await service.pause(1, session.id)
    assert.equal(paused.state, 'paused'); assert.equal(paused.segments[0].text, 'A durable final thought.'); assert.equal(paused.segments[0].status, 'final'); assert.equal(paused.gaps.length, 0)
    service.resume(1, session.id, true); await service.connect(1, session.id)
    assert.equal(socket.sent.filter(event => event.type === 'input_audio_buffer.append').length, 0)
  } finally { service.closeAll(); db.close() }
})
test('app restart keeps transcript and pins, marks active sessions interrupted, and supports literal search', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'alc-session-')); let db
  try {
    const filename = path.join(directory, 'sessions.sqlite'); db = openDatabase(filename)
    const repository = new IntelligenceRepository(db); const service = new SessionIntelligence(repository, {}, { record() {} })
    const session = service.start(1, input()); const snapshot = service.note(1, session.id, 'A 100% useful hook with _dependencies_.'); service.pin(session.id, snapshot.segments[0].id, true)
    db.close(); db = openDatabase(filename)
    const reopened = new IntelligenceRepository(db); reopened.recover()
    assert.equal(reopened.get(session.id).state, 'interrupted'); assert.equal(reopened.get(session.id).segments[0].highlighted, true)
    assert.equal(reopened.search('100%')[0].id, session.id); assert.equal(reopened.search('_dependencies_').length, 1); assert.equal(reopened.search('absent').length, 0)
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }) }
})
test('structured summaries reject fabricated, missing, and partial evidence and preserve assignment provenance', () => {
  const text = segment('Please write a custom hook.'); const summary = summaryFor(text)
  assert.deepEqual(validateSessionSummary(summary, [text]), summary)
  const bad = structuredClone(summary); bad.actions[0].evidence[0].quote = 'Finish by Friday'
  assert.throws(() => validateSessionSummary(bad, [text]), { code: 'INVALID_EVIDENCE' })
  assert.throws(() => validateSessionSummary(summary, [{ ...text, status: 'partial' }]), { code: 'INVALID_EVIDENCE' })
  assert.throws(() => validateSessionSummary(summary, []), { code: 'INVALID_EVIDENCE' })
  assert.equal(intelligenceSummarySchema.safeParse({ ...summary, extra: true }).success, false)
  assert.equal(intelligenceSummarySchema.safeParse({ ...summary, actions: [{ ...summary.actions[0], evidence: [] }] }).success, false)
})
test('summary SDK request uses strict format and stored transcript; failed extraction leaves session durable', async () => {
  const db = openDatabase(':memory:'); const workspace = new WorkspaceRepository(db); workspace.bootstrap(seed()); workspace.update({ field: 'aiProfile', value: 'standard' })
  let sent; let invalid = false
  const ai = new AIService(config, workspace, () => ({ responses: { create: async request => {
    sent = request; const data = JSON.parse(request.input); const summary = summaryFor(data.segments[0])
    if (invalid) summary.actions[0].evidence[0].quote = 'Invented deadline'
    return { status: 'completed', output_text: JSON.stringify(summary), usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 } }
  } } }))
  const service = new SessionIntelligence(new IntelligenceRepository(db), ai, workspace.usage)
  try {
    const session = service.start(1, input()); service.note(1, session.id, 'Please write a custom hook.'); await service.end(1, session.id)
    await service.summarize(session.id)
    assert.equal(sent.store, false); assert.equal(sent.text.format.strict, true); assert.equal(sent.text.format.name, 'session_intelligence_summary')
    assert.equal(JSON.parse(sent.input).segments[0].status, 'final')
    invalid = true; await assert.rejects(() => service.summarize(session.id), { code: 'INVALID_EVIDENCE' })
    assert.ok(workspace.usage.list().some(item => item.status === 'error' && item.error_code === 'INVALID_EVIDENCE'))
    assert.equal(service.repository.get(session.id).summary.actions[0].evidence[0].quote, 'Please write a custom hook.')
    assert.equal(service.repository.get(session.id).state, 'ended')
  } finally { service.closeAll(); db.close() }
})
test('audio worklet mixes mono PCM16, clamps samples, and flushes the final partial chunk on stop', () => {
  let Processor; const messages = []
  const context = { AudioWorkletProcessor: class { port = { postMessage: value => messages.push(value) } }, registerProcessor: (_, cls) => Processor = cls }
  vm.runInNewContext(readFileSync(path.resolve('public/audio-capture.js'), 'utf8'), context)
  const processor = new Processor(); processor.process([[Float32Array.from([-2, 0, 2])]])
  processor.port.onmessage({ data: 'stop' })
  const view = new DataView(messages[0]); assert.equal(view.getInt16(0, true), -32768); assert.equal(view.getInt16(2, true), 0); assert.equal(view.getInt16(4, true), 32767)
  assert.equal(messages[1], 'stopped'); assert.equal(processor.process([]), false)
})

test('microphone activation keys are owner-scoped and rotate on resume independently of clock timestamps',async()=>{const {db,service,repo}=setup();try{const s=service.start(1,input('microphone'));const first=service.capturePermissionKey(1);assert.ok(first);assert.equal(service.capturePermissionKey(2),null);await service.pause(1,s.id);assert.equal(service.capturePermissionKey(1),null);service.resume(1,s.id,true);repo.save({...repo.get(s.id),activeSince:s.activeSince,consentAt:s.consentAt});assert.notEqual(service.capturePermissionKey(1),first);service.interrupt(1,s.id);assert.equal(service.capturePermissionKey(1),null);service.resume(1,s.id,true);service.closeOwner(1);assert.equal(service.capturePermissionKey(1),null)}finally{service.closeAll();db.close()}})
