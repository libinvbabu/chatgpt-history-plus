import { describe, expect, it } from 'vitest'
import type { ConversationPage, ProviderSession } from '../../src/history/provider'
import { ProviderError } from '../../src/history/provider'
import { syncIndex, type SyncDeps } from '../../src/history/sync'
import { emptyIndex, type ConversationMetadata, type HistoryIndex } from '../../src/history/types'

const stats = { itemKeys: [], responseKeys: [], createFormats: {}, updateFormats: {}, archived: 0, withGizmo: 0, projectLike: 0, hasMissingConversations: null }

/** A fake server holding conversations ordered by update time, newest first. */
class FakeServer {
  convs: ConversationMetadata[]
  requests: number[] = []
  failAt: number | null = null
  reportTotal = true
  cap: number | null = null
  constructor(n: number) {
    this.convs = Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}`, createdAt: 1_000_000 - i, updatedAt: 1_000_000 - i }))
  }
  touch(i: number, title?: string) {
    const [c] = this.convs.splice(i, 1)
    this.convs.unshift({ ...c!, title: title ?? c!.title, updatedAt: this.convs[0]!.updatedAt! + 1 })
  }
  session(): ProviderSession {
    return {
      accountKey: 'acct',
      list: async ({ offset, limit }): Promise<ConversationPage> => {
        this.requests.push(offset)
        if (this.failAt !== null && offset >= this.failAt) throw new ProviderError('rate-limited', 'slow down', 429)
        const effective = this.cap ?? limit
        const items = this.convs.slice(offset, offset + effective)
        return { items, rawCount: items.length, malformed: 0, total: this.reportTotal ? this.convs.length : null, stats }
      },
    }
  }
}

function deps(saved: HistoryIndex[] = [], progress: number[] = []): SyncDeps {
  let t = 0
  return {
    save: async (i) => void saved.push(structuredClone(i)),
    now: () => (t += 10),
    sleep: async () => {},
    onProgress: (_i, p) => void progress.push(p.indexed),
    pageSize: 10,
    persistIntervalMs: 0,
  }
}

describe('syncIndex', () => {
  it('backfills the whole history progressively on first run', async () => {
    const server = new FakeServer(35)
    const index = emptyIndex('acct')
    const progress: number[] = []
    const d = await syncIndex(server.session(), index, 'incremental', deps([], progress))
    expect(Object.keys(index.conversations)).toHaveLength(35)
    expect(progress).toEqual([10, 20, 30, 35])
    expect(server.requests).toEqual([0, 10, 20, 30])
    expect(index.backfillComplete).toBe(true)
    expect(d.reachedEnd).toBe(true)
    expect(index.lastFullSyncAt).not.toBeNull()
  })

  it('stops incremental sync at the first fully-unchanged page', async () => {
    const server = new FakeServer(100)
    const index = emptyIndex('acct')
    await syncIndex(server.session(), index, 'incremental', deps())
    server.requests = []
    server.touch(50, 'Renamed chat')
    server.convs.unshift({ id: 'new', title: 'Brand new', createdAt: 2_000_000, updatedAt: 2_000_000 })
    const d = await syncIndex(server.session(), index, 'incremental', deps())
    expect(server.requests).toEqual([0, 10])
    expect(d.stoppedEarly).toBe(true)
    expect(d.added).toBe(1)
    expect(index.conversations['c50']!.title).toBe('Renamed chat')
    expect(index.conversations['new']).toBeDefined()
  })

  it('resumes an interrupted first sync where it stopped', async () => {
    const server = new FakeServer(80)
    const index = emptyIndex('acct')
    server.failAt = 40
    await expect(syncIndex(server.session(), index, 'incremental', deps())).rejects.toMatchObject({ status: 'rate-limited' })
    expect(Object.keys(index.conversations)).toHaveLength(40)
    expect(index.backfillComplete).toBe(false)
    expect(index.backfillOffset).toBe(40)

    server.failAt = null
    server.requests = []
    await syncIndex(server.session(), index, 'incremental', deps())
    // Head page is unchanged → jump to (40 - one page of overlap) and finish.
    expect(server.requests).toEqual([0, 30, 40, 50, 60, 70])
    expect(Object.keys(index.conversations)).toHaveLength(80)
    expect(index.backfillComplete).toBe(true)
  })

  it('persists partial progress when a page fails', async () => {
    const server = new FakeServer(50)
    server.failAt = 20
    const saved: HistoryIndex[] = []
    await expect(syncIndex(server.session(), emptyIndex('acct'), 'incremental', deps(saved))).rejects.toThrow()
    expect(Object.keys(saved.at(-1)!.conversations)).toHaveLength(20)
  })

  it('resumes with a small overlap, not a whole page, when pages are large', async () => {
    const server = new FakeServer(701)
    const index = emptyIndex('acct')
    server.failAt = 700
    const d = { ...deps(), pageSize: 100, maxRateLimitWaitMs: 0 }
    await expect(syncIndex(server.session(), index, 'incremental', d)).rejects.toMatchObject({ status: 'rate-limited' })
    expect(Object.keys(index.conversations)).toHaveLength(700)
    server.failAt = null
    server.requests = []
    await syncIndex(server.session(), index, 'incremental', d)
    // Head page (unchanged) + one page from 690: done in two requests.
    expect(server.requests).toEqual([0, 690])
    expect(Object.keys(index.conversations)).toHaveLength(701)
    expect(index.backfillComplete).toBe(true)
  })

  it('removes deleted conversations on a complete pass, not on an early stop', async () => {
    const server = new FakeServer(30)
    const index = emptyIndex('acct')
    await syncIndex(server.session(), index, 'incremental', deps())
    server.convs.splice(25, 1)
    await syncIndex(server.session(), index, 'incremental', deps())
    expect(index.conversations['c25']).toBeDefined()
    const d = await syncIndex(server.session(), index, 'full', deps())
    expect(d.removed).toBe(1)
    expect(index.conversations['c25']).toBeUndefined()
  })

  it('does not stop at a short page when the server caps the page size', async () => {
    const server = new FakeServer(25)
    server.cap = 7
    server.reportTotal = false
    const index = emptyIndex('acct')
    await syncIndex(server.session(), index, 'incremental', deps())
    expect(Object.keys(index.conversations)).toHaveLength(25)
    expect(server.requests).toEqual([0, 7, 14, 21, 25])
  })

  it('flags when the API stops short of the reported total', async () => {
    const server = new FakeServer(30)
    const s = server.session()
    const capped: ProviderSession = { ...s, list: async (p) => (p.offset >= 20 ? { items: [], rawCount: 0, malformed: 0, total: 30, stats } : s.list(p)) }
    const d = await syncIndex(capped, emptyIndex('acct'), 'incremental', deps())
    expect(d.incomplete).toBe(true)
    expect(d.note).toMatch(/20 of 30/)
  })

  it('waits out a 429 (Retry-After), retries the same page and slows down', async () => {
    const server = new FakeServer(30)
    const s = server.session()
    let limited = 1
    const session: ProviderSession = {
      ...s,
      list: async (p) => {
        if (p.offset === 10 && limited-- > 0) throw new ProviderError('rate-limited', 'slow down', 429, 7000)
        return s.list(p)
      },
    }
    const d = deps()
    const sleeps: number[] = []
    const pauses: Array<number | null> = []
    d.sleep = async (ms) => void sleeps.push(ms)
    d.onPause = (until) => void pauses.push(until)
    const pacing = { delayMs: 1000 }
    const index = emptyIndex('acct')
    const diag = await syncIndex(session, index, 'incremental', { ...d, pacing })
    expect(Object.keys(index.conversations)).toHaveLength(30)
    expect(server.requests).toEqual([0, 10, 20])
    expect(sleeps).toContain(7000)
    expect(pacing.delayMs).toBe(3000)
    expect(pauses[0]).toBeGreaterThan(0)
    expect(pauses.at(-1)).toBeNull()
    expect(diag).toMatchObject({ rateLimited: 1, rateLimitWaitMs: 7000, pageDelayMs: 3000 })
  })

  it('backs off exponentially without Retry-After, and gives up past the per-run cap', async () => {
    const server = new FakeServer(30)
    const s = server.session()
    const session: ProviderSession = {
      ...s,
      list: async (p) => {
        if (p.offset >= 10) throw new ProviderError('rate-limited', 'slow down', 429)
        return s.list(p)
      },
    }
    const d = deps()
    const sleeps: number[] = []
    d.sleep = async (ms) => void sleeps.push(ms)
    const index = emptyIndex('acct')
    await expect(syncIndex(session, index, 'incremental', { ...d, maxRateLimitWaitMs: 100_000 })).rejects.toMatchObject({ status: 'rate-limited' })
    expect(sleeps.filter((ms) => ms >= 20_000)).toEqual([20_000, 40_000])
    expect(Object.keys(index.conversations)).toHaveLength(10)
  })

  it('eases the pause back down after sustained success', async () => {
    const server = new FakeServer(200)
    const pacing = { delayMs: 8000 }
    await syncIndex(server.session(), emptyIndex('acct'), 'incremental', { ...deps(), pacing })
    expect(pacing.delayMs).toBeLessThan(8000)
    expect(pacing.delayMs).toBeGreaterThanOrEqual(1000)
  })

  it('stops on abort and keeps what it has', async () => {
    const server = new FakeServer(50)
    const ac = new AbortController()
    const index = emptyIndex('acct')
    const d = deps()
    d.sleep = async (_ms, signal) => {
      if (server.requests.length === 2) ac.abort()
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    await expect(syncIndex(server.session(), index, 'incremental', d, ac.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(Object.keys(index.conversations)).toHaveLength(20)
  })
})
