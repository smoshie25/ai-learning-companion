import type { DatabaseSync } from 'node:sqlite'
import type { z } from 'zod'
import { fields, workspaceSchema, type Workspace, type Update, type Usage } from '../../shared/contracts.cjs'
import { transaction } from './database.cjs'

/** Table names are internal constants, never renderer input. All values are bound parameters. */
export class EntityRepository<T extends { id: string }> {
  constructor(protected db: DatabaseSync, private table: string, private schema: z.ZodType<T>) {}
  list(): T[] { return this.db.prepare(`SELECT data FROM ${this.table} ORDER BY rowid`).all().map(row => this.schema.parse(JSON.parse(row.data as string))) }
  replace(items: T[]) {
    const validated = items.map(item => this.schema.parse(item))
    const ids = validated.map(item => item.id)
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate IDs')
    // Upserts preserve foreign-key dependents for records that remain present.
    const upsert = this.db.prepare(`INSERT INTO ${this.table} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`)
    for (const item of validated) upsert.run(item.id, JSON.stringify(item))
    const remove = this.db.prepare(`DELETE FROM ${this.table} WHERE id=?`)
    for (const row of this.db.prepare(`SELECT id FROM ${this.table}`).all()) if (!ids.includes(row.id as string)) remove.run(row.id)
  }
}
export class SessionRepository extends EntityRepository<Workspace['sessions'][number]> {
  constructor(db: DatabaseSync) { super(db, 'learning_sessions', fields.sessions.element) }
  override list() { return super.list().map(session => ({ ...session, transcript: this.db.prepare('SELECT role,text FROM transcripts WHERE session_id=? ORDER BY position').all(session.id).map(row => ({ role: row.role as 'user' | 'assistant', text: row.text as string })) })) }
  override replace(items: Workspace['sessions']) {
    super.replace(items.map(({ transcript, ...session }) => session))
    const insert = this.db.prepare('INSERT INTO transcripts VALUES (?,?,?,?)')
    for (const session of items) {
      this.db.prepare('DELETE FROM transcripts WHERE session_id=?').run(session.id)
      session.transcript?.forEach((message, position) => insert.run(session.id, position, message.role, message.text))
    }
  }
}
export class TaskRepository extends EntityRepository<Workspace['tasks'][number]> {
  constructor(db: DatabaseSync) { super(db, 'action_items', fields.tasks.element) }
  override replace(items: Workspace['tasks']) {
    const upsert = this.db.prepare('INSERT INTO action_items (id,deadline,done,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET deadline=excluded.deadline,done=excluded.done,data=excluded.data')
    for (const item of fields.tasks.parse(items)) upsert.run(item.id, item.date, Number(item.done), JSON.stringify(item))
    for (const row of this.db.prepare('SELECT id FROM action_items').all()) if (!items.some(item => item.id === row.id)) this.db.prepare('DELETE FROM action_items WHERE id=?').run(row.id)
  }
}
export class UsageRepository {
  constructor(private db: DatabaseSync) {}
  record(item: Usage) { this.db.prepare('INSERT INTO ai_usage VALUES (?,?,?,?,?,?,?,?,?,?)').run(item.id, item.operation, item.model, item.status, item.inputTokens, item.outputTokens, item.totalTokens, item.latencyMs, item.errorCode, item.createdAt) }
  totals() { const row = this.db.prepare('SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS totalTokens FROM ai_usage').get()!; return { requests: Number(row.requests), totalTokens: Number(row.totalTokens) } }
  list() { return this.db.prepare('SELECT * FROM ai_usage ORDER BY created_at DESC LIMIT 100').all() }
}
export class ResourceRepository extends EntityRepository<Workspace['resources'][number]> {
  constructor(db: DatabaseSync) { super(db, 'learning_resources', fields.resources.element) }
  override list() { return super.list().map(item => { const row = this.db.prepare('SELECT session_id FROM learning_resources WHERE id=?').get(item.id)!; return { ...item, sessionId: row.session_id as string | null } }) }
}
export class WorkspaceRepository {
  readonly sessions: SessionRepository
  readonly tasks: TaskRepository
  readonly plans: EntityRepository<Workspace['plans'][number]>
  readonly resources: EntityRepository<Workspace['resources'][number]>
  readonly interviews: EntityRepository<Workspace['interviewResults'][number]>
  readonly opportunities: EntityRepository<Workspace['opportunities'][number]>
  readonly usage: UsageRepository
  constructor(private db: DatabaseSync) {
    this.sessions = new SessionRepository(db); this.tasks = new TaskRepository(db)
    this.plans = new EntityRepository(db, 'study_plans', fields.plans.element)
    this.resources = new ResourceRepository(db)
    this.interviews = new EntityRepository(db, 'interview_results', fields.interviewResults.element)
    this.opportunities = new EntityRepository(db, 'opportunities', fields.opportunities.element)
    this.usage = new UsageRepository(db)
  }
  isInitialized() { return !!this.db.prepare("SELECT value FROM metadata WHERE key='initialized'").get() }
  bootstrap(seed: Workspace) {
    if (!this.isInitialized()) transaction(this.db, () => {
      const data = workspaceSchema.parse(seed)
      for (const field of ['preferences', 'sessions', 'tasks', 'plans', 'opportunities', 'resources', 'interviewResults', 'saved', 'theme', 'collapsed', 'interviewCompleted', 'aiProfile', 'learningDraft', 'interviewDraft'] as const) this.write({ field, value: data[field] } as Update)
      this.db.prepare("INSERT INTO metadata VALUES ('initialized','1')").run()
    })
    return this.load()
  }
  preference<K extends 'theme' | 'collapsed' | 'interviewCompleted' | 'aiProfile' | 'learningDraft' | 'interviewDraft'>(key: K): Workspace[K] {
    const row = this.db.prepare('SELECT value FROM app_preferences WHERE key=?').get(key)
    return fields[key].parse(row ? JSON.parse(row.value as string) : key === 'aiProfile' ? 'offline' : key === 'theme' ? 'light' : key === 'collapsed' ? false : key === 'interviewCompleted' ? 0 : null) as Workspace[K]
  }
  load(): Workspace {
    const profile = this.db.prepare("SELECT preferences FROM learner_profiles WHERE id='local'").get()
    return workspaceSchema.parse({ preferences: JSON.parse(profile!.preferences as string), sessions: this.sessions.list(), tasks: this.tasks.list(), plans: this.plans.list(), opportunities: this.opportunities.list(), resources: this.resources.list(), interviewResults: this.interviews.list(), saved: this.db.prepare('SELECT opportunity_id FROM saved_opportunities ORDER BY rowid').all().map(row => row.opportunity_id), theme: this.preference('theme'), collapsed: this.preference('collapsed'), interviewCompleted: this.preference('interviewCompleted'), aiProfile: this.preference('aiProfile'), learningDraft: this.preference('learningDraft'), interviewDraft: this.preference('interviewDraft') })
  }
  update(update: Update) { if (!this.isInitialized()) throw new Error('Workspace not initialized'); transaction(this.db, () => this.write(update)) }
  private write(update: Update) {
    switch (update.field) {
      case 'sessions': this.sessions.replace(fields.sessions.parse(update.value)); break
      case 'tasks': this.tasks.replace(fields.tasks.parse(update.value)); break
      case 'plans': this.plans.replace(fields.plans.parse(update.value)); break
      case 'resources': {
        const items = fields.resources.parse(update.value)
        this.resources.replace(items)
        for (const item of items) this.db.prepare('UPDATE learning_resources SET session_id=? WHERE id=?').run(item.sessionId, item.id)
        break
      }
      case 'opportunities': this.opportunities.replace(fields.opportunities.parse(update.value)); break
      case 'interviewResults': this.interviews.replace(fields.interviewResults.parse(update.value)); break
      case 'preferences': this.db.prepare("INSERT INTO learner_profiles VALUES ('local',?) ON CONFLICT(id) DO UPDATE SET preferences=excluded.preferences").run(JSON.stringify(fields.preferences.parse(update.value))); break
      case 'saved': {
        const ids = fields.saved.parse(update.value)
        this.db.prepare('DELETE FROM saved_opportunities').run()
        for (const id of ids) this.db.prepare('INSERT INTO saved_opportunities VALUES (?)').run(id)
        break
      }
      default: this.db.prepare('INSERT INTO app_preferences VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(update.field, JSON.stringify(fields[update.field].parse(update.value)))
    }
  }
}
