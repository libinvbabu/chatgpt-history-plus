// The local "related conversations" engine.
//
// What it works from: the conversation titles and timestamps History+ already
// syncs, turned into a small in-memory inverted index (stems, adjacent-word
// pairs, entities, topics). Message text is not captured by History+, so
// today's index is title-only; `setContent` accepts content-derived signals
// from a future capture or export importer, and those documents match more
// freely. Nothing here makes a network call, and nothing is persisted, so
// "Clear local data" and sign-out cover it by construction.
//
// Pipeline:  plan() diffs the history against the index → step() extracts and
// posts changed titles in time-boxed slices → related() retrieves candidates
// from postings, scores them, applies an evidence gate and threshold, dedupes.

import type { ConversationMetadata, HistoryIndex } from '../history/types'
import type { Activity, EntityType } from './dictionary'
import { extract, extractEntities, type Entity, type Extracted } from './extract'
import { explain, type Matched } from './reasons'
import { isGeneric, tokenize, stem } from './text'
import { fold } from '../utils/normalize'

const DAY_MS = 86_400_000

/** How much a conversation is known: nothing extractable, title-derived metadata, or message content. */
export type IndexLevel = 'title' | 'metadata' | 'content'

/** Starting weights, tuned against tests/unit/related.test.ts. */
export const WEIGHTS = { entities: 0.4, topics: 0.25, text: 0.25, recency: 0.1 } as const

/**
 * Text similarity (TF-IDF cosine, 0–1) a pair needs when text is the *only*
 * evidence, by how well both chats are known. Titles alone are short and
 * ambiguous, so they have to be near-duplicates; message content can be looser.
 */
export const TEXT_ONLY_MIN = { title: 0.45, metadata: 0.38, content: 0.3 } as const

/** How strongly sharing one entity of each type suggests the same subject. */
const ENTITY_STRENGTH: Record<EntityType, number> = { pr: 1, issue: 1, ticket: 1, prn: 0.75, repo: 0.6, product: 0.6, provider: 0.35, tech: 0.2 }
/** Entities that identify one thing; the rest (provider, tech, …) are less meaningful the more common they are. */
const EXACT: ReadonlySet<EntityType> = new Set(['pr', 'issue', 'ticket', 'prn'])
/** Types strong enough on their own to open the evidence gate. */
const STRONG: ReadonlySet<EntityType> = new Set(['pr', 'issue', 'ticket', 'prn', 'repo', 'product'])

const RECENCY_HALF_LIFE_DAYS = 180
/** A posting list longer than this share of the history is too common to retrieve candidates from. */
const RETRIEVAL_MAX_DF_SHARE = 0.08
const MAX_CANDIDATES_PER_TERM = 2500
const NEAR_DUPLICATE = 0.85
const CACHE_SIZE = 64

export interface ContentSignals {
  /** Hash of the source text; unchanged hash means nothing to re-index. */
  hash: string
  entities: Entity[]
  topics: string[]
  stems: string[]
  bigrams: string[]
}

interface Doc {
  num: number
  id: string
  title: string
  level: IndexLevel
  x: Extracted
  /** Keys this document is posted under. */
  keys: string[]
  time: number | null
}

export interface Related {
  id: string
  /** 0–1; relevance plus a modest recency bonus. */
  score: number
  /** Short explanations derived from what actually matched; shown on hover only. */
  reasons: string[]
  level: IndexLevel
}

export interface RelatedOptions {
  limit?: number
  /** Title of the active chat when it is not in the history yet (new, unsynced). */
  activeTitle?: string
  now?: number
}

export interface EngineStats {
  docs: number
  title: number
  metadata: number
  content: number
  keys: number
  version: number
}

const topicKey = (t: string) => `t:${t}`
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const noisyOr = (ps: number[]) => 1 - ps.reduce((acc, p) => acc * (1 - clamp(p, 0, 1)), 1)
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function keysOf(x: Extracted): string[] {
  return [...x.stems, ...x.bigrams, ...x.entities.map((e) => e.key), ...x.topics.map(topicKey)]
}

