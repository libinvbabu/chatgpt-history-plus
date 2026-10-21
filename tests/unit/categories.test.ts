import { describe, expect, it } from 'vitest'
import { CATEGORY_LABELS, type CategoryId } from '../../src/related/dictionary'
import { categoryDisplay, filterDef, filterFor, FILTERS, isFilterId } from '../../src/ui/categories'
import { countByCategory } from '../../src/ui/view'
import { conv } from './helpers'

describe('category filters', () => {
  it('lists the chips in order, each with its own icon', () => {
    expect(FILTERS.map((f) => [f.id, f.label, f.icon])).toEqual([
      ['all', 'All', 'grid'],
      ['pr-reviews', 'Reviews', 'git-pull-request'],
      ['engineering', 'Engineering', 'code'],
      ['analytics', 'Analytics', 'chart'],
      ['product', 'Product', 'lightbulb'],
      ['payments', 'Payments', 'credit-card'],
      ['writing', 'Writing', 'pen'],
      ['other', 'Other', 'message'],
    ])
    expect(new Set(FILTERS.map((f) => f.icon)).size).toBe(FILTERS.length)
  })

  it('files every category the extractor can produce under a chip, so no conversation is unreachable', () => {
    const chips = new Set(FILTERS.filter((f) => f.id !== 'all').map((f) => f.id))
    for (const id of Object.keys(CATEGORY_LABELS) as CategoryId[]) {
      const d = categoryDisplay(id)
      expect(chips.has(d.filter), id).toBe(true)
      expect(d.label.length, id).toBeGreaterThan(0)
    }
  })

  it('shows a row the chip’s label and icon, or its own where it says more', () => {
    expect(categoryDisplay('payments')).toEqual({ filter: 'payments', label: 'Payments', icon: 'credit-card' })
    expect(categoryDisplay('code-review')).toEqual({ filter: 'pr-reviews', label: 'Reviews', icon: 'git-pull-request' })
    // Listed under Engineering, but the row keeps its more specific icon and name.
    expect(categoryDisplay('debugging')).toEqual({ filter: 'engineering', label: 'Debugging', icon: 'bug' })
    expect(categoryDisplay('security')).toEqual({ filter: 'engineering', label: 'Security & access', icon: 'shield' })
    expect(categoryDisplay('people')).toEqual({ filter: 'other', label: 'Hiring & people', icon: 'users' })
  })

  it('treats anything unknown as Other', () => {
    for (const v of [undefined, null, '', 'not-a-category', 'toString', '__proto__']) {
      expect(categoryDisplay(v), String(v)).toEqual({ filter: 'other', label: 'Other', icon: 'message' })
    }
    expect(categoryDisplay('general')).toEqual({ filter: 'other', label: 'Other', icon: 'message' })
  })

  it('picks the chip from a stored category, else the title, else Other', () => {
    expect(filterFor({ title: 'Weekend trip', category: 'payments' })).toBe('payments')
    expect(filterFor({ title: 'Review Paytm Autopay PR', category: null })).toBe('pr-reviews')
    expect(filterFor({ title: 'Review Paytm Autopay PR', category: 'not-a-category' })).toBe('pr-reviews')
    expect(filterFor({ title: 'Weekend trip', category: 'not-a-category' })).toBe('other')
    expect(filterFor({ title: '' })).toBe('other')
  })

  it('validates a remembered chip', () => {
    expect(isFilterId('all')).toBe(true)
    expect(isFilterId('writing')).toBe(true)
    expect(isFilterId('debugging')).toBe(false) // a category, not a chip
    expect(isFilterId(undefined)).toBe(false)
    expect(isFilterId({})).toBe(false)
    expect(filterDef('other').label).toBe('Other')
  })

  it('counts each conversation once, under its chip, and All is the total', () => {
    const titles = ['Review Paytm Autopay PR', 'Debug CI pipeline', 'Fix login bug', 'Draft launch email', 'Weekend trip', 'Plan roadmap']
    const entries = titles.map((t, i) => ({ conv: conv(t, 1000 + i), ts: 1000 + i }))
    const counts = countByCategory(entries)
    expect(counts.all).toBe(entries.length)
    const parts = FILTERS.filter((f) => f.id !== 'all').reduce((n, f) => n + counts[f.id], 0)
    expect(parts).toBe(entries.length)
    expect(counts['pr-reviews']).toBe(1)
    expect(counts.engineering).toBe(2) // debugging is listed under Engineering
    expect(countByCategory([]).all).toBe(0)
  })
})
