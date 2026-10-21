import { describe, expect, it } from 'vitest'
import { classifyTitle } from '../../src/related/classify'
import { PRIMARY_IDS, SUBCATEGORIES } from '../../src/related/taxonomy'
import { ALL_FILTER, CATEGORY_FILTERS, categoryDisplay, classificationOf, filterDef, isFilterId, isPrimaryFilter, matchesFilter, migrateFilterId } from '../../src/ui/categories'
import { countByCategory } from '../../src/ui/view'
import { ALL_LABELLED } from './fixtures/personas'
import { conv } from './helpers'

describe('category filters', () => {
  it('lists every primary, each followed by its subcategories, General last', () => {
    const primaries = CATEGORY_FILTERS.filter((f) => !f.parent).map((f) => f.id)
    expect(primaries).toEqual([...PRIMARY_IDS])
    expect(CATEGORY_FILTERS.length).toBe(PRIMARY_IDS.length + SUBCATEGORIES.length)
    // Grouped: a subcategory always comes after its primary and before the next primary.
    let current = ''
    for (const f of CATEGORY_FILTERS) {
      if (!f.parent) current = f.id
      else expect(f.parent, f.id).toBe(current)
    }
    expect(ALL_FILTER).toMatchObject({ id: 'all', label: 'All', icon: 'grid' })
  })

  it('gives each primary its own icon (the Lucide set from the spec)', () => {
    const icons = Object.fromEntries(CATEGORY_FILTERS.filter((f) => !f.parent).map((f) => [f.id, f.icon]))
    expect(icons).toEqual({
      work: 'briefcase',
      learning: 'graduation-cap',
      writing: 'pen-line',
      creative: 'palette',
      technology: 'code',
      planning: 'calendar-check',
      personal: 'heart',
      general: 'message',
    })
  })

  it('keeps the developer subcategories, with their own icons', () => {
    for (const [id, label, icon] of [
      ['pr-reviews', 'PR Reviews', 'git-pull-request'],
      ['debugging', 'Debugging', 'bug'],
      ['security', 'Security', 'shield'],
      ['analytics', 'Analytics', 'chart'],
      ['payments', 'Payments', 'credit-card'],
      ['product', 'Product', 'lightbulb'],
      ['hiring', 'Hiring', 'users'],
    ] as const)
      expect(filterDef(id), id).toMatchObject({ label, icon })
  })

  it('shows a row its subcategory icon where it has one, else its primary icon', () => {
    expect(categoryDisplay(classifyTitle('Investigate Meta sync failure'))).toEqual({ primary: 'technology', sub: 'debugging', label: 'Technology · Debugging', icon: 'bug' })
    expect(categoryDisplay(classifyTitle('Plan a family trip to Kerala'))).toMatchObject({ label: 'Personal · Travel', icon: 'plane' })
    expect(categoryDisplay(classifyTitle('Kubernetes autoscaling config'))).toMatchObject({ label: 'Technology · Infrastructure', icon: 'code' })
    expect(categoryDisplay(classifyTitle('Hello'))).toEqual({ primary: 'general', sub: null, label: 'General', icon: 'message' })
  })

  it('a primary filter shows everything under it; a subcategory only its part', () => {
    const pr = classifyTitle('Review Paytm PR')
    expect(matchesFilter(pr, 'all')).toBe(true)
    expect(matchesFilter(pr, 'technology')).toBe(true)
    expect(matchesFilter(pr, 'pr-reviews')).toBe(true)
    expect(matchesFilter(pr, 'debugging')).toBe(false)
    expect(matchesFilter(pr, 'work')).toBe(false)
  })

  it('validates and migrates a remembered filter', () => {
    expect(isFilterId('all')).toBe(true)
    expect(isFilterId('technology')).toBe(true)
    expect(isFilterId('debugging')).toBe(true) // a subcategory is a filter now
    expect(isFilterId('engineering')).toBe(false) // a 0.2 id, mapped by migrateFilterId instead
    expect(isFilterId(undefined)).toBe(false)
    expect(isFilterId({})).toBe(false)
    // Every 0.2 chip still means something.
    expect(['pr-reviews', 'engineering', 'analytics', 'product', 'payments', 'writing', 'other'].map(migrateFilterId)).toEqual(['pr-reviews', 'technology', 'analytics', 'product', 'payments', 'writing', 'general'])
    for (const v of [undefined, null, 'gone', 'toString', 7]) expect(migrateFilterId(v)).toBe('all')
    expect(isPrimaryFilter('technology')).toBe(true)
    expect(isPrimaryFilter('pr-reviews')).toBe(false)
    expect(isPrimaryFilter('all')).toBe(false)
  })

  it('counts each conversation once under its primary (so primaries add up to All) and once under its subcategory', () => {
    const entries = ALL_LABELLED.map((l, i) => ({ conv: conv(l.title, 1000 + i), ts: 1000 + i }))
    const counts = countByCategory(entries)
    expect(counts.get('all')).toBe(entries.length)
    const primaries = PRIMARY_IDS.reduce((n, p) => n + (counts.get(p) ?? 0), 0)
    expect(primaries).toBe(entries.length) // no conversation disappears
    for (const p of PRIMARY_IDS) {
      const subs = SUBCATEGORIES.filter((s) => s.parent === p).reduce((n, s) => n + (counts.get(s.id) ?? 0), 0)
      expect(subs, p).toBeLessThanOrEqual(counts.get(p) ?? 0)
    }
    expect(countByCategory([]).get('all')).toBe(0)
  })

  it('reads a stored category before the title', () => {
    expect(classificationOf({ title: 'Weekend trip', category: 'payments' })).toMatchObject({ primary: 'work', sub: 'payments' })
    expect(classificationOf({ title: 'Weekend trip', category: 'not-a-category' })).toMatchObject({ primary: 'personal', sub: 'travel' })
  })
})
