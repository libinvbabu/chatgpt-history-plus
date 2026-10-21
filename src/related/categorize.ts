// One category per conversation, for its icon and its filter chip. Rules only:
// no model, no network, nothing stored. Precedence:
//
//   1. A category stored on the conversation (an import or a future manual
//      choice) — handled by `categoryFor` in extract.ts, before this runs.
//   2. Message content and metadata — History+ keeps titles only, so today
//      this is the extracted entities (PR and repo references, providers, tools).
//   3. The title, scored against CATEGORY_SIGNALS in dictionary.ts.
//   4. "general" (shown as Other) when nothing scores with confidence.
//
// A title that names a PR, or a review of code, is a PR review whatever it is
// about. Every other category is scored by the distinct keywords it matches,
// then a few rules settle the ambiguous cases the scores alone get wrong.

import { ANALYTICS_TOOLS, CATEGORY_SIGNALS, PRODUCT_TOOLS, PR_REVIEW_SIGNALS, type CategoryId } from './dictionary'
import type { Entity } from './extract'

type Scored = Exclude<CategoryId, 'code-review'>

/** Order for ties: the more specific reading first. "general" beats only "product", so a lone "plan" or "ideas" loses to a trip. */
const TIE_ORDER: readonly Scored[] = ['debugging', 'security', 'engineering', 'people', 'analytics', 'writing', 'payments', 'general', 'product']

/** Below this, a title has said too little to file; it is "general" (Other). A single hint (weight 1) is never enough. */
const MIN_SCORE = 2

const COMPILED = Object.entries(CATEGORY_SIGNALS).map(([cat, signals]) => [cat as Scored, signals.map(([re, w]) => [new RegExp(re.source, 'gu'), w] as const)] as const)

/** Lower case, with punctuation as spaces: "TRP - Review Paytm PR" → "trp review paytm pr", "read-only" → "read only", "1:1" → "1 1". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim()
}

export interface CategoryScores {
  scores: Record<Scored, number>
  /** Categories with a weight-3 match: a signal that settles the subject on its own. */
  strong: Set<Scored>
}

export function scoreTitle(title: string, entities: readonly Entity[] = []): CategoryScores {
  const text = normalizeTitle(title)
  const scores = Object.fromEntries(TIE_ORDER.map((c) => [c, 0])) as Record<Scored, number>
  const strong = new Set<Scored>()
  // The last word usually names what was done ("… analysis", "… report"); it tips a close call.
  const last = text.split(' ').at(-1) ?? ''

  for (const [cat, signals] of COMPILED) {
    for (const [re, weight] of signals) {
      const found = new Set(text.match(re) ?? [])
      if (!found.size) continue
      scores[cat] += weight * found.size
      if (weight === 3) strong.add(cat)
      if (weight >= 2 && found.has(last)) scores[cat] += 1
    }
  }

  // What the extractor recognised by name.
  for (const e of entities) {
    if (e.type === 'provider') scores.payments += 2
    else if (e.type === 'repo' || e.type === 'issue' || e.type === 'ticket') scores.engineering += 2
    else if (e.type === 'tech') {
      const id = e.key.slice('tech:'.length)
      if (ANALYTICS_TOOLS.has(id)) (scores.analytics += 3), strong.add('analytics')
      else if (PRODUCT_TOOLS.has(id)) scores.product += 2
      else scores.engineering += 2
    }
  }
  return { scores, strong }
}

export function categorize(title: string, entities: readonly Entity[] = []): CategoryId {
  const text = normalizeTitle(title)
  if (!text) return 'general'

  // 1. Reviewing a PR or code outranks whatever the PR is about.
  if (entities.some((e) => e.type === 'pr') || PR_REVIEW_SIGNALS.some((re) => re.test(text))) return 'code-review'

  const { scores, strong } = scoreTitle(title, entities)
  let best: Scored = TIE_ORDER[0]!
  for (const c of TIE_ORDER) if (scores[c] > scores[best]) best = c
  if (scores[best] < MIN_SCORE) return 'general'

  // Payments only when payments is the point: building or fixing the system is engineering.
  if (best === 'payments' && (strong.has('debugging') || strong.has('engineering'))) best = scores.debugging >= scores.engineering ? 'debugging' : 'engineering'
  // A clear fault in a technical title is debugging, not just engineering.
  if (best === 'engineering' && strong.has('debugging')) best = 'debugging'
  // A message about hiring is hiring work ("Draft interview heads up").
  if (best === 'writing' && strong.has('people')) best = 'people'
  return best
}
