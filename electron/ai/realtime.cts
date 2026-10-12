import { OpenAIRealtimeWS } from 'openai/realtime/ws'
import { randomUUID } from 'node:crypto'
import type { AIService } from './service.cjs'
import type { UsageRepository } from '../persistence/repositories.cjs'
import { AppError } from './errors.cjs'

type Connection = { owner: number; socket: OpenAIRealtimeWS; busy: boolean; topic: string; idleTimer?: ReturnType<typeof setTimeout> }
export class RealtimeService {
  private connections = new Map<string, Connection>()
  private disposed = false
  constructor(private ai: AIService, private usage: UsageRepository, private factory = () => new OpenAIRealtimeWS({ model: ai.config.realtimeModel, options: { handshakeTimeout: ai.config.timeoutMs, maxPayload: 1024 * 1024 } }, ai.getClient() as Pick<import('openai').OpenAI, 'apiKey' | 'baseURL'>)) {}
  async connect(owner: number, topic: string) {
    if (this.ai.status().selected === 'offline') throw new AppError('OFFLINE_MODE', 'Select an OpenAI configuration before connecting to Realtime.')
    if ([...this.connections.values()].some(item => item.owner === owner)) throw new AppError('BUSY', 'A Realtime connection is already open. Close it before starting another.')
    // Reserve ownership before waiting for the handshake, preventing concurrent sockets.
    const id = randomUUID(); const socket = this.factory(); const connection: Connection = { owner, socket, busy: false, topic }
    this.connections.set(id, connection)
    socket.on('error', () => { /* Provider errors are projected to a constant message below. Never log raw events. */ })
    socket.socket.on('close', () => { clearTimeout(connection.idleTimer); this.connections.delete(id) })
    const started = Date.now()
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new AppError('TIMEOUT', 'Realtime connection timed out.')), this.ai.config.timeoutMs)
        const ready = () => finish()
        const failed = () => finish(new AppError('REALTIME_UNAVAILABLE', 'Realtime could not connect. Check model access and your network.'))
        const finish = (error?: AppError) => { clearTimeout(timer); socket.off('session.created', ready); socket.off('error', failed); socket.socket.off('close', failed); error ? reject(error) : resolve() }
        socket.on('session.created', ready); socket.on('error', failed); socket.socket.on('close', failed)
      })
      this.armIdle(id, connection)
      this.record('realtime_connect', started)
      return { connectionId: id }
    } catch (error) { if (this.connections.has(id)) this.close(owner, id); this.record('realtime_connect', started, undefined, 'REALTIME_UNAVAILABLE'); throw error }
  }
  private owned(owner: number, id: string) { const item = this.connections.get(id); if (!item || item.owner !== owner) throw new AppError('INVALID_CONNECTION', 'This Realtime connection is unavailable.'); return item }
  private armIdle(id: string, item: Connection) { clearTimeout(item.idleTimer); item.idleTimer = setTimeout(() => this.close(item.owner, id), 60000) }
  async send(owner: number, id: string, text: string) {
    const item = this.owned(owner, id)
    if (item.busy) throw new AppError('BUSY', 'Wait for the current Realtime response to finish.')
    item.busy = true; clearTimeout(item.idleTimer); const started = Date.now()
    try {
      return await new Promise<{ text: string }>((resolve, reject) => {
        let text = ''; let settled = false
        const timer = setTimeout(() => fail(new AppError('TIMEOUT', 'Realtime response timed out. Reconnect before trying again.')), this.ai.config.timeoutMs)
        const cleanup = () => { clearTimeout(timer); item.socket.off('response.output_text.delta', delta); item.socket.off('response.done', done); item.socket.off('error', error); item.socket.socket.off('close', closed) }
        const fail = (error: AppError) => { if (settled) return; settled = true; cleanup(); this.record('realtime_reply', started, undefined, error.code); this.close(owner, id); reject(error) }
        const delta = (event: { delta: string }) => { text += event.delta; if (text.length > 24000) fail(new AppError('INVALID_RESPONSE', 'Realtime output exceeded the application limit.')) }
        const error = () => fail(new AppError('REALTIME_UNAVAILABLE', 'Realtime could not complete this response.'))
        const closed = () => fail(new AppError('REALTIME_UNAVAILABLE', 'The Realtime connection closed. Reconnect to continue.'))
        const done: Parameters<typeof item.socket.on<'response.done'>>[1] = event => {
          if (event.response.status !== 'completed' || !text.trim()) { fail(new AppError('INCOMPLETE_RESPONSE', 'Realtime returned an incomplete response.')); return }
          settled = true; cleanup(); this.record('realtime_reply', started, event.response.usage); this.armIdle(id, item)
          resolve({ text: text.split(this.ai.config.apiKey).join('[redacted]') })
        }
        item.socket.on('response.output_text.delta', delta); item.socket.on('response.done', done); item.socket.on('error', error); item.socket.socket.on('close', closed)
        try {
          item.socket.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
          item.socket.send({ type: 'response.create', response: { output_modalities: ['text'], instructions: `You are a helpful learning companion teaching ${item.topic}. Reply concisely and ask one useful learning question.` } })
        } catch { fail(new AppError('REALTIME_UNAVAILABLE', 'Realtime could not send this message. Reconnect to continue.')) }
      })
    } finally { item.busy = false }
  }
  close(owner: number, id: string) { const item = this.owned(owner, id); clearTimeout(item.idleTimer); this.connections.delete(id); item.socket.close(); return null }
  closeOwner(owner: number) { for (const [id, item] of this.connections) if (item.owner === owner) this.close(owner, id) }
  closeAll() { this.disposed = true; for (const [id, item] of this.connections) this.close(item.owner, id) }
  private record(operation: string, started: number, usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null, errorCode?: string) { if (!this.disposed) this.usage.record({ id: randomUUID(), operation, model: this.ai.config.realtimeModel, status: errorCode ? 'error' : 'success', inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, totalTokens: usage?.total_tokens ?? 0, latencyMs: Date.now() - started, createdAt: new Date().toISOString(), errorCode: errorCode ?? null }) }
}
