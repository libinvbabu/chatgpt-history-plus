import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildRows, sortEntries } from '../../src/history/grouping'
import { conv } from './helpers'

const original = process.env.TZ
afterEach(() => {
  if (original === undefined) delete process.env.TZ
  else process.env.TZ = original
})

/** Switch the process timezone; skip if the runtime ignores it. */
function useZone(tz: string): boolean {
  process.env.TZ = tz
  const offset = new Date(Date.UTC(2026, 9, 16, 12)).getTimezoneOffset()
  const expected = tz === 'Asia/Kolkata' ? -330 : tz === 'America/Los_Angeles' ? 420 : 0
  return offset === expected
}

// The same two instants, seen from two places:
//   now   2026-10-16 08:00 UTC  →  13:30 on Oct 16 in Kolkata,  01:00 on Oct 16 in Los Angeles
//   chat  2026-10-16 03:00 UTC  →  08:30 on Oct 16 in Kolkata,  20:00 on Oct 15 in Los Angeles
const NOW = Date.UTC(2026, 9, 16, 8)
const CHAT = Date.UTC(2026, 9, 16, 3)

const groupOf = (tz: string) => {
  const c = conv('chat', CHAT)
  const rows = buildRows(sortEntries([{ conv: c, ts: CHAT }]), { now: new Date(NOW), grouping: 'smart', weekStartsOn: 0, locale: 'en-US', collapsed: {} })
  return rows.find((r) => r.type === 'group')?.key
}

describe('local timezone', () => {
  it('groups by the viewer’s own calendar day', () => {
    if (!useZone('Asia/Kolkata')) return
    expect(groupOf('Asia/Kolkata')).toBe('today')
    useZone('America/Los_Angeles')
    expect(groupOf('America/Los_Angeles')).toBe('yesterday')
  })

  it('shows times in the viewer’s timezone, 24-hour', async () => {
    // Formatters are cached with the zone they were created in, so load a fresh copy per zone.
    const inZone = async (tz: string) => {
      if (!useZone(tz)) return null
      vi.resetModules()
      return import('../../src/utils/dates')
    }
    const ist = await inZone('Asia/Kolkata')
    if (!ist) return
    expect(ist.formatRowTime(CHAT, true, 'relative', new Date(NOW), 'en-US')).toBe('08:30')
    expect(ist.formatDateTime(CHAT, new Date(NOW), 'en-US')).toBe('Oct 16 · 08:30')
    const la = await inZone('America/Los_Angeles')
    expect(la!.formatRowTime(CHAT, true, 'relative', new Date(NOW), 'en-US')).toBe('20:00')
    expect(la!.formatDateTime(CHAT, new Date(NOW), 'en-US')).toBe('Oct 15 · 20:00')
  })
})
