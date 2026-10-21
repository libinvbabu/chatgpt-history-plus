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

/** A history with real titles, for the filter bar: `titles` repeated to `total` chats. */
function titledProvider(accountKey: string, titles: readonly string[], total = titles.length): ConversationProvider & { total: number } {
  const p = {
    total,
    async connect() {
      return {
        accountKey,
        async list({ offset, limit }: { offset: number; limit: number }): Promise<ConversationPage> {
          const items = Array.from({ length: Math.max(0, Math.min(limit, p.total - offset)) }, (_, i) => {
            const n = offset + i
            return { id: `${accountKey}-${n}`, title: titles[n % titles.length]!, createdAt: 1e12 - n, updatedAt: 1e12 - n }
          })
          return { items, rawCount: items.length, malformed: 0, total: p.total, stats }
        },
      }
    },
  }
  return p
}

const DEV_TITLES = ['Review backend PR #4294', 'Debug flaky login test', 'Postgres index tuning', 'Kubernetes autoscaling config', 'Write an email to my manager', 'Fix NullPointerException in OrderService']
const COOK_TITLES = ['Easy dinner recipes for kids', 'Chocolate cake recipe without eggs', 'Plan a family trip to Kerala', 'Visa requirements for Japan', 'Toddler sleep regression tips']


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

  it('maps a remembered filter from an older version, and falls back to All for one that no longer exists', async () => {
    for (const [stored, expected] of [
      ['engineering', 'technology'],
      ['pr-reviews', 'pr-reviews'],
      ['other', 'general'],
      ['writing', 'writing'],
      ['no-such-filter', 'all'],
    ] as const) {
      const app = new HistoryApp({ kv: memoryStore({ ui: { category: stored, collapsed: { yesterday: false } } }), provider: provider(), pageDelayMs: 0 })
      await app.init()
      expect(app.state.category, stored).toBe(expected)
      expect(app.state.collapsed).toEqual({ yesterday: false }) // other UI state untouched
    }
  })

  it('chooses the filter bar from the synced history and stores it per account', async () => {
    const kv = memoryStore()
    const app = new HistoryApp({ kv, provider: titledProvider('dev', DEV_TITLES, 120), pageDelayMs: 0 })
    await app.init()
    await app.open()
    await settle()
    expect(app.state.filterPrefs.ranked[0]).toBe('technology')
    expect(app.state.filterPrefs).toMatchObject({ basis: 120, complete: true })
    expect((await kv.get<{ ranked: string[] }>('flt:dev'))!.ranked).toEqual(app.state.filterPrefs.ranked)
    // Nothing about categories is written into the conversation index.
    const idx = (await kv.get<{ conversations: Record<string, object> }>('idx:dev'))!
    expect(Object.values(idx.conversations).some((c) => 'category' in c)).toBe(false)
    app.dispose()
  })

  it('keeps pins and hidden filters per account (personal and workspace never mix)', async () => {
    const kv = memoryStore()
    const dev = new HistoryApp({ kv, provider: titledProvider('dev', DEV_TITLES, 60), pageDelayMs: 0 })
    await dev.init()
    await dev.open()
    await settle()
    dev.pinFilter('cooking', true)
    dev.hideFilter('debugging', true)
    expect(dev.state.filterPrefs).toMatchObject({ pinned: ['cooking'], hidden: ['debugging'] })
    dev.dispose()

    const home = new HistoryApp({ kv, provider: titledProvider('home', COOK_TITLES, 60), pageDelayMs: 0 })
    await home.init()
    await home.open()
    await settle()
    expect(home.state.filterPrefs).toMatchObject({ pinned: [], hidden: [] })
    expect(home.state.filterPrefs.ranked[0]).toBe('personal')
    home.dispose()

    const again = new HistoryApp({ kv, provider: titledProvider('dev', DEV_TITLES, 60), pageDelayMs: 0 })
    await again.init()
    await again.open()
    await settle()
    expect(again.state.filterPrefs).toMatchObject({ pinned: ['cooking'], hidden: ['debugging'] })
    // Pinning un-hides, hiding un-pins; reset forgets both and chooses afresh.
    again.pinFilter('debugging', true)
    expect(again.state.filterPrefs).toMatchObject({ pinned: ['cooking', 'debugging'], hidden: [] })
    again.resetFilters()
    expect(again.state.filterPrefs).toMatchObject({ pinned: [], hidden: [], complete: true })
    expect(again.state.filterPrefs.ranked[0]).toBe('technology')
    again.dispose()
  })

  it('never reshuffles the bar while the panel is open: a new choice waits for it to close', async () => {
    const kv = memoryStore()
    const p = titledProvider('dev', DEV_TITLES, 60)
    const app = new HistoryApp({ kv, provider: p, pageDelayMs: 0 })
    await app.init()
    await app.open()
    await settle()
    const before = app.state.filterPrefs
    expect(before.ranked[0]).toBe('technology')

    // The history changes shape a lot (the user has been cooking), and syncs while the panel is open.
    const cooking = titledProvider('dev', COOK_TITLES, 400)
    const later = new HistoryApp({ kv, provider: { connect: async () => ({ ...(await cooking.connect()), accountKey: 'dev' }) }, pageDelayMs: 0 })
    await later.init()
    await later.open()
    await settle()
    const opened = later.state.filterPrefs
    await later.syncNow('full')
    await settle()
    expect(later.state.filterPrefs).toBe(opened) // unchanged while open

    later.close()
    expect(later.state.filterPrefs.ranked[0]).toBe('personal') // applied on close
    app.dispose()
    later.dispose()
  })

  it('clearing local data forgets the filter preferences too', async () => {
    const kv = memoryStore()
    const app = new HistoryApp({ kv, provider: titledProvider('dev', DEV_TITLES, 30), pageDelayMs: 0 })
    await app.init()
    await app.open()
    await settle()
    app.pinFilter('travel', true)
    await settle(50)
    expect(kv.data.has('flt:dev')).toBe(true)
    await app.clearAllData()
    expect(kv.data.has('flt:dev')).toBe(false)
    expect(app.state.filterPrefs.pinned).toEqual([])
    app.dispose()
  })
})
