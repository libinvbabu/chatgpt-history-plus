import { describe, expect, it } from 'vitest'
import { RELATED_INITIAL, RELATED_KEY, RELATED_MORE_KEY, buildRelatedRows, type RelatedEntry } from '../../src/history/related-rows'
import { categoryFor } from '../../src/related/extract'
import { at, conv } from './helpers'

const items = (n: number): RelatedEntry[] =>
  Array.from({ length: n }, (_, i) => {
    const c = conv(`related ${i}`, at(2026, 9, 20 - i))
    return { entry: { conv: c, ts: c.updatedAt }, reasons: i === 0 ? ['Same PR number (#4294)', 'Both about Paytm'] : [] }
  })

const kinds = (rows: ReturnType<typeof buildRelatedRows>) => rows.map((r) => r.type)

describe('related rows', () => {
  it('hides the section when nothing is related', () => {
    expect(buildRelatedRows([], {})).toEqual([])
  })

  it('shows a header and the two strongest by default, with "show more" when there are more', () => {
    const rows = buildRelatedRows(items(7), {})
    expect(kinds(rows)).toEqual(['related-header', 'related', 'related', 'related-more'])
    expect(rows[0]).toMatchObject({ count: 7, expanded: true })
    expect(rows.at(-1)).toMatchObject({ hidden: 7 - RELATED_INITIAL, expanded: false })
  })

  it('has no "show more" when there are only one or two', () => {
    expect(kinds(buildRelatedRows(items(1), {}))).toEqual(['related-header', 'related'])
    expect(kinds(buildRelatedRows(items(2), {}))).toEqual(['related-header', 'related', 'related'])
  })

  it('expands to everything on request, then back', () => {
    const more = buildRelatedRows(items(7), { [RELATED_MORE_KEY]: false }) // persisted as "not collapsed"
    expect(more.filter((r) => r.type === 'related')).toHaveLength(7)
    expect(more.at(-1)).toMatchObject({ type: 'related-more', expanded: true })
    const less = buildRelatedRows(items(7), { [RELATED_MORE_KEY]: true })
    expect(less.filter((r) => r.type === 'related')).toHaveLength(2)
  })

  it('collapses to just the header and remembers it', () => {
    const rows = buildRelatedRows(items(7), { [RELATED_KEY]: true })
    expect(kinds(rows)).toEqual(['related-header'])
    expect(rows[0]).toMatchObject({ expanded: false, count: 7 })
  })

  it('carries the reason text for hover, joined from real signals', () => {
    const rows = buildRelatedRows(items(3), {})
    expect(rows[1]).toMatchObject({ type: 'related', reason: 'Same PR number (#4294) · Both about Paytm' })
  })

  it('gives each row a key distinct from the same chat in the date groups', () => {
    const rows = buildRelatedRows(items(2), {})
    expect(rows.filter((r) => r.type === 'related').every((r) => r.key.startsWith('r:'))).toBe(true)
  })
})

describe('category lookup', () => {
  it('uses a stored category when valid, else derives one from the title, else general', () => {
    expect(categoryFor({ title: 'Weekend trip', category: 'security' })).toBe('security')
    expect(categoryFor({ title: 'Review Paytm Autopay PR', category: null })).toBe('code-review')
    expect(categoryFor({ title: 'Review Paytm Autopay PR', category: 'not-a-category' })).toBe('code-review')
    expect(categoryFor({ title: 'Weekend trip' })).toBe('general')
  })
})
