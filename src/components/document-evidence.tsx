import {useState} from 'react'
import {Button} from './ui/button'
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog'
import type {DocumentEvidence,DocumentChunk} from '../../shared/document-contracts.cts'
export function EvidenceLinks({documentId,evidence,locations}:{documentId:string;evidence:DocumentEvidence[];locations?:Record<string,string>}){
 const [open,setOpen]=useState(false),[source,setSource]=useState<DocumentChunk|null>(null),[quote,setQuote]=useState(''),[error,setError]=useState('')
 const inspect=async(ref:DocumentEvidence)=>{setOpen(true);setSource(null);setQuote(ref.quote);setError('');try{const r=await window.companion!.documents.source({id:documentId,chunkId:ref.chunkId});if(!r.ok)throw new Error(r.error.message);setSource(r.data)}catch(e){setError(e instanceof Error?e.message:'This source is unavailable.')}}
 const index=source?.text.indexOf(quote)??-1
 return <><div className="document-evidence">{evidence.map((ref,i)=><Button key={ref.chunkId+ref.quote+i} size="sm" variant="ghost" onClick={()=>void inspect(ref)} aria-label={'Inspect source '+(i+1)}>[{locations?.[ref.chunkId]??'Source '+(i+1)}]</Button>)}</div><Dialog open={open} onOpenChange={setOpen}><DialogContent className="document-source-dialog"><DialogTitle>{source?.heading??'Original source excerpt'}</DialogTitle><DialogDescription>{source?`${source.page?'Page '+source.page:'Line / paragraph '+source.lineStart} · Section ${source.position+1}. Highlighted text is the exact cited excerpt.`:'Loading the locally extracted source…'}</DialogDescription>{error&&<p role="alert">{error}</p>}{source&&<pre className="document-source-text">{index>=0?<>{source.text.slice(0,index)}<mark>{source.text.slice(index,index+quote.length)}</mark>{source.text.slice(index+quote.length)}</>:source.text}</pre>}</DialogContent></Dialog></>
}
