import { describe, expect, it } from 'vitest'
import { classifyTitle, type Classification } from '../../src/related/classify'
import { PRIMARY_IDS, SUBCATEGORIES } from '../../src/related/taxonomy'
import { matchesFilter, menuItems } from '../../src/ui/categories'
import { arrange, emptyFilterPrefs, PERSONALIZE, PERSONALIZE_VERSION, rankFilters, shouldRefresh, tally, visibleFilters, type FilterPrefs } from '../../src/ui/personalize'
import { PERSONAS, type PersonaId } from './fixtures/personas'

/** A history: each persona's titles, repeated, so counts look like months of use. */
const MIXES: Record<PersonaId, Array<[PersonaId, number]>> = {
  engineer: [['engineer', 6], ['business', 1], ['mixed', 1]],
  student: [['student', 6], ['creator', 1], ['mixed', 1]],
  parent: [['parent', 6], ['mixed', 1]],
  jobSeeker: [['jobSeeker', 6], ['mixed', 1]],
  creator: [['creator', 6], ['mixed', 1]],
  business: [['business', 6], ['mixed', 1]],
  mixed: [['mixed', 4], ['engineer', 1], ['student', 1], ['parent', 1]],
}

const titlesOf = (mix: Array<[PersonaId, number]>) => mix.flatMap(([p, n]) => Array.from({ length: n }, () => PERSONAS[p].map((l) => l.title)).flat())
const classify = (titles: readonly string[]) => titles.map(classifyTitle)
const barFor = (cls: readonly Classification[], prefs: Partial<FilterPrefs> = {}) => visibleFilters({ pinned: [], hidden: [], ranked: rankFilters(tally(cls)), ...prefs })

const SUB_PARENT = new Map(SUBCATEGORIES.map((s) => [s.id, s.parent as string]))
const familyOf = (id: string) => SUB_PARENT.get(id) ?? id
const subsOf = (bar: string[], primary: string) => bar.filter((id) => SUB_PARENT.get(id) === primary)

describe('personalized filters, per kind of user', () => {
  const bars = Object.fromEntries(Object.entries(MIXES).map(([p, mix]) => [p, barFor(classify(titlesOf(mix)))])) as Record<PersonaId, string[]>

  it('developer: Technology with PR Reviews and Debugging, and still room for another area', () => {
    const bar = bars.engineer
    expect(bar[0]).toBe('technology')
    expect(bar).toContain('pr-reviews')
    expect(bar).toContain('debugging')
    expect(bar.some((id) => familyOf(id) !== 'technology')).toBe(true)
  })

  it('student: Learning and its subjects lead', () => {
    const bar = bars.student
    expect(bar[0]).toBe('learning')
    expect(subsOf(bar, 'learning').length).toBeGreaterThanOrEqual(2)
    expect(bar.some((id) => familyOf(id) !== 'learning')).toBe(true)
  })

  it('parent: Personal with everyday subtopics (travel, cooking, parenting…)', () => {
    const bar = bars.parent
    expect(bar[0]).toBe('personal')
    expect(subsOf(bar, 'personal').length).toBeGreaterThanOrEqual(2)
    expect(subsOf(bar, 'personal').every((id) => ['travel', 'cooking', 'parenting', 'shopping', 'home', 'health', 'finance'].includes(id))).toBe(true)
  })

  it('job seeker: Work leads; a subcategory that is all of Work is not repeated beside it', () => {
    const bar = bars.jobSeeker
    expect(bar[0]).toBe('work')
    // Nearly every Work chat is Career, so a Career chip would only repeat Work.
    expect(bar).not.toContain('career')
  })

  it('content creator: Creative and Writing both prominent', () => {
    const bar = bars.creator
    expect(bar[0]).toBe('creative')
    expect(bar).toContain('writing')
    expect(subsOf(bar, 'creative').length + subsOf(bar, 'writing').length).toBeGreaterThanOrEqual(1)
  })

  it('business professional: Work with its subtopics', () => {
    const bar = bars.business
    expect(bar[0]).toBe('work')
    expect(subsOf(bar, 'work').length).toBeGreaterThanOrEqual(2)
  })

  it('mixed user: balanced, no single area filling the bar', () => {
    const bar = bars.mixed
    expect(new Set(bar.map(familyOf)).size).toBeGreaterThanOrEqual(3)
  })

  it.each(Object.keys(MIXES) as PersonaId[])('%s: at most five filters, never General, each with real activity, grouped by family', (p) => {
    const cls = classify(titlesOf(MIXES[p]))
    const t = tally(cls)
    const bar = bars[p]
    expect(bar.length).toBeGreaterThan(0)
    expect(bar.length).toBeLessThanOrEqual(PERSONALIZE.slots)
    expect(bar).not.toContain('general')
    for (const id of bar) expect(t.counts.get(id) ?? 0, id).toBeGreaterThanOrEqual(PERSONALIZE.minCount)
    for (const id of bar) expect((t.counts.get(id) ?? 0) / t.confident, id).toBeGreaterThanOrEqual(PERSONALIZE.minShare)
    // No family takes more than its share while others have something.
    const perFamily = new Map<string, number>()
    for (const id of bar) perFamily.set(familyOf(id), (perFamily.get(familyOf(id)) ?? 0) + 1)
    if (perFamily.size > 1) for (const [f, n] of perFamily) expect(n, f).toBeLessThanOrEqual(PERSONALIZE.maxPerFamily)
    // A family's chips sit together, primary first.
    const families = bar.map(familyOf)
    for (let i = 1; i < families.length; i++) if (families[i] !== families[i - 1]) expect(families.slice(0, i - 1)).not.toContain(families[i])
    for (const id of bar) if (SUB_PARENT.has(id) && bar.includes(familyOf(id))) expect(bar.indexOf(familyOf(id))).toBeLessThan(bar.indexOf(id))
  })

  it.each(Object.keys(MIXES) as PersonaId[])('%s: More lists every category not in the bar, and no conversation is unreachable', (p) => {
    const cls = classify(titlesOf(MIXES[p]))
    const history = new Map<string, number>()
    for (const c of cls) {
      history.set(c.primary, (history.get(c.primary) ?? 0) + 1)
      if (c.sub) history.set(c.sub, (history.get(c.sub) ?? 0) + 1)
    }
    const more = menuItems(history, new Set()).map((f) => f.id)
    for (const primary of PRIMARY_IDS) expect(more).toContain(primary)
    for (const [id, n] of history) if (n > 0) expect(more, id).toContain(id)
    // Every conversation matches its primary's filter, so the primaries in More reach all of them.
    for (const c of cls) expect(PRIMARY_IDS.some((primary) => matchesFilter(c, primary))).toBe(true)
  })

  it('is deterministic: the order conversations arrive in does not matter', () => {
    const cls = classify(titlesOf(MIXES.mixed))
    const reversed = [...cls].reverse()
    expect(barFor(reversed)).toEqual(barFor(cls))
    expect(rankFilters(tally(reversed))).toEqual(rankFilters(tally(cls)))
  })
})

