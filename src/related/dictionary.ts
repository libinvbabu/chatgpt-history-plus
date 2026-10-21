// The knowledge the rule-based extractor works from. Everything here is data:
// add a row to teach it a provider, a tool, a topic, an activity or a category.
// Aliases are matched case-insensitively on word boundaries and map to one
// canonical entity, so "Phone Pe", "phonepe" and "PhonePe" are the same thing.

export type EntityType = 'pr' | 'prn' | 'issue' | 'repo' | 'ticket' | 'provider' | 'tech' | 'product'

export interface EntityDef {
  type: Extract<EntityType, 'provider' | 'tech' | 'product'>
  /** Canonical id, lowercase, no spaces. */
  id: string
  label: string
  aliases: string[]
}

const provider = (id: string, label: string, ...aliases: string[]): EntityDef => ({ type: 'provider', id, label, aliases: [id, ...aliases] })
const tech = (id: string, label: string, ...aliases: string[]): EntityDef => ({ type: 'tech', id, label, aliases: [id, ...aliases] })

export const ENTITY_DEFS: EntityDef[] = [
  // Payment providers and rails.
  provider('paytm', 'Paytm'),
  provider('phonepe', 'PhonePe', 'phone pe', 'phonepay'),
  provider('razorpay', 'Razorpay', 'razor pay'),
  provider('payu', 'PayU', 'pay u', 'payumoney'),
  provider('cashfree', 'Cashfree', 'cash free'),
  provider('juspay', 'Juspay'),
  provider('billdesk', 'BillDesk', 'bill desk'),
  provider('ccavenue', 'CCAvenue'),
  provider('stripe', 'Stripe'),
  provider('paypal', 'PayPal', 'pay pal'),
  provider('gpay', 'Google Pay', 'google pay', 'gpay', 'g pay'),
  provider('bhim', 'BHIM'),
  provider('npci', 'NPCI'),

  // Infrastructure, data and tooling.
  tech('aws', 'AWS', 'amazon web services'),
  tech('gcp', 'GCP', 'google cloud'),
  tech('azure', 'Azure'),
  tech('kubernetes', 'Kubernetes', 'k8s', 'kubectl'),
  tech('docker', 'Docker'),
  tech('terraform', 'Terraform'),
  tech('nginx', 'Nginx'),
  tech('redis', 'Redis'),
  tech('postgres', 'Postgres', 'postgresql'),
  tech('mysql', 'MySQL'),
  tech('mongodb', 'MongoDB', 'mongo'),
  tech('elasticsearch', 'Elasticsearch', 'elastic search', 'opensearch'),
  tech('kafka', 'Kafka'),
  tech('rabbitmq', 'RabbitMQ', 'rabbit mq'),
  tech('celery', 'Celery'),
  tech('github', 'GitHub', 'git hub'),
  tech('gitlab', 'GitLab'),
  tech('jenkins', 'Jenkins'),
  tech('slack', 'Slack'),
  tech('jira', 'Jira'),
  tech('notion', 'Notion'),
  tech('figma', 'Figma'),
  tech('datadog', 'Datadog'),
  tech('sentry', 'Sentry'),
  tech('grafana', 'Grafana'),
  tech('prometheus', 'Prometheus'),
  tech('firebase', 'Firebase'),
  tech('bigquery', 'BigQuery', 'big query'),
  tech('metabase', 'Metabase'),
  tech('mixpanel', 'Mixpanel'),
  tech('clevertap', 'CleverTap', 'clever tap'),
  tech('python', 'Python'),
  tech('typescript', 'TypeScript'),
  tech('javascript', 'JavaScript'),
  tech('java', 'Java'),
  tech('kotlin', 'Kotlin'),
  tech('swift', 'Swift'),
  tech('golang', 'Go', 'golang'),
  tech('rust', 'Rust'),
  tech('php', 'PHP'),
  tech('react', 'React', 'reactjs'),
  tech('nextjs', 'Next.js', 'next.js', 'next js'),
  tech('nodejs', 'Node.js', 'node.js', 'node js'),
  tech('django', 'Django'),
  tech('flask', 'Flask'),
  tech('fastapi', 'FastAPI'),
  tech('laravel', 'Laravel'),
  tech('springboot', 'Spring Boot', 'spring boot'),
  tech('flutter', 'Flutter'),
  tech('android', 'Android'),
  tech('ios', 'iOS'),
]

