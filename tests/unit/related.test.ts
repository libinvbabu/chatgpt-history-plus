import { describe, expect, it } from 'vitest'
import { emptyIndex, type HistoryIndex } from '../../src/history/types'
import { classifyTitle } from '../../src/related/classify'
import { extract } from '../../src/related/extract'
import { RelatedEngine, signalsFromText } from '../../src/related/engine'
import { stem } from '../../src/related/text'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 16, 12)

type Row = [title: string, daysAgo: number]

function history(rows: Row[]): HistoryIndex {
  const idx = emptyIndex('acct')
  rows.forEach(([title, days], i) => {
    const t = NOW - days * DAY
    idx.conversations[`c${i}`] = { id: `c${i}`, title, createdAt: t, updatedAt: t, cachedAt: 0 }
  })
  return idx
}

/** Unrelated chatter, so document frequencies look like a real library. */
const FILLER_TITLES = [
  'Weekend trip itinerary',
  'Kitchen renovation budget',
  'Mobile game ideas',
  'Explain React hooks',
  'Draft launch email',
  'Workout plan',
  'Reading list',
  'Quarterly OKR draft',
  'Debug flaky login test',
  'Postgres index tuning',
  'Hiring loop design',
  'Pricing page copy',
  'Budget sheet',
  'Compare Notion and Obsidian',
  'Spanish practice',
]
const filler: Row[] = Array.from({ length: 300 }, (_, i) => [`${FILLER_TITLES[i % FILLER_TITLES.length]}${i % 7 === 0 ? ' v' + i : ''}`, 5 + (i % 400)])

/** The active chat is c0; everything else follows it. */
function setup(current: string, others: Row[], opts: { currentDaysAgo?: number } = {}) {
  const idx = history([[current, opts.currentDaysAgo ?? 1], ...others, ...filler])
  const engine = new RelatedEngine()
  engine.indexAll(idx)
  const results = engine.related('c0', { limit: 10, now: NOW })
  const titles = results.map((r) => idx.conversations[r.id]!.title)
  return { engine, idx, results, titles }
}

describe('extraction', () => {
  it('reads GitHub URLs, shorthand refs and PR numbers into canonical entities', () => {
    const keys = (t: string) => extract(t).entities.map((e) => e.key)
    expect(keys('Review https://github.com/Animall-In/backend-apis/pull/4294')).toEqual(
      expect.arrayContaining(['repo:animall-in/backend-apis', 'pr:animall-in/backend-apis#4294', 'prn:4294', 'tech:github']),
    )
    expect(keys('Animall-In/backend-apis#4294 retry')).toEqual(expect.arrayContaining(['repo:animall-in/backend-apis', 'pr:animall-in/backend-apis#4294', 'prn:4294']))
    expect(keys('Review Paytm Autopay PR #4294')).toEqual(['prn:4294', 'provider:paytm'])
    expect(keys('pull request 88 cleanup')).toContain('prn:88')
    expect(keys('Repo Animall-In/backend-apis cleanup')).toContain('repo:animall-in/backend-apis')
  })

  it('does not mistake prose or look-alikes for entities', () => {
    expect(extract('client/server architecture').entities).toEqual([])
    expect(extract('and/or in the repo').entities).toEqual([])
    expect(extract('Encode as UTF-8, compare with GPT-4 and SHA-256').entities).toEqual([])
    expect(extract('Top #1 ranking tips').entities).toEqual([]) // one digit is not a PR number
  })

  it('reads tickets and normalises provider aliases and casing', () => {
    expect(extract('Fix ANI-123 login redirect').entities.map((e) => e.key)).toContain('ticket:ani-123')
    for (const t of ['PhonePe retries', 'phone pe retries', 'PHONEPE retries', 'Phonepay retries']) {
      expect(extract(t).entities.map((e) => e.key)).toContain('provider:phonepe')
    }
    expect(extract('Google Pay vs gpay').entities.map((e) => e.key)).toEqual(['provider:gpay'])
  })

  it('finds topics and activity without model calls', () => {
    const x = extract('PhonePe renewal retry failures')
    expect(x.topics).toEqual(expect.arrayContaining(['subscriptions', 'payment-recovery']))
    expect(x.activity).toBe('debugging')
    expect(x.keywords).toEqual(expect.arrayContaining(['renewal', 'retry', 'fail']))
    expect(x.keywords).not.toContain('phonepe') // it is an entity, not a keyword
  })

  it('stems plurals and verb endings, and unifies a few synonyms', () => {
    expect(stem('retries')).toBe(stem('retrying'))
    expect(stem('failures')).toBe(stem('failed'))
    expect(stem('queries')).toBe('query')
    expect(stem('fixes')).toBe('fix')
    expect(stem('बिल')).toBe('बिल') // non-Latin words pass through
  })

  it('classification lives apart from extraction: the category is not an extracted signal', () => {
    // The icon and filters come from classify.ts; extract() feeds the related engine and carries no category.
    expect(extract('Review Paytm Autopay PR')).not.toHaveProperty('category')
    expect(classifyTitle('Review Paytm Autopay PR')).toMatchObject({ primary: 'technology', sub: 'pr-reviews' })
    expect(classifyTitle('Paytm settlement reconciliation')).toMatchObject({ primary: 'work', sub: 'payments' })
    expect(classifyTitle('')).toMatchObject({ primary: 'general', sub: null })
  })
})

