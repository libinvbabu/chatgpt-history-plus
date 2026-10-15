// Tokenising and stemming for relatedness. Deliberately small and dependency-free:
// titles are short, so a light suffix stripper plus an alias table does the job.

import { fold } from '../utils/normalize'

/** Dropped entirely: carries no meaning for matching. */
const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from how i if in into is it its me my of on or our so than that the their them then there these this to ' +
    'up us was we what when where which who why will with you your about can could do does did get got has have just like make need needs ' +
    'please should some want way would new chat conversation untitled ' +
    // Hindi/Hinglish glue words that show up in Indian-English titles.
    'ka ki ke ko se me hai kya only also any all one'
  ).split(' '),
)

/**
 * Kept, but nearly worthless on their own: "Review X" and "Fix Y" say what kind
 * of chat it was, not what it was about. Weighted down in scoring and never used
 * to retrieve candidates.
 */
export const GENERIC_WORDS = new Set(
  (
    'review help issue issues change changes fix fixes problem question questions request requests update updates idea ideas ' +
    'plan planning draft discuss discussion talk thing things work working task tasks use using add create build setup set ' +
    'check test tests tool tools tip tips guide guidance advice support improve improving improvement summary summarise summarize ' +
    'explain explanation best better good error pr code read incident'
  ).split(' '),
)

/** Canonical forms for stems that mean the same thing in a title. */
const ALIASES: Record<string, string> = {
  retries: 'retry',
  retrying: 'retry',
  retri: 'retry',
  failure: 'fail',
  failur: 'fail',
  failed: 'fail',
  failing: 'fail',
  fails: 'fail',
  renewals: 'renewal',
  renew: 'renewal',
  subscript: 'subscription',
  subscriptions: 'subscription',
  recurr: 'recurring',
  mandates: 'mandate',
  integration: 'integrate',
  integrat: 'integrate',
  integrations: 'integrate',
  authentication: 'auth',
  authorization: 'auth',
  authorisation: 'auth',
  authenticate: 'auth',
  deployment: 'deploy',
  deployments: 'deploy',
  deploying: 'deploy',
  deployed: 'deploy',
  migration: 'migrate',
  migrations: 'migrate',
  analytic: 'analytics',
  analysis: 'analytics',
  analyse: 'analytics',
  analyze: 'analytics',
  analyz: 'analytics',
  analys: 'analytics',
  metrics: 'metric',
  dashboards: 'dashboard',
  hire: 'hiring',
  hired: 'hiring',
  interviews: 'interview',
  interviewing: 'interview',
  recruiting: 'hiring',
  recruitment: 'hiring',
  candidates: 'candidate',
  bugs: 'bug',
  debugging: 'debug',
  debugged: 'debug',
  crashes: 'crash',
  crashing: 'crash',
  outages: 'outage',
  incidents: 'incident',
  timeouts: 'timeout',
  latencies: 'latency',
  refunds: 'refund',
  payments: 'payment',
  payouts: 'payout',
  reconcile: 'reconciliation',
  reconciling: 'reconciliation',
  settlements: 'settlement',
  checkout: 'checkout',
  webhooks: 'webhook',
  apis: 'api',
  endpoints: 'endpoint',
}

/** Light stemmer: plurals and the common verb endings. Leaves non-ASCII words untouched. */
export function stem(word: string): string {
  const alias = ALIASES[word]
  if (alias) return alias
  if (word.length < 4 || !/^[a-z]+$/.test(word)) return word
  let w = word
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y'
  else if (w.endsWith('sses') || /(ches|shes|xes|zes)$/.test(w)) w = w.slice(0, -2)
  else if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = undouble(w.slice(0, -3))
  else if (w.length > 4 && w.endsWith('ed')) w = undouble(w.slice(0, -2))
  return ALIASES[w] ?? w
}

function undouble(w: string): string {
  return /([^aeiouls])\1$/.test(w) ? w.slice(0, -1) : w
}

/** Letters/digits runs, folded to lowercase ASCII-ish form. */
export function words(text: string): string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
}

export interface Tokens {
  /** Significant stems in order, with stopwords and bare numbers removed. */
  stems: string[]
  /** Unordered adjacent pairs of significant stems: "morning+brief". */
  bigrams: string[]
}

export function tokenize(text: string): Tokens {
  const stems: string[] = []
  for (const w of words(text)) {
    if (STOPWORDS.has(w) || /^\d+$/.test(w) || w.length < 2) continue
    stems.push(stem(w))
  }
  const bigrams: string[] = []
  for (let i = 0; i + 1 < stems.length; i++) {
    const a = stems[i]!
    const b = stems[i + 1]!
    if (a === b) continue
    // A pair of two generic words ("review code") is no evidence of anything.
    if (GENERIC_WORDS.has(a) && GENERIC_WORDS.has(b)) continue
    bigrams.push(a < b ? `${a}+${b}` : `${b}+${a}`)
  }
  return { stems, bigrams }
}

export function isGeneric(term: string): boolean {
  return GENERIC_WORDS.has(term)
}
