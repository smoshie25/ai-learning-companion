import { z } from 'zod'
import { documentStudySourcesSchema } from './document-evidence.cjs'
import type { Result } from './contracts.cjs'
const text=(max:number)=>z.string().trim().min(1).max(max)
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v)
export const gapSchema=z.object({id:text(200),text:text(2000),sourceId:text(100),sourceTitle:text(200),source:z.enum(['session','interview','practice']),basis:z.literal('AI-identified'),excerpt:z.string().max(800).nullable()}).strict()
export const gapAnalysisSchema=z.object({gaps:z.array(z.object({sourceId:text(100),text:text(2000),excerpt:text(800)}).strict()).max(10)}).strict()
export const verificationSchema=z.object({state:z.enum(['reachable','unverified']),checkedAt:z.string().datetime(),finalUrl:z.string().max(2000).nullable(),textReadable:z.boolean(),message:text(500)}).strict()
export const discoveredResourceSchema=z.object({
 id:z.uuid(),url:text(2000),title:text(300),provider:text(200),sourceKind:z.enum(['Official documentation','Educational institution','Established free educator','Other search source']),
 difficulty:z.enum(['Beginner','Intermediate','Advanced','Unknown']),estimatedMinutes:z.number().int().min(5).max(600).nullable(),relevance:text(1200),
 query:text(1000),verification:verificationSchema,approved:z.boolean(),createdAt:z.string().datetime(),
}).strict()
export const resourceMetadataSchema=z.object({items:z.array(z.object({sourceId:z.number().int().min(0).max(11),difficulty:z.enum(['Beginner','Intermediate','Advanced','Unknown']),estimatedMinutes:z.number().int().min(5).max(600).nullable(),relevance:text(1200)}).strict()).max(12)}).strict()
export const discoveryInputSchema=z.object({goal:text(500),gapIds:z.array(text(200)).max(12),textOnly:z.boolean()}).strict()
export const planInputSchema=discoveryInputSchema.extend({minutesPerDay:z.number().int().min(10).max(180),deadline:dateSchema.nullable()}).strict()
export const proposedTaskSchema=z.object({
 key:text(40),title:text(150),description:text(1000),durationMinutes:z.number().int().min(5).max(120),priority:z.enum(['Low','Medium','High']),
 deadline:dateSchema.nullable(),dependencies:z.array(text(40)).max(12),resourceIds:z.array(z.uuid()).max(5),
 activity:text(1500),assessmentQuestion:text(700),assessmentCriteria:text(1000),
}).strict()
export const planProposalSchema=z.object({title:text(150),rationale:text(2000),tasks:z.array(proposedTaskSchema).min(1).max(12)}).strict()
export const attemptSchema=z.object({id:z.uuid(),at:z.string().datetime(),question:text(700),criteria:text(1000),revision:text(64),answer:text(6000),score:z.number().int().min(0).max(5),explanation:text(1200),excerpt:text(800)}).strict()
export const studyTaskSchema=proposedTaskSchema.extend({id:z.uuid(),state:z.enum(['proposed','approved','rejected','completed']),completedAt:z.string().datetime().nullable(),attempts:z.array(attemptSchema).max(30)}).strict()
export const studyPlanSchema=z.object({
 documentSources:documentStudySourcesSchema.optional(),
 id:z.uuid(),goal:text(500),title:text(150),rationale:text(2000),gapIds:z.array(text(200)).max(12),gapContext:z.array(gapSchema).max(12),
 minutesPerDay:z.number().int().min(10).max(180),deadline:dateSchema.nullable(),textOnly:z.boolean(),
 state:z.enum(['proposed','approved','rejected']),createdAt:z.string().datetime(),approvedAt:z.string().datetime().nullable(),
 tasks:z.array(studyTaskSchema).min(1).max(12),
}).strict()
export const learningRefSchema=z.object({id:z.uuid()}).strict()
export const resourceApproveSchema=learningRefSchema.extend({approved:z.boolean()}).strict()
export const taskRefSchema=z.object({planId:z.uuid(),taskId:z.uuid()}).strict()
export const taskEditSchema=taskRefSchema.extend({task:proposedTaskSchema}).strict()
export const taskActionSchema=taskRefSchema.extend({action:z.enum(['approve','reject','complete','reopen'])}).strict()
export const planActionSchema=learningRefSchema.extend({action:z.enum(['approve','reject'])}).strict()
export const taskAnswerSchema=taskRefSchema.extend({answer:text(6000)}).strict()
export const practiceResultSchema=z.object({score:z.number().int().min(0).max(5),explanation:text(1200),excerpt:text(800)}).strict()
export type Gap=z.infer<typeof gapSchema>
export type DiscoveredResource=z.infer<typeof discoveredResourceSchema>
export type StudyPlan=z.infer<typeof studyPlanSchema>
export type ProposedTask=z.infer<typeof proposedTaskSchema>
export type StudyTask=z.infer<typeof studyTaskSchema>
export type PlanInput=z.infer<typeof planInputSchema>
export type DiscoveryInput=z.infer<typeof discoveryInputSchema>
export type Verification=z.infer<typeof verificationSchema>
export type LearningSnapshot={gaps:Gap[];resources:DiscoveredResource[];plans:StudyPlan[]}
export interface LearningBridge {
 load():Promise<Result<LearningSnapshot>>
 analyzeGaps():Promise<Result<Gap[]>>
 discover(input:DiscoveryInput):Promise<Result<DiscoveredResource[]>>
 saveResource(input:{id:string;approved:boolean}):Promise<Result<DiscoveredResource>>
 verifyResource(input:{id:string}):Promise<Result<DiscoveredResource>>
 openResource(input:{id:string}):Promise<Result<null>>
 propose(input:PlanInput):Promise<Result<StudyPlan>>
 planAction(input:{id:string;action:'approve'|'reject'}):Promise<Result<StudyPlan>>
 editTask(input:{planId:string;taskId:string;task:ProposedTask}):Promise<Result<StudyPlan>>
 taskAction(input:{planId:string;taskId:string;action:'approve'|'reject'|'complete'|'reopen'}):Promise<Result<StudyPlan>>
 assess(input:{planId:string;taskId:string;answer:string}):Promise<Result<StudyPlan>>
}
