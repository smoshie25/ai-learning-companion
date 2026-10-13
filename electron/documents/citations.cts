import type {DocumentChunk,DocumentEvidence} from '../../shared/document-contracts.cjs'
import {AppError} from '../ai/errors.cjs'
export type Citation={id:string;chunkId:string;quote:string}
export function citationCatalog(refs:DocumentEvidence[]):Citation[]{const seen=new Set<string>();return refs.filter(r=>{const key=r.chunkId+'\0'+r.quote;if(seen.has(key))return false;seen.add(key);return true}).map((r,i)=>({id:'excerpt_'+(i+1),...r}))}
export function chunkCitations(chunks:DocumentChunk[]):Citation[]{
 const refs:DocumentEvidence[]=[]
 for(const chunk of chunks){let start=0;while(start<chunk.text.length){let end=Math.min(start+300,chunk.text.length);if(end<chunk.text.length){const boundary=chunk.text.lastIndexOf(' ',end);if(boundary>start+150)end=boundary}const quote=chunk.text.slice(start,end).trim();if(quote)refs.push({chunkId:chunk.id,quote});start=end}}
 return citationCatalog(refs)
}
// Provider outputs choose IDs. Only main supplies original source IDs and quotations.
export function citationSchema(schema:Record<string,unknown>,catalog:Citation[]):Record<string,unknown>{
 if(!catalog.length)throw new AppError('INVALID_EVIDENCE','No source excerpts are available for this request.')
 function visit(value:any):any{if(Array.isArray(value))return value.map(visit);if(!value||typeof value!=='object')return value;if(value.type==='object'&&value.properties?.chunkId&&value.properties?.quote)return {type:'object',properties:{citationId:{type:'string',enum:catalog.map(c=>c.id)}},required:['citationId'],additionalProperties:false};return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item)]))}
 return visit(schema)
}
export function resolveCitations(value:unknown,catalog:Citation[]):unknown{
 const byId=new Map(catalog.map(c=>[c.id,c]))
 function visit(v:any):any{if(Array.isArray(v))return v.map(visit);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.entries(v).map(([key,item])=>{if(key!=='evidence')return [key,visit(item)];if(!Array.isArray(item))throw new AppError('INVALID_EVIDENCE','The AI returned invalid source references.');return [key,item.map(ref=>{if(!ref||typeof ref!=='object'||Object.keys(ref).length!==1||typeof ref.citationId!=='string')throw new AppError('INVALID_EVIDENCE','The AI returned invalid source references.');const original=byId.get(ref.citationId);if(!original)throw new AppError('INVALID_EVIDENCE','The AI cited an unavailable source excerpt.');return {chunkId:original.chunkId,quote:original.quote}})]}))}
 return visit(value)
}
