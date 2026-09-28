import { describe, expect, it } from 'vitest'
import { highlightRanges, makeSearchDoc, matches, parseQuery } from '../../src/history/search'
import { at, conv, ctx } from './helpers'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime()

function search(q: string, list: ReturnType<typeof conv>[], literal = false) {
  const parsed = parseQuery(q, ctx, { literal })
  return list.filter((c) => matches(c, makeSearchDoc(c.title), parsed, 'updated')).map((c) => c.title)
}

const list = [
  conv('Duplicate Paytm debit investigation', at(2026, 9, 28)),
  conv('Paytm PreNotify architecture', at(2026, 9, 18)),
  conv('Paytm reconciliation', at(2026, 8, 24), at(2026, 7, 2)),
  conv('Review PR #997', at(2026, 9, 25)),
  conv('C++ templates', at(2026, 9, 1)),
  conv('Café menu ideas', at(2026, 3, 3)),
  conv('March madness bracket', at(2025, 3, 20)),
  conv('किसान ऐप डिज़ाइन', at(2026, 9, 10)),
  conv('Budget 2026', at(2025, 11, 1)),
]

describe('title search', () => {
  it('matches all words, case-insensitively', () => {
    expect(search('paytm', list)).toEqual(['Duplicate Paytm debit investigation', 'Paytm PreNotify architecture', 'Paytm reconciliation'])
    expect(search('PAYTM debit', list)).toEqual(['Duplicate Paytm debit investigation'])
  })
  it('ignores punctuation and diacritics', () => {
    expect(search('pr 997', list)).toEqual(['Review PR #997'])
    expect(search('pr#997', list)).toEqual(['Review PR #997'])
    expect(search('cafe', list)).toEqual(['Café menu ideas'])
  })
  it('keeps punctuation-only terms precise', () => {
    expect(search('c++', list)).toEqual(['C++ templates'])
  })
  it('keeps Indic combining marks intact', () => {
    expect(search('किसान', list)).toEqual(['किसान ऐप डिज़ाइन'])
  })
})

describe('date understanding', () => {
  it('treats a whole-query date phrase as a date filter', () => {
    const q = parseQuery('sep 2026', ctx)
    expect(q.terms).toEqual([])
    expect(q.inferredDate).toBe('sep 2026')
    expect(q.ranges[0]).toMatchObject({ field: 'active', start: d(2026, 9, 1), end: d(2026, 10, 1) })
  })
  it('reads trailing and leading date phrases when unambiguous', () => {
    expect(search('paytm last week', list)).toEqual([])
    expect(search('paytm in aug', list)).toEqual(['Paytm reconciliation'])
    expect(search('sep 2026 paytm', list)).toEqual(['Duplicate Paytm debit investigation', 'Paytm PreNotify architecture'])
    expect(search('paytm since sep 10', list)).toEqual(['Duplicate Paytm debit investigation', 'Paytm PreNotify architecture'])
  })
  it('leaves ambiguous words as title text', () => {
    expect(parseQuery('march madness', ctx).ranges).toEqual([])
    expect(search('budget 2026', list)).toEqual(['Budget 2026'])
    expect(search('march madness', list)).toEqual(['March madness bracket'])
  })
  it('can be forced literal', () => {
    expect(search('march', list, true)).toEqual(['March madness bracket'])
    expect(search('"march"', list)).toEqual(['March madness bracket'])
  })
  it('supports operators', () => {
    expect(search('paytm after:2026-09-01', list)).toEqual(['Duplicate Paytm debit investigation', 'Paytm PreNotify architecture'])
    expect(search('paytm before:2026-09-20', list)).toEqual(['Paytm PreNotify architecture', 'Paytm reconciliation'])
    expect(search('paytm in:sep', list)).toEqual(['Duplicate Paytm debit investigation', 'Paytm PreNotify architecture'])
    expect(search('created:2026-07', list)).toEqual(['Paytm reconciliation'])
    expect(search('updated:last-week', list)).toEqual(['Review PR #997'])
    expect(search('year:2025', list)).toEqual(['March madness bracket', 'Budget 2026'])
    expect(search('month:mar year:2025', list)).toEqual(['March madness bracket'])
    expect(search('in:"sep 2026" paytm', list)).toEqual(['Duplicate Paytm debit investigation', 'Paytm PreNotify architecture'])
  })
  it('warns on unreadable operator values', () => {
    expect(parseQuery('after:someday', ctx).warnings).toHaveLength(1)
  })
  it('does not treat unknown key:value as an operator', () => {
    expect(parseQuery('http://example.com', ctx).terms).toHaveLength(1)
  })
})

describe('highlightRanges', () => {
  it('marks every occurrence and merges overlaps', () => {
    expect(highlightRanges('Paytm vs paytm', parseQuery('paytm', ctx).terms)).toEqual([[0, 5], [9, 14]])
    expect(highlightRanges('Review PR #997', parseQuery('pr#997', ctx).terms)).toEqual([[7, 9], [11, 14]])
  })
})
