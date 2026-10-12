import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const migrations = [
  `CREATE TABLE learner_profiles (id TEXT PRIMARY KEY, preferences TEXT NOT NULL CHECK(json_valid(preferences)));
   CREATE TABLE learning_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE transcripts (session_id TEXT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE, position INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), text TEXT NOT NULL, PRIMARY KEY(session_id, position));
   CREATE TABLE study_plans (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE action_items (id TEXT PRIMARY KEY, deadline TEXT NOT NULL, done INTEGER NOT NULL CHECK(done IN (0,1)), data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE interview_results (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE learning_resources (id TEXT PRIMARY KEY, session_id TEXT REFERENCES learning_sessions(id) ON DELETE SET NULL, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE opportunities (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE saved_opportunities (opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE);
   CREATE TABLE app_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value)));
   CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE ai_usage (id TEXT PRIMARY KEY, operation TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('success','error')), input_tokens INTEGER NOT NULL CHECK(input_tokens >= 0), output_tokens INTEGER NOT NULL CHECK(output_tokens >= 0), total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0), latency_ms INTEGER NOT NULL, error_code TEXT, created_at TEXT NOT NULL);`,
  `CREATE INDEX action_items_deadline ON action_items(deadline, done);
   CREATE INDEX usage_created_at ON ai_usage(created_at);
   CREATE INDEX resource_session ON learning_resources(session_id);`,
  `CREATE TABLE intelligence_sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE TABLE intelligence_segments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES intelligence_sessions(id) ON DELETE CASCADE, position INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(session_id, position));
   CREATE INDEX intelligence_state ON intelligence_sessions(state, started_at);
   CREATE INDEX intelligence_segment_session ON intelligence_segments(session_id, position);`,
  `CREATE TABLE ai_interviews (id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))); CREATE INDEX ai_interviews_state ON ai_interviews(state, started_at);`,
]
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
}
export function migrate(db: DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const current = Number((db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as { version: number }).version)
  if (current > migrations.length) throw new Error('Unsupported database version')
  for (let version = current + 1; version <= migrations.length; version++) transaction(db, () => {
    db.exec(migrations[version - 1])
    db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, new Date().toISOString())
  })
}
export function openDatabase(filename: string) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(filename)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  migrate(db)
  return db
}
