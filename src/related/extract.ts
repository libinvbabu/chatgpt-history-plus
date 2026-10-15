// Rule-based metadata extraction. No model, no network, no stored text: given a
// title (or, later, any text a content source provides), pull out the things
// that make two conversations about the same *thing* rather than the same *kind
// of thing*: PRs, repositories, tickets, providers, tools, topics, activity.

import { ACTIVITY_RULES, CATEGORY_LABELS, TOPICS, entityMatcher, type Activity, type CategoryId, type EntityType } from './dictionary'
import { stem, tokenize, isGeneric } from './text'

export interface Entity {
  type: EntityType
  /** Canonical, case-folded identity, prefixed by type: "pr:animall-in/backend-apis#4294". */
  key: string
  /** Display form: "Animall-In/backend-apis#4294". */
  label: string
}

export interface Extracted {
  entities: Entity[]
  /** Canonical topic ids ("subscriptions"). Never broad areas like "engineering". */
  topics: string[]
  activity: Activity | null
  category: CategoryId
  /** Unique significant stems, minus single-word entity names (those are entities). */
  stems: string[]
  /** Unordered adjacent pairs of significant stems. */
  bigrams: string[]
  /** `stems` without generic words: what the conversation is specifically about. */
  keywords: string[]
}

const TOPIC_STEMS = Object.entries(TOPICS).map(([topic, triggers]) => [topic, new Set(triggers.map(stem))] as const)

/** Things shaped like "ABC-123" that are not tickets. */
const NOT_TICKET = new Set(['UTF', 'SHA', 'MD', 'GPT', 'COVID', 'ISO', 'TLS', 'SSL', 'IPV', 'HTTP', 'X', 'WIN', 'AK', 'RFC', 'EN', 'LLAMA', 'GEMINI', 'CLAUDE', 'USB', 'PDF', 'ES', 'PS', 'WPA', 'AES', 'RSA', 'DES', 'H'])

