// Orchestrates one History+ instance per ChatGPT tab: which account is
// signed in, when to sync, persistence of settings/UI state, and cross-tab
// coordination. The UI only reads the store and calls these methods.

import { abortableSleep } from '../chatgpt/api'
import { conversationIdFromPath } from '../chatgpt/selectors'
import { isAbortError, ProviderError, type ConversationProvider, type ProviderSession } from '../history/provider'
import { MetadataRepository, WRITER_ID, type StoredIndex } from '../history/repository'
import { PACING, newDiagnostics, syncIndex, type Pacing, type SyncDiagnostics, type SyncMode } from '../history/sync'
import { emptyIndex, type HistoryIndex, type Settings } from '../history/types'
import { KEYS, type KeyValueStore } from '../storage'
import { migrateIndex, migrateSettings } from '../storage/migrations'
import { navigateToConversation } from './navigation'
import { createStore, initialState, initialSync, type AppState, type DateFilter, type Store, type SyncState } from './store'

const LOCK_NAME = 'chatgpt-history-plus:sync'
/** Re-sync when the panel opens if the last sync is older than this. */
const OPEN_SYNC_AFTER_MS = 60_000
/** Background refresh on page load, for native sidebar dates. */
const BACKGROUND_SYNC_AFTER_MS = 10 * 60_000
const RESTORE_WINDOW_MS = 15_000
/** How long automatic syncs stay off after a run gives up on a rate limit (unless ChatGPT says otherwise). */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000

interface StoredPacing {
  delayMs?: number
  /** Automatic syncs wait until this time; shared across tabs and page loads. */
  cooldownUntil?: number
}

interface UiPrefs {
  collapsed?: Record<string, boolean>
  lastAccountKey?: string
  writer?: string
}

interface RestoreState {
  until: number
  open?: boolean
  query?: string
  literal?: boolean
  dateFilter?: DateFilter | null
  scrollTop?: number
}

export interface AppDeps {
  kv: KeyValueStore
  provider: ConversationProvider
  now?: () => number
  /** Starting pause between pages (tests); normally learned and persisted. */
  pageDelayMs?: number
  /** Cap on time one sync waits out rate limits before stopping (tests). */
  rateLimitMaxWaitMs?: number
}

export interface SyncOptions {
  /** A user-initiated sync ignores the rate-limit cooldown. */
  manual?: boolean
}

export class HistoryApp {
  readonly store: Store<AppState> = createStore(initialState())
  private readonly repo: MetadataRepository
  private readonly now: () => number
  private identifying: Promise<ProviderSession | null> | null = null
  private syncAbort: AbortController | null = null
  private uiSaveTimer: ReturnType<typeof setTimeout> | undefined
  private lastAccountKey: string | null = null
  private scrollTop = 0
  /** Bumped by clearAllData so an in-flight sync can't write the index back. */
  private generation = 0
  private pacing: Pacing
  private cooldownUntil = 0
  private resumeTimer: ReturnType<typeof setTimeout> | undefined
  private disposers: Array<() => void> = []

  constructor(private readonly deps: AppDeps) {
    this.repo = new MetadataRepository(deps.kv)
    this.now = deps.now ?? Date.now
    this.pacing = { delayMs: deps.pageDelayMs ?? PACING.initialDelayMs }
  }

  get state() {
    return this.store.get()
  }

  private setSync(patch: Partial<SyncState>) {
    this.store.set((s) => ({ sync: { ...s.sync, ...patch } }))
  }

  // -------------------------------------------------------------------------
  // Lifecycle

  async init(): Promise<void> {
    const [settings, ui, diagnostics, restore, pacing] = await Promise.all([
      this.deps.kv.get(KEYS.settings),
      this.deps.kv.get<UiPrefs>(KEYS.ui),
      this.deps.kv.get<SyncDiagnostics>(KEYS.diagnostics),
      this.deps.kv.get<RestoreState>(KEYS.restore),
      this.deps.kv.get<StoredPacing>(KEYS.pacing),
    ])
    this.lastAccountKey = ui?.lastAccountKey ?? null
    this.applyStoredPacing(pacing)
    this.store.set({
      settings: migrateSettings(settings),
      collapsed: sanitizeCollapsed(ui?.collapsed),
      diagnostics: diagnostics ?? null,
      currentId: conversationIdFromPath(location.pathname),
    })
    this.disposers.push(this.deps.kv.onChanged((changes) => this.onStorageChanged(changes)))

    if (restore) {
      await this.deps.kv.remove(KEYS.restore)
      if (restore.until > this.now()) {
        this.store.set({
          query: restore.query ?? '',
          literal: !!restore.literal,
          dateFilter: restore.dateFilter ?? null,
          initialScrollTop: restore.scrollTop ?? null,
        })
        if (restore.open !== false) void this.open()
      }
    }
  }

