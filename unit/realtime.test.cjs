const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { RealtimeService } = require('../dist-electron/electron/ai/realtime.cjs')
const { config } = require('./fixtures.cjs')
class FakeSocket extends EventEmitter {
  socket = new EventEmitter()
  sent = []
  constructor() { super(); queueMicrotask(() => this.emit('session.created', {})) }
  send(event) { this.sent.push(event); if (event.type === 'response.create') queueMicrotask(() => { this.emit('response.output_text.delta', { delta: 'Practice with examples.' }); this.emit('response.done', { response: { status: 'completed', usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } } }) }) }
  close() { this.socket.emit('close') }
}
test('Realtime isolates ownership, projects text, tracks usage, and closes on lifecycle', async () => {
  const usage = []; let socket
  const service = new RealtimeService({ config, status: () => ({ selected: 'standard' }) }, { record: item => usage.push(item) }, () => socket = new FakeSocket())
  const { connectionId } = await service.connect(10, 'Learning techniques')
  await assert.rejects(() => service.connect(10, 'Another topic'), { code: 'BUSY' })
  await assert.rejects(() => service.send(11, connectionId, 'Hello'), { code: 'INVALID_CONNECTION' })
  assert.equal((await service.send(10, connectionId, 'How can I learn?')).text, 'Practice with examples.')
  assert.equal(usage.at(-1).totalTokens, 9); assert.equal(socket.sent[1].response.output_modalities[0], 'text')
  service.closeOwner(10)
  await assert.rejects(() => service.send(10, connectionId, 'Again'), { code: 'INVALID_CONNECTION' })
  service.closeAll()
})
test('Realtime connection failure does not expose provider messages', async () => {
  const usage = []
  const service = new RealtimeService({ config, status: () => ({ selected: 'standard' }) }, { record: item => usage.push(item) }, () => { const socket = new EventEmitter(); socket.socket = new EventEmitter(); socket.close = () => {}; queueMicrotask(() => socket.emit('error', new Error(config.apiKey))); return socket })
  await assert.rejects(() => service.connect(10, 'React'), error => error.code === 'REALTIME_UNAVAILABLE' && !error.message.includes(config.apiKey))
  assert.equal(usage[0].status, 'error'); service.closeAll()
})

test('Realtime synchronous send failure cleans up listeners and socket without exposing credentials', async () => {
  const usage = []; let socket
  const service = new RealtimeService({ config, status: () => ({ selected: 'standard' }) }, { record: item => usage.push(item) }, () => {
    socket = new FakeSocket()
    socket.send = () => { throw new Error(config.apiKey) }
    return socket
  })
  const { connectionId } = await service.connect(10, 'React')
  await assert.rejects(() => service.send(10, connectionId, 'Hello'), error => error.code === 'REALTIME_UNAVAILABLE' && !error.message.includes(config.apiKey))
  assert.equal(socket.listenerCount('response.done'), 0)
  assert.equal(socket.listenerCount('response.output_text.delta'), 0)
  assert.equal(usage.at(-1).status, 'error')
  await assert.rejects(() => service.send(10, connectionId, 'Again'), { code: 'INVALID_CONNECTION' })
  service.closeAll()
})
