import { open } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { limits } from './extraction.cjs'
import { AppError } from '../ai/errors.cjs'
import type { DocumentChunk } from '../../shared/document-contracts.cjs'
export async function importStudyFile(filename:string){
 const format=path.extname(filename).slice(1).toLowerCase();if(!['pdf','docx','txt','md'].includes(format))throw new AppError('FILE_FORMAT','Choose PDF, DOCX, TXT or Markdown.')
 const file=await open(filename,'r');let buffer:Buffer
 try{const stat=await file.stat();if(!stat.isFile()||stat.size<=0||stat.size>limits.bytes)throw new AppError('FILE_LIMIT','Choose a non-empty local file up to 20 MB.');buffer=Buffer.alloc(stat.size);const {bytesRead}=await file.read(buffer,0,stat.size,0);if(bytesRead!==stat.size)throw new AppError('FILE_CHANGED','The file changed during import. Try again.')}finally{await file.close()}
 const result=await new Promise<{extracted:{pages:number|null;warning:string};chunks:DocumentChunk[]}>((resolve,reject)=>{
  const worker=new Worker(path.join(__dirname,'extraction-worker.cjs'),{workerData:{bytes:buffer,format},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}});const timer=setTimeout(()=>{void worker.terminate();reject(new AppError('EXTRACTION_TIMEOUT','Extraction exceeded 45 seconds. Import a smaller chapter or a text export.'))},45000)
  worker.once('message',message=>{clearTimeout(timer);void worker.terminate();message.ok?resolve(message):reject(new AppError(message.code,message.message))});worker.once('error',()=>{clearTimeout(timer);reject(new AppError('EXTRACTION_FAILED','Extraction could not finish within the local resource limits. Try a smaller text export.'))});worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new AppError('EXTRACTION_FAILED','The extraction worker stopped. Try a smaller text export.'))}})
 })
 return {format:format as 'pdf'|'docx'|'txt'|'md',title:path.basename(filename).slice(0,250),hash:createHash('sha256').update(buffer).digest('hex'),...result}
}
