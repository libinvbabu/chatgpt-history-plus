import type { ProviderStatus, HistoryIndex, Settings } from '../history/types'
import { DEFAULT_SETTINGS } from '../history/types'
import type { SyncDiagnostics, SyncMode } from '../history/sync'
import type { Theme } from './theme'

export type PresetId = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'last-7' | 'last-30' | 'this-month' | 'last-month' | 'this-year'

export type DateFilter =
  | { kind: 'preset'; id: PresetId }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number }
  /** Inclusive local days, yyyy-mm-dd. */
  | { kind: 'custom'; from: string; to: string }

export interface SyncState {
  running: boolean
  mode: SyncMode | null
  pages: number
  indexed: number
  total: number | null
  /** Another ChatGPT tab holds the sync lock. */
  otherTab: boolean
  status: ProviderStatus
  /** Set when the last sync failed. */
  error: Exclude<ProviderStatus, 'available'> | null
  /** Set when the last sync finished without reaching everything. */
  incomplete: string | null
  /** While running: waiting on ChatGPT's rate limit until this time. */
  pausedUntil: number | null
  /** After a rate-limited stop: automatic sync resumes at this time. */
  resumeAt: number | null
}

export type AccountState = 'unknown' | 'ready' | 'signed-out' | 'offline'

export interface AppState {
  open: boolean
  view: 'list' | 'settings'
  account: AccountState
  accountKey: string | null
  index: HistoryIndex | null
  /** Bumped whenever `index` is mutated in place. */
  indexRev: number
  settings: Settings
  collapsed: Record<string, boolean>
  sync: SyncState
  query: string
  literal: boolean
  dateFilter: DateFilter | null
  currentId: string | null
  theme: Theme
  /** Bumped to ask the search box to take focus. */
  focusRequest: number
  initialScrollTop: number | null
  diagnostics: SyncDiagnostics | null
  /** User cleared local data this page session; don't auto-sync again. */
  paused: boolean
}

export const initialSync: SyncState = {
  running: false,
  mode: null,
  pages: 0,
  indexed: 0,
  total: null,
  otherTab: false,
  status: 'available',
  error: null,
  incomplete: null,
  pausedUntil: null,
  resumeAt: null,
}

export function initialState(): AppState {
  return {
    open: false,
    view: 'list',
    account: 'unknown',
    accountKey: null,
    index: null,
    indexRev: 0,
    settings: { ...DEFAULT_SETTINGS },
    collapsed: {},
    sync: initialSync,
    query: '',
    literal: false,
    dateFilter: null,
    currentId: null,
    theme: 'light',
    focusRequest: 0,
    initialScrollTop: null,
    diagnostics: null,
    paused: false,
  }
}

export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(listener: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...p }
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}
