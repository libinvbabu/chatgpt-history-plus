import { describe, expect, it } from 'vitest'
import { buildRows, sortEntries, type Entry, type Row } from '../../src/history/grouping'
import { effectiveTime } from '../../src/history/types'
import { NOW, at, conv } from './helpers'

function entries(list: ReturnType<typeof conv>[]): Entry[] {
  return sortEntries(list.map((c) => ({ conv: c, ts: effectiveTime(c, 'updated') })))
}

const headers = (rows: Row[]) => rows.filter((r) => r.type === 'group').map((r) => `${r.level ? '  ' : ''}${r.label}${r.type === 'group' && r.expanded ? '' : ' ▸'} (${r.count})`)

const base = { now: NOW, grouping: 'smart' as const, weekStartsOn: 0, locale: 'en-US', collapsed: {} }

const list = [
  conv('today a', at(2026, 9, 28, 10, 5)),
  conv('today b', at(2026, 9, 28, 9, 1)),
  conv('yesterday', at(2026, 9, 27, 12, 4)),
  conv('last week', at(2026, 9, 22)),
  conv('earlier september', at(2026, 9, 5)),
  conv('august', at(2026, 8, 19)),
  conv('january', at(2026, 1, 2)),
  conv('last december', at(2025, 12, 14)),
  conv('last november', at(2025, 11, 1)),
  conv('2024', at(2024, 6, 1)),
  conv('no date', null),
]

describe('smart grouping', () => {
  it('builds the recent → month → year hierarchy with sensible defaults', () => {
    expect(headers(buildRows(entries(list), base))).toEqual([
      'Today (2)',
      'Yesterday (1)',
      'Last week (1)',
      'September 2026 (1)',
      'August 2026 ▸ (1)',
      'January 2026 ▸ (1)',
      '2025 ▸ (2)',
      '2024 ▸ (1)',
      'Unknown date ▸ (1)',
    ])
  })
  it('labels recent groups with their dates', () => {
    const rows = buildRows(entries(list), base)
    const g = (k: string) => rows.find((r) => r.key === k) as Extract<Row, { type: 'group' }>
    expect(g('yesterday').sublabel).toBe('Sun, Sep 27')
    expect(g('last-week').sublabel).toMatch(/^Sep 20\s*–\s*26$/)
  })
  it('creates an "earlier this week" group when the week has started', () => {
    const wed = new Date(2026, 8, 30, 12) // Wednesday
    const rows = buildRows(entries([conv('mon', at(2026, 9, 28)), conv('sun', at(2026, 9, 27))]), { ...base, now: wed })
    expect(headers(rows)).toEqual(['Earlier this week (2)'])
  })
  it('respects collapse overrides and nests months inside years', () => {
    const rows = buildRows(entries(list), { ...base, collapsed: { today: true, 'y:2025': false } })
    expect(headers(rows).slice(0, 1)).toEqual(['Today ▸ (2)'])
    expect(headers(rows)).toContain('  December ▸ (1)')
    expect(headers(rows)).toContain('  November ▸ (1)')
    expect(rows.some((r) => r.type === 'conversation' && r.entry.conv.title === 'today a')).toBe(false)
  })
  it('shows only times in Today/Yesterday rows', () => {
    const rows = buildRows(entries(list), base).filter((r) => r.type === 'conversation')
    expect(rows.map((r) => r.type === 'conversation' && r.timeOnly)).toEqual([true, true, true, false, false])
  })
  it('expands everything by default for search results, still honouring overrides', () => {
    const rows = buildRows(entries(list), { ...base, expandAll: true })
    expect(rows.filter((r) => r.type === 'conversation')).toHaveLength(list.length)
    const some = buildRows(entries(list), { ...base, expandAll: true, collapsed: { 'y:2025': true } })
    expect(some.filter((r) => r.type === 'conversation')).toHaveLength(list.length - 2)
  })
  it('adds week dividers to large month groups', () => {
    const aug = Array.from({ length: 12 }, (_, i) => conv(`aug ${i}`, at(2026, 8, 1 + i * 2)))
    const rows = buildRows(entries(aug), { ...base, collapsed: { 'm:2026-08': false } })
    const dividers = rows.filter((r) => r.type === 'divider').map((r) => r.label)
    expect(dividers[0]).toMatch(/^Aug 23\s*–\s*29$/)
    expect(dividers.at(-1)).toMatch(/^Jul 26\s*–\s*Aug 1$/)
    expect(rows[0]).toMatchObject({ type: 'group', label: 'August 2026', count: 12 })
  })

  it('adds day dividers to large week groups and drops the repeated date from rows', () => {
    const week = Array.from({ length: 9 }, (_, i) => conv(`lw ${i}`, at(2026, 9, 20 + (i % 3), 9 + i)))
    const rows = buildRows(entries(week), base)
    expect(rows.filter((r) => r.type === 'divider').map((r) => r.label)).toEqual(['Tue, Sep 22', 'Mon, Sep 21', 'Sun, Sep 20'])
    expect(rows.filter((r) => r.type === 'conversation').every((r) => r.type === 'conversation' && r.timeOnly)).toBe(true)
    const small = buildRows(entries(week.slice(0, 3)), base)
    expect(small.some((r) => r.type === 'divider')).toBe(false)
    expect(small.filter((r) => r.type === 'conversation').some((r) => r.type === 'conversation' && r.timeOnly)).toBe(false)
  })
})

describe('month grouping', () => {
  it('groups everything by calendar month', () => {
    expect(headers(buildRows(entries(list), { ...base, grouping: 'month' })).slice(0, 5)).toEqual([
      'September 2026 (5)',
      'August 2026 ▸ (1)',
      'January 2026 ▸ (1)',
      'December 2025 ▸ (1)',
      'November 2025 ▸ (1)',
    ])
  })
})