const GITHUB_URL = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(pull|pulls|issues)\/(\d+))?(?=[\s)?#"'<>,;:\]]|$)/gi
const REPO_REF = /(?<![\w/.-])([A-Za-z0-9][\w-]{1,38})\/([A-Za-z0-9][\w.-]{1,100})#(\d{1,7})\b/g
const REPO_BARE = /(?<![\w/.:-])([A-Za-z0-9][\w-]{1,38})\/([A-Za-z0-9][\w.-]{1,60})(?![\w/-])/g
const REPO_CONTEXT = /\b(repo|repository|github|gitlab|pr|prs|pull request|commit|branch)\b/i
const PR_WORD = /\b(?:pr|prs|pull[- ]?request|mr)\s*[#:-]?\s*(\d{1,7})\b/gi
const HASH_NUMBER = /(?<![\w/&])#(\d{3,7})\b/g
const TICKET = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g

const entity = (type: EntityType, key: string, label: string): Entity => ({ type, key: `${type}:${key}`, label })

export function extractEntities(text: string): Entity[] {
  const found = new Map<string, Entity>()
  const add = (e: Entity) => found.has(e.key) || found.set(e.key, e)
  const repo = (org: string, name: string) => add(entity('repo', `${org}/${name}`.toLowerCase(), `${org}/${name}`))

  for (const m of text.matchAll(GITHUB_URL)) {
    const [, org, name, kind, num] = m as unknown as [string, string, string, string | undefined, string | undefined]
    repo(org, name)
    if (num) {
      const t = kind === 'issues' ? 'issue' : 'pr'
      add(entity(t, `${org}/${name}#${num}`.toLowerCase(), `${org}/${name}#${num}`))
      if (t === 'pr') add(entity('prn', num, `#${num}`))
    }
  }
  for (const m of text.matchAll(REPO_REF)) {
    const [, org, name, num] = m as unknown as [string, string, string, string]
    repo(org, name)
    add(entity('pr', `${org}/${name}#${num}`.toLowerCase(), `${org}/${name}#${num}`))
    add(entity('prn', num, `#${num}`))
  }
  if (REPO_CONTEXT.test(text)) {
    for (const m of text.matchAll(REPO_BARE)) {
      const [, org, name] = m as unknown as [string, string, string]
      // "client/server" is prose; "Animall-In/backend-apis" has a hyphen, dot, underscore or digit somewhere.
      if (/[-_.\d]/.test(org + name)) repo(org, name)
    }
  }
  for (const m of text.matchAll(PR_WORD)) add(entity('prn', m[1]!, `#${m[1]}`))
  for (const m of text.matchAll(HASH_NUMBER)) add(entity('prn', m[1]!, `#${m[1]}`))
  for (const m of text.matchAll(TICKET)) {
    if (!NOT_TICKET.has(m[1]!)) add(entity('ticket', `${m[1]}-${m[2]}`.toLowerCase(), `${m[1]}-${m[2]}`))
  }

  const { re, byAlias } = entityMatcher()
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    const def = byAlias.get(m[0].toLowerCase())
    if (def) add(entity(def.type, def.id, def.label))
  }
  return [...found.values()]
}

function classify(activity: Activity | null, topics: readonly string[], entities: readonly Entity[]): CategoryId {
  const has = (...t: string[]) => t.some((x) => topics.includes(x))
  const ent = (type: EntityType) => entities.some((e) => e.type === type)
  if (activity === 'code_review') return 'code-review'
  if (activity === 'debugging' || has('incidents')) return 'debugging'
  if (has('payments', 'subscriptions') || ent('provider')) return 'payments'
  if (has('access-control', 'security')) return 'security'
  if (activity === 'analytics' || has('analytics')) return 'analytics'
  if (activity === 'hiring' || has('hiring')) return 'people'
  if (ent('tech') || ent('repo') || has('database', 'infrastructure', 'api', 'architecture', 'mobile')) return 'engineering'
  if (activity === 'planning' || has('roadmap')) return 'product'
  if (activity === 'writing' || has('email')) return 'writing'
  return 'general'
}

export function extract(text: string): Extracted {
  const entities = extractEntities(text)
  // URLs are entities already; their path fragments are noise as words.
  const { stems: allStems, bigrams } = tokenize(text.replace(/https?:\/\/\S+/gi, ' '))

  // Single-word entity names are matched as entities; counting them again as
  // plain words would double their weight.
  const entityWords = new Set<string>()
  for (const e of entities) if (e.type === 'provider' || e.type === 'tech') entityWords.add(stem(e.key.slice(e.type.length + 1)))
  const stems = [...new Set(allStems)].filter((s) => !entityWords.has(s))

  const stemSet = new Set(allStems)
  const uniqueTopics: string[] = []
  for (const [topic, triggers] of TOPIC_STEMS) {
    for (const t of triggers) {
      if (stemSet.has(t)) {
        uniqueTopics.push(topic)
        break
      }
    }
  }

  let activity: Activity | null = null
  for (const rule of ACTIVITY_RULES) {
    if (rule.re.test(text)) {
      activity = rule.activity
      break
    }
  }
  return {
    entities,
    topics: uniqueTopics,
    activity,
    category: classify(activity, uniqueTopics, entities),
    stems,
    bigrams: [...new Set(bigrams)],
    keywords: stems.filter((s) => !isGeneric(s)),
  }
}

// ---------------------------------------------------------------------------
// Category lookups for the UI: one per conversation row, so memoised by title.

const categoryCache = new Map<string, CategoryId>()

export function categoryForTitle(title: string): CategoryId {
  let c = categoryCache.get(title)
  if (!c) {
    if (categoryCache.size > 20_000) categoryCache.clear()
    c = title.trim() ? extract(title).category : 'general'
    categoryCache.set(title, c)
  }
  return c
}

export const categoryLabel = (c: CategoryId): string => CATEGORY_LABELS[c]

export const isCategoryId = (v: unknown): v is CategoryId => typeof v === 'string' && v in CATEGORY_LABELS

/** A stored category if something supplied a valid one, else the title rules. One place to change. */
export function categoryFor(conv: { title: string; category?: string | null }): CategoryId {
  return isCategoryId(conv.category) ? conv.category : categoryForTitle(conv.title)
}