/**
 * Teach the extractor more names at runtime (e.g. from a future settings page).
 * Project and product names that recur in someone's titles belong here.
 */
export function defineEntity(def: EntityDef): void {
  ENTITY_DEFS.push(def)
  compiled = null
}

interface Compiled {
  /** One alternation of every alias, longest first, so "google pay" beats "google". */
  re: RegExp
  byAlias: Map<string, EntityDef>
}
let compiled: Compiled | null = null

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function entityMatcher(): Compiled {
  if (compiled) return compiled
  const byAlias = new Map<string, EntityDef>()
  for (const def of ENTITY_DEFS) for (const a of def.aliases) byAlias.set(a.toLowerCase(), def)
  const aliases = [...byAlias.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  // Word boundaries that also work next to "." and "+" ("node.js", "c++" are not handled; not needed).
  compiled = { re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${aliases.join('|')})(?![\\p{L}\\p{N}])`, 'giu'), byAlias }
  return compiled
}

/**
 * Specific topics, as lists of stems that signal them. Broad areas such as
 * "engineering" are deliberately not topics: sharing one is not a relationship.
 */
export const TOPICS: Record<string, string[]> = {
  subscriptions: ['subscription', 'renewal', 'autopay', 'mandate', 'recurring', 'billing', 'prenotify', 'dunning'],
  'payment-recovery': ['retry', 'recovery', 'dunning', 'chargeback', 'refund', 'fail'],
  payments: ['payment', 'payout', 'settlement', 'reconciliation', 'upi', 'wallet', 'checkout', 'gateway', 'transaction', 'debit', 'credit', 'emi', 'invoice', 'refund'],
  'access-control': ['auth', 'oauth', 'sso', 'permission', 'access', 'rbac', 'role', 'credential', 'token', 'password', '2fa', 'mfa'],
  security: ['security', 'vulnerability', 'encryption', 'secret', 'xss', 'csrf', 'pentest', 'compliance', 'audit'],
  incidents: ['outage', 'incident', 'downtime', 'latency', 'timeout', 'crash', 'rollback', 'oom', 'postmortem', 'rca'],
  database: ['database', 'schema', 'migrate', 'index', 'query', 'sql', 'replica', 'shard'],
  infrastructure: ['deploy', 'scaling', 'autoscaling', 'cluster', 'pipeline', 'ci', 'infra', 'server', 'cdn'],
  analytics: ['analytics', 'metric', 'dashboard', 'funnel', 'retention', 'cohort', 'kpi', 'churn', 'report', 'experiment'],
  hiring: ['hiring', 'interview', 'candidate', 'resume', 'recruit', 'offer', 'jd', 'onboarding', 'appraisal', 'okr'],
  roadmap: ['roadmap', 'prd', 'launch', 'pricing', 'mvp', 'strategy', 'positioning', 'gtm'],
  api: ['api', 'webhook', 'endpoint', 'sdk', 'rest', 'graphql', 'grpc'],
  architecture: ['architecture', 'refactor', 'backend', 'frontend', 'microservice', 'monolith', 'codebase'],
  mobile: ['android', 'ios', 'flutter', 'mobile', 'playstore', 'appstore'],
  email: ['email', 'newsletter', 'outreach', 'cold', 'linkedin'],
}

export type Activity = 'code_review' | 'debugging' | 'planning' | 'hiring' | 'analytics' | 'writing' | 'implementation'

/** First match wins, so order is priority. Tested against the raw title. */
export const ACTIVITY_RULES: Array<{ activity: Activity; re: RegExp }> = [
  { activity: 'code_review', re: /\b(pr|prs|pull[- ]?requests?|mr|code review|review(?:ing)? (?:the )?(?:pr|diff|code|changes|commit)|pr review)\b/i },
  { activity: 'debugging', re: /\b(bug|bugs|debug\w*|error|errors|exception|crash\w*|fail\w*|broken|not working|stack ?trace|incident|outage|timeout|regression|root cause|rca|investigat\w*)\b/i },
  { activity: 'hiring', re: /\b(hiring|interview\w*|candidates?|resume|cv|recruit\w*|job description|jd|offer letter|onboarding|appraisal|performance review)\b/i },
  { activity: 'analytics', re: /\b(analytics|analys[ie]s|metrics?|dashboards?|funnel|cohort|kpis?|sql|report|reconciliation|churn|retention|a\/b)\b/i },
  { activity: 'writing', re: /\b(write|writing|draft\w*|email|blog|essay|rewrite|proofread|linkedin|cover letter|copy|article|post|tweet|speech)\b/i },
  // "fix" alone is weak evidence, so it ranks below the specific activities.
  { activity: 'debugging', re: /\bfix(?:es|ed|ing)?\b/i },
  { activity: 'planning', re: /\b(plan|planning|roadmap|strategy|brief|proposal|okrs?|prd|spec|brainstorm\w*|ideas?)\b/i },
  { activity: 'implementation', re: /\b(implement\w*|build|building|create|add|integrat\w*|setup|set up|migrat\w*|refactor\w*|script|api)\b/i },
]

export type CategoryId = 'code-review' | 'engineering' | 'debugging' | 'payments' | 'analytics' | 'product' | 'people' | 'security' | 'writing' | 'general'

export const CATEGORY_LABELS: Record<CategoryId, string> = {
  'code-review': 'Code review',
  engineering: 'Engineering',
  debugging: 'Debugging',
  payments: 'Payments',
  analytics: 'Analytics',
  product: 'Product & ideas',
  people: 'Hiring & people',
  security: 'Security & access',
  writing: 'Writing',
  general: 'General',
}

// ---------------------------------------------------------------------------
// Category signals: what the icon classifier (categorize.ts) looks for.
//
// Kept apart from TOPICS and ACTIVITY_RULES on purpose: those drive "Related to
// this chat", and teaching the icon a word must not change what counts as
// related. Patterns run on the lower-cased title with punctuation turned into
// spaces. Weight: 3 = settles it on its own, 2 = clear, 1 = a hint (never
// enough alone: a category needs a score of 2).

export type Signals = Array<[pattern: RegExp, weight: 1 | 2 | 3]>

/** A title that names a pull request, or a review of code, is a PR review whatever it is about. */
export const PR_REVIEW_SIGNALS: RegExp[] = [
  /\b(pr|prs|pull requests?|merge requests?)\b/, // not "MR": too often a person ("Mr Sharma")
  /\bcode ?reviews?\b/,
  // "Review Kisan backend changes", "review the diff", "reviewing my commits"
  /\breview(?:ing|ed)? (?:\S+ ){0,3}(?:changes|diffs?|commits?|code|branch|patch(?:es)?)\b/,
]

export const CATEGORY_SIGNALS: Record<Exclude<CategoryId, 'code-review'>, Signals> = {
  debugging: [
    [/\b(bugs?|crash\w*|errors?|exceptions?|stack ?traces?|broken|regressions?|outages?|incidents?|hotfix\w*|anrs?|memory leaks?)\b/, 3],
    [/\b(?:not (?:working|showing|loading|opening|receiving|getting delivered)|debug\w*)\b/, 3],
    [/\b(root cause|rca|postmortem|fail(?:s|ed|ing|ures?)?|timeouts?|latency|slow|stuck|flaky|leaks?)\b/, 2],
    [/\b(call drops?|drop(?:ped|ping)? calls?|drops?)\b/, 2],
    [/\b(investigat\w*|fix(?:es|ed|ing)?|issues?|wrong|mismatch\w*)\b/, 1],
  ],
  security: [
    [/\b(vulnerabilit\w*|pentest\w*|encryption|xss|csrf|2fa|mfa|sso|oauth|rbac)\b/, 3],
    [/\b(access|permissions?|roles?|security|credentials?|passwords?|secrets?|compliance|audit|auth\w*|read only)\b/, 2],
    [/\btokens?\b/, 1],
  ],
  engineering: [
    [/\b(architecture|refactor\w*|implement\w*|integrat\w*|api|apis|sdk|endpoints?|webhooks?|schema|migrations?|deploy\w*|infra\w*|database|websockets?|microservices?|codebase|kubernetes|docker)\b/, 3],
    [/\b(backend|frontend|engineering|engineers?|developers?|technical|code|coding|script|server|cache|queues?|cron|pipeline|ci|cd|notifications?|push|sync|build|release|logs?|tests?|testing|query|sql|index|data model|app|android|ios|repo)\b/, 2],
    [/\b(ai|llm|model|prompt|audio|video|calls?|calling|voip|events?|setup|set up|config\w*|tool(?:ing)?)\b/, 1],
  ],
  people: [
    [/\b(interview\w*|hiring|hire|candidates?|recruit\w*|resumes?|cv|job description|jd|offer letter|appraisals?|performance review|compensation|salary|salaries|attrition|resignation|notice period)\b/, 3],
    [/\b(promotion|increment|1 1|one on one|offsite|team building|employee onboarding|new joiners?|hr|headcount|org chart)\b/, 2],
    [/\b(team|manager)\b/, 1],
  ],
  analytics: [
    [/\b(analytics|funnels?|dashboards?|cohorts?|discrepanc\w*|attribution|kpis?|mau|dau|gmv|arpu|ltv|cac|amplitude|mixpanel|clevertap|metabase|bigquery|looker|tableau|posthog|appsflyer|google analytics|ga4)\b/, 3],
    [/\b(analys[ie]s|analy[sz]e|metrics?|tracking|reports?|reporting|revenue|retention|churn|conversion|a b test\w*|ab test\w*|experiments?|insights?|forecast\w*|trends?)\b/, 2],
    [/\b(data|numbers|stats|sql|query|events?)\b/, 1],
  ],
  payments: [
    [/\b(payments?|payouts?|refunds?|upi|mandates?|autopay|auto pay|checkout|cashback|settlements?|reconciliation|chargebacks?|dunning|prenotify|pre notify|payment gateway|emi)\b/, 2],
    [/\b(subscriptions?|billing|invoices?|wallet|debit|transactions?|gateway|recurring|renewals?|charges?)\b/, 2],
    [/\b(credit|coupons?|price)\b/, 1],
  ],
  product: [
    [/\b(prd|roadmap|ux|user experience|wireframes?|mockups?|mvp|user research|personas?|ideation|go to market|gtm|feature requests?)\b/, 3],
    [/\b(features?|ideas?|brainstorm\w*|strategy|positioning|pricing|launch|requirements|spec|proposal|okrs?|q[1-4]|user flows?|onboarding flow|product|sidebar|ui|redesign)\b/, 2],
    [/\b(plan|planning|improve\w*|design|screens?|page|experience|users?|flow|checklist)\b/, 1],
  ],
  writing: [
    [/\b(emails?|mail|messages?|reply|replies|letters?|heads up|announcement|blog|tweet|caption|proofread\w*|cover letter|speech|essay|article|newsletter|linkedin)\b/, 3],
    [/\b(draft\w*|rewrite|rephrase|summar(?:y|ies|i[sz]e\w*)|documentation|docs|readme|post|invite|wish(?:es)?|notes|thank you)\b/, 2],
    [/\b(write|writing|copy|text|words?)\b/, 1],
  ],
  // Personal life: outweighs a lone "ideas" or "plan" so a trip or a workout is not "Product".
  general: [
    [/\b(trip|travel|itinerary|vacation|holiday|recipes?|cook\w*|workout|gym|diet|fitness|movies?|reading list|gifts?|birthday|wedding|kitchen|renovation|apartment|doctor|kids|homework)\b/, 2],
    [/\b(books?|home|budget|weekend|family|personal)\b/, 1],
  ],
}

/** Tools named in titles that say "this is analytics", not just "this is technical". */
export const ANALYTICS_TOOLS = new Set(['mixpanel', 'clevertap', 'bigquery', 'metabase'])
/** Tools that say "this is product work". */
export const PRODUCT_TOOLS = new Set(['figma', 'notion', 'jira'])
