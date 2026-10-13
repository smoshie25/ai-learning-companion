import { randomUUID } from 'node:crypto'
import { unzipSync,strFromU8 } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import { AppError } from '../ai/errors.cjs'
import type { DocumentChunk } from '../../shared/document-contracts.cjs'
export const limits={bytes:20*1024*1024,characters:1500000,pages:500,chunks:400,chunkSize:4500}
export type SourceBlock={heading:string;page:number|null;lineStart:number|null;text:string;paragraph?:boolean}
export type Extracted={blocks:SourceBlock[];pages:number|null;warning:string}
export function chunkBlocks(blocks:SourceBlock[]):DocumentChunk[]{
 const chunks:DocumentChunk[]=[];let total=0
 const add=(b:SourceBlock,text:string)=>{if(!text.trim())return;total+=text.length;if(total>limits.characters||chunks.length>=limits.chunks)throw new AppError('DOCUMENT_LIMIT','The extracted document is too long. Import it as smaller chapter files.');chunks.push({id:randomUUID(),position:chunks.length,heading:b.heading.slice(0,200),page:b.page,lineStart:b.lineStart,text,state:'pending',analysis:null,error:null,completed:false,reviewedCards:[]})}
 const packed:SourceBlock[]=[];for(const block of blocks){const previous=packed.at(-1);if(previous&&previous.heading===block.heading&&previous.page===block.page&&previous.text.length+block.text.length+1<=limits.chunkSize)previous.text+='\n'+block.text;else packed.push({...block})}
 for(const block of packed){let remaining=block.text.replace(/\0/g,'').trim();let line=block.lineStart
  while(remaining.length>limits.chunkSize){let cut=remaining.lastIndexOf('\n',limits.chunkSize);if(cut<limits.chunkSize/2)cut=remaining.lastIndexOf(' ',limits.chunkSize);if(cut<limits.chunkSize/2)cut=limits.chunkSize;const part=remaining.slice(0,cut);add({...block,lineStart:line},part);const suffix=remaining.slice(cut),trimmed=suffix.trimStart();if(line!==null&&!block.paragraph)line+=(part.match(/\n/g)??[]).length+(suffix.slice(0,suffix.length-trimmed.length).match(/\n/g)??[]).length;remaining=trimmed}
  add({...block,lineStart:line},remaining)
 }
 if(!chunks.length)throw new AppError('NO_TEXT','No readable text was extracted. Scanned PDFs need OCR, which is not included.');return chunks
}
function decode(bytes:Uint8Array){try{if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes);if(bytes[0]===0xfe&&bytes[1]===0xff)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes);return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{throw new AppError('TEXT_ENCODING','Save this text file as UTF-8 or UTF-16 with a byte-order mark before importing.')}}
export function extractText(bytes:Uint8Array,markdown:boolean):Extracted{
 const content=decode(bytes).replace(/\r\n?/g,'\n');if(content.length>limits.characters)throw new AppError('DOCUMENT_LIMIT','This text file is too long. Import separate chapters.')
 const blocks:SourceBlock[]=[];let heading='Introduction',lines:string[]=[],start=1,fenced=false;const stack:string[]=[]
 const flush=()=>{if(lines.join('\n').trim())blocks.push({heading,page:null,lineStart:start,text:lines.join('\n')});lines=[]}
 const source=content.split('\n');for(let i=0;i<source.length;i++){const line=source[i];if(markdown&&/^\s*(```|~~~)/.test(line))fenced=!fenced;const h=!fenced?(markdown?/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line):/^(Chapter\s+\d+[:.\s-]+|Section\s+\d+[:.\s-]+)(.+)$/i.exec(line)):null
  if(h){flush();if(markdown){const depth=h[1].length;stack.length=depth-1;stack[depth-1]=h[2];heading=stack.filter(Boolean).join(' / ')}else heading=line.trim();start=i+1;lines.push(line);continue}
  if(!lines.length)start=i+1;lines.push(line)
 }flush();return {blocks,pages:null,warning:'References use extracted headings and original line numbers; this format has no reliable page numbers.'}
}
function docxBlocks(bytes:Uint8Array):Extracted{
 let entries=0,total=0
 const files=unzipSync(bytes,{filter:file=>{if(++entries>2000)throw new AppError('DOCX_LIMIT','This DOCX archive has too many entries.');if(!['word/document.xml','word/styles.xml'].includes(file.name))return false;total+=file.originalSize;if(file.originalSize>12*1024*1024||total>16*1024*1024)throw new AppError('DOCX_LIMIT','DOCX text exceeds the extraction limit.');return true}})
 if(!files['word/document.xml'])throw new AppError('INVALID_DOCX','This file is not a supported Word document.')
 const parse=(data:Uint8Array)=>{const xml=strFromU8(data);if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new AppError('INVALID_DOCX','XML entity declarations are not supported.');return new XMLParser({preserveOrder:true,ignoreAttributes:false,removeNSPrefix:true,processEntities:false,parseTagValue:false}).parse(xml)}
 const tree=parse(files['word/document.xml']);const styles=new Map<string,string>()
 const walk=(nodes:any[],visit:(node:any)=>void)=>{for(const node of nodes??[]){visit(node);for(const [key,value] of Object.entries(node))if(key!==':@'&&Array.isArray(value))walk(value,visit)}}
 if(files['word/styles.xml'])walk(parse(files['word/styles.xml']),node=>{if(node.style){const id=node[':@']?.['@_styleId'];const name=node.style.find((x:any)=>x.name)?.[':@']?.['@_val'];if(id&&name)styles.set(id,name)}})
 const blocks:SourceBlock[]=[];let heading='Introduction',paragraph=0
 walk(tree,node=>{if(!node.p)return;paragraph++;let text='',style='',breaks=0
  walk(node.p,(child:any)=>{if(child.t)text+=child.t.map((t:any)=>t['#text']??'').join('');if(child.tab)text+='\t';if(child.br){text+='\n';breaks++}if(child.pStyle)style=child[':@']?.['@_val']??''})
  // Decode predefined XML entities only; never resolve custom entities or external relationships.
  text=text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim()
  const name=styles.get(style)??style;if(/^heading\s*[1-6]$/i.test(name)||/^(title|subtitle)$/i.test(name))heading=text
  if(text)blocks.push({heading,page:null,lineStart:paragraph,text,paragraph:true})
 })
 return {blocks,pages:null,warning:'DOCX references use headings and paragraph numbers. Word layout pages, images, comments, footnotes and tracked-change semantics are not reconstructed.'}
}
export async function extractDocument(bytes:Uint8Array,format:'pdf'|'docx'|'txt'|'md'):Promise<Extracted>{
 if(!bytes.length||bytes.length>limits.bytes)throw new AppError('FILE_LIMIT','Import a non-empty file up to 20 MB; split larger materials by chapter.')
 if(format==='txt'||format==='md')return extractText(bytes,format==='md')
 if(format==='docx'){if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new AppError('INVALID_DOCX','The selected file is not a DOCX archive.');return docxBlocks(bytes)}
 if(!decode(bytes.slice(0,5)).startsWith('%PDF-'))throw new AppError('INVALID_PDF','The selected file is not a PDF.')
 const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=pdf.getDocument({data:new Uint8Array(bytes),enableXfa:false,useWorkerFetch:false,disableFontFace:true,verbosity:0});let document:Awaited<typeof task.promise>|undefined
 try{document=await task.promise;if(document.numPages>limits.pages)throw new AppError('DOCUMENT_LIMIT','PDFs are limited to 500 pages. Import separate chapters.');const blocks:SourceBlock[]=[];let characters=0,empty=0;const headings=new Map<number,string>()
  const visitOutline=async(items:Awaited<ReturnType<NonNullable<typeof document>['getOutline']>>)=>{for(const item of items??[]){try{const dest=typeof item.dest==='string'?await document!.getDestination(item.dest):item.dest;if(Array.isArray(dest)&&dest.length){const index=typeof dest[0]==='number'?dest[0]:await document!.getPageIndex(dest[0]);if(Number.isInteger(index)&&index>=0&&index<document!.numPages)headings.set(index+1,String(item.title).slice(0,200))}}catch{}if(item.items?.length)await visitOutline(item.items)}}
  try{await visitOutline(await document.getOutline())}catch{}let currentHeading=''
  for(let n=1;n<=document.numPages;n++){const page=await document.getPage(n);const content=await page.getTextContent();let text='',lastY:number|null=null
   for(const item of content.items){if(!('str' in item))continue;const y=item.transform[5];if(lastY!==null&&Math.abs(y-lastY)>3)text+='\n';else if(text&&!/\s$/.test(text))text+=' ';text+=item.str;if(item.hasEOL)text+='\n';lastY=y}
   if(headings.has(n))currentHeading=headings.get(n)!;else{const chapter=/^((?:Chapter|Section)\s+\d+[:. -][^\n.]{1,170})/im.exec(text);if(chapter)currentHeading=chapter[1].trim()}
   characters+=text.length;if(characters>limits.characters)throw new AppError('DOCUMENT_LIMIT','The PDF text exceeds the extraction limit.');if(!text.trim())empty++;else blocks.push({heading:currentHeading||'Page '+n,page:n,lineStart:null,text:text.trim()});page.cleanup()
  }return {blocks,pages:document.numPages,warning:empty?`${empty} page(s) had no readable text. Scanned content needs OCR; it is not analyzed.`:'PDF references use physical page numbers. Reading order in columns, equations and tables may need review.'}
 }finally{await task.destroy()}
}
