import type { DatabaseSync } from 'node:sqlite'
import { discoveredResourceSchema,studyPlanSchema,gapSchema,type Gap,type DiscoveredResource,type StudyPlan } from '../../shared/learning-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
import { resourceIdentity } from '../ai/resource-retrieval.cjs'
export class LearningRepository {
 constructor(private db:DatabaseSync){}
 gaps(){const row=this.db.prepare("SELECT data FROM learning_gap_analyses WHERE id='latest'").get();return row?gapSchema.array().max(10).parse(JSON.parse(row.data as string)):[]}
 saveGaps(gaps:Gap[]){const data=gapSchema.array().max(10).parse(gaps);this.db.prepare("INSERT INTO learning_gap_analyses VALUES ('latest',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(JSON.stringify(data));return data}
 resources(){return this.db.prepare('SELECT data FROM discovered_resources ORDER BY created_at DESC LIMIT 500').all().map(r=>discoveredResourceSchema.parse(JSON.parse(r.data as string)))}
 resource(id:string){const row=this.db.prepare('SELECT data FROM discovered_resources WHERE id=?').get(id);if(!row)throw new AppError('NOT_FOUND','This learning resource is unavailable.');return discoveredResourceSchema.parse(JSON.parse(row.data as string))}
 saveResource(value:DiscoveredResource){
  const item=discoveredResourceSchema.parse(value);const identity=resourceIdentity(item.url)
  const existing=this.db.prepare('SELECT data FROM discovered_resources WHERE canonical_url=?').get(identity)
  const old=existing?discoveredResourceSchema.parse(JSON.parse(existing.data as string)):null
  const saved={...item,id:old?.id??item.id,approved:old?.approved??item.approved,createdAt:old?.createdAt??item.createdAt}
  this.db.prepare('INSERT INTO discovered_resources VALUES (?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET data=excluded.data').run(saved.id,identity,saved.createdAt,JSON.stringify(saved));return saved
 }
 approveResource(id:string,approved:boolean){const item={...this.resource(id),approved};this.db.prepare('UPDATE discovered_resources SET data=? WHERE id=?').run(JSON.stringify(item),id);return item}
 plans(){return this.db.prepare('SELECT data FROM personalized_plans ORDER BY created_at DESC LIMIT 200').all().map(r=>studyPlanSchema.parse(JSON.parse(r.data as string)))}
 plan(id:string){const row=this.db.prepare('SELECT data FROM personalized_plans WHERE id=?').get(id);if(!row)throw new AppError('NOT_FOUND','This study plan is unavailable.');return studyPlanSchema.parse(JSON.parse(row.data as string))}
 savePlan(value:StudyPlan){const plan=studyPlanSchema.parse(value);this.db.prepare('INSERT INTO personalized_plans VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(plan.id,plan.createdAt,JSON.stringify(plan));return plan}
}