export class RelatedEngine {
  /** Bumps whenever documents are added, removed or re-indexed; keys the result cache. */
  version = 0

  private docs = new Map<string, Doc>()
  private byNum: Array<Doc | undefined> = []
  private freeNums: number[] = []
  private postings = new Map<string, Set<number>>()
  private activityCount = new Map<Activity, number>()
  private content = new Map<string, ContentSignals>()
  private queue: ConversationMetadata[] = []
  private cursor = 0
  private dirty = false
  private cache = new Map<string, Related[]>()

  // -------------------------------------------------------------------------
  // Indexing

  /**
   * Compare the history with the index and queue what changed. Cheap (one pass,
   * no extraction): unchanged titles only refresh their timestamp.
   */
  plan(index: HistoryIndex | null): void {
    this.queue = []
    this.cursor = 0
    if (!index) {
      if (this.docs.size) this.reset()
      return
    }
    const seen = new Set<string>()
    for (const c of Object.values(index.conversations)) {
      seen.add(c.id)
      const d = this.docs.get(c.id)
      if (d && d.title === c.title) d.time = c.updatedAt ?? c.createdAt
      else this.queue.push(c)
    }
    for (const id of [...this.docs.keys()]) {
      if (!seen.has(id)) {
        this.remove(id)
        this.content.delete(id)
        this.dirty = true
      }
    }
    if (!this.queue.length && this.dirty) this.finish()
  }

  /** Index queued conversations for up to `budgetMs`. Returns true while work remains. */
  step(budgetMs: number): boolean {
    const deadline = now() + budgetMs
    let n = 0
    while (this.cursor < this.queue.length) {
      const c = this.queue[this.cursor++]!
      this.upsert(c.id, c.title, c.updatedAt ?? c.createdAt)
      this.dirty = true
      if ((++n & 7) === 0 && now() > deadline) break
    }
    if (this.cursor < this.queue.length) return true
    this.queue = []
    this.cursor = 0
    if (this.dirty) this.finish()
    return false
  }

  /** Index everything now. For tests and small histories; the app uses time-boxed `step`. */
  indexAll(index: HistoryIndex | null): void {
    this.plan(index)
    while (this.step(50)) {
      // keep going
    }
  }

  reset(): void {
    this.docs.clear()
    this.byNum = []
    this.freeNums = []
    this.postings.clear()
    this.activityCount.clear()
    this.content.clear()
    this.queue = []
    this.cursor = 0
    this.finish()
  }

  /**
   * Attach content-derived signals to a conversation (from an opt-in capture or
   * an export importer). Skipped when the hash is unchanged. Re-index is local
   * to that one conversation.
   */
  setContent(id: string, signals: ContentSignals): void {
    const d = this.docs.get(id)
    if (this.content.get(id)?.hash === signals.hash) return
    this.content.set(id, signals)
    if (d) {
      this.upsert(id, d.title, d.time)
      this.finish()
    }
  }

  clearContent(id: string): void {
    const d = this.docs.get(id)
    if (!this.content.delete(id) || !d) return
    this.upsert(id, d.title, d.time)
    this.finish()
  }

  stats(): EngineStats {
    const s: EngineStats = { docs: this.docs.size, title: 0, metadata: 0, content: 0, keys: this.postings.size, version: this.version }
    for (const d of this.docs.values()) s[d.level]++
    return s
  }

  private finish() {
    this.dirty = false
    this.version++
    this.cache.clear()
  }

  private upsert(id: string, title: string, time: number | null) {
    const prev = this.docs.get(id)
    if (prev) this.unpost(prev)
    const own = extract(title)
    const sig = this.content.get(id)
    const x = sig ? merge(own, sig) : own
    const level: IndexLevel = sig ? 'content' : x.entities.length || x.topics.length || x.activity ? 'metadata' : 'title'
    const num = prev?.num ?? this.freeNums.pop() ?? this.byNum.length
    const doc: Doc = { num, id, title, level, x, keys: keysOf(x), time }
    this.docs.set(id, doc)
    this.byNum[num] = doc
    this.post(doc)
  }

