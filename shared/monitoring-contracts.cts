import { z } from 'zod'
export const factSchema=z.object({value:z.string().min(1).max(500),quote:z.string().min(1).max(600)}).strict().nullable()
export const opportunityFactsSchema=z.object({cost:factSchema,eligibility:factSchema,deadline:factSchema,free:z.boolean().nullable()}).strict()
export const opportunitySchema=z.object({url:z.string().max(2000),title:z.string().min(1).max(300),provider:z.string().max(200),cost:factSchema,eligibility:factSchema,deadline:factSchema,free:z.boolean().nullable(),checkedAt:z.string().datetime(),verification:z.enum(['evidence-checked','unverified']),relevance:z.number().min(0).max(100),note:z.string().max(600)}).strict()
export type Opportunity=z.infer<typeof opportunitySchema>
export type MonitoringSnapshot={watches:Array<{id:string;enabled:boolean;query:string;intervalHours:number;notificationTo?:string;lastRun:string|null}>,runs:Array<{watchId:string;at:string;state:string;message:string}>,alerts:Array<{id:string;watchId:string;actionId:string|null;state:string;opportunity:Opportunity}>;note:string}