describe('related conversations', () => {
  it('A: the same PR outranks generic payment and PR-review chats', () => {
    const { titles } = setup('Review Paytm Autopay PR #4294', [
      ['Paytm Autopay PR 4294 follow-up fixes', 20],
      ['Autopay mandate PR #4294 discussion', 30],
      ['Paytm payment gateway integration', 10],
      ['Review Razorpay PR', 3],
      ['Review Paytm settlement report', 8],
      ['Review Animall backend PR', 4],
    ])
    expect(titles.slice(0, 2).sort()).toEqual(['Autopay mandate PR #4294 discussion', 'Paytm Autopay PR 4294 follow-up fixes'])
    expect(titles).not.toContain('Review Razorpay PR')
    expect(titles).not.toContain('Review Animall backend PR')
    expect(titles).not.toContain('Paytm payment gateway integration')
  })

  it('A: an exact repository PR reference is the strongest signal', () => {
    const { results, titles } = setup('Review https://github.com/Animall-In/backend-apis/pull/4294', [
      ['Animall-In/backend-apis#4294 retry handling', 90],
      ['Backend API rate limiting', 2],
      ['Review Animall-In/other-repo PR', 1],
    ])
    expect(titles[0]).toBe('Animall-In/backend-apis#4294 retry handling')
    expect(results[0]!.reasons[0]).toBe('Same PR (Animall-In/backend-apis#4294)')
  })

  it('B: related investigations rank above unrelated chats about the same provider', () => {
    const { titles } = setup('PhonePe renewal retry failures', [
      ['PhonePe renewal retry investigation', 25],
      ['Subscription renewal recovery dunning flow', 40],
      ['PhonePe UPI integration', 12],
      ['Fix retry logic in Kafka consumer', 6],
    ])
    expect(titles[0]).toBe('PhonePe renewal retry investigation')
    expect(titles).toContain('Subscription renewal recovery dunning flow')
    expect(titles).not.toContain('PhonePe UPI integration')
    expect(titles).not.toContain('Fix retry logic in Kafka consumer')
  })

  it('C: continues a product across design and implementation chats', () => {
    const { titles } = setup('CTO Morning Brief App', [
      ['CTO Morning Brief design', 30],
      ['CTO Morning Brief implementation plan', 25],
      ['Morning routine tips', 8],
      ['CTO Path', 50],
    ])
    expect(titles).toEqual(expect.arrayContaining(['CTO Morning Brief design', 'CTO Morning Brief implementation plan']))
    expect(titles).not.toContain('Morning routine tips')
    expect(titles).not.toContain('CTO Path')
  })

  it('D: a broad title with no indexed content gets no suggestions', () => {
    const { results } = setup('Need help', [
      ['Need help with Excel', 2],
      ['Help me write a poem', 3],
    ])
    expect(results).toEqual([])
  })

  it('E: relatedness does not decay with age', () => {
    const { titles } = setup(
      'Redis OOM incident postmortem',
      [
        ['Redis eviction policy OOM debugging', 240],
        ['Redis cluster sizing', 2],
        ['Postgres vacuum incident', 3],
      ],
      { currentDaysAgo: 200 },
    )
    expect(titles).toEqual(['Redis eviction policy OOM debugging'])
  })

  it('E: an old strong match still beats a recent weak one', () => {
    const { titles } = setup('Review Paytm Autopay PR #4294', [
      ['Autopay PR 4294 rollout notes', 700],
      ['Review Paytm PR', 1],
    ])
    expect(titles[0]).toBe('Autopay PR 4294 rollout notes')
  })

  it('F: title-only matching is conservative and invents nothing', () => {
    const { results, titles } = setup('Revenue agent prototype', [
      ['Revenue agent evaluation', 20],
      ['Zebra quokka', 2],
      ['Revenue dashboard', 30],
    ])
    expect(titles).toEqual(['Revenue agent evaluation'])
    expect(results[0]!.level).toBe('title')
    // One shared word is not a relationship.
    expect(titles).not.toContain('Revenue dashboard')
  })

  it('excludes the active chat, honours the limit, and never returns weak generic matches', () => {
    const aspects = ['retry', 'webhook', 'ledger', 'timeout', 'rollout', 'alerting', 'schema', 'backfill', 'mandate', 'cron', 'sandbox', 'idempotency', 'cache', 'metrics', 'queue', 'throttle', 'refund', 'audit', 'billing', 'latency']
    const others: Row[] = aspects.map((a, i) => [`Paytm Autopay PR 4294 ${a} discussion`, i + 1])
    const idx = history([['Paytm Autopay PR 4294', 0], ...others])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    const two = engine.related('c0', { limit: 2, now: NOW })
    const ten = engine.related('c0', { limit: 10, now: NOW })
    expect(two).toHaveLength(2)
    expect(ten).toHaveLength(10)
    expect(ten.every((r) => r.id !== 'c0')).toBe(true)
    // The shorter list is a prefix of the longer one.
    expect(ten.slice(0, 2).map((r) => r.id)).toEqual(two.map((r) => r.id))
  })

  it('suppresses near-identical suggestions', () => {
    const { titles } = setup('Review Paytm Autopay PR #4294', [
      ['Paytm Autopay PR 4294 follow-up', 5],
      ['Paytm Autopay PR 4294 follow-up', 9],
      ['paytm autopay PR 4294 follow up', 12],
    ])
    expect(titles).toHaveLength(1)
  })

  it('suggests nothing for a chat with no history to match', () => {
    const engine = new RelatedEngine()
    engine.indexAll(history([['Review Paytm Autopay PR #4294', 0]]))
    expect(engine.related('c0')).toEqual([])
    expect(engine.related('missing')).toEqual([])
    expect(engine.related(null)).toEqual([])
  })

  it('uses the page title when the active chat has not synced yet', () => {
    const idx = history([['Autopay PR 4294 rollout notes', 30], ...filler])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    const r = engine.related('not-synced-yet', { activeTitle: 'Review Paytm Autopay PR #4294', now: NOW })
    expect(idx.conversations[r[0]!.id]!.title).toBe('Autopay PR 4294 rollout notes')
    expect(engine.related('not-synced-yet', { activeTitle: 'New chat', now: NOW })).toEqual([])
  })

  it('explains matches from real signals only', () => {
    const { results } = setup('Review Paytm Autopay PR #4294', [['Paytm Autopay PR 4294 follow-up fixes', 20]])
    expect(results[0]!.reasons[0]).toBe('Same PR number (#4294)')
    const none = setup('Review Paytm Autopay PR #4294', [['PR Review Paytm Recovery', 15]])
    for (const r of none.results) expect(r.reasons.join(' ')).not.toMatch(/Same PR|repository|ticket/)
  })
})

