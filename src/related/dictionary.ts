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