  /** Identify the account in the background and refresh a stale cache. */
  async startBackground(): Promise<void> {
    const session = await this.identify()
    const index = this.state.index
    if (!session || !index || this.state.paused) return
    const stale = !index.backfillComplete || this.now() - (index.lastIncrementalSyncAt ?? 0) > BACKGROUND_SYNC_AFTER_MS
    if (stale) await this.sync('incremental', session)
  }

  dispose(): void {
    this.syncAbort?.abort()
    clearTimeout(this.resumeTimer)
    for (const d of this.disposers.splice(0)) d()
  }

  // -------------------------------------------------------------------------
  // Account + index

  /**
   * Resolves which account is signed in and loads its cache. The returned
   * session (holding an access token in memory) is only for immediate use.
   */
  identify(): Promise<ProviderSession | null> {
    this.identifying ??= this.doIdentify().finally(() => {
      this.identifying = null
    })
    return this.identifying
  }

  private async doIdentify(): Promise<ProviderSession | null> {
    try {
      const session = await this.deps.provider.connect()
      await this.useAccount(session.accountKey)
      this.store.set({ account: 'ready' })
      return session
    } catch (e) {
      if (e instanceof ProviderError && e.status === 'auth-failed') {
        // Signed out: never show a cached history that may belong to someone else.
        this.store.set({ account: 'signed-out', accountKey: null, index: null, indexRev: this.state.indexRev + 1 })
        this.setSync({ status: 'auth-failed', error: 'auth-failed' })
        return null
      }
      // Offline or API trouble: fall back to the last account's cache.
      const status = e instanceof ProviderError ? e.status : 'network-error'
      if (this.lastAccountKey && !this.state.index) await this.useAccount(this.lastAccountKey)
      this.store.set({ account: 'offline' })
      this.setSync({ status, error: status })
      return null
    }
  }

  private async useAccount(accountKey: string): Promise<void> {
    if (this.state.accountKey === accountKey && this.state.index) return
    const index = await this.repo.load(accountKey)
    this.store.set((s) => ({ accountKey, index, indexRev: s.indexRev + 1 }))
    if (this.lastAccountKey !== accountKey) {
      this.lastAccountKey = accountKey
      this.saveUi()
    }
  }

  // -------------------------------------------------------------------------
  // Sync

  async sync(mode: SyncMode, existing?: ProviderSession | null, opts: SyncOptions = {}): Promise<void> {
    if (this.state.sync.running) return
    if (!opts.manual && this.now() < this.cooldownUntil) {
      // ChatGPT asked us to back off recently (maybe in another tab): wait it out.
      this.setSync({ error: 'rate-limited', status: 'rate-limited', resumeAt: this.cooldownUntil })
      this.scheduleResume(this.cooldownUntil)
      return
    }
    clearTimeout(this.resumeTimer)
    const abort = new AbortController()
    this.syncAbort = abort
    this.store.set({ paused: false })
    this.setSync({ running: true, mode, pages: 0, otherTab: false, error: null, incomplete: null, pausedUntil: null, resumeAt: null })
    const diag = newDiagnostics(mode, this.now())
    const generation = this.generation
    let connected = false
    try {
      const outcome = await withLock(async () => {
        const session = existing ?? (await this.deps.provider.connect(abort.signal))
        connected = true
        await this.useAccount(session.accountKey)
        this.store.set({ account: 'ready' })
        const index: HistoryIndex = this.state.index ?? emptyIndex(session.accountKey)
        if (!this.state.index) this.store.set((s) => ({ index, indexRev: s.indexRev + 1 }))
        await syncIndex(
          session,
          index,
          mode,
          {
            save: async (i) => {
              if (generation === this.generation) await this.repo.save(i)
            },
            now: this.now,
            sleep: abortableSleep,
            pacing: this.pacing,
            maxRateLimitWaitMs: this.deps.rateLimitMaxWaitMs,
            onPause: (until) => {
              this.setSync({ pausedUntil: until })
              // Tell other tabs to hold off too.
              if (until) void this.savePacing(until)
            },
            onProgress: (_i, p) => {
              this.store.set((s) => ({ indexRev: s.indexRev + 1 }))
              this.setSync({ pages: p.pages, indexed: p.indexed, total: p.total })
            },
          },
          abort.signal,
          diag,
        )
        return 'done' as const
      })
      if (outcome === 'busy') {
        this.setSync({ running: false, otherTab: true })
        return
      }
      this.store.set((s) => ({ indexRev: s.indexRev + 1 }))
      this.cooldownUntil = 0
      this.setSync({ running: false, status: 'available', error: null, incomplete: diag.incomplete ? diag.note : null })
    } catch (e) {
      this.store.set((s) => ({ indexRev: s.indexRev + 1 }))
      if (isAbortError(e)) {
        this.setSync({ running: false })
        return
      }
      const status = e instanceof ProviderError ? e.status : 'network-error'
      diag.error = { status, httpStatus: e instanceof ProviderError ? e.httpStatus : undefined }
      if (status === 'auth-failed' && !connected) {
        // Signed out since the page loaded: hide the cache, as in identify().
        this.store.set((st) => ({ account: 'signed-out', accountKey: null, index: null, indexRev: st.indexRev + 1 }))
      }
      let resumeAt: number | null = null
      if (status === 'rate-limited') {
        const retryAfter = e instanceof ProviderError ? e.retryAfterMs : null
        resumeAt = this.now() + Math.max(retryAfter ?? 0, RATE_LIMIT_COOLDOWN_MS)
        this.cooldownUntil = resumeAt
        this.scheduleResume(resumeAt)
      }
      this.setSync({ running: false, status, error: status, resumeAt })
    } finally {
      if (this.syncAbort === abort) this.syncAbort = null
      this.setSync({ pausedUntil: null })
      if (generation === this.generation) void this.savePacing()
      if ((diag.pages || diag.error) && generation === this.generation) {
        this.store.set({ diagnostics: diag })
        void this.deps.kv.set({ [KEYS.diagnostics]: diag }).catch(() => {})
      }
    }
  }