describe('index lifecycle', () => {
  it('indexes new, renamed and deleted conversations incrementally', () => {
    const idx = history([['Review Paytm Autopay PR #4294', 1], ...filler])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    expect(engine.related('c0', { now: NOW })).toEqual([])

    // Synced: a related chat appears.
    idx.conversations.new1 = { id: 'new1', title: 'Autopay PR 4294 hotfix', createdAt: NOW, updatedAt: NOW, cachedAt: 0 }
    engine.indexAll(idx)
    expect(engine.related('c0', { now: NOW }).map((r) => r.id)).toEqual(['new1'])

    // Renamed: it stops matching, and the old terms are gone from the index.
    idx.conversations.new1!.title = 'Garden watering schedule'
    engine.indexAll(idx)
    expect(engine.related('c0', { now: NOW })).toEqual([])

    // Renamed back, then deleted upstream.
    idx.conversations.new1!.title = 'Autopay PR 4294 hotfix'
    engine.indexAll(idx)
    expect(engine.related('c0', { now: NOW })).toHaveLength(1)
    delete idx.conversations.new1
    engine.indexAll(idx)
    expect(engine.related('c0', { now: NOW })).toEqual([])
    expect(engine.stats().docs).toBe(Object.keys(idx.conversations).length)
  })

  it('does no work for unchanged titles, and a timestamp-only change does not invalidate results', () => {
    const idx = history([['Review Paytm Autopay PR #4294', 1], ['Autopay PR 4294 hotfix', 3], ...filler])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    const v = engine.version
    const first = engine.related('c0', { now: NOW })

    engine.plan(idx) // nothing changed
    expect(engine.step(50)).toBe(false)
    expect(engine.version).toBe(v)

    idx.conversations.c1!.updatedAt = NOW // a new message in that chat
    engine.indexAll(idx)
    expect(engine.version).toBe(v)
    expect(engine.related('c0', { now: NOW })).toBe(first) // served from cache
  })

  it('indexes in time-boxed slices and finishes with one version bump', () => {
    const idx = history(Array.from({ length: 400 }, (_, i) => [`Debug webhook retries ${i}`, i]))
    const engine = new RelatedEngine()
    engine.plan(idx)
    const v = engine.version
    let slices = 0
    while (engine.step(0)) slices++ // a zero budget yields after every small batch
    expect(slices).toBeGreaterThan(5)
    expect(engine.version).toBe(v + 1)
    expect(engine.stats().docs).toBe(400)
  })

  it('tracks how well each conversation is known', () => {
    const idx = history([['Paytm Autopay PR #4294', 1], ['Revenue agent prototype', 2], ['Need help', 3]])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    expect(engine.stats()).toMatchObject({ docs: 3, metadata: 1, title: 2, content: 0 })
  })

  it('clears everything on reset or sign-out', () => {
    const idx = history([['Review Paytm Autopay PR #4294', 1], ['Autopay PR 4294 hotfix', 3]])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    engine.plan(null)
    expect(engine.stats()).toMatchObject({ docs: 0, keys: 0 })
    expect(engine.related('c0')).toEqual([])
  })
})