  private remove(id: string) {
    const d = this.docs.get(id)
    if (!d) return
    this.unpost(d)
    this.docs.delete(id)
    this.byNum[d.num] = undefined
    this.freeNums.push(d.num)
  }

  private post(d: Doc) {
    for (const k of d.keys) {
      let set = this.postings.get(k)
      if (!set) this.postings.set(k, (set = new Set()))
      set.add(d.num)
    }
    if (d.x.activity) this.activityCount.set(d.x.activity, (this.activityCount.get(d.x.activity) ?? 0) + 1)
  }

  private unpost(d: Doc) {
    for (const k of d.keys) {
      const set = this.postings.get(k)
      set?.delete(d.num)
      if (set && !set.size) this.postings.delete(k)
    }
    if (d.x.activity) this.activityCount.set(d.x.activity, (this.activityCount.get(d.x.activity) ?? 1) - 1)
  }

  // -------------------------------------------------------------------------
  // Retrieval and ranking

  related(activeId: string | null, opts: RelatedOptions = {}): Related[] {
    const limit = opts.limit ?? 10
    const at = opts.now ?? Date.now()
    const own = activeId ? this.docs.get(activeId) : undefined
    const title = own?.title ?? opts.activeTitle ?? ''
    const cacheKey = `${activeId ?? ''}|${own ? '' : title}|${limit}|${this.version}|${Math.floor(at / DAY_MS)}`
    const hit = this.cache.get(cacheKey)
    if (hit) return hit

    let query: { x: Extracted; level: IndexLevel } | null = null
    if (own) query = { x: own.x, level: own.level }
    else if (title.trim()) {
      const x = extract(title)
      query = { x, level: x.entities.length || x.topics.length || x.activity ? 'metadata' : 'title' }
    }
    const out = query ? this.rank(query.x, query.level, title, own?.num, limit, at) : []
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!)
    this.cache.set(cacheKey, out)
    return out
  }

  private df(key: string): number {
    return this.postings.get(key)?.size ?? 0
  }

  private idf(key: string): number {
    const n = this.docs.size
    const df = this.df(key)
    return Math.log(1 + (n - df + 0.5) / (df + 0.5))
  }

  /** TF-IDF weight of a stem or bigram. Generic words and pairs containing one count for little. */
  private weight(key: string): number {
    const generic = key.includes('+') ? key.split('+').some(isGeneric) : isGeneric(key)
    return this.idf(key) * (generic ? (key.includes('+') ? 0.35 : 0.15) : 1)
  }

  /** 1 for rare things, falling towards 0.25 for things half the history shares. */
  private specificity(df: number): number {
    const n = Math.max(this.docs.size, 30)
    return clamp(Math.log(n / Math.max(df, 1)) / Math.log(n / 3), 0.25, 1)
  }

  private rank(q: Extracted, qLevel: IndexLevel, qTitle: string, selfNum: number | undefined, limit: number, at: number): Related[] {
    // Nothing specific to go on ("Need help"): no suggestions rather than guesses.
    if (!q.keywords.length && !q.entities.length) return []

    const n = this.docs.size
    const maxDf = Math.max(50, Math.floor(n * RETRIEVAL_MAX_DF_SHARE))
    // Exact identifiers (PR, issue, ticket) are always worth following, however many chats share them.
    const exactKeys = new Set(q.entities.filter((e) => EXACT.has(e.type)).map((e) => e.key))
    const queryKeys = [...q.entities.map((e) => e.key), ...q.stems.filter((s) => !isGeneric(s)), ...q.bigrams, ...q.topics.map(topicKey)]
    const candidates = new Set<number>()
    for (const key of queryKeys) {
      const set = this.postings.get(key)
      if (!set || (set.size > maxDf && !exactKeys.has(key))) continue
      let taken = 0
      for (const num of set) {
        if (num !== selfNum) candidates.add(num)
        if (++taken >= MAX_CANDIDATES_PER_TERM) break
      }
    }
    if (!candidates.size) return []

    const qTerms = [...q.stems, ...q.bigrams]
    const qNorm = Math.sqrt(qTerms.reduce((s, t) => s + this.weight(t) ** 2, 0)) || 1
    const qStems = new Set(q.stems)
    const qBigrams = new Set(q.bigrams)
    const qEntities = new Map(q.entities.map((e) => [e.key, e]))
    const qTopics = new Set(q.topics)
    // A shared word or pair counts as evidence only if it is neither generic nor common.
    const rareEnough = (key: string) => this.df(key) <= Math.max(4, n * 0.08)
    const specificStem = (s: string) => !isGeneric(s) && rareEnough(s)
    const specificPair = (b: string) => !b.split('+').some(isGeneric) && rareEnough(b)

    const scored: Array<{ doc: Doc; score: number; matched: Matched; tokens: Set<string> }> = []
    for (const num of candidates) {
      const d = this.byNum[num]
      if (!d) continue

      // Entities.
      const sharedEntities: Entity[] = []
      const eStrengths: number[] = []
      for (const e of d.x.entities) {
        const mine = qEntities.get(e.key)
        if (!mine) continue
        sharedEntities.push(mine)
        const base = ENTITY_STRENGTH[e.type]
        eStrengths.push(EXACT.has(e.type) ? base : base * this.specificity(this.df(e.key)))
      }
      const E = noisyOr(eStrengths)

      // Topics and activity.
      const sharedTopics = d.x.topics.filter((t) => qTopics.has(t))
      const sameActivity = q.activity && d.x.activity === q.activity ? q.activity : null
      const tStrengths = sharedTopics.map((t) => 0.5 * this.specificity(this.df(topicKey(t))))
      if (sameActivity) tStrengths.push(0.3 * this.specificity(this.activityCount.get(sameActivity) ?? 1))
      const T = noisyOr(tStrengths)

      // Text: TF-IDF cosine over stems and adjacent pairs.
      let dot = 0
      const sharedStems: string[] = []
      const sharedBigrams: string[] = []
      for (const s of d.x.stems) {
        if (qStems.has(s)) {
          dot += this.weight(s) ** 2
          if (specificStem(s)) sharedStems.push(s)
        }
      }
      for (const b of d.x.bigrams) {
        if (qBigrams.has(b)) {
          dot += this.weight(b) ** 2
          if (specificPair(b)) sharedBigrams.push(b)
        }
      }
      let dNorm = 0
      for (const t of d.x.stems) dNorm += this.weight(t) ** 2
      for (const t of d.x.bigrams) dNorm += this.weight(t) ** 2
      const X = dot / (qNorm * (Math.sqrt(dNorm) || 1))

      // Evidence gate. Weak, generic similarity ("both are engineering", "both
      // are PR reviews", "both mention Animall") never passes on its own; some
      // specific evidence must. The weighted score below only ranks survivors.
      const exact = sharedEntities.some((e) => EXACT.has(e.type)) // same PR, issue or ticket
      const named = sharedEntities.some((e) => STRONG.has(e.type) && !EXACT.has(e.type)) // same repo or project
      const textMin = TEXT_ONLY_MIN[tierName(Math.min(rank(qLevel), rank(d.level)))]
      const pass =
        exact ||
        (named && (X >= 0.1 || T >= 0.25)) ||
        (X >= textMin && (sharedBigrams.length > 0 || sharedStems.length >= 2)) ||
        (E >= 0.25 && (T >= 0.25 || X >= 0.12)) ||
        (sharedTopics.length >= 2 && X >= 0.1) ||
        (sharedTopics.length >= 1 && sharedStems.length >= 2) ||
        // Same tool, same kind of problem, and a specific shared word (Redis + incidents + "oom").
        (sharedEntities.length > 0 && sharedTopics.length >= 1 && sharedStems.length >= 1)
      if (!pass) continue

      const relevance = WEIGHTS.entities * E + WEIGHTS.topics * T + WEIGHTS.text * X
      const ageDays = d.time == null ? 365 : Math.max(0, (at - d.time) / DAY_MS)
      const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
      scored.push({
        doc: d,
        score: relevance + WEIGHTS.recency * recency,
        matched: { entities: sharedEntities, topics: sharedTopics, activity: sameActivity, terms: sharedStems, bigrams: sharedBigrams },
        tokens: new Set([...d.x.stems, ...d.x.bigrams]),
      })
    }

    scored.sort((a, b) => b.score - a.score || (b.doc.time ?? 0) - (a.doc.time ?? 0))

    // No near-identical suggestions ("Mobile game ideas" ×3): keep the best of each.
    const picked: typeof scored = []
    const titles = new Set<string>()
    for (const s of scored) {
      const folded = fold(s.doc.title)
      if (titles.has(folded) || picked.some((p) => jaccard(p.tokens, s.tokens) >= NEAR_DUPLICATE)) continue
      titles.add(folded)
      picked.push(s)
      if (picked.length >= limit) break
    }
    return picked.map((p) => ({ id: p.doc.id, score: Math.min(1, p.score), reasons: explain(p.matched, qTitle), level: p.doc.level }))
  }
}