describe('balancing', () => {
  const make = (counts: Record<string, number>) => {
    const cls: Classification[] = []
    for (const [label, n] of Object.entries(counts)) {
      const [primary, sub] = label.split('/') as [Classification['primary'], string | undefined]
      for (let i = 0; i < n; i++) cls.push({ primary, sub: sub ?? null, topics: [], confidence: 'high' })
    }
    return cls
  }

  it('a dominant category does not take every slot when other areas have meaningful activity', () => {
    // 80% Technology, split across many parts; Writing and Personal are small but real.
    const bar = barFor(make({ 'technology/pr-reviews': 300, 'technology/debugging': 250, 'technology/backend': 150, 'technology/architecture': 100, 'writing/emails': 100, 'personal/travel': 50, 'personal': 50 }))
    expect(bar).toContain('writing')
    expect(bar).toContain('personal')
    expect(bar.filter((id) => familyOf(id) === 'technology').length).toBeLessThanOrEqual(PERSONALIZE.maxPerFamily)
  })

  it('one area alone may fill the bar with its parts', () => {
    const bar = barFor(make({ 'personal/travel': 40, 'personal/cooking': 30, 'personal/shopping': 25, 'personal/health': 20 }))
    expect(bar).toEqual(['personal', 'travel', 'cooking', 'shopping', 'health'])
    // A part that is a small slice of its area (under 15%) is left to More.
    expect(barFor(make({ 'personal/travel': 60, 'personal/cooking': 30, 'personal/health': 10 }))).toEqual(['personal', 'travel', 'cooking'])
  })

  it('does not show nearly empty filters to fill slots', () => {
    const bar = barFor(make({ 'learning/mathematics': 120, 'learning/science': 60, 'writing': 2, 'creative/design': 1 }))
    expect(bar).toEqual(['learning', 'mathematics', 'science'])
  })

  it('ignores low-confidence and unclassified chats when choosing', () => {
    const cls = make({ 'work/meetings': 30 })
    for (let i = 0; i < 100; i++) cls.push({ primary: 'creative', sub: 'stories', topics: [], confidence: 'low' })
    for (let i = 0; i < 200; i++) cls.push({ primary: 'general', sub: null, topics: [], confidence: 'none' })
    expect(barFor(cls)).toEqual(['work']) // Meetings is all of Work, so it is not repeated beside it
  })

  it('an empty history has no filters, only All and More', () => {
    expect(barFor([])).toEqual([])
  })
})

