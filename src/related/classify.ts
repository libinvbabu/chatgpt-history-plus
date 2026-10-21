// One category per conversation, for its icon and its filters: a primary
// category, a subcategory when the title says clearly which part of it, and a
// few secondary topic tags. Rules only: no model, no network, nothing stored.
// The vocabulary lives in taxonomy.ts.
//
// Precedence, first match wins:
//
//   1. A category stored on the conversation (an import or a future manual
//      choice), legacy ids mapped (`categoryFor`).
//   2. A title that names a PR or a review of code → Technology · PR Reviews,
//      whatever the PR is about ("TRP - Review Paytm PR").
//   3. A title that says "debug" → Technology · Debugging, whatever is being
//      debugged ("Debug hiring loop").
//   4. Scores. Every facet (a subcategory, or a primary's own vocabulary) is
//      scored by the distinct keywords it matches; known tools and providers
//      add theirs; a primary's score is the sum of its facets. A signal in
//      the head of the title (before its first preposition, else its last
//      word) adds a point: "Poster for a music festival" is about a poster.
//      The highest primary wins; ties go to the more specific reading
//      (TIE_ORDER). Then:
//      a. Planning is an activity more often than a subject. When all it has
//         is the act of planning ("plan", "organize"), any other category with
//         a clear score wins ("Plan a family trip to Kerala" → Personal,
//         "Weekly meal planning" → Personal). When it has a planning format (a
//         schedule, a checklist, a decision), a decisive subject wins ("Plan
//         the product launch checklist" → Work · Product). A planning subject
//         keeps it ("Plan my daughter's birthday party" → Planning · Events).
//      b. Payments yields to Technology when the title is about building or
//         fixing the system ("Paytm PreNotify architecture").
//      c. A message about hiring is hiring work, not writing ("Draft interview
//         heads up" → Work · Hiring).
//      d. Personal and Learning yield to a clearly technical title that scores
//         nearly as well, unless the study side is decisive too ("Health app
//         architecture" → Technology; "Python homework help" stays Learning).
//   5. General, when the best score is under 2: one weak hint is never enough.
//
// Generic faults ("not working", "broken", "fails") count toward Debugging only
// when the title is already technical, so "my washing machine is not working"
// stays out of Technology.

import { extractEntities, type Entity } from './extract'
import {
  DEBUG_VERB,
  ENTITY_FACETS,
  FACET_SIGNALS,
  FAULT_SIGNALS,
  LEGACY_CATEGORY_IDS,
  PR_REVIEW_SIGNALS,
  PRIMARY_IDS,
  SUBCATEGORIES,
  WRITING_VERB,
  type PrimaryId,
  type Signals,
} from './taxonomy'

/**
 * How sure the rules are, from the evidence they actually had:
 * - high: settled by a rule (a PR, "debug", a stored category), or a decisive
 *   keyword and a clear lead over the next category;
 * - medium: a clear lead;
 * - low: won on a tie-break, or on weak hints only;
 * - none: General, nothing to go on.
 */
export type Confidence = 'high' | 'medium' | 'low' | 'none'

export interface Classification {
  primary: PrimaryId
  /** A subcategory id from taxonomy.ts, or null when the title does not say which part. */
  sub: string | null
  /** Secondary tags: known tools and providers, then other subcategories the title touched. */
  topics: string[]
  confidence: Confidence
}

export const CONFIDENCE_RANK: Record<Confidence, number> = { none: 0, low: 1, medium: 2, high: 3 }

/** Order for ties: the more specific reading first. Planning is last because it is an activity. */
const TIE_ORDER: readonly Exclude<PrimaryId, 'general'>[] = ['technology', 'work', 'learning', 'writing', 'personal', 'creative', 'planning']

/** What Planning is *about* when it is the subject itself; its other subcategories (schedules, to-dos, decisions) are formats. */
const PLANNING_SUBJECTS = ['event-planning', 'goal-setting']

/** Below this, a title has said too little to file: it is General. */
export const MIN_SCORE = 2
const MAX_TOPICS = 5

const SUB_PARENT = new Map(SUBCATEGORIES.map((s) => [s.id, s.parent] as const))
const SUB_ORDER = new Map(SUBCATEGORIES.map((s, i) => [s.id, i] as const))
const PRIMARY_SET: ReadonlySet<string> = new Set(PRIMARY_IDS)

const primaryOf = (facet: string): PrimaryId => SUB_PARENT.get(facet) ?? (facet as PrimaryId)

const compile = (signals: Signals) => signals.map(([re, w]) => [new RegExp(re.source, 'gu'), w] as const)
const FACETS = Object.entries(FACET_SIGNALS).map(([facet, signals]) => [facet, compile(signals)] as const)
const FAULTS = compile(FAULT_SIGNALS)