  /** A user-initiated sync (buttons): runs even during a rate-limit cooldown. */
  syncNow(mode: SyncMode = 'incremental'): Promise<void> {
    return this.sync(mode, null, { manual: true })
  }

  cancelSync(): void {
    this.syncAbort?.abort()
  }

  /** After a rate-limited stop, pick the sync back up once the cooldown passes. */
  private scheduleResume(at: number): void {
    clearTimeout(this.resumeTimer)
    this.resumeTimer = setTimeout(() => {
      if (!this.state.paused && this.state.account !== 'signed-out') void this.sync('incremental')
    }, Math.max(1000, at - this.now() + 500))
  }

  private applyStoredPacing(p: StoredPacing | undefined): void {
    if (typeof p?.delayMs === 'number' && Number.isFinite(p.delayMs)) {
      this.pacing.delayMs = Math.min(PACING.maxDelayMs, Math.max(PACING.minDelayMs, p.delayMs))
    }
    if (typeof p?.cooldownUntil === 'number' && p.cooldownUntil > this.cooldownUntil) this.cooldownUntil = p.cooldownUntil
  }

  private async savePacing(cooldownUntil = this.cooldownUntil): Promise<void> {
    const value: StoredPacing = { delayMs: this.pacing.delayMs, cooldownUntil }
    await this.deps.kv.set({ [KEYS.pacing]: value }).catch(() => {})
  }

  // -------------------------------------------------------------------------
  // Panel

  async open(): Promise<void> {
    this.store.set((s) => ({ open: true, view: s.view, focusRequest: s.focusRequest + 1 }))
    if (this.state.paused) return
    let session: ProviderSession | null = null
    if (this.state.account === 'unknown' || this.state.account === 'signed-out' || this.state.account === 'offline') {
      session = await this.identify()
      if (!session) return
    }
    const index = this.state.index
    const due = !index || !index.backfillComplete || this.now() - (index.lastIncrementalSyncAt ?? 0) > OPEN_SYNC_AFTER_MS
    if (due) await this.sync('incremental', session)
  }

  close(): void {
    // Reopening in the same page returns to the same place.
    this.store.set({ open: false, initialScrollTop: this.scrollTop })
  }

  /** Shortcut/toolbar: open, focus the search box if already open, or close. */
  toggle(focusInside: boolean): void {
    if (!this.state.open) void this.open()
    else if (!focusInside) this.store.set((s) => ({ focusRequest: s.focusRequest + 1 }))
    else this.close()
  }

  setView(view: AppState['view']): void {
    this.store.set({ view })
  }

  setQuery(query: string): void {
    this.store.set((s) => ({ query, literal: query.trim() ? s.literal : false }))
  }

  setLiteral(literal: boolean): void {
    this.store.set({ literal })
  }

  setDateFilter(dateFilter: DateFilter | null): void {
    this.store.set({ dateFilter })
  }

  setCurrentPath(path: string): void {
    const id = conversationIdFromPath(path)
    if (id !== this.state.currentId) this.store.set({ currentId: id })
  }

  rememberScroll(top: number): void {
    this.scrollTop = top
  }

  toggleCollapsed(key: string, currentlyExpanded: boolean): void {
    this.store.set((s) => ({ collapsed: { ...s.collapsed, [key]: currentlyExpanded } }))
    this.saveUi()
  }

