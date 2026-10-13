import { parentPort,workerData } from 'node:worker_threads'
import { extractDocument,chunkBlocks } from './extraction.cjs'
import { AppError } from '../ai/errors.cjs'
void (async()=>{try{const extracted=await extractDocument(new Uint8Array(workerData.bytes),workerData.format);parentPort?.postMessage({ok:true,extracted:{pages:extracted.pages,warning:extracted.warning},chunks:chunkBlocks(extracted.blocks)})}catch(error){parentPort?.postMessage({ok:false,code:error instanceof AppError?error.code:'EXTRACTION_FAILED',message:error instanceof AppError?error.message:'Text extraction failed. The file may be corrupted, encrypted, or unsupported.'})}})()
