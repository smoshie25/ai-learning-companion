import { planProposalSchema, type PlanInput, type ProposedTask, type StudyPlan } from '../../shared/learning-contracts.cjs'
import { AppError } from './errors.cjs'
export function validateTasks(tasks:ProposedTask[],resourceIds:string[],deadline:string|null) {
 const keys=new Set(tasks.map(t=>t.key))
 if(keys.size!==tasks.length)throw new AppError('INVALID_PLAN','Task keys must be unique.')
 for(const task of tasks){
  if(task.dependencies.length!==new Set(task.dependencies).size||task.dependencies.some(d=>d===task.key||!keys.has(d)))throw new AppError('INVALID_PLAN','Dependencies must refer to other tasks in this plan.')
  if(task.resourceIds.some(id=>!resourceIds.includes(id)))throw new AppError('INVALID_PLAN','Tasks can only cite approved saved resources.')
  if(deadline&&task.deadline&&task.deadline>deadline)throw new AppError('INVALID_PLAN','Task deadlines must fit within the plan deadline.')
  if(/https?:\/\//i.test([task.title,task.description,task.activity,task.assessmentQuestion,task.assessmentCriteria].join(' ')))throw new AppError('INVALID_PLAN','Resources must be attached from saved search sources, not generated URLs.')
  for(const key of task.dependencies){const dependency=tasks.find(t=>t.key===key)!;if(task.deadline&&dependency.deadline&&dependency.deadline>task.deadline)throw new AppError('INVALID_PLAN','A prerequisite cannot have a later deadline than its dependent task.')}
 }
 const visiting=new Set<string>();const visited=new Set<string>()
 const visit=(key:string)=>{if(visiting.has(key))throw new AppError('INVALID_PLAN','Task dependencies contain a cycle.');if(visited.has(key))return;visiting.add(key);tasks.find(t=>t.key===key)!.dependencies.forEach(visit);visiting.delete(key);visited.add(key)}
 tasks.forEach(t=>visit(t.key))
}
export function validateProposal(value:unknown,input:PlanInput,resourceIds:string[]) {
 const result=planProposalSchema.safeParse(value);if(!result.success)throw new AppError('INVALID_PLAN','The proposed plan did not match the planning schema.')
 validateTasks(result.data.tasks,resourceIds,input.deadline)
 if(result.data.tasks.some(t=>t.durationMinutes>input.minutesPerDay))throw new AppError('INVALID_PLAN','Break each task into a duration within the daily study budget.')
 return result.data
}
export function requireDependencies(plan:StudyPlan,taskId:string) {
 const task=plan.tasks.find(t=>t.id===taskId);if(!task)throw new AppError('NOT_FOUND','This study task is unavailable.')
 if(task.dependencies.some(key=>plan.tasks.find(t=>t.key===key)?.state!=='completed'))throw new AppError('DEPENDENCY_PENDING','Complete this task’s prerequisites first.')
 return task
}