const rank = (l: IndexLevel) => (l === 'title' ? 0 : l === 'metadata' ? 1 : 2)
const tierName = (r: number): IndexLevel => (r === 0 ? 'title' : r === 1 ? 'metadata' : 'content')

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

function merge(own: Extracted, sig: ContentSignals): Extracted {
  const entities = new Map(own.entities.map((e) => [e.key, e]))
  for (const e of sig.entities) entities.set(e.key, e)
  const stems = [...new Set([...own.stems, ...sig.stems])]
  return {
    ...own,
    entities: [...entities.values()],
    topics: [...new Set([...own.topics, ...sig.topics])],
    stems,
    bigrams: [...new Set([...own.bigrams, ...sig.bigrams])],
    keywords: stems.filter((s) => !isGeneric(s)),
  }
}

/** Tokens shaped like passwords, keys, hashes or ids: never worth keeping as "keywords". */
const looksSensitive = (t: string) => t.length >= 24 || (t.length >= 7 && /\d/.test(t) && /[a-z]/.test(t))

/**
 * Reduce message text to signals worth keeping: entities, topics and the most
 * frequent significant terms. The text itself is not retained, so a future
 * capture can feed this without storing conversations. Identifier-shaped tokens
 * (keys, hashes, passwords) are dropped rather than kept as keywords.
 */
export function signalsFromText(text: string, opts: { maxTerms?: number } = {}): ContentSignals {
  const max = opts.maxTerms ?? 80
  const x = extract(text)
  const { stems, bigrams } = tokenize(text.replace(/https?:\/\/\S+/gi, ' '))
  const top = (items: string[], keep: (s: string) => boolean) => {
    const counts = new Map<string, number>()
    for (const i of items) if (keep(i) && !i.split('+').some(looksSensitive)) counts.set(i, (counts.get(i) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k)
  }
  const entityWords = new Set(x.entities.filter((e) => e.type === 'provider' || e.type === 'tech').map((e) => stem(e.key.slice(e.type.length + 1))))
  return {
    hash: hash(text),
    entities: extractEntities(text),
    topics: x.topics,
    stems: top(stems, (s) => !isGeneric(s) && !entityWords.has(s)),
    bigrams: top(bigrams, () => true),
  }
}

/** FNV-1a, 32-bit: enough to notice that text changed. */
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}
