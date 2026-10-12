import { interviewConfigSchema, interviewRefSchema, interviewAnswerSchema, interviewResumeSchema, interviewPollSchema } from '../../shared/interview-contracts.cjs'
import type { InterviewService } from '../ai/interview-service.cjs'
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { workspaceSchema, updateSchema, tutorSchema, interviewRequestSchema, realtimeConnectSchema, realtimeSendSchema, realtimeCloseSchema, saveKeySchema, type Update, type Result } from '../../shared/contracts.cjs'
import type { WorkspaceRepository } from '../persistence/repositories.cjs'
import type { AIService } from '../ai/service.cjs'
import type { RealtimeService } from '../ai/realtime.cjs'
import { AppError, safeError } from '../ai/errors.cjs'
import { assertTrustedSender, validatePayload } from './validation.cjs'
import { startRecordingSchema, recordingRefSchema, resumeRecordingSchema, audioChunkSchema, noteSchema, pinSchema, searchRecordingsSchema } from '../../shared/session-contracts.cjs'
import type { SessionIntelligence } from '../ai/session-intelligence.cjs'
export function registerIPC(getWindow: () => BrowserWindow | null, expectedURL: string, repository: WorkspaceRepository, ai: AIService, realtime: RealtimeService, intelligence: SessionIntelligence, interviews: InterviewService) {
  const busy = new Set<number>(); const requests = new Map<number, number[]>()
  const sender = (event: IpcMainInvokeEvent) => {
    const window = getWindow(); const frame = event.senderFrame
    if (!window || !frame) throw new AppError('FORBIDDEN', 'Application window unavailable.')
    assertTrustedSender({ id: event.sender.id, frameId: frame.routingId, mainFrameId: event.sender.mainFrame.routingId, url: frame.url }, { id: window.webContents.id, url: expectedURL })
  }
  function handle<T, R>(channel: string, schema: z.ZodType<T>, work: (input: T, owner: number) => R | Promise<R>, paid = false) {
    ipcMain.handle(channel, async (event, payload): Promise<Result<R>> => {
      let reserved = false
      try {
        sender(event); const input = validatePayload(schema, payload)
        if (paid) {
          const recent = (requests.get(event.sender.id) ?? []).filter(time => Date.now() - time < 60000)
          if (busy.has(event.sender.id)) throw new AppError('BUSY', 'Wait for the current AI operation to finish.')
          if (recent.length >= 12) throw new AppError('RATE_LIMIT', 'Please wait a moment before sending more AI requests.')
          requests.set(event.sender.id, [...recent, Date.now()]); busy.add(event.sender.id); reserved = true
        }
        return { ok: true, data: await work(input, event.sender.id) }
      } catch (error) { const safe = error instanceof AppError ? error : safeError(error); return { ok: false, error: { code: safe.code, message: safe.message } } }
      finally { if (reserved) busy.delete(event.sender.id) }
    })
  }
  const none = z.null()
  ipcMain.handle('app:version', event => { sender(event); return '0.1.0' })
  handle('workspace:bootstrap', workspaceSchema, input => repository.bootstrap(input))
  handle('workspace:update', updateSchema, input => { repository.update(input as Update); return null })
  handle('ai:status', none, () => ai.status())
  const changeCredential = async (work: () => Promise<import('../../shared/contracts.cjs').AIStatus>) => { if (realtime.hasConnections() || intelligence.hasAIWork() || interviews.hasAIWork()) throw new AppError('BUSY', 'Pause recording or voice interviews and disconnect Realtime before changing your API key.'); return work() }
  handle('ai:save-key', saveKeySchema, input => changeCredential(() => ai.saveKey(input.key)), true)
  handle('ai:remove-key', none, () => changeCredential(() => ai.removeKey()), true)
  handle('ai:validate', none, () => ai.validate(), true)
  handle('ai:tutor', tutorSchema, input => ai.tutor(input), true)
  handle('ai:summarize', tutorSchema, input => ai.summarize(input), true)
  handle('ai:interview', interviewRequestSchema, input => ai.interview(input), true)
  handle('ai:realtime-connect', realtimeConnectSchema, (input, owner) => realtime.connect(owner, input.topic), true)
  handle('ai:realtime-send', realtimeSendSchema, (input, owner) => realtime.send(owner, input.connectionId, input.text), true)
  handle('ai:realtime-close', realtimeCloseSchema, (input, owner) => realtime.close(owner, input.connectionId))
  handle('interviews:start', interviewConfigSchema, (input, owner) => interviews.start(owner, input), true)
  handle('interviews:get', interviewRefSchema, input => interviews.get(input.id))
  handle('interviews:list', none, () => interviews.repository.list())
  handle('interviews:answer', interviewAnswerSchema, (input, owner) => interviews.answer(owner, input.id, input.text), true)
  handle('interviews:connect', interviewRefSchema, (input, owner) => interviews.connect(owner, input.id), true)
  handle('interviews:audio', audioChunkSchema, (input, owner) => interviews.audio(owner, input.id, input.sequence, input.pcm))
  handle('interviews:poll', interviewPollSchema, (input, owner) => interviews.poll(owner, input.id, input.after))
  handle('interviews:pause', interviewRefSchema, (input, owner) => interviews.pause(owner, input.id))
  handle('interviews:resume', interviewResumeSchema, (input, owner) => interviews.resume(owner, input.id, input.mode, input.consent), true)
  handle('interviews:end', interviewRefSchema, (input, owner) => interviews.end(owner, input.id))
  handle('interviews:evaluate', interviewRefSchema, input => interviews.evaluate(input.id), true)
  handle('intelligence:capabilities', none, () => ({ systemAudio: process.platform === 'win32' }))
  handle('intelligence:start', startRecordingSchema, (input, owner) => intelligence.start(owner, input))
  handle('intelligence:get', recordingRefSchema, input => intelligence.repository.get(input.id))
  handle('intelligence:search', searchRecordingsSchema, input => intelligence.repository.search(input.query))
  handle('intelligence:connect', recordingRefSchema, (input, owner) => intelligence.connect(owner, input.id), true)
  handle('intelligence:audio', audioChunkSchema, (input, owner) => intelligence.audio(owner, input.id, input.sequence, input.pcm))
  handle('intelligence:pause', recordingRefSchema, (input, owner) => intelligence.pause(owner, input.id))
  handle('intelligence:resume', resumeRecordingSchema, (input, owner) => intelligence.resume(owner, input.id, input.consent))
  handle('intelligence:end', recordingRefSchema, (input, owner) => intelligence.end(owner, input.id))
  handle('intelligence:interrupt', recordingRefSchema, (input, owner) => intelligence.interrupt(owner, input.id))
  handle('intelligence:note', noteSchema, (input, owner) => intelligence.note(owner, input.id, input.text))
  handle('intelligence:pin', pinSchema, input => intelligence.pin(input.id, input.segmentId, input.highlighted))
  handle('intelligence:summarize', recordingRefSchema, input => intelligence.summarize(input.id), true)
  return (owner: number) => { realtime.closeOwner(owner); intelligence.closeOwner(owner); interviews.closeOwner(owner); requests.delete(owner); busy.delete(owner) }
}
