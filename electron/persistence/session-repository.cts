import type { DatabaseSync } from 'node:sqlite'
import { recordingSchema, segmentSchema, type Recording, type Segment, type RecordingSnapshot } from '../../shared/session-contracts.cjs'
import { AppError } from '../ai/errors.cjs'
import { transaction } from './database.cjs'
export class IntelligenceRepository {
  constructor(private db: DatabaseSync) {}
  save(value: Recording) {
    const { segments: _segments, ...metadata } = value as RecordingSnapshot
    const item = recordingSchema.parse(metadata)
    this.db.prepare('INSERT INTO intelligence_sessions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data').run(item.id, item.state, item.startedAt, JSON.stringify(item))
  }
  get(id: string): RecordingSnapshot {
    const row = this.db.prepare('SELECT data FROM intelligence_sessions WHERE id=?').get(id)
    if (!row) throw new AppError('NOT_FOUND', 'This learning session is unavailable.')
    const recording = recordingSchema.parse(JSON.parse(row.data as string))
    const segments = this.db.prepare('SELECT data FROM intelligence_segments WHERE session_id=? ORDER BY position').all(id).map(row => segmentSchema.parse(JSON.parse(row.data as string)))
    return { ...recording, segments }
  }
  segment(id: string, value: Segment) {
    const item = segmentSchema.parse(value)
    transaction(this.db, () => {
      const current = this.get(id)
      const old = current.segments.find(segment => segment.id === item.id)
      if (current.segments.length >= 1000 && !old || current.segments.reduce((n, segment) => n + (segment.id === item.id ? 0 : segment.text.length), 0) + item.text.length > 100000) throw new AppError('SESSION_LIMIT', 'This session reached the transcript limit. End it and start a new session.')
      if (old?.status === 'final' && item.status === 'partial') return
      const position = Number(this.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS next FROM intelligence_segments WHERE session_id=?').get(id)!.next)
      this.db.prepare('INSERT INTO intelligence_segments VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(item.id, id, position, JSON.stringify(item))
    })
  }
  search(query: string): RecordingSnapshot[] {
    // Literal substring matching: no SQL wildcard interpretation or renderer-provided SQL.
    return this.db.prepare('SELECT id FROM intelligence_sessions ORDER BY started_at DESC').all().map(row => this.get(row.id as string)).filter(session => [session.title, session.topic, session.goals, session.summary ? JSON.stringify(session.summary) : '', ...session.segments.map(segment => segment.text)].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100)
  }
  recover() {
    for (const row of this.db.prepare("SELECT id FROM intelligence_sessions WHERE state='recording'").all()) {
      const session = this.get(row.id as string)
      // Received audio time is durable; never count an app's downtime as learning time.
      this.save({ ...session, state: 'interrupted', activeSince: null, gaps: [...session.gaps.slice(-99), { at: new Date().toISOString(), reason: 'The app closed while recording. Received transcript text was retained; unsent audio may be missing.' }] })
    }
  }
}