/** Lower case, with punctuation as spaces: "TRP - Review Paytm PR" → "trp review paytm pr", "read-only" → "read only", "1:1" → "1 1". */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim()
}

export interface Scores {
  /** Per facet (subcategory or primary id). */
  facets: Map<string, number>
  /** Per primary: the sum of its facets. */
  primaries: Record<PrimaryId, number>
  /** Facets with a decisive (weight-3) match. */
  strong: Set<string>
}

function add(s: Scores, facet: string, n: number, strong: boolean) {
  s.facets.set(facet, (s.facets.get(facet) ?? 0) + n)
  s.primaries[primaryOf(facet)] += n
  if (strong) s.strong.add(facet)
}

export function scoreTitle(text: string, entities: readonly Entity[]): Scores {
  const s: Scores = { facets: new Map(), primaries: Object.fromEntries(PRIMARY_IDS.map((p) => [p, 0])) as Record<PrimaryId, number>, strong: new Set() }
  const inHead = headOf(text)
  const score = (facet: string, compiled: ReturnType<typeof compile>) => {
    // Each word counts once per facet: "product manager" is not also "product".
    const taken: Array<[number, number]> = []
    for (const [re, weight] of compiled) {
      const found = new Set<string>()
      let tip = false
      for (const m of text.matchAll(re)) {
        const end = m.index + m[0].length
        if (taken.some(([a, b]) => m.index < b && end > a)) continue
        taken.push([m.index, end])
        found.add(m[0])
        tip ||= weight >= 2 && inHead(m.index, m[0].length)
      }
      if (found.size) add(s, facet, weight * found.size + (tip ? 1 : 0), weight === 3)
    }
  }
  for (const [facet, compiled] of FACETS) score(facet, compiled)

  // What the extractor recognised by name.
  for (const e of entities) {
    if (e.type === 'provider') add(s, 'payments', 2, false)
    else if (e.type === 'repo' || e.type === 'issue' || e.type === 'ticket') add(s, 'technology', 2, false)
    else if (e.type === 'tech') {
      const [facet, weight] = ENTITY_FACETS[e.key.slice('tech:'.length)] ?? ['technology', 2]
      add(s, facet, weight, weight === 3)
    }
  }

  // A generic fault is a software fault only in a technical title.
  if (s.primaries.technology > 0) score('debugging', FAULTS)
  // "Write …", "Draft …": a request for a piece of writing.
  if (WRITING_VERB.test(text)) add(s, 'writing', 2, false)
  return s
}

/** Words that open a modifier: what follows says who or what the chat was for, not what it was. */
const PREPOSITIONS = new Set(['for', 'with', 'about', 'in', 'on', 'to', 'of', 'from', 'at', 'by', 'after', 'before', 'during', 'into', 'without', 'using', 'via', 'when'])

/**
 * The head of a title names what the chat was for, and a signal there tips a
 * close call by one point. With a preposition, the head is everything before
 * it ("Poster | for a music festival", "Recipes | for kids"); without one, it
 * is the last word ("Payment failure analysis", "Revenue report").
 */
function headOf(text: string): (index: number, length: number) => boolean {
  const words = text.split(' ')
  let offset = 0
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && PREPOSITIONS.has(words[i]!)) return (index) => index < offset
    offset += words[i]!.length + 1
  }
  return (index, length) => index + length === text.length
}

const result = (primary: PrimaryId, sub: string | null, confidence: Confidence, topics: string[] = []): Classification => ({ primary, sub, topics, confidence })

