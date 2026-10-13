import type { DocumentChunk,DocumentEvidence,DocumentAnalysis,GroundedPoint,DocumentAnswer } from '../../shared/document-contracts.cjs'
import { documentAnalysisSchema,documentAnswerSchema,synthesisSchema } from '../../shared/document-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
// Resolve only whitespace differences from PDF layout. Persist the original source span.
function sourceQuote(text:string,quote:string):string|null {
 if(text.includes(quote))return quote
 const words=quote.trim().split(/\s+/u)
 if(!words.length||!words[0])return null
 const pattern=words.map(word=>word.replace(/[.*+?^${}()|[\]\\]/g,char=>'\\'+char)).join('\\s+')
 const match=new RegExp(pattern,'u').exec(text)
 return match&&match[0].length<=400?match[0]:null
}
export function validateEvidence(refs:DocumentEvidence[],chunks:DocumentChunk[],allowed?:Set<string>){
 const resolved=refs.map(ref=>{const c=chunks.find(c=>c.id===ref.chunkId),quote=c?sourceQuote(c.text,ref.quote):null;if(!quote||allowed&&!allowed.has(ref.chunkId+'\0'+quote))throw new AppError('INVALID_EVIDENCE','AI output cited text absent from the supplied source. It was not saved.');return quote})
 refs.forEach((ref,i)=>{ref.quote=resolved[i]})
}
export function evidenceFrom(value:unknown):DocumentEvidence[]{const refs:DocumentEvidence[]=[];function walk(v:any){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(walk);return}for(const [key,item] of Object.entries(v))if(key==='evidence'&&Array.isArray(item))refs.push(...item as DocumentEvidence[]);else walk(item)}walk(value);return refs}
export function validateAnalysis(value:unknown,chunks:DocumentChunk[]):DocumentAnalysis{const parsed=documentAnalysisSchema.parse(value);validateEvidence(evidenceFrom(parsed),chunks);return parsed}
export function validateSynthesis(value:unknown,chunks:DocumentChunk[],inputs:GroundedPoint[]){const parsed=synthesisSchema.parse(value);validateEvidence(evidenceFrom(parsed),chunks,new Set(evidenceFrom(inputs).map(e=>e.chunkId+'\0'+e.quote)));return parsed.points}
export function validateAnswer(value:unknown,chunks:DocumentChunk[]):DocumentAnswer{const parsed=documentAnswerSchema.parse(value);if(!parsed.supported){if(parsed.evidence.length)throw new AppError('INVALID_EVIDENCE','An unsupported answer must not invent references.');return {...parsed,answer:'The retrieved source sections do not support an answer to this question. Try a more specific question or inspect another chapter.'}}if(!parsed.evidence.length)throw new AppError('INVALID_EVIDENCE','A supported answer requires source evidence.');validateEvidence(parsed.evidence,chunks);return parsed}
const tokens=(text:string):string[]=>text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]
export function retrieveChunks(chunks:DocumentChunk[],question:string){
 const stop=new Set(['what','when','where','which','does','with','that','this','from','explain','please','about','could','would','should','have','the','and','for','how','why','are']);const terms=[...new Set(tokens(question))].filter(t=>!stop.has(t))
 const documents=chunks.map(c=>{const frequencies=new Map<string,number>();for(const word of tokens(c.text))frequencies.set(word,(frequencies.get(word)??0)+1);return {c,frequencies,heading:new Set(tokens(c.heading))}})
 const documentFrequency=new Map(terms.map(t=>[t,documents.filter(d=>d.frequencies.has(t)).length]))
 return documents.map(d=>({c:d.c,score:terms.reduce((sum,t)=>{const tf=d.frequencies.get(t)??0,df=documentFrequency.get(t)??0;return sum+(tf?Math.log(1+tf)*Math.log(1+documents.length/(1+df)):0)+(d.heading.has(t)?2:0)},0)})).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.c.position-b.c.position).slice(0,5).map(v=>v.c)
}
