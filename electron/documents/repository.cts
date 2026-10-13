import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { StudyDocument,DocumentChunk,DocumentSnapshot,DocumentAnswer } from '../../shared/document-contracts.cjs'
import { studyDocumentSchema,documentChunkSchema,documentAnswerSchema } from '../../shared/document-contracts.cjs'
import { transaction } from '../persistence/database.cjs'
import { AppError } from '../ai/errors.cjs'
export class DocumentRepository {
 constructor(private db:DatabaseSync){}
 list():StudyDocument[]{return this.db.prepare('SELECT data FROM study_documents ORDER BY rowid DESC LIMIT 100').all().map(r=>studyDocumentSchema.parse(JSON.parse(r.data as string)))}
 get(id:string):StudyDocument{const r=this.db.prepare('SELECT data FROM study_documents WHERE id=?').get(id);if(!r)throw new AppError('NOT_FOUND','This study document is unavailable.');return studyDocumentSchema.parse(JSON.parse(r.data as string))}
 save(doc:StudyDocument){doc=studyDocumentSchema.parse(doc);this.db.prepare('UPDATE study_documents SET data=? WHERE id=?').run(JSON.stringify(doc),doc.id);return doc}
 create(doc:StudyDocument,chunks:DocumentChunk[]){doc=studyDocumentSchema.parse(doc);chunks=chunks.map(c=>documentChunkSchema.parse(c));return transaction(this.db,()=>{const existing=this.db.prepare('SELECT id FROM study_documents WHERE hash=?').get(doc.hash);if(existing)return this.get(existing.id as string);this.db.prepare('INSERT INTO study_documents VALUES (?,?,?)').run(doc.id,doc.hash,JSON.stringify(doc));for(const chunk of chunks)this.db.prepare('INSERT INTO document_chunks VALUES (?,?,?,?)').run(chunk.id,doc.id,chunk.position,JSON.stringify(chunk));return doc})}
 chunks(id:string):DocumentChunk[]{this.get(id);return this.db.prepare('SELECT data FROM document_chunks WHERE document_id=? ORDER BY position').all(id).map(r=>documentChunkSchema.parse(JSON.parse(r.data as string)))}
 chunk(id:string,chunkId:string):DocumentChunk{const r=this.db.prepare('SELECT data FROM document_chunks WHERE id=? AND document_id=?').get(chunkId,id);if(!r)throw new AppError('NOT_FOUND','This source section is unavailable.');return documentChunkSchema.parse(JSON.parse(r.data as string))}
 saveChunk(id:string,c:DocumentChunk){c=documentChunkSchema.parse(c);if(!this.db.prepare('UPDATE document_chunks SET data=? WHERE id=? AND document_id=?').run(JSON.stringify(c),c.id,id).changes)throw new AppError('NOT_FOUND','This source section was removed.')}
 answer(id:string,question:string,result:DocumentAnswer){result=documentAnswerSchema.parse(result);this.db.prepare('INSERT INTO document_answers VALUES (?,?,?,?)').run(randomUUID(),id,new Date().toISOString(),JSON.stringify({question,result}));this.db.prepare('DELETE FROM document_answers WHERE document_id=? AND id NOT IN (SELECT id FROM document_answers WHERE document_id=? ORDER BY at DESC,rowid DESC LIMIT 30)').run(id,id)}
 snapshot(id:string):DocumentSnapshot{return {document:this.get(id),chunks:this.chunks(id).map(({text,analysis,...c})=>({...c,analysis:null})),answers:this.db.prepare('SELECT at,data FROM document_answers WHERE document_id=? ORDER BY at DESC,rowid DESC LIMIT 30').all(id).map(r=>({at:r.at as string,...JSON.parse(r.data as string)}))}}
 remove(id:string){this.get(id);this.db.prepare('DELETE FROM study_documents WHERE id=?').run(id)}
 recover(){for(const row of this.db.prepare("SELECT id FROM study_documents WHERE json_extract(data,'$.state')='analyzing'").all()){const doc=this.get(row.id as string);if(doc.state==='analyzing'){for(const chunk of this.chunks(doc.id))if(chunk.state==='working')this.saveChunk(doc.id,{...chunk,state:'pending',error:null});this.save({...doc,state:'paused',message:'Analysis was interrupted. Completed sections are retained; consent and resume to continue.'})}}}
}
