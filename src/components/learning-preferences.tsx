import { useState, type FormEvent } from 'react'
import { Check } from 'lucide-react'
import { Button } from './ui/button'
import { SectionHeading } from './shared'
import { usePersistence, useWorkspaceState } from '@/lib/workspace'
import { preferencesSchema } from '../../shared/contracts.cts'
export function LearningPreferences({ onSaved }: { onSaved: () => void }) {
  const [preferences, setPreferences] = useWorkspaceState('preferences')
  const [draft, setDraft] = useState(preferences)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { flush } = usePersistence()
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    const result = preferencesSchema.safeParse({ ...draft, name: draft.name.trim() })
    if (!result.success) { setError('Enter a name and choose valid learning preferences.'); return }
    setBusy(true)
    try { setPreferences(result.data); await flush(); onSaved() } catch { setError('Preferences could not be saved. Please retry.') } finally { setBusy(false) }
  }
  return <section className="card settings-card"><SectionHeading title="Learning preferences" subtitle="Shape a learning experience that fits you" /><form onSubmit={save}><div className="form-grid"><label>Preferred name<input required maxLength={30} value={draft.name} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))} /></label><label>Language<select value={draft.language} onChange={e => setDraft(p => ({ ...p, language: e.target.value as typeof p.language }))}><option>English</option><option>French</option><option>Spanish</option></select></label></div><label>Learning goal<select value={draft.goal} onChange={e => setDraft(p => ({ ...p, goal: e.target.value as typeof p.goal }))}><option>Build a career in technology</option><option>Develop professional skills</option><option>Explore something new</option></select></label><label>Learning level<select value={draft.level} onChange={e => setDraft(p => ({ ...p, level: e.target.value as typeof p.level }))}><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label><p className="form-note left">Live AI follows your language preference. The application interface remains in English.</p><div className="setting-row"><div><strong>Learning reminders</strong><p>Keep your intention to learn a little each day.</p></div><button className={`switch ${draft.reminders ? 'on' : ''}`} type="button" role="switch" aria-label="Learning reminders" aria-checked={draft.reminders} onClick={() => setDraft(p => ({ ...p, reminders: !p.reminders }))}><span /></button></div><p className="form-note left">Reminder preference only; desktop notifications are not scheduled.</p>{error && <p className="ai-status-message" role="alert">{error}</p>}<Button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save preferences'}<Check size={16} /></Button></form></section>
}
