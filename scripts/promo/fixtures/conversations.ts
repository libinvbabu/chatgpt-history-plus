// Synthetic ChatGPT history for the promo recording. Every title here is
// invented; no real conversation, person or account is involved.
//
// Deterministic: a fixed "now" (Thursday 15 Oct 2026, 3:40 PM in New York)
// and a seeded generator, so every recording shows the same dates, groups and
// counts. The recording harness shifts the extension's clock to DEMO_NOW, so
// Today / Yesterday / Earlier this week / Last week line up with these times.

import type { MockConversation } from '../../../tests/e2e/mock-chatgpt'

export const DEMO_TZ = 'America/New_York'
export const DEMO_LOCALE = 'en-US'
export const DEMO_NOW = Date.parse('2026-10-15T15:40:00-04:00')

const DAY = 86_400_000

/** Wall-clock time in DEMO_TZ → epoch ms. */
function et(date: string, time: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: DEMO_TZ, timeZoneName: 'shortOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName')!.value // "GMT-4"
  const offsetHours = Number(name.replace('GMT', '') || 0)
  return guess - offsetHours * 3_600_000
}

/** [title, date, time, created date (optional, defaults to the same moment)] */
type Named = [string, string, string, string?]

// Everything the storyboard touches is named here, newest first. Titles are
// worded so the real categoriser files them where the scenes need them.
const NAMED: Named[] = [
  // Today: Thursday 15 Oct
  ['Review payment gateway changes', '2026-10-15', '15:05'],
  ['Analyze revenue dashboard drop', '2026-10-15', '13:48'],
  ['Review backend pull request #482', '2026-10-15', '11:02'],
  ['Weekly retention cohort analysis', '2026-10-15', '10:15'],
  ['Product launch checklist', '2026-10-15', '09:30', '2026-10-12'],
  // Yesterday: Wednesday 14 Oct
  ['Fix subscription renewal failures', '2026-10-14', '19:20'],
  ['Plan Q4 marketing campaign', '2026-10-14', '18:40'],
  ['Investigate Android notification delays', '2026-10-14', '16:10'],
  ['Prepare investor update for October', '2026-10-14', '14:25'],
  ['Improve customer onboarding emails', '2026-10-14', '10:05'],
  // Earlier this week: Sunday 11 – Tuesday 13 Oct
  ['PR 4821 follow-up fixes', '2026-10-13', '17:30'],
  ['Engineering architecture discussion: event bus', '2026-10-13', '11:00'],
  ['Conversion funnel for annual plans', '2026-10-12', '15:20'],
  ['Draft release notes for v3.2', '2026-10-12', '09:45'],
  ['Pricing page A/B test results', '2026-10-11', '20:10'],
  // Last week: Sunday 4 – Saturday 10 Oct
  ['Payment retry webhook failures', '2026-10-09', '16:40'],
  ['Review settlement service PR #4821', '2026-10-08', '14:15'],
  ['Compare payment providers for international cards', '2026-10-07', '11:30'],
  ['Sprint planning for the mobile team', '2026-10-06', '10:00'],
  ['Event tracking plan for the new app', '2026-10-05', '15:45'],
  ['Write job description for data engineer', '2026-10-05', '09:20'],
  ['Code review: search indexing service', '2026-10-04', '19:00'],
  // Older
  ['PR 4821 rollback plan', '2026-10-02', '16:20'],
  ['Refund flow for failed payments', '2026-09-28', '11:40'],
  ['Settlement PR 4821 rollout notes', '2026-09-22', '15:10'],
  ['Payment success rate dashboard', '2026-09-09', '10:30'],
  ['Monthly payments reconciliation script', '2026-08-19', '17:05'],
  ['Payment page redesign ideas', '2026-07-14', '13:15'],
  ['Explain payment idempotency keys', '2026-03-03', '09:50'],
  ['Payment links for invoices', '2025-11-20', '14:00'],
]

