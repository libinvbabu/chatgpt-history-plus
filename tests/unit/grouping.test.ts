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
  it('builds the recent → month → year hierarchy: only Today starts open', () => {
    expect(headers(buildRows(entries(list), base))).toEqual([
      'Today (2)',
      'Yesterday ▸ (1)',
      'Last week ▸ (1)',
      'September 2026 ▸ (1)',
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
    expect(g('today').sublabel).toBe('Mon, Sep 28')
    expect(g('yesterday').sublabel).toBe('Sun, Sep 27')
    expect(g('last-week').sublabel).toMatch(/^Sep 20\s*–\s*26$/)
  })
  it('labels month and year groups with the span of days they hold', () => {
    const rows = buildRows(entries([...list, conv('aug later', at(2026, 8, 24))]), { ...base, collapsed: { 'y:2025': false } })
    const sub = (k: string) => (rows.find((r) => r.key === k) as Extract<Row, { type: 'group' }>).sublabel
    expect(sub('m:2026-08')).toMatch(/^Aug 19\s*–\s*24$/)
    expect(sub('m:2026-01')).toBe('Jan 2')
    expect(sub('y:2025')).toMatch(/^Nov 1\s*–\s*Dec 14,\s*2025$/)
    expect(sub('y:2025/m:2025-12')).toBe('Dec 14, 2025')
  })
  it('creates an "earlier this week" group when the week has started', () => {
    const wed = new Date(2026, 8, 30, 12) // Wednesday
    const rows = buildRows(entries([conv('mon', at(2026, 9, 28)), conv('sun', at(2026, 9, 27))]), { ...base, now: wed })
    expect(headers(rows)).toEqual(['Earlier this week ▸ (2)'])
  })
  it('respects collapse overrides and nests months inside years', () => {
    const rows = buildRows(entries(list), { ...base, collapsed: { yesterday: false, 'y:2025': false } })
    expect(headers(rows)).toContain('Yesterday (1)')
    expect(headers(rows)).toContain('  December ▸ (1)')
    expect(headers(rows)).toContain('  November ▸ (1)')
    expect(rows.some((r) => r.type === 'conversation' && r.entry.conv.title === 'yesterday')).toBe(true)
  })
  it('keeps Today open whatever was stored, and makes only Today non-collapsible', () => {
    const rows = buildRows(entries(list), { ...base, collapsed: { today: true } })
    const groups = rows.filter((r): r is Extract<Row, { type: 'group' }> => r.type === 'group')
    expect(groups[0]).toMatchObject({ key: 'today', expanded: true, collapsible: false })
    expect(groups.slice(1).every((g) => g.collapsible && !g.expanded)).toBe(true)
    expect(rows.filter((r) => r.type === 'conversation' && r.entry.conv.title.startsWith('today'))).toHaveLength(2)
  })
  it('shows only times in Today/Yesterday rows', () => {
    const open = { yesterday: false, 'last-week': false, 'm:2026-09': false }
    const rows = buildRows(entries(list), { ...base, collapsed: open }).filter((r) => r.type === 'conversation')
    expect(rows.map((r) => r.type === 'conversation' && r.timeOnly)).toEqual([true, true, true, true, false])
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

  it('gives every week group a day divider, so its rows show only a time', () => {
    const week = Array.from({ length: 9 }, (_, i) => conv(`lw ${i}`, at(2026, 9, 20 + (i % 3), 9 + i)))
    const open = { 'last-week': false }
    const rows = buildRows(entries(week), { ...base, collapsed: open })
    expect(rows.filter((r) => r.type === 'divider').map((r) => r.label)).toEqual(['Tue, Sep 22', 'Mon, Sep 21', 'Sun, Sep 20'])
    expect(rows.filter((r) => r.type === 'conversation').every((r) => r.type === 'conversation' && r.timeOnly)).toBe(true)
    // Even a single conversation: the date is in the divider, the row carries the time.
    const small = buildRows(entries(week.slice(0, 1)), { ...base, collapsed: open })
    expect(small.filter((r) => r.type === 'divider')).toHaveLength(1)
    expect(small.filter((r) => r.type === 'conversation').every((r) => r.type === 'conversation' && r.timeOnly)).toBe(true)
  })

  it('moves conversations from Today to Yesterday as midnight passes (local time)', () => {
    const late = conv('late', at(2026, 9, 28, 23, 30))
    const before = buildRows(entries([late]), { ...base, now: new Date(2026, 8, 28, 23, 59) })
    expect(headers(before)).toEqual(['Today (1)'])
    const after = buildRows(entries([late]), { ...base, now: new Date(2026, 8, 29, 0, 1) })
    expect(headers(after)).toEqual(['Yesterday ▸ (1)'])
    expect(after.find((r) => r.key === 'today')).toBeUndefined()
  })
})

describe('month grouping', () => {
  it('groups everything by calendar month; the month that holds today starts open', () => {
    expect(headers(buildRows(entries(list), { ...base, grouping: 'month' })).slice(0, 5)).toEqual([
      'September 2026 (5)',
      'August 2026 ▸ (1)',
      'January 2026 ▸ (1)',
      'December 2025 ▸ (1)',
      'November 2025 ▸ (1)',
    ])
  })
})
