import { describe, expect, it } from 'vitest'
import { buildRows, sortEntries } from '../../src/history/grouping'
import { makeSearchDoc, matches, parseQuery } from '../../src/history/search'
import { effectiveTime, type StoredConversation } from '../../src/history/types'
import { classify, classifyTitle } from '../../src/related/classify'
import { classificationOf, matchesFilter } from '../../src/ui/categories'
import { rankFilters, tally } from '../../src/ui/personalize'
import { countByCategory } from '../../src/ui/view'
import { ALL_LABELLED } from './fixtures/personas'
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

describe('categories at 3,000 and 10,000 conversations', () => {
  // Realistic titles, made distinct so nothing is served from the memo.
  const titles = Array.from({ length: 10_000 }, (_, i) => `${ALL_LABELLED[i % ALL_LABELLED.length]!.title} ${Math.floor(i / ALL_LABELLED.length) || ''}`.trim())
  const entries = titles.map((title, i) => {
    const ts = NOW.getTime() - i * 3_600_000
    return { conv: { id: `k${i}`, title, createdAt: ts, updatedAt: ts, cachedAt: 0 } as StoredConversation, ts }
  })
  const time = (fn: () => void, runs = 5) => {
    fn()
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) fn()
    return (performance.now() - t0) / runs
  }

  it('classifies a new title in well under a millisecond (done once, in background slices)', () => {
    const sample = titles.slice(0, 2000).map((t) => `${t} x`)
    const t0 = performance.now()
    for (const t of sample) classify(t)
    const perTitle = (performance.now() - t0) / sample.length
    expect(perTitle).toBeLessThan(0.25)
    console.info(`classify: ${(perTitle * 1000).toFixed(0)} µs per title, cold`)
  })

  it('counts, filters and personalises from the memo fast enough to feel instant', () => {
    for (const t of titles) classifyTitle(t) // what the app's background pass does after a sync
    const report: string[] = []
    for (const n of [3_000, 10_000]) {
      const slice = entries.slice(0, n)
      const count = time(() => countByCategory(slice))
      const filter = time(() => slice.filter((e) => matchesFilter(classificationOf(e.conv), 'technology')))
      const choose = time(() => rankFilters(tally(slice.map((e) => classificationOf(e.conv)))))
      report.push(`${n}: count ${count.toFixed(2)} ms, filter ${filter.toFixed(2)} ms, personalise ${choose.toFixed(2)} ms`)
      expect(count + filter, `${n} count+filter`).toBeLessThan(n === 3_000 ? 10 : 30)
      expect(choose, `${n} personalise`).toBeLessThan(n === 3_000 ? 10 : 30)
    }
    console.info(report.join('\n'))
  })
})
