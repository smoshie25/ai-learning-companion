import { readFile,writeFile,mkdir,rename,unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { z } from 'zod'
import type { SecretEncryption } from '../ai/credentials.cjs'
import { AppError } from '../ai/errors.cjs'
export class ProviderVault {
 constructor(private directory:string,readonly encryption:SecretEncryption){}
 async available(){try{return await this.encryption.available()}catch{return false}}
 private filename(name:'client'|'calendar'|'gmail'){return path.join(this.directory,'google-'+name+'.enc')}
 async read<T>(name:'client'|'calendar'|'gmail',schema:z.ZodType<T>):Promise<T|null>{
  let bytes:Buffer;try{bytes=await readFile(this.filename(name))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new AppError('SECURE_STORAGE','Provider credentials could not be read.')}
  if(!await this.available())throw new AppError('SECURE_STORAGE','Unlock OS credential storage before using Google integrations.')
  try{if(bytes.length>65536)throw new Error();const value=await this.encryption.decrypt(bytes);return schema.parse(JSON.parse(value.result))}catch{throw new AppError('SECURE_STORAGE','Provider credentials could not be decrypted. Reconnect from Settings.')}
 }
 async write(name:'client'|'calendar'|'gmail',value:unknown){
  if(!await this.available())throw new AppError('SECURE_STORAGE','Secure OS storage is unavailable. Plaintext credential storage is disabled.')
  const filename=this.filename(name);const temporary=filename+'.'+randomUUID()+'.tmp'
  try{const bytes=await this.encryption.encrypt(JSON.stringify(value));await mkdir(this.directory,{recursive:true});await writeFile(temporary,bytes,{flag:'wx',mode:0o600});await rename(temporary,filename)}catch{throw new AppError('SECURE_STORAGE','Provider credentials could not be stored securely.')}finally{await unlink(temporary).catch(()=>{})}
 }
 async remove(name:'client'|'calendar'|'gmail'){try{await unlink(this.filename(name))}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new AppError('SECURE_STORAGE','Provider credentials could not be removed.')}}
}
