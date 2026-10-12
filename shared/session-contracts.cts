import { z } from 'zod'
const label = (max: number) => z.string().trim().min(1).max(max)
export const sessionId = z.uuid()
export const evidenceSchema = z.object({ segmentId: sessionId, quote: label(1000) }).strict()
export const insightSchema = z.object({ text: label(700), evidence: z.array(evidenceSchema).min(1).max(3) }).strict()
export const intelligenceSummarySchema = z.object({
  overview: label(1500), topics: z.array(label(200)).max(12),
  concepts: z.array(z.object({ name: label(150), explanation: label(700) }).strict()).max(12),
  conclusions: z.array(label(700)).max(10),
  actions: z.array(z.object({ title: label(300), kind: z.enum(['explicit_assignment', 'ai_suggested']), evidence: z.array(evidenceSchema).min(1).max(3) }).strict()).max(12),
  knowledgeGaps: z.array(label(700)).max(10), nextSteps: z.array(label(700)).max(8),
}).strict()
export const liveInsightsSchema = z.object({ highlights: z.array(insightSchema).max(5) }).strict()
export const segmentSchema = z.object({ id: sessionId, itemId: label(200), text: z.string().max(12000), status: z.enum(['partial', 'final']), source: z.enum(['microphone', 'mixed_audio', 'note']), offsetMs: z.number().int().min(0), highlighted: z.boolean() }).strict()
export const recordingSchema = z.object({
  id: sessionId, title: label(150), topic: label(150), goals: z.string().max(1500),
  source: z.enum(['notes', 'microphone', 'microphone_system']), consentAt: z.string().datetime().nullable(),
  state: z.enum(['recording', 'paused', 'interrupted', 'ended']), startedAt: z.string().datetime(), endedAt: z.string().datetime().nullable(),
  elapsedMs: z.number().int().min(0), activeSince: z.string().datetime().nullable(),
  gaps: z.array(z.object({ at: z.string().datetime(), reason: label(500) }).strict()).max(100),
  highlights: z.array(insightSchema).max(30), summary: intelligenceSummarySchema.nullable(),
}).strict()
export const snapshotSchema = recordingSchema.extend({ segments: z.array(segmentSchema).max(1000) })
export const startRecordingSchema = z.object({ title: label(150), topic: label(150), goals: z.string().trim().max(1500), source: z.enum(['notes', 'microphone', 'microphone_system']), consent: z.boolean() }).strict().refine(value => value.source === 'notes' || value.consent)
export const recordingRefSchema = z.object({ id: sessionId }).strict()
export const resumeRecordingSchema = recordingRefSchema.extend({ consent: z.boolean() }).strict()
export const audioChunkSchema = recordingRefSchema.extend({ sequence: z.number().int().min(0), pcm: z.string().min(8).max(16000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict()
export const noteSchema = recordingRefSchema.extend({ text: label(6000) }).strict()
export const pinSchema = recordingRefSchema.extend({ segmentId: sessionId, highlighted: z.boolean() }).strict()
export const searchRecordingsSchema = z.object({ query: z.string().max(200) }).strict()
export type Recording = z.infer<typeof recordingSchema>
export type Segment = z.infer<typeof segmentSchema>
export type RecordingSnapshot = z.infer<typeof snapshotSchema>
export type IntelligenceSummary = z.infer<typeof intelligenceSummarySchema>
export type StartRecording = z.infer<typeof startRecordingSchema>
export interface IntelligenceBridge {
  capabilities(): Promise<import('./contracts.cjs').Result<{ systemAudio: boolean }>>
  start(input: StartRecording): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  get(input: { id: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  search(input: { query: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot[]>>
  connect(input: { id: string }): Promise<import('./contracts.cjs').Result<null>>
  audio(input: { id: string; sequence: number; pcm: string }): Promise<import('./contracts.cjs').Result<null>>
  pause(input: { id: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  resume(input: { id: string; consent: boolean }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  end(input: { id: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  interrupt(input: { id: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  note(input: { id: string; text: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  pin(input: { id: string; segmentId: string; highlighted: boolean }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
  summarize(input: { id: string }): Promise<import('./contracts.cjs').Result<RecordingSnapshot>>
}
