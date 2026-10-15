import { describe, expect, it } from 'vitest'
import { HistoryApp } from '../../src/content/app'
import type { ConversationPage, ConversationProvider } from '../../src/history/provider'
import { ProviderError } from '../../src/history/provider'
import { memoryStore } from '../../src/storage'

const stats = { itemKeys: [], responseKeys: [], createFormats: {}, updateFormats: {}, archived: 0, withGizmo: 0, projectLike: 0, hasMissingConversations: null }

// HistoryApp touches a few page globals; give it just enough of a window.
Object.assign(globalThis, { location: { pathname: '/' }, window: { innerWidth: 1280 } })

function provider(opts: { total?: number; accountKey?: string; signedOut?: boolean; gate?: Promise<void>; rateLimitFrom?: number } = {}): ConversationProvider {
  const total = opts.total ?? 250
  return {
    async connect() {
      if (opts.signedOut) throw new ProviderError('auth-failed', 'signed out')
      return {
        accountKey: opts.accountKey ?? 'acct-a',
        async list({ offset, limit }): Promise<ConversationPage> {
          if (offset > 0 && opts.gate) await opts.gate
          if (opts.rateLimitFrom !== undefined && offset >= opts.rateLimitFrom) throw new ProviderError('rate-limited', 'slow down', 429, 60_000)
          const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
            id: `c${offset + i}`,
            title: `Chat ${offset + i}`,
            createdAt: 1e12 - (offset + i),
            updatedAt: 1e12 - (offset + i),
          }))
          return { items, rawCount: items.length, malformed: 0, total, stats }
        },
      }
    },
  }
}

/** Titles that make chats c1 and c2 related (same PR), so the engine has something to find. */
function relatedProvider(): ConversationProvider {
  const titles = ['Review Paytm Autopay PR #4294', 'Autopay PR 4294 hotfix', 'Autopay PR 4294 rollout notes', 'Weekend trip itinerary', 'Kitchen renovation budget']
  return {
    async connect() {
      return {
        accountKey: 'acct-r',
        async list(): Promise<ConversationPage> {
          const items = titles.map((title, i) => ({ id: `c${i}`, title, createdAt: 1e12 - i, updatedAt: 1e12 - i }))
          return { items, rawCount: items.length, malformed: 0, total: items.length, stats }
        },
      }
    },
  }
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))

describe('HistoryApp', () => {
  it('keeps the related-chats index in step with the synced history, and drops it on clear', async () => {
    const app = new HistoryApp({ kv: memoryStore(), provider: relatedProvider(), pageDelayMs: 0 })
    await app.init()
    expect(app.state.relatedRev).toBe(0)
    await app.open()
    await settle() // debounce + slices

    expect(app.related.stats().docs).toBe(5)
    expect(app.state.relatedRev).toBe(app.related.version)
    expect(app.state.relatedRev).toBeGreaterThan(0)
    expect(app.related.related('c0', { now: 1e12 }).map((r) => r.id).sort()).toEqual(['c1', 'c2'])

    await app.clearAllData()
    expect(app.related.stats().docs).toBe(0)
    expect(app.related.related('c0')).toEqual([])
    app.dispose()
  })

  it('forgets a cached history for a signed-out user: no related suggestions either', async () => {
    const kv = memoryStore()
    const a = new HistoryApp({ kv, provider: relatedProvider(), pageDelayMs: 0 })
    await a.init()
    await a.open()
    await settle()
    expect(a.related.stats().docs).toBe(5)
    a.dispose()

    const b = new HistoryApp({ kv, provider: provider({ signedOut: true }), pageDelayMs: 0 })
    await b.init()
    await b.open()
    await settle()
    expect(b.related.stats().docs).toBe(0)
    b.dispose()
  })

  it('syncs on first open and persists the index under a hashed account key', async () => {
    const kv = memoryStore()
    const app = new HistoryApp({ kv, provider: provider(), pageDelayMs: 0 })
    await app.init()
    await app.open()
    expect(Object.keys(app.state.index!.conversations)).toHaveLength(250)
    expect(app.state.sync).toMatchObject({ running: false, error: null })
    expect(kv.data.has('idx:acct-a')).toBe(true)
  })

  it('never shows a cache to a signed-out user', async () => {
    const kv = memoryStore()
    const a = new HistoryApp({ kv, provider: provider(), pageDelayMs: 0 })
    await a.init()
    await a.open()
    const b = new HistoryApp({ kv, provider: provider({ signedOut: true }), pageDelayMs: 0 })
    await b.init()
    await b.open()
    expect(b.state.account).toBe('signed-out')
    expect(b.state.index).toBeNull()
  })

  it('after a rate-limited stop, holds automatic syncs until the cooldown but allows a manual retry', async () => {
    const kv = memoryStore()
    let now = 1_000_000
    let lists = 0
    const base = provider({ rateLimitFrom: 100 })
    const counting: ConversationProvider = {
      async connect() {
        const s = await base.connect()
        return { ...s, list: (p) => (lists++, s.list(p)) }
      },
    }
    const app = new HistoryApp({ kv, provider: counting, pageDelayMs: 0, rateLimitMaxWaitMs: 0, now: () => now })
    await app.init()
    await app.open()
    expect(Object.keys(app.state.index!.conversations)).toHaveLength(100)
    expect(app.state.sync).toMatchObject({ error: 'rate-limited', running: false })
    expect(app.state.sync.resumeAt).toBeGreaterThanOrEqual(now + 5 * 60_000)
    expect((await kv.get<{ cooldownUntil: number }>('pacing'))!.cooldownUntil).toBe(app.state.sync.resumeAt)

    // A second tab / page load inherits the cooldown from storage.
    const other = new HistoryApp({ kv, provider: counting, pageDelayMs: 0, rateLimitMaxWaitMs: 0, now: () => now })
    await other.init()
    lists = 0
    await other.open()
    expect(lists).toBe(0)
    expect(other.state.sync.error).toBe('rate-limited')

    await other.syncNow()
    expect(lists).toBeGreaterThan(0)
    now += 10 * 60_000
    app.dispose()
    other.dispose()
  })

  it('does not resurrect data cleared while a sync is running', async () => {
    const kv = memoryStore()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const app = new HistoryApp({ kv, provider: provider({ gate }), pageDelayMs: 0 })
    await app.init()
    const opening = app.open()
    await new Promise((r) => setTimeout(r, 20)) // first page merged, second page pending
    await app.clearAllData()
    release()
    await opening
    await new Promise((r) => setTimeout(r, 20))
    expect(await kv.keys()).toEqual([])
    expect(app.state.index).toBeNull()
    expect(app.state.paused).toBe(true)
  })
})
