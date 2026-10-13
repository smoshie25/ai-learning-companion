import { z } from 'zod'

const text = (max = 500) => z.string().min(1).max(max)
export const apiKeySchema = z.string().trim().min(20).max(1000).regex(/^sk-[A-Za-z0-9_-]+$/)
export const saveKeySchema = z.object({ key: apiKeySchema }).strict()
export const idSchema = z.string().min(1).max(100).regex(/^[\w-]+$/)
export const messageSchema = z.object({ role: z.enum(['assistant', 'user']), text: text(12000) }).strict()
export const messagesSchema = z.array(messageSchema).max(80).refine(items => items.reduce((n, m) => n + m.text.length, 0) <= 100000)
export const sessionSchema = z.object({ id: idSchema, title: text(150), category: text(100), duration: text(50), date: text(100), summary: text(12000), highlights: z.array(text(2000)).max(20), transcript: messagesSchema.optional() }).strict()
export const taskSchema = z.object({ id: idSchema, title: text(150), subject: text(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value), done: z.boolean() }).strict()
export const planSchema = z.object({ id: idSchema, title: text(100), description: text(2000), subject: text(100), weeks: text(60), color: z.enum(['green', 'blue', 'purple', 'orange']) }).strict()
export const opportunitySchema = z.object({ id: idSchema, title: text(200), provider: text(100), initials: text(8), color: z.enum(['green', 'blue', 'purple', 'orange', 'coral']), kind: z.enum(['Free course', 'Certification', 'Scholarship', 'Bootcamp', 'Discounted training']), category: text(100), description: text(3000), duration: text(100), deadline: text(100), detail: text(6000), skills: z.array(text(100)).max(20) }).strict()
export const resourceSchema = z.object({ id: idSchema, title: text(200), kind: z.enum(['note', 'link', 'course']), content: z.string().max(20000), sessionId: idSchema.nullable() }).strict()
export const preferencesSchema = z.object({ name: text(30).refine(s => s.trim().length > 0), language: z.enum(['English', 'French', 'Spanish']), goal: z.enum(['Build a career in technology', 'Develop professional skills', 'Explore something new']), level: z.enum(['Beginner', 'Intermediate', 'Advanced']), reminders: z.boolean() }).strict()
export const summarySchema = z.object({ summary: text(6000), highlights: z.array(text(1000)).min(1).max(8) }).strict()
export const feedbackSchema = z.object({ strengths: z.array(text(1500)).min(1).max(5), improvements: z.array(text(1500)).min(1).max(5), nextStep: text(2000) }).strict()
export const interviewSchema = z.object({ id: idSchema, career: text(100), experience: text(80), type: text(80), date: text(100), questions: z.array(text(2000)).length(3), answers: z.array(text(12000)).length(3), feedback: feedbackSchema.nullable(), mode: z.enum(['offline', 'openai']) }).strict()
const unique = <T extends { id: string }>(schema: z.ZodType<T>) => z.array(schema).max(2000).refine(items => new Set(items.map(item => item.id)).size === items.length)
export const fields = {
  preferences: preferencesSchema, sessions: unique(sessionSchema), tasks: unique(taskSchema), plans: unique(planSchema),
  opportunities: unique(opportunitySchema), resources: unique(resourceSchema), interviewResults: unique(interviewSchema),
  saved: z.array(idSchema).max(2000).refine(items => new Set(items).size === items.length),
  theme: z.enum(['light', 'dark']), collapsed: z.boolean(), interviewCompleted: z.number().int().min(0).max(100000),
  aiProfile: z.enum(['offline', 'standard', 'focused']),
  learningDraft: z.object({ topic: text(150), mode: z.enum(['Guided learning', 'Practice & exercises', 'Explain it simply']), messages: messagesSchema }).strict().nullable(),
  interviewDraft: z.object({ career: text(100), experience: text(80), type: text(80), questionIndex: z.number().int().min(0).max(2), answers: z.array(text(12000)).max(2), answer: z.string().max(12000) }).strict().nullable(),
}
export const workspaceSchema = z.object(fields).strict()
export type Workspace = z.infer<typeof workspaceSchema>
export type Field = keyof Workspace
export type Update = { [K in Field]: { field: K; value: Workspace[K] } }[Field]
export const updateSchema = z.union(Object.entries(fields).map(([field, value]) => z.object({ field: z.literal(field), value }).strict()) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]])
export const tutorSchema = z.object({ topic: text(150), mode: z.enum(['Guided learning', 'Practice & exercises', 'Explain it simply']), messages: messagesSchema }).strict()
export const interviewRequestSchema = interviewSchema.pick({ career: true, experience: true, type: true, questions: true, answers: true })
export const realtimeConnectSchema = z.object({ topic: text(150) }).strict()
export const realtimeSendSchema = z.object({ connectionId: z.uuid(), text: text(6000) }).strict()
export const realtimeCloseSchema = z.object({ connectionId: z.uuid() }).strict()
export type TutorInput = z.infer<typeof tutorSchema>
export type InterviewInput = z.infer<typeof interviewRequestSchema>
export type Feedback = z.infer<typeof feedbackSchema>
export type Summary = z.infer<typeof summarySchema>
export type Usage = { id: string; operation: string; model: string; status: 'success' | 'error'; inputTokens: number; outputTokens: number; totalTokens: number; latencyMs: number; errorCode: string | null; createdAt: string }
export type AIStatus = { keyConfigured: boolean; keyStorageAvailable: boolean; keySaved: boolean; keyWarning: string | null; selected: Workspace['aiProfile']; profiles: { id: Workspace['aiProfile']; label: string; model: string | null }[]; realtimeModel: string; timeoutMs: number; maxRetries: number; usage: { requests: number; totalTokens: number } }
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
export interface CompanionBridge {
  actions: import('./action-contracts.cjs').ActionsBridge
  learning: import('./learning-contracts.cjs').LearningBridge
  interviews: import('./interview-contracts.cjs').InterviewBridge
  intelligence: import('./session-contracts.cjs').IntelligenceBridge
  getVersion(): Promise<string>
  workspace: { bootstrap(seed: Workspace): Promise<Result<Workspace>>; update(update: Update): Promise<Result<null>> }
  ai: {
    saveKey(input: { key: string }): Promise<Result<AIStatus>>
    removeKey(): Promise<Result<AIStatus>>
    status(): Promise<Result<AIStatus>>
    validate(): Promise<Result<{ message: string }>>
    tutor(input: TutorInput): Promise<Result<{ text: string }>>
    summarize(input: TutorInput): Promise<Result<Summary>>
    interview(input: InterviewInput): Promise<Result<Feedback>>
    realtimeConnect(input: { topic: string }): Promise<Result<{ connectionId: string }>>
    realtimeSend(input: { connectionId: string; text: string }): Promise<Result<{ text: string }>>
    realtimeClose(input: { connectionId: string }): Promise<Result<null>>
  }
}