describe('content-aware matching (for a future capture or import)', () => {
  it('lets message content relate chats whose titles say nothing', () => {
    const idx = history([['Need help', 1], ['Quick question', 4], ...filler])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    expect(engine.related('c0', { now: NOW })).toEqual([])

    engine.setContent('c0', signalsFromText('Reviewing github.com/Animall-In/backend-apis/pull/4294 about Paytm autopay mandate retries'))
    engine.setContent('c1', signalsFromText('The Paytm autopay mandate retry fix is in https://github.com/Animall-In/backend-apis/pull/4294'))
    const r = engine.related('c0', { now: NOW })
    expect(r.map((x) => x.id)).toEqual(['c1'])
    expect(r[0]!.level).toBe('content')
    expect(r[0]!.reasons[0]).toMatch(/^Same PR/)
    expect(engine.stats().content).toBe(2)
  })

  it('skips re-indexing when the source text is unchanged, and can drop content again', () => {
    const idx = history([['Need help', 1], ['Quick question', 4]])
    const engine = new RelatedEngine()
    engine.indexAll(idx)
    const signals = signalsFromText('Paytm autopay mandate retries')
    engine.setContent('c0', signals)
    const v = engine.version
    engine.setContent('c0', { ...signals }) // same hash
    expect(engine.version).toBe(v)
    engine.clearContent('c0')
    expect(engine.stats().content).toBe(0)
  })

  it('keeps only signals, never the text', () => {
    const s = signalsFromText('Dear team, my password is hunter2 and the Paytm autopay mandate retries are failing')
    expect(JSON.stringify(s)).not.toContain('hunter2') // identifier-shaped tokens are dropped
    expect(JSON.stringify(s)).not.toContain('Dear team, my password') // no prose
    expect(s.entities.map((e) => e.key)).toContain('provider:paytm')
  })
})

