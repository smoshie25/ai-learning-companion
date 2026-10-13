import { z } from 'zod'
import type { Result } from './contracts.cjs'
import { dateSchema } from './learning-contracts.cjs'
const text=(n:number)=>z.string().trim().min(1).max(n)
const header=text(150).refine(v=>!/[\r\n\0]/.test(v))
export const timezoneSchema=text(80).refine(v=>{try{return (v==='UTC'||/^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(v))&&!!new Intl.DateTimeFormat('en',{timeZone:v})}catch{return false}},'Use an IANA time zone.')
export const calendarActionSchema=z.object({title:header,description:z.string().max(5000),start:z.string().datetime({offset:true}),end:z.string().datetime({offset:true}),timeZone:timezoneSchema,reminderMinutes:z.number().int().min(0).max(10080)}).strict()
export const emailActionSchema=z.object({to:z.array(z.string().email().max(254).regex(/^[\x21-\x7E]+$/)).min(1).max(5).refine(v=>new Set(v.map(s=>s.toLowerCase())).size===v.length),subject:header,body:text(20000).refine(v=>!v.includes('\0'))}).strict()
export const watchPayloadSchema=z.object({query:text(300),categories:z.array(text(80)).max(8),intervalHours:z.number().int().min(6).max(168),freeOnly:z.boolean(),notificationTo:z.string().email().max(254).regex(/^[\x21-\x7E]+$/).optional()}).strict()
export const learningTaskPayloadSchema=z.object({title:text(150),subject:text(100),deadline:dateSchema.nullable(),durationMinutes:z.number().int().min(5).max(180),priority:z.enum(['Low','Medium','High'])}).strict()
export const actionPayloadSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('calendar_event'),data:calendarActionSchema}).strict(),
 z.object({kind:z.literal('calendar_reminder'),data:calendarActionSchema}).strict(),
 z.object({kind:z.literal('email'),data:emailActionSchema}).strict(),
 z.object({kind:z.literal('learning_task'),data:learningTaskPayloadSchema}).strict(),
 z.object({kind:z.literal('opportunity_watch'),data:watchPayloadSchema}).strict(),
])
export const proposeActionSchema=z.object({idempotencyKey:text(100).regex(/^[A-Za-z0-9_-]+$/),rationale:text(2000),action:actionPayloadSchema}).strict()
export const actionSchema=z.object({
 id:z.uuid(),idempotencyKey:text(100),digest:text(64),revision:z.number().int().min(1),rationale:text(2000),action:actionPayloadSchema,
 state:z.enum(['proposed','approved','executing','succeeded','failed','uncertain','rejected']),
 createdAt:z.string().datetime(),updatedAt:z.string().datetime(),approvedAt:z.string().datetime().nullable(),approvedDigest:z.string().nullable(),grantId:z.string().nullable(),
 outcome:z.object({providerId:z.string().max(300).nullable(),message:text(1000)}).strict().nullable(),errorCode:z.string().max(80).nullable(),
}).strict()
export const actionRefSchema=z.object({id:z.uuid()}).strict()
export const actionApprovalSchema=actionRefSchema.extend({digest:z.string().regex(/^[a-f0-9]{64}$/),revision:z.number().int().min(1),grantId:z.uuid().nullable()}).strict()
export const actionEditSchema=actionRefSchema.extend({action:actionPayloadSchema,rationale:text(2000)}).strict()
export const listActionsSchema=z.object({state:actionSchema.shape.state.optional(),limit:z.number().int().min(1).max(100).default(50)}).strict()
export const watchInputSchema=watchPayloadSchema.extend({idempotencyKey:text(100).regex(/^[A-Za-z0-9_-]+$/)}).strict()
export const googleFeatureSchema=z.enum(['calendar','gmail'])
export const googleClientSchema=z.object({clientId:text(200).regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),clientSecret:z.string().max(300)}).strict()
export const googleFeatureInputSchema=z.object({feature:googleFeatureSchema}).strict()
export const googleTokenSchema=z.object({accountEmail:z.string().email().nullable(),accessToken:text(5000),refreshToken:text(5000),expiresAt:z.number().int().min(0),scopes:z.array(text(300)).max(10),grantId:z.uuid(),clientId:text(200)}).strict()
export type ActionPayload=z.infer<typeof actionPayloadSchema>
export type ActionRecord=z.infer<typeof actionSchema>
export type ActionView=ActionRecord&{taskCompleted?:boolean}
export type CalendarAction=z.infer<typeof calendarActionSchema>
export type EmailAction=z.infer<typeof emailActionSchema>
export type WatchPayload=z.infer<typeof watchPayloadSchema>
export type GoogleFeature=z.infer<typeof googleFeatureSchema>
export type GoogleToken=z.infer<typeof googleTokenSchema>
export type ActionProposal=z.infer<typeof proposeActionSchema>
export type IntegrationStatus={clientConfigured:boolean;secureStorage:boolean;calendarConnected:boolean;gmailConnected:boolean;gmailAccount:string|null;calendarGrantId:string|null;gmailGrantId:string|null;calendarScope:string;gmailScope:string}
export interface ActionsBridge {
 monitoring():Promise<Result<import('./monitoring-contracts.cjs').MonitoringSnapshot>>
 disableWatch(input:{id:string}):Promise<Result<null>>
 list():Promise<Result<ActionView[]>>
 propose(input:ActionProposal):Promise<Result<ActionRecord>>
 edit(input:{id:string;action:ActionPayload;rationale:string}):Promise<Result<ActionRecord>>
 approve(input:{id:string;digest:string;revision:number;grantId:string|null}):Promise<Result<ActionRecord>>
 reject(input:{id:string}):Promise<Result<ActionRecord>>
 execute(input:{id:string}):Promise<Result<ActionRecord>>
 completeTask(input:{id:string}):Promise<Result<null>>
 integrations():Promise<Result<IntegrationStatus>>
 saveGoogleClient(input:z.infer<typeof googleClientSchema>):Promise<Result<IntegrationStatus>>
 cancelGoogleConnect():Promise<Result<null>>
 connectGoogle(input:{feature:GoogleFeature}):Promise<Result<IntegrationStatus>>
 disconnectGoogle(input:{feature:GoogleFeature}):Promise<Result<IntegrationStatus>>
}
