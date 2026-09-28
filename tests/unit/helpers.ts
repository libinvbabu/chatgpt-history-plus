import type { StoredConversation } from '../../src/history/types'

/** Monday 28 Sep 2026, 3 PM local time. */
export const NOW = new Date(2026, 8, 28, 15, 0)
export const ctx = { now: NOW, weekStartsOn: 0, locale: 'en-US' }

export const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

let seq = 0
export function conv(title: string, updatedAt: number | null, createdAt: number | null = updatedAt, extra: Partial<StoredConversation> = {}): StoredConversation {
  seq++
  return { id: `id-${seq}`, title, createdAt, updatedAt, cachedAt: 0, ...extra }
}
