import { describe, expect, it } from 'vitest'
import { buildRows, sortEntries } from '../../src/history/grouping'
import { makeSearchDoc, matches, parseQuery } from '../../src/history/search'
import { effectiveTime, type StoredConversation } from '../../src/history/types'
import { NOW, ctx } from './helpers'

const WORDS = ['paytm', 'review', 'design', 'meta', 'sync', 'hiring', 'budget', 'notes', 'api', 'plan', 'debug', 'kisan', 'launch', 'ideas', 'retro']

describe('performance at 10,000 conversations', () => {
  const convs: StoredConversation[] = Array.from({ length: 10_000 }, (_, i) => {
    const ts = NOW.getTime() - i * 3_600_000 * 3
    return { id: `c${i}`, title: `${WORDS[i % 15]} ${WORDS[(i * 7) % 15]} ${i}`, createdAt: ts, updatedAt: ts, cachedAt: 0 }
  })
  const docs = convs.map((c) => makeSearchDoc(c.title))

  it('filters + groups a keystroke well under 50 ms', () => {
    const run = (q: string) => {
      const parsed = parseQuery(q, ctx)
      const entries = []
      for (let i = 0; i < convs.length; i++) if (matches(convs[i]!, docs[i]!, parsed, 'updated')) entries.push({ conv: convs[i]!, ts: effectiveTime(convs[i]!, 'updated') })
      return buildRows(sortEntries(entries), { now: NOW, grouping: 'smart', weekStartsOn: 0, locale: 'en-US', collapsed: {}, expandAll: true })
    }
    run('warm up')
    const t0 = performance.now()
    for (const q of ['p', 'pa', 'pay', 'payt', 'paytm', 'paytm review', 'paytm last month']) run(q)
    const perQuery = (performance.now() - t0) / 7
    expect(perQuery).toBeLessThan(50)
  })
})
