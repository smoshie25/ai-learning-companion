const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { openDatabase, migrate, transaction, migrations } = require('../dist-electron/electron/persistence/database.cjs')
const { WorkspaceRepository } = require('../dist-electron/electron/persistence/repositories.cjs')
const { seed } = require('./fixtures.cjs')
const { DatabaseSync } = require('node:sqlite')

test('an existing version-one database upgrades without losing learner data', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    db.exec(migrations[0]); db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(1, new Date().toISOString())
    db.prepare('INSERT INTO learner_profiles VALUES (?,?)').run('local', JSON.stringify(seed().preferences))
    migrate(db)
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, 2)
    assert.equal(JSON.parse(db.prepare("SELECT preferences FROM learner_profiles WHERE id='local'").get().preferences).name, 'Alex')
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='action_items_deadline'").get())
  } finally { db.close() }
})

test('all repositories persist across close/reopen; migrations are idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'alc-unit-'))
  let db
  try {
    const file = path.join(directory, 'companion.sqlite'); db = openDatabase(file)
    const repository = new WorkspaceRepository(db); const original = seed()
    assert.deepEqual(repository.bootstrap(original), original)
    repository.update({ field: 'tasks', value: [{ ...original.tasks[0], done: true }] })
    repository.update({ field: 'theme', value: 'dark' })
    repository.usage.record({ id: 'u1', operation: 'tutor', model: 'gpt-4.1-mini', status: 'success', inputTokens: 12, outputTokens: 8, totalTokens: 20, latencyMs: 10, errorCode: null, createdAt: new Date().toISOString() })
    db.close(); db = openDatabase(file); migrate(db)
    const reopened = new WorkspaceRepository(db); const data = reopened.load()
    assert.equal(data.tasks[0].done, true); assert.equal(data.theme, 'dark')
    assert.deepEqual(data.sessions, original.sessions); assert.deepEqual(data.resources, original.resources)
    assert.deepEqual(data.interviewResults, original.interviewResults); assert.deepEqual(data.plans, original.plans)
    assert.deepEqual(data.preferences, original.preferences); assert.deepEqual(data.opportunities, original.opportunities)
    assert.deepEqual(data.saved, ['o1']); assert.deepEqual(reopened.usage.totals(), { requests: 1, totalTokens: 20 })
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, migrations.length)
    assert.deepEqual(reopened.bootstrap(seed()), data, 'bootstrap never overwrites existing data')
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }) }
})
test('failed updates roll back and foreign keys protect bookmarks', () => {
  const db = openDatabase(':memory:')
  try {
    const repository = new WorkspaceRepository(db); repository.bootstrap(seed())
    assert.throws(() => repository.update({ field: 'saved', value: ['missing'] }))
    assert.deepEqual(repository.load().saved, ['o1'])
    assert.throws(() => transaction(db, () => { db.prepare('DELETE FROM action_items').run(); throw new Error('interrupted') }))
    assert.equal(repository.load().tasks.length, 1)
    assert.throws(() => repository.update({ field: 'sessions', value: [{ ...seed().sessions[0], transcript: [{ role: 'system', text: 'invalid' }] }] }))
    assert.deepEqual(repository.load().sessions, seed().sessions)
  } finally { db.close() }
})
test('updating sessions preserves related notes; removing opportunities cascades bookmarks', () => {
  const db = openDatabase(':memory:')
  try {
    const repository = new WorkspaceRepository(db); repository.bootstrap(seed())
    repository.update({ field: 'sessions', value: [{ ...seed().sessions[0], summary: 'New summary' }] })
    assert.equal(repository.load().resources[0].sessionId, 's1')
    assert.equal(repository.load().sessions[0].transcript.length, 2)
    repository.update({ field: 'sessions', value: [] })
    assert.equal(repository.load().resources[0].sessionId, null)
    repository.update({ field: 'opportunities', value: [] }); assert.deepEqual(repository.load().saved, [])
  } finally { db.close() }
})