describe('customization', () => {
  const ranked = ['technology', 'work', 'personal', 'debugging', 'pr-reviews', 'backend', 'travel']

  it('pinned filters come first, in pin order, and stay even with nothing in them', () => {
    expect(visibleFilters({ pinned: ['cooking', 'travel'], hidden: [], ranked })).toEqual(['cooking', 'travel', 'technology', 'work', 'personal'])
    expect(visibleFilters({ pinned: ['cooking'], hidden: [], ranked: [] })).toEqual(['cooking'])
  })

  it('a hidden filter leaves the bar and the next one takes its place', () => {
    expect(visibleFilters({ pinned: [], hidden: ['debugging'], ranked })).toEqual(['technology', 'pr-reviews', 'backend', 'work', 'personal'])
  })

  it('more pins than slots: all pins show (the row scrolls), no automatic ones', () => {
    const pinned = ['work', 'learning', 'writing', 'creative', 'technology', 'planning']
    expect(visibleFilters({ pinned, hidden: [], ranked })).toEqual(pinned)
  })

  it('arranges a family together whatever the ranking order', () => {
    expect(arrange(['debugging', 'work', 'technology'], ranked)).toEqual(['technology', 'debugging', 'work'])
  })
})

describe('stability', () => {
  const base = classify(titlesOf(MIXES.engineer))
  const settled = (cls: readonly Classification[]): FilterPrefs => ({ ...emptyFilterPrefs(), ranked: rankFilters(tally(cls)), basis: cls.length, complete: true, v: PERSONALIZE_VERSION })

  it('a few new conversations do not trigger a new choice', () => {
    const prefs = settled(base)
    expect(shouldRefresh(prefs, base.length + 5, true)).toBe(false)
    expect(shouldRefresh(prefs, base.length - 5, true)).toBe(false)
  })

  it('a material change does, and re-choosing keeps the bar when the history has not really changed shape', () => {
    const prefs = settled(base)
    const grown = [...base, ...classify(PERSONAS.engineer.map((l) => l.title))]
    expect(shouldRefresh(prefs, grown.length, true)).toBe(true)
    expect(visibleFilters({ ...prefs, ranked: rankFilters(tally(grown), visibleFilters(prefs)) })).toEqual(visibleFilters(prefs))
  })

  it('filters already shown win near-ties (stickiness), so re-choosing does not swap them', () => {
    const t = tally([
      ...Array.from({ length: 100 }, (): Classification => ({ primary: 'technology', sub: 'backend', topics: [], confidence: 'high' })),
      ...Array.from({ length: 100 }, (): Classification => ({ primary: 'technology', sub: 'frontend', topics: [], confidence: 'high' })),
      ...Array.from({ length: 95 }, (): Classification => ({ primary: 'technology', sub: 'mobile', topics: [], confidence: 'high' })),
      ...Array.from({ length: 105 }, (): Classification => ({ primary: 'technology', sub: 'debugging', topics: [], confidence: 'high' })),
    ])
    const fresh = visibleFilters({ pinned: [], hidden: [], ranked: rankFilters(t) })
    expect(fresh).toEqual(['technology', 'debugging', 'backend', 'frontend', 'mobile'].slice(0, fresh.length))
    // Mobile was in the bar and Backend was not: Mobile keeps its place on a near-tie.
    const sticky = rankFilters(t, ['technology', 'debugging', 'mobile'])
    expect(sticky.indexOf('mobile')).toBeLessThan(sticky.indexOf('backend'))
  })

  it('chooses again when the algorithm changes, when the first sync completes, and in bigger steps while it runs', () => {
    expect(shouldRefresh(emptyFilterPrefs(), 0, false)).toBe(true) // never chosen
    expect(shouldRefresh({ ...settled(base), v: PERSONALIZE_VERSION - 1 }, base.length, true)).toBe(true)
    const provisional = { ...settled(base), complete: false, basis: 200 }
    expect(shouldRefresh(provisional, 200, true)).toBe(true) // sync finished
    expect(shouldRefresh(provisional, 260, false)).toBe(false) // +30%: still settling
    expect(shouldRefresh(provisional, 300, false)).toBe(true) // +50%
  })
})