  openConversation(id: string, opts: { newTab?: boolean } = {}): void {
    const result = navigateToConversation(id, {
      newTab: opts.newTab,
      beforeReload: () => {
        // A full page load is coming; bring the panel back in the same place.
        const s = this.state
        const restore: RestoreState = {
          until: this.now() + RESTORE_WINDOW_MS,
          query: s.query,
          literal: s.literal,
          dateFilter: s.dateFilter,
          scrollTop: this.scrollTop,
          open: s.open && window.innerWidth >= 900,
        }
        void this.deps.kv.set({ [KEYS.restore]: restore })
      },
    })
    if (result === 'spa') {
      this.store.set({ currentId: id })
      if (window.innerWidth < 900) this.close()
    }
  }

  // -------------------------------------------------------------------------
  // Settings + data

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...this.state.settings, ...patch }
    this.store.set({ settings })
    await this.deps.kv.set({ [KEYS.settings]: settings })
  }

  async clearAllData(): Promise<void> {
    this.generation++
    this.cancelSync()
    await this.repo.clearAll()
    this.lastAccountKey = null
    this.store.set((s) => ({
      ...initialState(),
      open: s.open,
      view: s.view,
      theme: s.theme,
      account: s.account === 'ready' ? 'ready' : 'unknown',
      accountKey: s.accountKey,
      currentId: s.currentId,
      indexRev: s.indexRev + 1,
      sync: initialSync,
      paused: true,
    }))
  }

  diagnosticsReport(): string {
    const s = this.state
    const convs = Object.values(s.index?.conversations ?? {})
    const times = convs.map((c) => c.updatedAt ?? c.createdAt).filter((t): t is number => t != null)
    const month = (t: number | undefined) => (t == null ? null : new Date(t).toISOString().slice(0, 7))
    const report = {
      generatedAt: new Date(this.now()).toISOString(),
      extensionVersion: safeVersion(),
      browser: /Chrom(e|ium)\/(\d+)/.exec(navigator.userAgent)?.[0] ?? null,
      account: s.account,
      settings: s.settings,
      sync: { ...s.sync },
      index: s.index && {
        conversations: convs.length,
        backfillComplete: s.index.backfillComplete,
        backfillOffset: s.index.backfillOffset,
        totalReported: s.index.totalReported,
        lastIncrementalSyncAt: iso(s.index.lastIncrementalSyncAt),
        lastFullSyncAt: iso(s.index.lastFullSyncAt),
        missingCreated: convs.filter((c) => c.createdAt == null).length,
        missingUpdated: convs.filter((c) => c.updatedAt == null).length,
        untitled: convs.filter((c) => !c.title).length,
        archived: convs.filter((c) => c.archived).length,
        withGizmo: convs.filter((c) => c.gizmoId).length,
        projectLike: convs.filter((c) => c.gizmoId?.startsWith('g-p-')).length,
        oldestMonth: month(times.length ? Math.min(...times) : undefined),
        newestMonth: month(times.length ? Math.max(...times) : undefined),
      },
      lastSync: s.diagnostics,
      note: 'Contains no conversation titles, ids or account identifiers.',
    }
    return JSON.stringify(report, null, 2)
  }

  // -------------------------------------------------------------------------
  // Persistence

  private saveUi(): void {
    clearTimeout(this.uiSaveTimer)
    this.uiSaveTimer = setTimeout(() => {
      const ui: UiPrefs = { collapsed: this.state.collapsed, lastAccountKey: this.lastAccountKey ?? undefined, writer: WRITER_ID }
      void this.deps.kv.set({ [KEYS.ui]: ui }).catch(() => {})
    }, 250)
  }

  private onStorageChanged(changes: Record<string, { newValue?: unknown }>): void {
    const s = this.state
    if (KEYS.settings in changes) this.store.set({ settings: migrateSettings(changes[KEYS.settings]!.newValue) })
    if (KEYS.pacing in changes) this.applyStoredPacing(changes[KEYS.pacing]!.newValue as StoredPacing | undefined)
    if (KEYS.ui in changes) {
      const ui = changes[KEYS.ui]!.newValue as UiPrefs | undefined
      if (ui?.writer !== WRITER_ID) this.store.set({ collapsed: sanitizeCollapsed(ui?.collapsed) })
    }
    if (s.accountKey) {
      const key = KEYS.index(s.accountKey)
      if (key in changes && !s.sync.running) {
        const value = changes[key]!.newValue as StoredIndex | undefined
        if (value?.writer === WRITER_ID) return
        // Another tab synced (or cleared) this account's history.
        this.store.set((st) => ({ index: migrateIndex(value, s.accountKey!), indexRev: st.indexRev + 1, sync: { ...st.sync, otherTab: false } }))
      }
    }
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T | 'busy'> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks?.request) return fn()
  return locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? fn() : 'busy'))
}

function sanitizeCollapsed(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v
  }
  return out
}

function iso(t: number | null): string | null {
  return t == null ? null : new Date(t).toISOString()
}

function safeVersion(): string | null {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return null
  }
}