describe('performance', () => {
  it('never relates two chats only because they share a broad category', () => {
    // Pairs filed under the same primary (and often the same subcategory) with no specific subject in common.
    const pairs: Array<[string, string]> = [
      ['Explain photosynthesis for class 8', 'Calculus derivatives practice'], // both Learning
      ['Plan a family trip to Kerala', 'Easy dinner recipes for kids'], // both Personal
      ['Weekend trip itinerary ideas', 'Visa requirements for Japan'], // both Personal · Travel
      ['Agenda for Monday leadership meeting', 'Competitor analysis for our SaaS'], // both Work
      ['Quarterly OKR planning', 'Marketing campaign for Diwali sale'], // both Work
      ['Logo design for my bakery', 'Short story about a lost robot'], // both Creative
      ['Kubernetes autoscaling config', 'Postgres index tuning'], // both Technology
      ['Debug flaky login test', 'Fix NullPointerException in OrderService'], // both Technology · Debugging
    ]
    for (const [a, b] of pairs) {
      expect(classifyTitle(a).primary, `${a} / ${b}`).toBe(classifyTitle(b).primary)
      const { titles } = setup(a, [[b, 2]])
      expect(titles, `${a} ↔ ${b}`).not.toContain(b)
    }
  })

  it('still relates chats about the same PR, and ranks the same entity above the same category', () => {
    const { titles } = setup('Review Paytm Autopay PR #4294', [
      ['Autopay PR 4294 hotfix', 2],
      ['Review Razorpay settlement PR #5150', 3], // same subcategory (PR Reviews), different PR
    ])
    expect(titles[0]).toBe('Autopay PR 4294 hotfix')
    expect(titles).not.toContain('Review Razorpay settlement PR #5150')
  })

  it('indexes 10,000 titles and answers quickly', () => {
    const subjects = ['paytm', 'phonepe', 'razorpay', 'postgres', 'redis', 'kafka', 'hiring', 'analytics', 'roadmap', 'onboarding', 'pricing', 'checkout']
    const things = ['autopay mandate', 'webhook retries', 'settlement report', 'index tuning', 'eviction policy', 'consumer lag', 'interview loop', 'funnel dashboard', 'launch plan', 'refund flow', 'api errors', 'schema migration']
    const verbs = ['Review', 'Debug', 'Plan', 'Draft', 'Explain', 'Compare', 'Design', 'Fix']
    const rows: Row[] = []
    for (let i = 0; i < 10_000; i++) {
      const pr = i % 13 === 0 ? ` PR #${1000 + (i % 400)}` : ''
      rows.push([`${verbs[i % verbs.length]} ${subjects[(i * 7) % subjects.length]} ${things[(i * 5 + (i >> 3)) % things.length]}${pr} ${i}`, i % 900])
    }
    rows.unshift(['Review Paytm autopay mandate PR #1003', 0])
    const idx = history(rows)
    const engine = new RelatedEngine()

    const t0 = performance.now()
    engine.indexAll(idx)
    const indexMs = performance.now() - t0

    const times: number[] = []
    for (let i = 0; i < 40; i++) {
      const t = performance.now()
      engine.related(`c${i * 3}`, { now: NOW })
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    const p50 = times[20]!
    const p95 = times[38]!
    // Generous bounds: these should be far lower on a developer machine.
    expect(indexMs).toBeLessThan(4000)
    expect(p95).toBeLessThan(150)
    expect(p50).toBeLessThan(50)
    const hit = performance.now()
    engine.related('c0', { now: NOW })
    expect(performance.now() - hit).toBeLessThan(2) // cached
    expect(engine.stats().docs).toBe(10_001)
  })
})
