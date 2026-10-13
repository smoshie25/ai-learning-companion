import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
import { normalizeResourceURL,publicIPv4 } from '../ai/resource-retrieval.cjs'
// Public IPv4 is pinned for every redirect; never use renderer fetch or arbitrary headers.
export function readableText(html:string){return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim().slice(0,16000)}
export async function readOpportunityPage(input:string):Promise<string>{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000)
 try{let url=normalizeResourceURL(input)
 for(let hop=0;hop<4;hop++){
  const addresses=await Promise.race([lookup(new URL(url).hostname,{all:true,family:4}),new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});if(controller.signal.aborted)reject(new Error('timeout'))})])
  if(!addresses.length||addresses.some(a=>!publicIPv4(a.address)))throw new Error('unsafe address')
  const result=await new Promise<{status:number;location?:string;text:string}>((resolve,reject)=>{
   const req=request(url,{method:'GET',signal:controller.signal,headers:{'User-Agent':'AI-Learning-Companion/0.1','Accept':'text/html,text/plain'},lookup:((_host:any,options:any,callback:any)=>options?.all?callback(null,[{address:addresses[0].address,family:4}]):callback(null,addresses[0].address,4)) as any},res=>{
    const status=res.statusCode??0;if(status>=300&&status<400){res.resume();resolve({status,location:res.headers.location,text:''});return}
    if(status!==200||!/^text\/(html|plain)(?:;|$)/i.test(res.headers['content-type']??'')){res.resume();reject(new Error('unreadable'));return}
    const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>256000){res.destroy();reject(new Error('oversized page'))}else chunks.push(chunk)});res.on('error',reject);res.on('end',()=>resolve({status,text:readableText(Buffer.concat(chunks).toString('utf8'))}))
   });req.on('error',reject);req.end()
  })
  if(result.location){url=normalizeResourceURL(new URL(result.location,url).href);continue}
  if(result.text)return result.text;throw new Error('empty page')
 }throw new Error('redirect limit')
 }finally{clearTimeout(timer)}
}
