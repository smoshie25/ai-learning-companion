import type { AIService } from '../ai/service.cjs'
import { normalizeSources,resourceIdentity,sourceKind } from '../ai/resource-retrieval.cjs'
import { opportunityFactsSchema,type Opportunity } from '../../shared/monitoring-contracts.cjs'
import { readOpportunityPage } from './page-reader.cjs'
import { AppError } from '../ai/errors.cjs'
export function validateOpportunityFacts(input:unknown,text:string){const facts=opportunityFactsSchema.parse(input);for(const fact of [facts.cost,facts.eligibility,facts.deadline])if(fact&&!text.includes(fact.quote))throw new AppError('INVALID_EVIDENCE','Opportunity facts must quote the retrieved source exactly.');if(facts.free!==null&&!facts.cost)throw new AppError('INVALID_EVIDENCE','Free/paid status requires cost evidence.');return facts}
export class OpportunityDiscovery {
 constructor(private ai:Pick<AIService,'searchLearningSources'|'opportunityFacts'>,private read=readOpportunityPage){}
 async search(query:string){
  const sources=normalizeSources(await this.ai.searchLearningSources('Find current learning courses, training, scholarships or certifications matching: '+query+'. Prefer provider enrollment pages; verify price, eligibility and deadline.')).slice(0,6)
  const results:Opportunity[]=[]
  for(const s of sources){let facts={cost:null,eligibility:null,deadline:null,free:null} as ReturnType<typeof validateOpportunityFacts>;let verified=false
   try{const text=await this.read(s.url);facts=validateOpportunityFacts(await this.ai.opportunityFacts(text),text);verified=true}catch{/* Unknown facts stay unknown; never fabricate a substitute. */}
   const words=query.toLowerCase().split(/\W+/).filter(w=>w.length>3);const hits=words.filter(w=>s.title.toLowerCase().includes(w)).length;const kind=sourceKind(new URL(s.url).hostname)
   results.push({url:resourceIdentity(s.url),title:s.title,provider:new URL(s.url).hostname,...facts,checkedAt:new Date().toISOString(),verification:verified?'evidence-checked':'unverified',relevance:Math.min(100,20+hits*12+(kind!=='Other search source'?25:0)),note:verified?'Facts are AI interpretations of exact retrieved excerpts; confirm terms with the provider. Missing fields are unverified.':'The page or extraction could not be verified. Cost, eligibility and deadline are unknown.'})
  }return results.sort((a,b)=>b.relevance-a.relevance)
 }
}