// Background history: realistic, varied, and deliberately free of the words the
// storyboard searches for ("payment"), so search results stay exactly the named ones.
const POOL = [
  // engineering
  'Refactor auth middleware', 'Set up CI caching for the monorepo', 'Migrate cron jobs to a queue', 'Design schema for audit logs', 'Optimize slow Postgres queries',
  'Kubernetes autoscaling config', 'WebSocket reconnect strategy', 'API rate limiting design', 'Dockerize the reporting service', 'GraphQL vs REST for the mobile API',
  'Background job retries with backoff', 'Database index for order lookups', 'Feature flag cleanup', 'Monorepo build times', 'Set up staging environment',
  'Redis cache invalidation', 'Explain React server components', 'TypeScript generics question', 'Image upload pipeline', 'Search indexing architecture',
  // debugging
  'Debug memory leak in worker', 'Fix flaky checkout test', 'Investigate 502 errors after deploy', 'Crash on Android 14 startup', 'Timeouts in the export job',
  'iOS push notifications not showing', 'Race condition in cart updates', 'Login redirect loop', 'Slow dashboard load times', 'Root cause for Sunday outage',
  // reviews
  'Code review: caching layer', 'Review migration script changes', 'Review PR for notification service', 'Code review: rate limiter', 'Review analytics SDK changes',
  // analytics
  'Weekly active users report', 'Churn analysis for annual plans', 'Cohort retention by signup month', 'Attribution model comparison', 'KPI dashboard for support team',
  'Forecast Q1 signups', 'Trial conversion metrics', 'DAU drop investigation', 'Marketing funnel analysis', 'SQL for monthly revenue report',
  // product
  'PRD for saved searches', 'Onboarding flow wireframes', 'Feature ideas for the mobile app', 'Roadmap priorities for H1', 'User research synthesis',
  'Pricing strategy for teams plan', 'Go-to-market plan for new tier', 'Redesign settings screen', 'MVP scope for referrals', 'Feature requests from enterprise customers',
  // payments (no "payment" in the text)
  'Subscription billing edge cases', 'Invoice numbering rules', 'Refund policy for annual plans', 'Checkout drop-off fixes', 'Wallet top-up limits',
  'Chargeback dispute process', 'Billing cycle proration math', 'Dunning email schedule', 'Coupon stacking rules', 'Settlement report mismatch',
  // writing
  'Draft customer apology email', 'Rewrite landing page copy', 'Blog post outline: scaling support', 'Summarize board meeting notes', 'LinkedIn post about the launch',
  'Newsletter for October', 'Reply to partner proposal', 'Proofread the case study', 'Announcement for the new office', 'Cover letter feedback',
  // people
  'Interview questions for senior backend role', 'Offer letter template', 'Team offsite agenda', 'Performance review talking points', 'Onboarding plan for new joiners',
  // personal
  'Weekend trip itinerary ideas', 'Meal prep recipes for the week', 'Half marathon training plan', 'Kitchen renovation budget', 'Gift ideas for a 10-year-old',
  'Book recommendations on leadership', 'Learn Spanish in 3 months', 'Apartment hunting checklist', 'Birthday party ideas', 'Home office setup',
]
const QUALIFIERS = ['', '', '', ' follow-up', ' (v2)', ' for mobile', ' for web', ' – part 2', ' questions', ' for Q1', ' for Q3', ' for the EU launch', ' notes']

const BACKGROUND_COUNT = 1250

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Same shape as the e2e mock's ids, which pass the extension's id checks. */
function uuid(n: number): string {
  const h = n.toString(16).padStart(12, '0')
  return `5d0e7a31-${h.slice(0, 4)}-4c2b-8e6f-${h}`
}

const iso = (ms: number) => new Date(ms).toISOString()

export function demoConversations(): MockConversation[] {
  const items: MockConversation[] = []
  let n = 0
  for (const [title, date, time, created] of NAMED) {
    const updated = et(date, time)
    items.push({ id: uuid(++n), title, create_time: iso(created ? et(created, time) : updated), update_time: iso(updated) })
  }
  // Background chats start before 2 Oct, so the 28 most recent (what ChatGPT's own
  // sidebar shows, and so what History+ can open without a page load) are all named.
  const rand = mulberry32(2026)
  const oldest = et('2026-10-01', '23:00')
  const seen = new Set(NAMED.map((r) => r[0]))
  while (items.length < NAMED.length + BACKGROUND_COUNT) {
    const title = POOL[Math.floor(rand() * POOL.length)]! + QUALIFIERS[Math.floor(rand() * QUALIFIERS.length)]!
    const updated = oldest - Math.floor(Math.pow(rand(), 1.5) * 620 * DAY) - Math.floor(rand() * DAY)
    if (seen.has(title) && rand() < 0.7) continue // a few repeats, as in a real history
    seen.add(title)
    items.push({ id: uuid(++n), title, create_time: iso(updated - Math.floor(rand() * 5) * DAY), update_time: iso(updated) })
  }
  items.sort((a, b) => Date.parse(String(b.update_time)) - Date.parse(String(a.update_time)))
  return items
}

/** What the storyboard does, in one place. Change a word here, not in record.spec.ts. */
export const STORY = {
  /** The chat open when the video starts. */
  start: 'Product launch checklist',
  /** Typed into the real search box. History+ searches titles only. */
  query: 'payment',
  /** Opened from the search results. */
  searchPick: 'Compare payment providers for international cards',
  /**
   * Category filters. The bar is chosen by History+ from this history (Work, Analytics, Technology,
   * Backend, Writing); PR Reviews ranks below it, so it is found in More by typing `find`. `shows` is a chat
   * the filter must show (and the other filter must hide).
   */
  categories: {
    chip: { label: 'Analytics', shows: 'Analyze revenue dashboard drop' },
    more: { id: 'pr-reviews', label: 'PR Reviews', find: 'review', shows: 'Review backend pull request #482' },
  },
  /** The date group expanded, by label. */
  group: 'Last week',
  /** Opened from "Last week"; has related chats (same PR). */
  datePick: 'Review settlement service PR #4821',
  /** Opened from "Related to this chat". */
  relatedPick: 'PR 4821 follow-up fixes',
}
