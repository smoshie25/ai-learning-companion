import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import { isIP } from 'node:net'
import type { Verification } from '../../shared/learning-contracts.cjs'
import { AppError } from './errors.cjs'
export function normalizeResourceURL(value:string) {
 let url:URL;try{url=new URL(value)}catch{throw new AppError('INVALID_SOURCE','The search source URL is invalid.')}
 if(value.length>2000||url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||isIP(url.hostname.replace(/[\[\]]/g,''))||!url.hostname.includes('.')||/\.(local|internal|localhost|test)$/i.test(url.hostname)||url.hostname==='localhost')throw new AppError('INVALID_SOURCE','Only public HTTPS source links are supported.')
 for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key)||['fbclid','gclid','msclkid'].includes(key.toLowerCase()))url.searchParams.delete(key)
 url.searchParams.sort();return url.href
}
export function resourceIdentity(url:string) {const value=new URL(normalizeResourceURL(url));value.hash='';return value.href}
export function sourceKind(host:string):'Official documentation'|'Educational institution'|'Established free educator'|'Other search source' {
 const official=['developer.mozilla.org','docs.python.org','react.dev','typescriptlang.org','learn.microsoft.com','docs.oracle.com','docs.github.com','docs.rust-lang.org','go.dev','docs.postgresql.org','postgresql.org','developers.google.com','developers.openai.com','platform.openai.com','w3.org']
 if(official.some(d=>host===d||host.endsWith('.'+d)))return 'Official documentation'
 if(host.endsWith('.edu')||['mit.edu','stanford.edu','ox.ac.uk','cam.ac.uk','open.ac.uk'].some(d=>host===d||host.endsWith('.'+d)))return 'Educational institution'
 if(['freecodecamp.org','khanacademy.org','theodinproject.com','openstax.org'].some(d=>host===d||host.endsWith('.'+d)))return 'Established free educator'
 return 'Other search source'
}
export type SearchSource={url:string;title:string}
export function normalizeSources(sources:SearchSource[]) {
 const seen=new Set<string>();const results:SearchSource[]=[]
 for(const source of sources.slice(0,100)){try{const url=normalizeResourceURL(source.url);const id=resourceIdentity(url);if(seen.has(id)||!source.title?.trim())continue;seen.add(id);results.push({url,title:source.title.trim().slice(0,300)})}catch{}}
 const order=['Official documentation','Educational institution','Established free educator','Other search source']
 return results.sort((a,b)=>order.indexOf(sourceKind(new URL(a.url).hostname))-order.indexOf(sourceKind(new URL(b.url).hostname))).slice(0,12)
}
export function extractSearchSources(response:any):SearchSource[] {
 if(response.status!=='completed'||!Array.isArray(response.output)||!response.output.some((item:any)=>item.type==='web_search_call'&&item.status==='completed'))throw new AppError('SEARCH_UNAVAILABLE','Search did not complete. No generated URLs will be substituted.')
 const sources:SearchSource[]=[]
 for(const item of response.output)if(item.type==='message')for(const part of item.content??[])if(part.type==='output_text')for(const citation of part.annotations??[])if(citation.type==='url_citation'&&typeof citation.url==='string'&&typeof citation.title==='string')sources.push({url:citation.url,title:citation.title})
 return normalizeSources(sources)
}
export function publicIPv4(value:string) {
 if(isIP(value)!==4)return false
 const [a,b,c]=value.split('.').map(Number)
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113)
}
type HeadResult={status:number;location?:string;contentType:string}
export type LinkTransport={resolve(host:string):Promise<string[]>;head(url:string,address:string):Promise<HeadResult>}
const transport:LinkTransport={
 resolve:async host=>(await lookup(host,{all:true,family:4})).map(item=>item.address),
 head:(url,address)=>new Promise((resolve,reject)=>{
  const req=request(url,{method:'HEAD',headers:{'User-Agent':'AI-Learning-Companion/0.1'},lookup:((_host:any,_options:any,callback:any)=>_options?.all?callback(null,[{address,family:4}]):callback(null,address,4)) as any},res=>{res.resume();resolve({status:res.statusCode??0,location:res.headers.location,contentType:res.headers['content-type']??''})})
  const timer=setTimeout(()=>req.destroy(new Error('timeout')),5000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end()
 }),
}
export async function verifySource(url:string,network:LinkTransport=transport):Promise<Verification> {
 const checkedAt=new Date().toISOString()
 try{
 let current=normalizeResourceURL(url)
 for(let hops=0;hops<4;hops++){
  const host=new URL(current).hostname
  let timer:ReturnType<typeof setTimeout>|undefined;const addresses=await Promise.race([network.resolve(host),new Promise<string[]>((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),5000)})]).finally(()=>clearTimeout(timer));if(!addresses.length||addresses.some(a=>!publicIPv4(a)))throw new Error('nonpublic')
  const result=await network.head(current,addresses[0])
  if([301,302,303,307,308].includes(result.status)&&result.location){current=normalizeResourceURL(new URL(result.location,current).href);continue}
  if(result.status>=200&&result.status<300)return {state:'reachable',checkedAt,finalUrl:current,textReadable:/^(text\/|application\/(xhtml\+xml|json))/i.test(result.contentType),message:'HTTPS link responded successfully. Reachability does not confirm course content, price, or learning-time estimates.'}
  return {state:'unverified',checkedAt,finalUrl:null,textReadable:false,message:'The source did not confirm availability (HTTP '+result.status+'). It may require a browser or sign-in.'}
 }
 }catch{}
 return {state:'unverified',checkedAt,finalUrl:null,textReadable:false,message:'The link could not be verified. Network restrictions, an unsafe redirect, or a timeout may be responsible.'}
}
