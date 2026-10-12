import { z } from 'zod'
import type { Result } from './contracts.cjs'
const text = (n: number) => z.string().trim().min(1).max(n)
export const interviewConfigSchema = z.object({
 role: text(150), experience: z.enum(['Entry-level','Mid-level','Senior']),
 type: z.enum(['Technical','Behavioral','General']), durationMinutes: z.number().int().min(5).max(60),
 jobDescription: z.string().trim().max(8000), language: text(80), mode: z.enum(['text','voice']), consent: z.boolean(),
}).strict().refine(v => v.mode !== 'voice' || v.consent)
export const rubric = [
 { id: 'knowledge', label: 'Subject knowledge', description: 'Accuracy, relevant concepts, and appropriate depth for the role.' },
 { id: 'communication', label: 'Communication clarity', description: 'Clear structure, concise explanations, and understandable examples. Do not infer accent or confidence from text.' },
 { id: 'reasoning', label: 'Reasoning & problem-solving', description: 'Logical steps, alternatives, constraints, and justified tradeoffs.' },
 { id: 'completeness', label: 'Answer completeness', description: 'Addresses the question with specifics, examples, and outcomes where relevant.' },
] as const
export const evidenceSchema = z.object({ turnId: z.uuid(), quote: text(800) }).strict()
const dimension = z.object({ score: z.number().int().min(0).max(5).nullable(), explanation: text(1200), evidence: z.array(evidenceSchema).max(4) }).strict()
const observation = z.object({ text: text(700), evidence: z.array(evidenceSchema).min(1).max(3) }).strict()
export const assessmentSchema = z.object({
 rubricVersion: z.literal('1'), knowledge: dimension, communication: dimension, reasoning: dimension, completeness: dimension,
 strengths: z.array(observation).max(6), improvements: z.array(observation).max(6), practiceTopics: z.array(text(300)).max(8),
}).strict()
export const questionSchema = z.object({ question: text(2000) }).strict()
export const interviewTurnSchema = z.object({ id: z.uuid(), itemId: text(200), role: z.enum(['user','assistant']), text: z.string().max(12000), status: z.enum(['partial','final']), at: z.string().datetime() }).strict()
export const interviewSessionSchema = z.object({
 id: z.uuid(), config: interviewConfigSchema, state: z.enum(['active','paused','interrupted','ended']),
 startedAt: z.string().datetime(), activeSince: z.string().datetime().nullable(), endedAt: z.string().datetime().nullable(),
 elapsedMs: z.number().int().min(0), turns: z.array(interviewTurnSchema).max(200), notices: z.array(text(500)).max(30),
 assessment: assessmentSchema.nullable(), evaluatedAt: z.string().datetime().nullable(),
}).strict()
export const interviewRefSchema = z.object({ id: z.uuid() }).strict()
export const interviewAnswerSchema = interviewRefSchema.extend({ text: text(12000) }).strict()
export const interviewResumeSchema = interviewRefSchema.extend({ mode: z.enum(['text','voice']), consent: z.boolean() }).strict()
export const interviewPollSchema = interviewRefSchema.extend({ after: z.number().int().min(0) }).strict()
export type InterviewConfig = z.infer<typeof interviewConfigSchema>
export type InterviewSession = z.infer<typeof interviewSessionSchema>
export type InterviewTurn = z.infer<typeof interviewTurnSchema>
export type Assessment = z.infer<typeof assessmentSchema>
export interface InterviewBridge {
 start(input: InterviewConfig): Promise<Result<InterviewSession>>
 get(input: {id:string}): Promise<Result<InterviewSession>>
 list(): Promise<Result<InterviewSession[]>>
 answer(input: {id:string;text:string}): Promise<Result<InterviewSession>>
 connect(input: {id:string}): Promise<Result<InterviewSession>>
 audio(input: {id:string;sequence:number;pcm:string}): Promise<Result<null>>
 poll(input: {id:string;after:number}): Promise<Result<{session:InterviewSession;audio:{sequence:number;pcm:string}[];cursor:number}>>
 pause(input: {id:string}): Promise<Result<InterviewSession>>
 resume(input: {id:string;mode:'text'|'voice';consent:boolean}): Promise<Result<InterviewSession>>
 end(input: {id:string}): Promise<Result<InterviewSession>>
 evaluate(input: {id:string}): Promise<Result<InterviewSession>>
}
