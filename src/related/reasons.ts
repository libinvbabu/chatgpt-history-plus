// Turns the signals that actually matched into a short hover explanation.
// Nothing here is guessed: every phrase comes from a shared entity, topic,
// activity or term between the two conversations.

import type { Activity } from './dictionary'
import type { Entity } from './extract'
import { stem, words } from './text'

export interface Matched {
  entities: Entity[]
  topics: string[]
  activity: Activity | null
  /** Shared significant stems and bigram keys, most specific first. */
  terms: string[]
  bigrams: string[]
}

const ACTIVITY_PHRASE: Record<Activity, string> = {
  code_review: 'Similar code review',
  debugging: 'Similar debugging problem',
  planning: 'Related planning discussion',
  hiring: 'Related hiring discussion',
  analytics: 'Related analytics discussion',
  writing: 'Related writing task',
  implementation: 'Similar implementation work',
}

/** stem → the word as the user wrote it in `title`, so reasons read naturally. */
function spellings(title: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const w of words(title)) if (!map.has(stem(w))) map.set(stem(w), w)
  return map
}

function readable(bigram: string, spell: Map<string, string>): string {
  const [a, b] = bigram.split('+') as [string, string]
  return `${spell.get(a) ?? a} ${spell.get(b) ?? b}`
}

const list = (items: string[]) => items.slice(0, 2).join(', ')

/** Up to two reasons, strongest first. `title` is the active conversation's title. */
export function explain(m: Matched, title: string): string[] {
  const out: string[] = []
  const of = (type: Entity['type']) => m.entities.filter((e) => e.type === type)
  const pr = of('pr')
  const issue = of('issue')
  const prn = of('prn')
  const ticket = of('ticket')
  const repo = of('repo')
  const product = of('product')
  const named = [...of('provider'), ...of('tech')]

  if (pr.length) out.push(`Same PR (${pr[0]!.label})`)
  else if (issue.length) out.push(`Same issue (${issue[0]!.label})`)
  else if (prn.length) out.push(`Same PR number (${prn[0]!.label})`)
  if (ticket.length) out.push(`Same ticket (${ticket[0]!.label})`)
  if (repo.length) out.push(`Same repository (${repo[0]!.label})`)
  if (product.length) out.push(`Same project (${product[0]!.label})`)

  const spell = spellings(title)
  if (out.length < 2 && m.bigrams.length) out.push(`Shared phrase “${readable(m.bigrams[0]!, spell)}”`)

  if (out.length < 2) {
    const parts: string[] = []
    if (named.length) parts.push(`Both about ${list(named.map((e) => e.label))}`)
    if (m.topics.length) parts.push(`Related ${m.topics.slice(0, 2).map((t) => t.replace(/-/g, ' ')).join(' & ')}`)
    else if (m.activity) parts.push(ACTIVITY_PHRASE[m.activity])
    out.push(...parts)
  }
  if (!out.length && m.terms.length) out.push(`Shared terms: ${list(m.terms.map((t) => spell.get(t) ?? t))}`)
  return out.slice(0, 2)
}
