import { describe, expect, it } from 'vitest'
import { categoryFor, classify, classifyTitle, isCategoryNodeId, migrateCategoryId, normalizeTitle, type Classification } from '../../src/related/classify'
import { extract } from '../../src/related/extract'
import { FACET_SIGNALS, PRIMARY_IDS, SUBCATEGORIES } from '../../src/related/taxonomy'
import { AUDIT } from './fixtures/category-titles'
import { ALL_LABELLED, HOLDOUT, PERSONAS, type LabelledTitle } from './fixtures/personas'

const label = (c: Classification) => (c.sub ? `${c.primary}/${c.sub}` : c.primary)
/** "primary" accepts any subcategory; "primary/sub" must match exactly. */
const accepts = (expected: string, c: Classification) => (expected.includes('/') ? expected === label(c) : expected === c.primary)
const correct = (l: LabelledTitle, c: Classification) => [l.expected, ...(l.also ?? [])].some((e) => accepts(e, c))

describe('taxonomy', () => {
  it('has eight fixed primaries and uniquely named subcategories, each under one primary', () => {
    expect(PRIMARY_IDS).toEqual(['work', 'learning', 'writing', 'creative', 'technology', 'planning', 'personal', 'general'])
    const ids = [...PRIMARY_IDS, ...SUBCATEGORIES.map((s) => s.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SUBCATEGORIES) expect(PRIMARY_IDS).toContain(s.parent)
    expect(SUBCATEGORIES.some((s) => s.parent === ('general' as string))).toBe(false)
  })

  it('has vocabulary for every subcategory and every primary but General', () => {
    for (const s of SUBCATEGORIES) if (s.id !== 'pr-reviews') expect(FACET_SIGNALS[s.id]?.length, s.id).toBeGreaterThan(0)
    for (const p of PRIMARY_IDS) if (p !== 'general') expect(FACET_SIGNALS[p]?.length, p).toBeGreaterThan(0)
    for (const facet of Object.keys(FACET_SIGNALS)) expect(isCategoryNodeId(facet), facet).toBe(true)
  })
})

describe('classification', () => {
  it('normalises titles before matching', () => {
    expect(normalizeTitle('TRP - Review Paytm PR')).toBe('trp review paytm pr')
    expect(normalizeTitle('Read-Only access (1:1)')).toBe('read only access 1 1')
    expect(normalizeTitle('  ')).toBe('')
  })

  it.each(AUDIT)('developer audit: %s → %s', (title, expected) => {
    const c = classifyTitle(title)
    expect(accepts(expected, c), `got ${label(c)}`).toBe(true)
  })

  for (const [persona, titles] of Object.entries(PERSONAS)) {
    it(`persona "${persona}": every title filed as a person would`, () => {
      const wrong = titles.filter((l) => !correct(l, classifyTitle(l.title))).map((l) => `${l.title} → ${label(classifyTitle(l.title))}`)
      expect(wrong).toEqual([])
    })
  }

  it('reads deliberately misleading titles by their purpose, not their keywords', () => {
    const wrong = ALL_LABELLED.filter((l) => !correct(l, classifyTitle(l.title))).map((l) => `${l.title} → ${label(classifyTitle(l.title))}`)
    expect(wrong).toEqual([])
  })

  it('generalises to titles it was not tuned on (held-out floor)', () => {
    const exact = HOLDOUT.filter((l) => correct(l, classifyTitle(l.title))).length / HOLDOUT.length
    const primary = HOLDOUT.filter((l) => [l.expected, ...(l.also ?? [])].some((e) => e.split('/')[0] === classifyTitle(l.title).primary)).length / HOLDOUT.length
    // Measured at 94% exact and 98% primary when written; the floor leaves room for vocabulary changes, not for regressions.
    expect(exact).toBeGreaterThanOrEqual(0.9)
    expect(primary).toBeGreaterThanOrEqual(0.95)
  })

  it('classifies the primary purpose (the examples from the spec)', () => {
    const cases: Array<[string, string]> = [
      ['Debug React authentication issue', 'technology/debugging'],
      ['Write an email to my manager', 'writing/emails'],
      ['Plan a family trip to Kerala', 'personal/travel'],
      ['Create a watercolor illustration', 'creative/image-generation'],
      ['Explain photosynthesis for class 8', 'learning/science'],
      ['Build quarterly business strategy', 'work/strategy'],
      ['Weekly meal planning', 'personal/cooking'],
      ['Review backend PR #4294', 'technology/pr-reviews'],
      ['Health app architecture', 'technology/architecture'],
      ['Plan an engineering interview', 'work/hiring'],
      ['Review my travel plan', 'personal/travel'],
      ['Payment for flight booking', 'personal/travel'],
    ]
    for (const [title, expected] of cases) expect(label(classifyTitle(title)), title).toBe(expected)
    // Interview preparation is never a code review.
    expect(classifyTitle('Python interview preparation').sub).not.toBe('pr-reviews')
  })

  it('gives a PR review precedence over whatever the PR is about', () => {
    for (const t of ['Review Paytm PR', 'Hero Cashback PR Review', 'Review Kisan Backend Changes', 'Analytics dashboard PR', 'Fix payment crash PR #4312', 'https://github.com/Animall-In/backend-apis/pull/4294'])
      expect(label(classifyTitle(t)), t).toBe('technology/pr-reviews')
  })

  it('an explicit "debug" is debugging, whatever is being debugged', () => {
    for (const t of ['Debug CI pipeline', 'Debug onboarding flow', 'Debug hiring loop', 'Debugging Redis eviction']) expect(label(classifyTitle(t)), t).toBe('technology/debugging')
  })

  it('treats a generic fault as software only in a technical title', () => {
    expect(label(classifyTitle('API not working after deploy'))).toBe('technology/debugging')
    expect(classifyTitle('My washing machine is not working').primary).not.toBe('technology')
    expect(classifyTitle('Broken heart advice').primary).not.toBe('technology')
  })

  it('needs a clear signal: a single hint, or nothing at all, is General', () => {
    for (const t of ['Hello', 'New chat', 'Quick question', 'Improving Team Communication', 'Untitled', '¿Qué es esto?', 'Random thoughts', 'Mr Sharma follow-up', '']) {
      const c = classifyTitle(t)
      expect(c.primary, t).toBe('general')
      expect(c.confidence, t).toBe('none')
    }
  })

  it('reports confidence from the evidence it had', () => {
    expect(classifyTitle('Review Paytm PR').confidence).toBe('high') // settled by a rule
    expect(classifyTitle('Solve quadratic equations step by step').confidence).toBe('high') // decisive and unopposed
    expect(classifyTitle('Mobile game ideas').confidence).toBe('low') // a tie, broken by order
    expect(classifyTitle('Plan for tomorrow').confidence).toBe('low') // two weak hints
  })

  it('tags secondary topics: known names first, then other subcategories the title touched', () => {
    const c = classifyTitle('Review Paytm subscription backend PR')
    expect(label(c)).toBe('technology/pr-reviews')
    expect(c.topics).toContain('paytm')
    expect(c.topics).toContain('payments')
    expect(c.topics).toContain('backend')
    expect(c.topics.length).toBeLessThanOrEqual(5)
    expect(classifyTitle('Hello').topics).toEqual([])
  })

  it('is deterministic and memoised by title', () => {
    expect(classifyTitle('Weekly meal planning')).toBe(classifyTitle('Weekly meal planning'))
    expect(classify('Weekly meal planning')).toEqual(classifyTitle('Weekly meal planning'))
  })
})

describe('stored and legacy categories', () => {
  it('uses a stored category before the title, and ignores one that is not ours', () => {
    expect(categoryFor({ title: 'Review Paytm PR', category: 'writing' })).toMatchObject({ primary: 'writing', sub: null, confidence: 'high' })
    expect(categoryFor({ title: 'Weekend trip', category: 'payments' })).toMatchObject({ primary: 'work', sub: 'payments' })
    expect(label(categoryFor({ title: 'Review Paytm PR', category: 'made-up' }))).toBe('technology/pr-reviews')
    for (const bogus of ['toString', 'constructor', '__proto__', '']) expect(label(categoryFor({ title: 'Weekend trip itinerary', category: bogus })), bogus).toBe('personal/travel')
  })

  it('maps every category id History+ has ever used', () => {
    const legacy: Record<string, string> = {
      'code-review': 'pr-reviews',
      engineering: 'technology',
      debugging: 'debugging',
      payments: 'payments',
      analytics: 'analytics',
      product: 'product',
      people: 'hiring',
      security: 'security',
      writing: 'writing',
      general: 'general',
      // 0.2 filter chip ids
      'pr-reviews': 'pr-reviews',
      other: 'general',
    }
    for (const [old, now] of Object.entries(legacy)) expect(migrateCategoryId(old), old).toBe(now)
    expect(migrateCategoryId('nope')).toBeNull()
    expect(migrateCategoryId(42)).toBeNull()
    expect(label(categoryFor({ title: 'x', category: 'people' }))).toBe('work/hiring')
    expect(label(categoryFor({ title: 'x', category: 'code-review' }))).toBe('technology/pr-reviews')
  })
})

describe('separation from "Related to this chat"', () => {
  it('extract() carries no category, and its topics and activity are the related engine’s own', () => {
    const x = extract('Paytm PreNotify architecture')
    expect(x).not.toHaveProperty('category')
    expect(x.topics).toEqual(['subscriptions', 'architecture'])
    expect(x.activity).toBeNull()
    // The category vocabulary knows far more words than the related engine's topics; teaching it one changes nothing there.
    expect(extract('Weekly meal planning').topics).toEqual([])
    expect(extract('Explain photosynthesis for class 8').topics).toEqual([])
  })
})
