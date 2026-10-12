import { randomUUID } from 'node:crypto'
import { OpenAIRealtimeWS } from 'openai/realtime/ws'
import type { AIService } from './service.cjs'
import { AppError } from './errors.cjs'
import type { IntelligenceRepository } from '../persistence/session-repository.cjs'
import type { UsageRepository } from '../persistence/repositories.cjs'
import type { RecordingSnapshot, Segment, StartRecording } from '../../shared/session-contracts.cjs'
type Run = { owner: number; socket: OpenAIRealtimeWS; prefix: string; ready: boolean; sequence: number; bytes: number; acceptedBytes: number; audioStarted: number; packetTimes: number[]; offset: number; commits: number[]; items: Map<string, Segment>; pending: Set<string>; finished: Set<string>; events: Set<string>; closing: boolean; lastAudio: number; watchdog?: ReturnType<typeof setInterval> }
export class SessionIntelligence {
  private owners = new Map<string, number>()
  private runs = new Map<string, Run>()
  private controls = new Set<string>()
  private extracting = new Set<string>()
  private lastInsight = new Map<string, number>()
  private disposed = false
  hasAIWork() { return this.runs.size > 0 || this.extracting.size > 0 || this.controls.size > 0 }
  constructor(readonly repository: IntelligenceRepository, private ai: AIService, private usage: UsageRepository, private factory = () => new OpenAIRealtimeWS({ intent: 'transcription', options: { handshakeTimeout: ai.config.timeoutMs, maxPayload: 1024 * 1024 } }, ai.getClient())) { repository.recover() }
  private owned(owner: number, id: string) { if (this.owners.get(id) !== owner) throw new AppError('FORBIDDEN', 'Resume this learning session before changing it.'); return this.repository.get(id) }
  private noOther(owner: number, id?: string) { for (const [other, current] of this.owners) if (current === owner && other !== id && this.repository.get(other).state !== 'ended') throw new AppError('BUSY', 'End the current learning session before starting another.') }
  start(owner: number, input: StartRecording) {
    this.noOther(owner)
    if (input.source === 'microphone_system' && process.platform !== 'win32') throw new AppError('UNSUPPORTED', 'System audio is currently supported on Windows only.')
    if (input.source !== 'notes') { if (!input.consent) throw new AppError('CONSENT_REQUIRED', 'Recording requires participant consent.'); if (this.ai.status().selected === 'offline') throw new AppError('OFFLINE_MODE', 'Select an OpenAI configuration in Settings to transcribe audio.'); this.ai.getClient() }
    const now = new Date().toISOString(); const id = randomUUID()
    this.repository.save({ id, title: input.title, topic: input.topic, goals: input.goals, source: input.source, consentAt: input.source === 'notes' ? null : now, state: 'recording', startedAt: now, endedAt: null, elapsedMs: 0, activeSince: now, gaps: [], highlights: [], summary: null })
    this.owners.set(id, owner); return this.repository.get(id)
  }
  canCapture(owner: number, system = false) { return [...this.owners].some(([id, current]) => { const item = this.repository.get(id); return owner === current && item.state === 'recording' && !!item.consentAt && (system ? item.source === 'microphone_system' : item.source !== 'notes') }) }
  async connect(owner: number, id: string) {
    const session = this.owned(owner, id)
    if (session.state !== 'recording' || session.source === 'notes' || this.runs.has(id)) throw new AppError('INVALID_STATE', 'This session cannot open an audio connection now.')
    const socket = this.factory()
    const run: Run = { owner, socket, prefix: randomUUID(), ready: false, sequence: 0, bytes: 0, acceptedBytes: 0, audioStarted: Date.now(), packetTimes: [], offset: session.elapsedMs, commits: [], items: new Map(), pending: new Set(), finished: new Set(), events: new Set(), closing: false, lastAudio: Date.now() }
    this.runs.set(id, run)
    const guarded = (work: () => void) => { if (this.disposed || run.closing) return; try { work() } catch { this.interrupt(owner, id, 'Transcript processing stopped. Received text is retained; part of the recording may be missing.') } }
    socket.on('error', () => guarded(() => { this.interrupt(owner, id) }))
    socket.socket.on('close', () => guarded(() => { this.interrupt(owner, id) }))
    socket.on('input_audio_buffer.committed', event => guarded(() => {
      const item = this.item(id, run, event.item_id, run.commits.shift() ?? run.offset)
      if (!run.finished.has(item.itemId)) run.pending.add(item.itemId)
    }))
    socket.on('conversation.item.input_audio_transcription.delta', event => guarded(() => {
      if (run.events.has(event.event_id)) return
      run.events.add(event.event_id); if (run.events.size > 2000) run.events.delete(run.events.values().next().value!)
      const item = this.item(id, run, event.item_id)
      if (item.status === 'final') return
      item.text += this.redact(event.delta ?? ''); this.repository.segment(id, item)
    }))
    socket.on('conversation.item.input_audio_transcription.completed', event => guarded(() => {
      const item = this.item(id, run, event.item_id)
      if (run.finished.has(item.itemId)) return
      item.text = this.redact(event.transcript ?? ''); item.status = 'final'; this.repository.segment(id, item)
      run.pending.delete(item.itemId); run.finished.add(item.itemId)
      const usage = event.usage?.type === 'tokens' ? event.usage : undefined
      this.usage.record({ id: randomUUID(), operation: 'session_transcription', model: this.ai.config.transcriptionModel ?? 'gpt-live-transcribe', status: 'success', inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, totalTokens: usage?.total_tokens ?? 0, latencyMs: 0, errorCode: null, createdAt: new Date().toISOString() })
      void this.insights(id)
    }))
    socket.on('conversation.item.input_audio_transcription.failed', () => guarded(() => { this.interrupt(owner, id, 'A speech turn could not be transcribed. Received partial text was retained.') }))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(new AppError('TIMEOUT', 'Audio transcription timed out. Resume to reconnect.')), this.ai.config.timeoutMs)
        const finish = (error?: AppError) => { clearTimeout(timer); socket.off('session.created', created); socket.off('session.updated', updated); socket.off('error', failed); socket.socket.off('close', failed); error ? reject(error) : resolve() }
        const failed = () => finish(new AppError('REALTIME_UNAVAILABLE', 'Audio transcription could not connect. Check your configuration and resume.'))
        const updated = () => { if (this.runs.get(id) !== run || this.repository.get(id).state !== 'recording') { failed(); return } run.ready = true; finish() }
        const created = () => { try { socket.send({ type: 'session.update', session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: this.ai.config.transcriptionModel ?? 'gpt-live-transcribe', prompt: `Learning topic: ${session.topic}`, languages: [this.language()] }, turn_detection: null } } } }) } catch { failed() } }
        socket.on('session.created', created); socket.on('session.updated', updated); socket.on('error', failed); socket.socket.on('close', failed)
      })
      run.watchdog = setInterval(() => { if (Date.now() - run.lastAudio > 15000) guarded(() => { this.interrupt(owner, id, 'Audio delivery stopped. Check your microphone and resume. No audio was replayed.') }) }, 5000)
      return null
    } catch (error) { if (this.runs.get(id) === run) this.interrupt(owner, id); throw error }
  }
  private language() { return this.ai.learningLanguage() }
  private redact(value: string) { return this.ai.config.apiKey ? value.split(this.ai.config.apiKey).join('[redacted]') : value }
  private item(id: string, run: Run, itemId: string, offset?: number) {
    let item = run.items.get(itemId)
    if (!item) {
      const session = this.repository.get(id)
      item = { id: randomUUID(), itemId: `${run.prefix}:${itemId}`, text: '', status: 'partial', source: session.source === 'microphone_system' ? 'mixed_audio' : 'microphone', offsetMs: offset ?? run.offset, highlighted: false }
      run.items.set(itemId, item); this.repository.segment(id, item)
    } else if (offset !== undefined) { item.offsetMs = offset; this.repository.segment(id, item) }
    return item
  }
  audio(owner: number, id: string, sequence: number, pcm: string) {
    const session = this.owned(owner, id); const run = this.runs.get(id)
    if (session.state !== 'recording' || !run?.ready || run.closing) throw new AppError('INVALID_STATE', 'Audio recording is not connected.')
    const buffer = Buffer.from(pcm, 'base64')
    if (buffer.length < 4 || buffer.length > 12000 || buffer.length % 2 || sequence !== run.sequence) { this.interrupt(owner, id, 'Audio delivery was interrupted or out of order. Resume to continue; missing audio is not replayed.'); throw new AppError('AUDIO_SEQUENCE', 'Audio delivery stopped. Resume the session to reconnect.') }
    const now = Date.now(); run.packetTimes = run.packetTimes.filter(time => now - time < 1000)
    if (run.packetTimes.length >= 10 || run.acceptedBytes + buffer.length > (now - run.audioStarted + 2000) * 48) { this.interrupt(owner, id, 'Audio exceeded the live delivery rate. Recording was stopped without replaying packets.'); throw new AppError('AUDIO_RATE_LIMIT', 'Audio arrived too quickly. Recording was stopped; resume to continue.') }
    run.packetTimes.push(now); run.acceptedBytes += buffer.length
    if (run.socket.socket.bufferedAmount > 96000) { this.interrupt(owner, id, 'The connection could not keep up with audio. Resume when the network is stable.'); throw new AppError('BACKPRESSURE', 'The audio connection is too slow. Recording was stopped.') }
    run.sequence++; run.lastAudio = Date.now(); run.bytes += buffer.length
    this.repository.save({ ...session, elapsedMs: session.elapsedMs + Math.round(buffer.length / 48) })
    try { run.socket.send({ type: 'input_audio_buffer.append', audio: pcm }); if (run.bytes >= 384000) this.commit(id, run) }
    catch { this.interrupt(owner, id); throw new AppError('REALTIME_UNAVAILABLE', 'Audio could not be sent. Resume to reconnect.') }
    return null
  }
  private commit(id: string, run: Run) {
    if (run.bytes < 4800) return
    run.commits.push(run.offset); run.offset = this.repository.get(id).elapsedMs; run.bytes = 0
    run.socket.send({ type: 'input_audio_buffer.commit' })
  }
  private closeRun(id: string) { const run = this.runs.get(id); if (run) { run.closing = true; clearInterval(run.watchdog); this.runs.delete(id); run.socket.close() } }
  interrupt(owner: number, id: string, reason = 'The audio connection was interrupted. Received transcript text is retained; unsent audio may be missing.') {
    const session = this.owned(owner, id)
    if (session.state === 'ended' || session.state === 'interrupted') return session
    this.repository.save({ ...session, state: 'interrupted', activeSince: null, gaps: [...session.gaps.slice(-99), { at: new Date().toISOString(), reason }] })
    this.closeRun(id); return this.repository.get(id)
  }
  private async stop(owner: number, id: string) {
    const session = this.owned(owner, id)
    if (session.state !== 'recording') return session
    this.repository.save({ ...session, state: 'paused', activeSince: null, elapsedMs: session.source === 'notes' && session.activeSince ? session.elapsedMs + Date.now() - Date.parse(session.activeSince) : session.elapsedMs })
    const run = this.runs.get(id)
    if (run?.ready) {
      try {
        this.commit(id, run)
        const deadline = Date.now() + 5000
        while (this.runs.get(id) === run && (run.commits.length || run.pending.size) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40))
        if (run.bytes || run.commits.length || run.pending.size) { const latest = this.repository.get(id); this.repository.save({ ...latest, gaps: [...latest.gaps.slice(-99), { at: new Date().toISOString(), reason: 'The last audio turn did not fully finalize. Partial transcript text is retained and excluded from summary evidence.' }] }) }
      } catch { const latest = this.repository.get(id); this.repository.save({ ...latest, gaps: [...latest.gaps.slice(-99), { at: new Date().toISOString(), reason: 'The last audio turn could not be finalized.' }] }) }
    }
    this.closeRun(id); return this.repository.get(id)
  }
  private async control<T>(id: string, work: () => Promise<T>) { if (this.controls.has(id)) throw new AppError('BUSY', 'Wait for the current session operation to finish.'); this.controls.add(id); try { return await work() } finally { this.controls.delete(id) } }
  pause(owner: number, id: string) { return this.control(id, async () => { const session = this.owned(owner, id); if (session.state !== 'recording') throw new AppError('INVALID_STATE', 'Only an active session can be paused.'); return this.stop(owner, id) }) }
  resume(owner: number, id: string, consent: boolean) {
    if (this.controls.has(id)) throw new AppError('BUSY', 'Wait for the current session operation to finish.')
    this.noOther(owner, id); const session = this.repository.get(id)
    if (this.owners.has(id) && this.owners.get(id) !== owner) throw new AppError('FORBIDDEN', 'This session belongs to another window.')
    if (!['paused', 'interrupted'].includes(session.state)) throw new AppError('INVALID_STATE', 'Only a paused or interrupted session can resume.')
    if (session.source !== 'notes' && !consent) throw new AppError('CONSENT_REQUIRED', 'Confirm participant consent before resuming recording.')
    if (session.source !== 'notes') { if (this.ai.status().selected === 'offline') throw new AppError('OFFLINE_MODE', 'Select an OpenAI configuration in Settings to resume audio transcription.'); this.ai.getClient() }
    this.owners.set(id, owner); this.repository.save({ ...session, state: 'recording', activeSince: new Date().toISOString(), consentAt: session.source === 'notes' ? null : new Date().toISOString() }); return this.repository.get(id)
  }
  end(owner: number, id: string) { return this.control(id, async () => {
    // An interrupted session recovered after a restart can be ended without reopening capture.
    const session = this.repository.get(id)
    if (!this.owners.has(id) && ['paused', 'interrupted'].includes(session.state)) { this.noOther(owner, id); this.owners.set(id, owner) }
    this.owned(owner, id); if (session.state === 'ended') throw new AppError('INVALID_STATE', 'This session has already ended.')
    const stopped = await this.stop(owner, id); this.closeRun(id)
    this.repository.save({ ...stopped, state: 'ended', activeSince: null, endedAt: new Date().toISOString() }); this.owners.delete(id); return this.repository.get(id)
  }) }
  note(owner: number, id: string, text: string) { const session = this.owned(owner, id); if (session.state !== 'recording' || session.source !== 'notes') throw new AppError('INVALID_STATE', 'Notes can be added only during an active notes session.'); this.repository.segment(id, { id: randomUUID(), itemId: randomUUID(), text, status: 'final', source: 'note', offsetMs: session.elapsedMs + Date.now() - Date.parse(session.activeSince!), highlighted: false }); return this.repository.get(id) }
  pin(id: string, segmentId: string, highlighted: boolean) { const session = this.repository.get(id); const segment = session.segments.find(item => item.id === segmentId); if (!segment) throw new AppError('NOT_FOUND', 'Transcript excerpt unavailable.'); this.repository.segment(id, { ...segment, highlighted }); const run = this.runs.get(id); if (run) for (const item of run.items.values()) if (item.id === segmentId) item.highlighted = highlighted; return this.repository.get(id) }
  summarize(id: string) { return this.control(id, async () => { const session = this.repository.get(id); if (session.state !== 'ended') throw new AppError('INVALID_STATE', 'End the session before generating its summary.'); const summary = await this.ai.sessionSummary(session); if (this.disposed) throw new AppError('CLOSED', 'The application closed.'); this.repository.save({ ...this.repository.get(id), summary }); return this.repository.get(id) }) }
  private async insights(id: string) {
    if (this.extracting.has(id) || Date.now() - (this.lastInsight.get(id) ?? 0) < 30000 || this.disposed) return
    this.extracting.add(id); this.lastInsight.set(id, Date.now())
    try { const result = await this.ai.sessionInsights(this.repository.get(id)); if (!this.disposed) { const current = this.repository.get(id); this.repository.save({ ...current, highlights: [...current.highlights, ...result.highlights].filter((item, i, items) => items.findIndex(other => other.text === item.text) === i).slice(-30) }) } }
    catch { /* Live highlights are optional. Transcript persistence and recording continue. */ }
    finally { this.extracting.delete(id) }
  }
  closeOwner(owner: number) { for (const [id, current] of this.owners) if (current === owner) { if (this.repository.get(id).state === 'recording') this.interrupt(owner, id, 'The session window closed or reloaded. Received transcript text is retained.'); this.closeRun(id); this.owners.delete(id) } }
  closeAll() { for (const owner of new Set(this.owners.values())) this.closeOwner(owner); this.disposed = true }
}
