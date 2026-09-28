// Metadata sync.
//
// Pages through the conversation list newest-updated first, merging into the
// local index and reporting progress after every page so the UI can render
// immediately.
//
// Incremental mode stops at the first page whose items are all already cached
// unchanged. If an earlier first sync was interrupted (backfill incomplete),
// it then jumps ahead to where that sync stopped and continues to the end.
// A pass that covers the whole history contiguously also removes cached
// conversations that no longer exist.
//
// Pacing is adaptive (AIMD): the pause between pages doubles on every 429
// and eases back after a run of successes. A 429 means: save progress, wait
// (Retry-After, else 20s → 40s → … → 5 min), then retry the same page. The
// learned pause is persisted by the caller, so later runs start gently.

import { PAGE_SIZE } from '../chatgpt/api'
import { ProviderError, type ConversationPage, type ProviderSession } from './provider'
import { isUnchanged, mergeItems, sweepUnseen } from './repository'
import type { HistoryIndex, ProviderStatus } from './types'

export type SyncMode = 'incremental' | 'full'

export interface SyncProgress {
  mode: SyncMode
  pages: number
  indexed: number
  total: number | null
}

export interface SyncDiagnostics {
  at: number
  mode: SyncMode
  durationMs: number
  pages: number
  rawItems: number
  malformed: number
  added: number
  changed: number
  removed: number
  totalReported: number | null
  reachedEnd: boolean
  stoppedEarly: boolean
  incomplete: boolean
  note: string | null
  itemKeys: string[]
  responseKeys: string[]
  createFormats: Record<string, number>
  updateFormats: Record<string, number>
  archived: number
  withGizmo: number
  projectLike: number
  hasMissingConversations: boolean | null
  /** 429 responses received, time spent waiting on them, and the final page pause. */
  rateLimited: number
  rateLimitWaitMs: number
  pageDelayMs: number
  error: { status: Exclude<ProviderStatus, 'available'>; httpStatus?: number } | null
}

export interface Pacing {
  /** Pause between page requests. Mutated by the engine as it learns. */
  delayMs: number
}

/** Items re-fetched before the resume point of an interrupted backfill. */
const RESUME_OVERLAP = 10

export const PACING = {
  initialDelayMs: 1000,
  minDelayMs: 1000,
  maxDelayMs: 20_000,
  /** Successful pages before easing the pause back down. */
  easeAfter: 8,
  firstCooldownMs: 20_000,
  maxCooldownMs: 5 * 60_000,
  /** Total time one run may spend waiting on rate limits before giving up. */
  maxWaitPerRunMs: 30 * 60_000,
} as const

export interface SyncDeps {
  save(index: HistoryIndex): Promise<void>
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  onProgress?(index: HistoryIndex, progress: SyncProgress): void
  /** Called with the resume time when a run starts waiting on a rate limit, and with null when it resumes. */
  onPause?(until: number | null): void
  pageSize?: number
  /** Shared, persisted pacing; defaults to a fresh one. */
  pacing?: Pacing
  maxRateLimitWaitMs?: number
  persistIntervalMs?: number
  maxPages?: number
}

export function newDiagnostics(mode: SyncMode, now: number): SyncDiagnostics {
  return {
    at: now,
    mode,
    durationMs: 0,
    pages: 0,
    rawItems: 0,
    malformed: 0,
    added: 0,
    changed: 0,
    removed: 0,
    totalReported: null,
    reachedEnd: false,
    stoppedEarly: false,
    incomplete: false,
    note: null,
    itemKeys: [],
    responseKeys: [],
    createFormats: {},
    updateFormats: {},
    archived: 0,
    withGizmo: 0,
    projectLike: 0,
    hasMissingConversations: null,
    rateLimited: 0,
    rateLimitWaitMs: 0,
    pageDelayMs: 0,
    error: null,
  }
}

function accumulate(d: SyncDiagnostics, page: ConversationPage) {
  d.pages++
  d.rawItems += page.rawCount
  d.malformed += page.malformed
  d.itemKeys = [...new Set([...d.itemKeys, ...page.stats.itemKeys])].sort()
  d.responseKeys = [...new Set([...d.responseKeys, ...page.stats.responseKeys])].sort()
  for (const [k, v] of Object.entries(page.stats.createFormats)) d.createFormats[k] = (d.createFormats[k] ?? 0) + (v ?? 0)
  for (const [k, v] of Object.entries(page.stats.updateFormats)) d.updateFormats[k] = (d.updateFormats[k] ?? 0) + (v ?? 0)
  d.archived += page.stats.archived
  d.withGizmo += page.stats.withGizmo
  d.projectLike += page.stats.projectLike
  if (page.stats.hasMissingConversations !== null) d.hasMissingConversations = page.stats.hasMissingConversations
  if (page.total !== null) d.totalReported = page.total
}

