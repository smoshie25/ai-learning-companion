import { useState, useEffect } from 'react'
export function useLocalState<T>(key: string, fallback: T) {
  const [state, setState] = useState<T>(() => { try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T : fallback } catch { return fallback } })
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)) } catch { /* The app remains usable when storage is unavailable. */ } }, [key, state])
  return [state, setState] as const
}
