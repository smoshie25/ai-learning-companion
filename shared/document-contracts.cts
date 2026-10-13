import { z } from 'zod'
import type { Result } from './contracts.cjs'
import { planInputSchema,planProposalSchema } from './learning-contracts.cjs'
import { interviewConfigSchema } from './interview-contracts.cjs'
const text=(n:number)=>z.string().trim().min(1).max(n)
import { documentEvidenceSchema } from './document-evidence.cjs'
export { documentEvidenceSchema,documentStudySourcesSchema,documentInterviewContextSchema,documentQuestionsSchema } from './document-evidence.cjs'
const evidence=z.array(documentEvidenceSchema).min(1).max(3)
export const groundedPointSchema=z.object({text:text(1200),evidence}).strict()
export const documentAnalysisSchema=z.object({summary:z.array(groundedPointSchema).min(1).max(5),concepts:z.array(groundedPointSchema).max(5),definitions:z.array(z.object({term:text(150),explanation:text(1000),evidence}).strict()).max(5),priorities:z.array(groundedPointSchema).max(4),practice:z.array(z.object({question:text(500),answer:text(1000),evidence}).strict()).max(4),flashcards:z.array(z.object({front:text(300),back:text(700),evidence}).strict()).max(5)}).strict()
export const synthesisSchema=z.object({points:z.array(groundedPointSchema).min(1).max(4)}).strict()
export const documentAnswerSchema=z.object({supported:z.boolean(),answer:text(3000),evidence:z.array(documentEvidenceSchema).max(6)}).strict()
export const documentPlanSchema=z.object({plan:planProposalSchema,references:z.array(z.object({taskKey:text(40),evidence}).strict()).min(1).max(12)}).strict()
export const documentRefSchema=z.object({id:z.uuid()}).strict()
export const documentConsentSchema=documentRefSchema.extend({consent:z.literal(true)}).strict()
export const documentAnalyzeSchema=documentConsentSchema.extend({retryFailed:z.boolean().default(false),chunkIds:z.array(z.uuid()).min(1).max(8).optional()}).strict()
export const documentSelectionSchema=documentConsentSchema.extend({chunkIds:z.array(z.uuid()).min(1).max(8),topics:z.array(text(1200)).max(8)}).strict()
export const documentStudySchema=documentSelectionSchema.extend({goal:planInputSchema.shape.goal,minutesPerDay:planInputSchema.shape.minutesPerDay,deadline:planInputSchema.shape.deadline}).strict()
export const documentInterviewSchema=documentSelectionSchema.extend({config:interviewConfigSchema}).strict()
export const documentAskSchema=documentConsentSchema.extend({question:text(1000)}).strict()
export const documentSourceSchema=documentRefSchema.extend({chunkId:z.uuid()}).strict()
export const documentProgressSchema=documentSourceSchema.extend({completed:z.boolean(),reviewedCards:z.array(z.number().int().min(0).max(4)).max(5)}).strict()
export type DocumentEvidence=z.infer<typeof documentEvidenceSchema>
export type DocumentAnalysis=z.infer<typeof documentAnalysisSchema>
export type GroundedPoint=z.infer<typeof groundedPointSchema>
export type DocumentAnswer=z.infer<typeof documentAnswerSchema>
export type DocumentChunk={id:string;position:number;heading:string;page:number|null;lineStart:number|null;text:string;state:'pending'|'working'|'complete'|'failed';analysis:DocumentAnalysis|null;error:string|null;completed:boolean;reviewedCards:number[]}
export type ChunkView=Omit<DocumentChunk,'text'>
export type StudyDocument={id:string;title:string;format:'pdf'|'docx'|'txt'|'md';hash:string;createdAt:string;characters:number;pages:number|null;warning:string;state:'ready'|'analyzing'|'paused'|'complete'|'failed';message:string;executive:GroundedPoint[];chapters:Array<{heading:string;points:GroundedPoint[]}>;consentAt:string|null}
export const documentChunkSchema=z.object({id:z.uuid(),position:z.number().int().min(0).max(399),heading:text(200),page:z.number().int().min(1).max(500).nullable(),lineStart:z.number().int().min(1).nullable(),text:z.string().min(1).max(4500),state:z.enum(['pending','working','complete','failed']),analysis:documentAnalysisSchema.nullable(),error:z.string().max(1500).nullable(),completed:z.boolean(),reviewedCards:z.array(z.number().int().min(0).max(4)).max(5)}).strict()
export const studyDocumentSchema=z.object({id:z.uuid(),title:text(250),format:z.enum(['pdf','docx','txt','md']),hash:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.string().datetime(),characters:z.number().int().min(1).max(1500000),pages:z.number().int().min(1).max(500).nullable(),warning:z.string().max(1000),state:z.enum(['ready','analyzing','paused','complete','failed']),message:z.string().max(1500),executive:z.array(groundedPointSchema).max(4),chapters:z.array(z.object({heading:text(200),points:z.array(groundedPointSchema).max(4)}).strict()).max(400),consentAt:z.string().datetime().nullable()}).strict()
export type DocumentSnapshot={document:StudyDocument;chunks:ChunkView[];answers:Array<{question:string;at:string;result:DocumentAnswer}>}
export interface DocumentsBridge {
 import():Promise<Result<StudyDocument|null>>
 list():Promise<Result<StudyDocument[]>>
 get(input:{id:string}):Promise<Result<DocumentSnapshot>>
 source(input:{id:string;chunkId:string}):Promise<Result<DocumentChunk>>
 analyze(input:z.infer<typeof documentAnalyzeSchema>):Promise<Result<StudyDocument>>
 cancel(input:{id:string}):Promise<Result<null>>
 ask(input:z.infer<typeof documentAskSchema>):Promise<Result<DocumentAnswer>>
 study(input:z.infer<typeof documentStudySchema>):Promise<Result<import('./learning-contracts.cjs').StudyPlan>>
 interview(input:z.infer<typeof documentInterviewSchema>):Promise<Result<import('./interview-contracts.cjs').InterviewSession>>
 progress(input:z.infer<typeof documentProgressSchema>):Promise<Result<null>>
 remove(input:{id:string}):Promise<Result<null>>
}
