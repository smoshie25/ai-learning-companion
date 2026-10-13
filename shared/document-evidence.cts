import { z } from 'zod'
const text=(n:number)=>z.string().trim().min(1).max(n)
export const documentEvidenceSchema=z.object({chunkId:z.uuid(),quote:text(400)}).strict()
const evidence=z.array(documentEvidenceSchema).min(1).max(3)
export const documentQuestionsSchema=z.object({questions:z.array(z.object({question:text(600),answer:text(1000),evidence}).strict()).min(1).max(6)}).strict()
export const documentStudySourcesSchema=z.object({documentId:z.uuid(),title:text(250),references:z.array(z.object({taskKey:text(40),evidence}).strict()).max(12)}).strict()
export const documentInterviewContextSchema=z.object({documentId:z.uuid(),title:text(250),questions:documentQuestionsSchema.shape.questions}).strict()