export async function syncIndex(
  session: ProviderSession,
  index: HistoryIndex,
  mode: SyncMode,
  deps: SyncDeps,
  signal?: AbortSignal,
  diag: SyncDiagnostics = newDiagnostics(mode, deps.now()),
): Promise<SyncDiagnostics> {
  const limit = deps.pageSize ?? PAGE_SIZE
  const pacing = deps.pacing ?? { delayMs: PACING.initialDelayMs }
  const maxWait = deps.maxRateLimitWaitMs ?? PACING.maxWaitPerRunMs
  const persistEvery = deps.persistIntervalMs ?? 1500
  const maxPages = deps.maxPages ?? 2000
  const started = deps.now()
  const seen = new Set<string>()

  let offset = 0
  let jumped = false
  let lastPersist = started
  let okStreak = 0
  let limitedStreak = 0

  /** Fetch one page, waiting out rate limits (bounded per run). */
  const fetchPage = async (): Promise<ConversationPage> => {
    for (;;) {
      try {
        const page = await session.list({ offset, limit, signal })
        limitedStreak = 0
        if (++okStreak >= PACING.easeAfter) {
          okStreak = 0
          pacing.delayMs = Math.max(PACING.minDelayMs, Math.round(pacing.delayMs * 0.8))
        }
        return page
      } catch (e) {
        if (!(e instanceof ProviderError) || e.status !== 'rate-limited') throw e
        diag.rateLimited++
        okStreak = 0
        limitedStreak++
        pacing.delayMs = Math.min(PACING.maxDelayMs, Math.max(pacing.delayMs * 2, 3000))
        const wait = e.retryAfterMs ?? Math.min(PACING.maxCooldownMs, PACING.firstCooldownMs * 2 ** (limitedStreak - 1))
        if (diag.rateLimitWaitMs + wait > maxWait) throw e
        await deps.save(index)
        deps.onPause?.(deps.now() + wait)
        try {
          await deps.sleep(wait, signal)
        } finally {
          deps.onPause?.(null)
        }
        diag.rateLimitWaitMs += wait
      }
    }
  }

  try {
    while (diag.pages < maxPages) {
      if (diag.pages > 0) await deps.sleep(pacing.delayMs, signal)
      const page = await fetchPage()
      accumulate(diag, page)

      const unchanged = page.items.length > 0 && page.items.every((c) => isUnchanged(index.conversations[c.id], c))
      const merged = mergeItems(index, page.items, deps.now())
      diag.added += merged.added
      diag.changed += merged.changed
      for (const c of page.items) seen.add(c.id)
      if (page.total !== null) index.totalReported = page.total
      offset += page.rawCount
      if (!index.backfillComplete) index.backfillOffset = Math.max(index.backfillOffset, offset)

      deps.onProgress?.(index, { mode, pages: diag.pages, indexed: Object.keys(index.conversations).length, total: index.totalReported })
      if (deps.now() - lastPersist >= persistEvery) {
        lastPersist = deps.now()
        await deps.save(index)
      }

      if (page.rawCount === 0) {
        diag.reachedEnd = true
        if (page.total !== null && offset < page.total) {
          diag.incomplete = true
          diag.note = `ChatGPT stopped returning conversations after ${offset} of ${page.total}`
        }
        break
      }
      // Don't trust a short page as the end: the server may cap `limit`.
      // Stop on `total` when reported, otherwise on the first empty page.
      if (page.total !== null && offset >= page.total) {
        diag.reachedEnd = true
        break
      }
      if (mode === 'incremental' && unchanged) {
        if (index.backfillComplete) {
          diag.stoppedEarly = true
          break
        }
        if (!jumped) {
          jumped = true
          // Resume slightly before where the last run stopped. New or updated
          // chats only push older ones to higher offsets (we re-see a few,
          // harmless); only deletions pull them lower, so a small overlap
          // suffices, and saves a whole request under strict rate limits.
          offset = Math.max(offset, index.backfillOffset - Math.min(limit, RESUME_OVERLAP))
        }
      }
    }
    if (!diag.reachedEnd && !diag.stoppedEarly) {
      diag.incomplete = true
      diag.note = `Stopped after ${diag.pages} pages`
    }

    if (diag.reachedEnd) {
      index.backfillComplete = true
      index.backfillOffset = offset
      if (!jumped && !diag.incomplete) {
        diag.removed = sweepUnseen(index, seen)
        index.lastFullSyncAt = deps.now()
      }
    }
    index.lastIncrementalSyncAt = deps.now()
    diag.durationMs = deps.now() - started
    diag.pageDelayMs = pacing.delayMs
    await deps.save(index)
    return diag
  } catch (e) {
    diag.durationMs = deps.now() - started
    diag.pageDelayMs = pacing.delayMs
    // Keep everything fetched so far.
    await deps.save(index).catch(() => {})
    throw e
  }
}
