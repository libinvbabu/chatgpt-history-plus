import { describe, expect, it } from 'vitest'
import { parseDatePhrase } from '../../src/history/date-query'
import { ctx } from './helpers'

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime()
const range = (s: string) => {
  const p = parseDatePhrase(s, ctx)
  return p ? [p.range.start, p.range.end] : null
}

describe('parseDatePhrase', () => {
  it('handles relative keywords', () => {
    expect(range('today')).toEqual([d(2026, 9, 28), d(2026, 9, 29)])
    expect(range('Yesterday')).toEqual([d(2026, 9, 27), d(2026, 9, 28)])
    expect(range('this week')).toEqual([d(2026, 9, 27), d(2026, 10, 4)])
    expect(range('last week')).toEqual([d(2026, 9, 20), d(2026, 9, 27)])
    expect(range('last month')).toEqual([d(2026, 8, 1), d(2026, 9, 1)])
    expect(range('this year')).toEqual([d(2026, 1, 1), d(2027, 1, 1)])
    expect(range('last year')).toEqual([d(2025, 1, 1), d(2026, 1, 1)])
  })
  it('handles rolling windows', () => {
    expect(range('last 7 days')).toEqual([d(2026, 9, 22), d(2026, 9, 29)])
    expect(range('past 2 weeks')).toEqual([d(2026, 9, 15), d(2026, 9, 29)])
    expect(range('past week')).toEqual([d(2026, 9, 22), d(2026, 9, 29)])
    expect(range('past month')).toEqual([d(2026, 8, 29), d(2026, 9, 29)])
  })
  it('handles weekdays as the most recent past one', () => {
    expect(range('tuesday')).toEqual([d(2026, 9, 22), d(2026, 9, 23)])
    expect(range('last monday')).toEqual([d(2026, 9, 21), d(2026, 9, 22)]) // today is Monday
    expect(range('sun')).toEqual([d(2026, 9, 27), d(2026, 9, 28)])
  })
  it('handles months, resolving to the most recent occurrence', () => {
    expect(range('sep')).toEqual([d(2026, 9, 1), d(2026, 10, 1)])
    expect(range('August')).toEqual([d(2026, 8, 1), d(2026, 9, 1)])
    expect(range('december')).toEqual([d(2025, 12, 1), d(2026, 1, 1)])
    expect(range('Sep 2026')).toEqual([d(2026, 9, 1), d(2026, 10, 1)])
    expect(range('2025 dec')).toEqual([d(2025, 12, 1), d(2026, 1, 1)])
  })
  it('handles days in several spellings', () => {
    expect(range('Sep 23')).toEqual([d(2026, 9, 23), d(2026, 9, 24)])
    expect(range('23 sep')).toEqual([d(2026, 9, 23), d(2026, 9, 24)])
    expect(range('23rd of September')).toEqual([d(2026, 9, 23), d(2026, 9, 24)])
    expect(range('Sep 23, 2025')).toEqual([d(2025, 9, 23), d(2025, 9, 24)])
    expect(range('oct 3')).toEqual([d(2025, 10, 3), d(2025, 10, 4)]) // not in the future
    expect(range('2026-09-23')).toEqual([d(2026, 9, 23), d(2026, 9, 24)])
    expect(range('2026/9/3')).toEqual([d(2026, 9, 3), d(2026, 9, 4)])
  })
  it('handles years and ISO months', () => {
    expect(range('2026')).toEqual([d(2026, 1, 1), d(2027, 1, 1)])
    expect(range('2026-08')).toEqual([d(2026, 8, 1), d(2026, 9, 1)])
  })
  it('handles fuzzy and composite phrases', () => {
    expect(range('around sep 14')).toEqual([d(2026, 9, 11), d(2026, 9, 18)])
    expect(range('mid aug')).toEqual([d(2026, 8, 11), d(2026, 8, 21)])
    expect(range('late feb 2024')).toEqual([d(2024, 2, 21), d(2024, 3, 1)])
    expect(range('week of aug 19')).toEqual([d(2026, 8, 16), d(2026, 8, 23)])
    expect(range('aug 17 - 23')).toEqual([d(2026, 8, 17), d(2026, 8, 24)])
    expect(range('aug 17-23')).toEqual([d(2026, 8, 17), d(2026, 8, 24)])
    expect(range('aug 17 to sep 2')).toEqual([d(2026, 8, 17), d(2026, 9, 3)])
    expect(range('dec 20 – jan 5')).toEqual([d(2025, 12, 20), d(2026, 1, 6)])
    expect(range('2026-08-01 to 2026-08-15')).toEqual([d(2026, 8, 1), d(2026, 8, 16)])
  })
  it('rejects things that are not dates', () => {
    for (const s of ['', 'paytm', 'review pr 997', 'feb 30', '2026-13', '1850', 'mayday', 'sep 2026 budget', '997', 'march madness']) {
      expect(range(s), s).toBeNull()
    }
  })
  it('produces readable labels', () => {
    expect(parseDatePhrase('last week', ctx)!.label).toMatch(/^Last week · Sep 20\s*–\s*26$/)
    expect(parseDatePhrase('aug', ctx)!.label).toBe('August 2026')
    expect(parseDatePhrase('sep 23', ctx)!.label).toBe('Wed, Sep 23, 2026')
    expect(parseDatePhrase('2025', ctx)!.label).toBe('2025')
  })
})