export function classify(title: string, entities: readonly Entity[] = extractEntities(title)): Classification {
  const text = normalizeTitle(title)
  if (!text) return result('general', null, 'none')

  const s = scoreTitle(text, entities)
  const topics = (chosen: string | null) => topicsFrom(s, entities, chosen)

  if (entities.some((e) => e.type === 'pr') || PR_REVIEW_SIGNALS.some((re) => re.test(text))) return result('technology', 'pr-reviews', 'high', topics('pr-reviews'))
  if (DEBUG_VERB.test(text)) return result('technology', 'debugging', 'high', topics('debugging'))

  const p = s.primaries
  const strongIn = (primary: PrimaryId) => [...s.strong].some((f) => primaryOf(f) === primary)
  let best = TIE_ORDER[0]!
  for (const c of TIE_ORDER) if (p[c] > p[best]) best = c
  if (p[best] < MIN_SCORE) return result('general', null, 'none', topics(null))

  let forcedSub: string | null = null
  // a. Planning yields to a subject.
  if (best === 'planning' && !PLANNING_SUBJECTS.some((f) => s.strong.has(f))) {
    // Only the act of planning: any clear subject wins. A planning format (a schedule, a checklist, a decision): a decisive subject wins.
    const needsDecisive = strongIn('planning')
    let other: PrimaryId | null = null
    for (const c of TIE_ORDER) if (c !== 'planning' && p[c] >= MIN_SCORE && (!needsDecisive || strongIn(c)) && (!other || p[c] > p[other])) other = c
    if (other) best = other
  }
  // b. Payments yields to building or fixing the payments system.
  if (best === 'work' && bestSub(s, 'work') === 'payments' && (strongIn('technology') || s.strong.has('debugging'))) best = 'technology'
  // c. A message about hiring is hiring work.
  if (best === 'writing' && s.strong.has('hiring')) {
    best = 'work'
    forcedSub = 'hiring'
  }
  // d. A technical title stays technical when it touches a personal or study subject.
  if ((best === 'personal' || best === 'learning') && strongIn('technology') && p.technology >= p[best] - 1 && !s.strong.has('exam-prep') && !strongIn('learning')) best = 'technology'

  // A clear fault in a technical title is debugging, whatever else it touches.
  const sub = forcedSub ?? (best === 'technology' && s.strong.has('debugging') ? 'debugging' : bestSub(s, best))
  return result(best, sub, confidenceOf(s, best), topics(sub))
}

/** The highest-scoring subcategory of a primary, if one scores at least MIN_SCORE. Ties go to taxonomy order. */
function bestSub(s: Scores, primary: PrimaryId): string | null {
  let best: string | null = null
  let bestScore = MIN_SCORE - 1
  for (const [facet, score] of s.facets) {
    if (SUB_PARENT.get(facet) !== primary) continue
    if (score > bestScore || (score === bestScore && best && SUB_ORDER.get(facet)! < SUB_ORDER.get(best)!)) {
      best = facet
      bestScore = score
    }
  }
  return best
}

function confidenceOf(s: Scores, best: PrimaryId): Confidence {
  const score = s.primaries[best]
  let runnerUp = 0
  for (const c of PRIMARY_IDS) if (c !== best && s.primaries[c] > runnerUp) runnerUp = s.primaries[c]
  const decisive = [...s.strong].some((f) => primaryOf(f) === best)
  if (score - runnerUp <= 0 || (!decisive && score < 3)) return 'low'
  return decisive && score - runnerUp >= 2 ? 'high' : 'medium'
}

function topicsFrom(s: Scores, entities: readonly Entity[], chosen: string | null): string[] {
  const out = new Set<string>()
  for (const e of entities) if (e.type === 'provider' || e.type === 'tech') out.add(e.key.slice(e.type.length + 1))
  const others = [...s.facets].filter(([f, n]) => n >= MIN_SCORE && f !== chosen && SUB_PARENT.has(f)).sort((a, b) => b[1] - a[1] || SUB_ORDER.get(a[0])! - SUB_ORDER.get(b[0])!)
  for (const [f] of others) out.add(f)
  return [...out].slice(0, MAX_TOPICS)
}

// ---------------------------------------------------------------------------
// Lookups for the UI: one per conversation row, so memoised by title.

const cache = new Map<string, Classification>()
const CACHE_LIMIT = 50_000

export function classifyTitle(title: string): Classification {
  let c = cache.get(title)
  if (!c) {
    if (cache.size >= CACHE_LIMIT) cache.clear()
    c = classify(title)
    cache.set(title, c)
  }
  return c
}

/** Whether the title's classification is already memoised (no work to do). */
export const isClassified = (title: string): boolean => cache.has(title)

/** A primary or subcategory id. */
export const isCategoryNodeId = (v: unknown): v is string => typeof v === 'string' && (PRIMARY_SET.has(v) || SUB_PARENT.has(v))

/** Current id for a stored category or filter id, legacy ids mapped; null when it is not ours. */
export function migrateCategoryId(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const id = Object.hasOwn(LEGACY_CATEGORY_IDS, v) ? LEGACY_CATEGORY_IDS[v]! : v
  return isCategoryNodeId(id) ? id : null
}

export const parentOf = (id: string): PrimaryId | null => SUB_PARENT.get(id) ?? (PRIMARY_SET.has(id) ? (id as PrimaryId) : null)

const stored = new Map<string, Classification>()

/** A stored category if something supplied a valid one (an import, a manual choice), else the title rules. */
export function categoryFor(conv: { title: string; category?: string | null }): Classification {
  if (conv.category) {
    const id = migrateCategoryId(conv.category)
    if (id) {
      let c = stored.get(id)
      if (!c) {
        c = SUB_PARENT.has(id) ? result(SUB_PARENT.get(id)!, id, 'high') : result(id as PrimaryId, null, 'high')
        stored.set(id, c)
      }
      return c
    }
  }
  return classifyTitle(conv.title)
}
