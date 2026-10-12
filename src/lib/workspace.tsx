import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { fields, workspaceSchema, type Workspace, type Update } from '../../shared/contracts.cts'
import { initialSessions, initialTasks, opportunities } from './data'
import { Button } from '@/components/ui/button'

export const seedWorkspace: Workspace = {
  theme: 'light', collapsed: false, sessions: initialSessions, tasks: initialTasks, saved: [],
  preferences: { name: 'Alex', language: 'English', goal: 'Build a career in technology', level: 'Intermediate', reminders: true },
  plans: [{ id: 'p1', title: 'Frontend developer journey', description: 'Your path from fundamentals to confident building.', subject: 'Frontend development', weeks: '8 weeks', color: 'green' }, { id: 'p2', title: 'Data analytics essentials', description: 'Turn curiosity into insights, one dataset at a time.', subject: 'Data & analytics', weeks: '6 weeks', color: 'blue' }],
  opportunities: fields.opportunities.parse(opportunities), resources: [], interviewResults: [], interviewCompleted: 0, aiProfile: 'offline', learningDraft: null, interviewDraft: null,
}
const legacyKeys = { theme: 'alc-theme', collapsed: 'alc-sidebar', sessions: 'alc-sessions', tasks: 'alc-tasks', saved: 'alc-saved', preferences: 'alc-preferences', plans: 'alc-plans', interviewCompleted: 'alc-interviews' } as const
function legacySeed() {
  const seed = { ...seedWorkspace }
  for (const [field, key] of Object.entries(legacyKeys)) {
    try { const saved = localStorage.getItem(key); if (saved) { const parsed = fields[field as keyof Workspace].safeParse(JSON.parse(saved)); if (parsed.success) Object.assign(seed, { [field]: parsed.data }) } } catch { /* Keep valid defaults and preserve the original legacy data. */ }
  }
  seed.saved = seed.saved.filter(id => seed.opportunities.some(item => item.id === id))
  return seed
}
type WorkspaceContextValue = { data: Workspace; update<K extends keyof Workspace>(field: K, action: SetStateAction<Workspace[K]>): void; flush(): Promise<void> }
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Workspace | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(0)
  const current = useRef<Workspace>(seedWorkspace)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const dirty = useRef(new Map<keyof Workspace, Update>())
  const initialized = useRef(false)
  const validationFailure = useRef(false)
  const initialize = useCallback(async () => {
    setError('')
    try {
      let workspace: Workspace
      if (window.companion) {
        const result = await window.companion.workspace.bootstrap(legacySeed())
        if (!result.ok) throw new Error(result.error.message)
        workspace = workspaceSchema.parse(result.data)
      } else {
        const saved = localStorage.getItem('alc-web-preview')
        workspace = saved ? workspaceSchema.parse(JSON.parse(saved)) : legacySeed()
      }
      current.current = workspace; setData(workspace)
    } catch { setError('Your local workspace could not be loaded. Retry before making changes.') }
  }, [])
  useEffect(() => { if (!initialized.current) { initialized.current = true; void initialize() } }, [initialize])
  const enqueue = useCallback((update: Update) => {
    setPending(count => count + 1)
    queue.current = queue.current.then(async () => {
      try {
        if (window.companion) { const result = await window.companion.workspace.update(update); if (!result.ok) throw new Error(result.error.message) }
        else localStorage.setItem('alc-web-preview', JSON.stringify(current.current))
        dirty.current.delete(update.field)
        if (!dirty.current.size && !validationFailure.current) setError('')
      } catch { dirty.current.set(update.field, update); setError('Changes could not be saved. Keep this window open and retry.') }
      finally { setPending(count => count - 1) }
    })
  }, [])
  const update = useCallback(<K extends keyof Workspace,>(field: K, action: SetStateAction<Workspace[K]>) => {
    const next = typeof action === 'function' ? (action as (value: Workspace[K]) => Workspace[K])(current.current[field]) : action
    const validation = fields[field].safeParse(next)
    if (!validation.success) { validationFailure.current = true; setError('The change is invalid or too large and was not saved.'); return }
    validationFailure.current = false
    current.current = { ...current.current, [field]: next }; setData(current.current)
    enqueue({ field, value: next } as Update)
  }, [enqueue])
  const flush = useCallback(async () => { await queue.current; if (dirty.current.size || validationFailure.current) throw new Error('Your changes have not been saved yet.') }, [])
  if (!data) return <div className="workspace-loading" role="status"><h2>{error ? 'Let’s reconnect to your workspace.' : 'Opening your learning space…'}</h2><p>{error || 'Loading your local data.'}</p>{error && <Button onClick={() => void initialize()}>Retry</Button>}</div>
  return <WorkspaceContext.Provider value={{ data, update, flush }}>{children}<div className={`storage-status ${error ? 'storage-error' : ''}`} role="status">{error ? <>{error}<Button variant="outline" size="sm" onClick={() => { for (const update of dirty.current.values()) enqueue(update); if (!dirty.current.size) setError('') }}>Retry save</Button></> : pending ? 'Saving to this device…' : window.companion ? 'Saved on this device · SQLite' : 'Browser preview · Local storage'}</div></WorkspaceContext.Provider>
}
export function useWorkspaceState<K extends keyof Workspace>(field: K) {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('WorkspaceProvider is required')
  const setter = useCallback((action: SetStateAction<Workspace[K]>) => context.update(field, action), [context.update, field])
  return [context.data[field], setter] as const
}
export function usePersistence() { const context = useContext(WorkspaceContext); if (!context) throw new Error('WorkspaceProvider is required'); return context }
