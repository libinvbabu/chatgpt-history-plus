// A stand-in for chatgpt.com, served through Playwright routing: a tiny SPA
// with a ChatGPT-like sidebar, plus fake session and conversation APIs.
// All data is synthetic.

import type { Route } from '@playwright/test'

export interface MockConversation {
  id: string
  title: string | null
  create_time: string | number
  update_time: string | number
}

const DAY = 86_400_000

function uuid(n: number): string {
  const h = n.toString(16).padStart(12, '0')
  return `6f1a9c2e-${h.slice(0, 4)}-4a7b-9c1d-${h}`
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const A = ['Review', 'Debug', 'Plan', 'Draft', 'Explain', 'Compare', 'Design', 'Refactor', 'Summarise', 'Fix', 'Estimate', 'Outline']
const B = ['onboarding flow', 'Postgres index', 'hiring loop', 'pricing page', 'webhook retries', 'Q3 roadmap', 'React hooks', 'budget sheet', 'launch email', 'CI pipeline', 'data model', 'API errors', 'weekend trip', 'workout plan', 'reading list']

export const SESSION = {
  user: { id: 'user-E2EFAKE0000000000000000', name: 'E2E User', email: 'e2e@example.com' },
  expires: '2099-01-01T00:00:00.000Z',
  account: { id: '00000000-0000-4000-8000-00000000e2e0', planType: 'plus', structure: 'personal' },
  accessToken: 'e2e.fake.token',
}

/** Neutral titles for public store screenshots (no real brands). */
const SHOWCASE_NAMES = [
  'Plan the product launch checklist',
  'Debug flaky login test',
  'Weekend trip itinerary ideas',
  'Pricing page copy review',
  'Quarterly OKR draft',
  'Invoice reconciliation script',
  'Kitchen renovation budget',
]

/** Named conversations the tests look for, placed at fixed relative days. */
export function makeDataset(total: number, now = Date.now(), showcase = false) {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const t0 = today.getTime()
  const sinceMidnight = now - t0
  const rand = mulberry32(42)
  const at = (daysAgo: number, frac = 0.5) => (daysAgo === 0 ? t0 + Math.floor(sinceMidnight * frac) : t0 - daysAgo * DAY + Math.floor(DAY * frac))

  const named: Array<[string, number, number?]> = [
    ['Investigate Meta sync failure', at(0, 0.9)],
    ['Review duplicate Paytm debit query', at(0, 0.5)],
    ['Mobile game ideas', at(1, 0.5)],
    ['Paytm PreNotify architecture', at(10, 0.4)],
    ['Apple developer enrolment', at(12, 0.6)],
    ['Paytm reconciliation', at(40, 0.4), at(70, 0.3)],
    ['Kisan pricing model', at(400, 0.5)],
  ]
  if (showcase) named.forEach((row, i) => (row[0] = SHOWCASE_NAMES[i]!))
  const items: MockConversation[] = []
  let n = 0
  const iso = (ms: number) => new Date(ms).toISOString().replace('Z', '000Z')
  for (const [title, updated, created] of named) {
    items.push({ id: uuid(++n), title, create_time: iso(created ?? updated), update_time: iso(updated) })
  }
  while (items.length < total) {
    const daysAgo = Math.floor(Math.pow(rand(), 2.2) * 900) + 2
    const updated = at(daysAgo, rand())
    const created = updated - Math.floor(rand() * 20) * DAY
    const title = rand() < 0.02 ? null : `${A[Math.floor(rand() * A.length)]} ${B[Math.floor(rand() * B.length)]}`
    // Mix numeric and ISO timestamps, as the real API has done.
    const fmt = (ms: number) => (n % 3 === 0 ? ms / 1000 : iso(ms))
    items.push({ id: uuid(++n), title, create_time: fmt(created), update_time: fmt(updated) })
  }
  const time = (v: string | number) => (typeof v === 'number' ? v * 1000 : Date.parse(v))
  items.sort((a, b) => time(b.update_time) - time(a.update_time))
  return items
}

export interface RequestLogEntry {
  path: string
  offset: number | null
  at: number
  status: number
  headers: Record<string, string>
}

export class MockChatGPT {
  conversations: MockConversation[]
  log: RequestLogEntry[] = []
  loggedOut = false
  failAll = false
  rateLimitOnce = false
  /** Answer the next N list requests with 429 + this Retry-After (seconds). */
  rateLimitNext = 0
  rateLimitRetryAfter = '1'
  /** 'current' mirrors ChatGPT's Sep 2026 signed-in sidebar; 'legacy' the 2025 one. */
  layout: 'current' | 'legacy' = 'current'
  /** Neutral titles and a fake chat transcript, for store screenshots. */
  showcase = false
  constructor(total = 650) {
    this.conversations = makeDataset(total)
  }

  useShowcase() {
    this.showcase = true
    this.conversations = makeDataset(this.conversations.length, Date.now(), true)
  }

  byTitle(title: string) {
    const c = this.conversations.find((x) => x.title === title)
    if (!c) throw new Error(`no conversation ${title}`)
    return c
  }

  apiRequests() {
    return this.log.filter((l) => l.path.startsWith('/backend-api/'))
  }

  async handle(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const entry: RequestLogEntry = { path: url.pathname, offset: null, at: Date.now(), status: 200, headers: req.headers() }
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      entry.status = status
      this.log.push(entry)
      return route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
    }

    if (url.pathname === '/api/auth/session') {
      if (this.failAll) return json(503, {})
      return json(200, this.loggedOut ? {} : SESSION)
    }
    if (url.pathname === '/backend-api/conversations') {
      entry.offset = Number(url.searchParams.get('offset'))
      if (this.failAll) return json(503, { detail: 'unavailable' })
      if (req.headers()['authorization'] !== `Bearer ${SESSION.accessToken}`) return json(401, { detail: 'unauthorized' })
      if (this.rateLimitOnce) {
        this.rateLimitOnce = false
        return json(429, { detail: 'slow down' }, { 'retry-after': '1' })
      }
      if (this.rateLimitNext > 0 && entry.offset > 0) {
        this.rateLimitNext--
        return json(429, { detail: 'slow down' }, { 'retry-after': this.rateLimitRetryAfter })
      }
      const offset = entry.offset
      const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 28))
      const items = this.conversations.slice(offset, offset + limit).map((c) => ({ ...c, mapping: null, current_node: null, gizmo_id: null, is_archived: false, safe_urls: [] }))
      return json(200, { items, total: this.conversations.length, limit, offset, has_missing_conversations: false })
    }
    if (url.pathname === '/' || url.pathname.startsWith('/c/')) {
      entry.status = 200
      this.log.push(entry)
      return route.fulfill({ status: 200, contentType: 'text/html', body: this.page() })
    }
    entry.status = 404
    this.log.push(entry)
    return route.fulfill({ status: 404, body: '' })
  }

  /** ChatGPT-like shell: a sidebar showing only the most recent chats. */
  page() {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const recent = this.conversations.slice(0, 28).map((c) => ({ id: c.id, title: c.title ?? 'New chat' }))
    const pinned = this.conversations[28]!
    const all = Object.fromEntries(this.conversations.map((c) => [c.id, c.title ?? 'New chat']))
    const sidebar = this.layout === 'legacy' ? this.legacySidebar() : this.currentSidebar(esc(pinned.title ?? 'New chat'), pinned.id)
    return `<!doctype html>
<html class="light"><head><meta charset="utf-8"><title>ChatGPT</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;font-size:14px;color:#0d0d0d;background:#fff}
  html.dark body{background:#212121;color:#ececec}
  html.dark aside{background:#181818}
  .shell{display:flex;height:100vh}
  aside{width:260px;background:#f9f9f9;overflow:auto;flex:none;position:relative}
  nav{padding:8px}
  .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .menu-item,a.item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;color:inherit;text-decoration:none;cursor:pointer}
  .menu-item:hover,a.item:hover{background:rgba(0,0,0,.05)}
  a.item .truncate{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  a.item .trailing{display:none} a.item:hover .trailing{display:block}
  /* current layout */
  .toolbar{display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 8px 0 16px;font-weight:600}
  .icon-btn{all:unset;display:grid;place-items:center;width:36px;height:36px;border-radius:10px;cursor:pointer}
  .nav-list{display:flex;flex-direction:column;gap:1px}
  .sidebar-item{all:unset;box-sizing:border-box;display:flex;align-items:center;width:100%;height:35px;padding:6px 8px;border-radius:10px;gap:8px;cursor:pointer;font-size:14px}
  .sidebar-item:hover{background:rgba(0,0,0,.05)}
  .sidebar-item .line{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
  .icon-leading-slot{display:flex;align-items:center;justify-content:center;min-width:20px}
  .text-fade-truncate{white-space:nowrap;overflow:hidden}
  section h3{font-size:14px;color:#8f8f8f;margin:18px 8px 6px;font-weight:500}
  .row{position:relative;display:flex;align-items:center;height:36px;padding:0 8px;border-radius:10px}
  .row:hover{background:rgba(0,0,0,.05)}
  .row .tt{display:flex;flex:1;min-width:0;align-items:center;gap:8px}
  .row a.title-link{display:flex;flex:1;min-width:0;color:inherit;text-decoration:none}
  .row [data-thread-title]{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .row .rail{min-width:0} .row:hover .rail{min-width:56px}
  .row .actions{position:absolute;right:6px;top:0;height:100%;display:flex;align-items:center;opacity:0}
  .row:hover .actions{opacity:1}
  main{flex:1;padding:40px;overflow:auto}
  main.chat{padding:48px 0 0}
  .thread{max-width:720px;margin:0 auto;padding:0 32px 0 440px;line-height:1.6;font-size:15px}
  .bubble{margin-left:auto;max-width:70%;width:max-content;background:#f1f1f1;border-radius:18px;padding:10px 16px;margin-bottom:28px}
  html.dark .bubble{background:#303030}
  .thread li{margin:6px 0}
</style></head>
<body><div class="shell">
${sidebar}
${this.showcase ? '<main class="chat"><div class="thread"><div class="bubble" id="title"></div><div id="where" hidden></div><p>Here’s a structured plan you can adapt:</p><ol><li><strong>Define the goal</strong> and what “done” looks like.</li><li><strong>List the steps</strong>, owners and dates.</li><li><strong>Flag the risks</strong> early and agree on fallbacks.</li><li><strong>Review weekly</strong> and adjust.</li></ol><p>Want me to turn this into a checklist?</p></div></main>' : '<main><h1 id="title"></h1><p id="where"></p></main>'}
</div>
<script>
  const RECENT = ${JSON.stringify(recent)};
  const ALL = ${JSON.stringify(all)};
  const LAYOUT = ${JSON.stringify(this.layout)};
  window.__pageLoads = (window.__pageLoads || 0) + 1;
  const esc = t => t.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  function row(c, i) {
    if (LAYOUT === 'legacy') return '<a class="item" href="/c/' + c.id + '"><div class="truncate">' + esc(c.title) + '</div><div class="trailing"><button aria-label="Open conversation options">…</button></div></a>';
    // Every 5th row carries a second, aria-hidden icon link, like ChatGPT's "Work" rows.
    const extra = i % 5 === 4 ? '<a tabindex="-1" aria-hidden="true" href="/c/' + c.id + '"><svg width="16" height="16"></svg></a>' : '';
    return '<div role="listitem"><div class="row" role="group" aria-label="' + esc(c.title) + '"><div class="tt" data-thread-title-trigger="true"><a class="title-link" data-interactive-row-link="true" href="/c/' + c.id + '"><span data-thread-title="true">' + esc(c.title) + '</span></a>' + extra + '</div><div class="rail"></div><div class="actions"><button aria-label="Chat actions">…</button></div></div></div>';
  }
  function renderSidebar() {
    const h = document.getElementById('history');
    if (h) h.innerHTML = RECENT.map(row).join('');
  }
  function renderMain() {
    const m = location.pathname.match(/\\/c\\/([^/]+)/);
    document.getElementById('title').textContent = m ? (ALL[m[1]] || 'Not found') : 'What can I help with?';
    document.getElementById('where').textContent = location.pathname;
    document.title = m ? (ALL[m[1]] || 'ChatGPT') : 'ChatGPT';
  }
  // Client-side routing, like ChatGPT's router: sidebar links never reload.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('nav a[href*="/c/"], a[data-testid="create-new-chat-button"]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    history.pushState({}, '', a.getAttribute('href'));
    window.__spaNavigations = (window.__spaNavigations || 0) + 1;
    renderMain();
  });
  window.addEventListener('popstate', renderMain);
  renderSidebar(); renderMain();
  // React-style re-renders that throw away sidebar DOM nodes.
  setInterval(renderSidebar, 2500);
</script></body></html>`
  }

  /** 2025: nav[aria-label="Chat history"], New chat link, "Search chats" row. */
  private legacySidebar() {
    return `<aside><nav aria-label="Chat history">
  <a class="menu-item" data-testid="create-new-chat-button" href="/">New chat</a>
  <div><div class="menu-item" role="button" tabindex="0">Search chats<span style="margin-left:auto;opacity:.5">⌘ K</span></div></div>
  <h2 style="font-size:12px;color:#8f8f8f;margin:16px 10px 6px;font-weight:500">Chats</h2>
  <div id="history"></div>
</nav></aside>`
  }

  /** Sep 2026 (signed in), reduced from the real DOM: hidden rail, text-only New chat, data-sidebar-destination menu. */
  private currentSidebar(pinnedTitle: string, pinnedId: string) {
    const icon = '<span class="icon-leading-slot"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg></span>'
    const item = (label: string, attrs: string) => `<button type="button" class="sidebar-item" ${attrs}><div class="line">${icon}<span class="text-fade-truncate">${label}</span></div></button>`
    return `<aside class="app-shell-left-panel"><div><div id="app-shell-sidebar">
  <div inert style="position:absolute;opacity:0;pointer-events:none"><nav aria-label="Show sidebar" data-app-navigation-rail="true" style="display:none !important">
    <div class="nav-list">
      <span class="contents"><button type="button" aria-label="New chat"><span class="sr-only">New chat</span></button></span>
      <span class="contents"><button type="button" aria-label="Search"><span class="sr-only">Search</span></button></span>
      <span class="contents"><button type="button" aria-label="Library"><span class="sr-only">Library</span></button></span>
    </div>
  </nav></div>
  <div>
    <div class="toolbar"><span>ChatGPT</span><span><button type="button" class="icon-btn" aria-label="Search"><svg width="20" height="20"></svg></button><button type="button" class="icon-btn" aria-label="Hide sidebar"><svg width="20" height="20"></svg></button></span></div>
    <nav role="navigation" aria-label="Chat history">
      <div class="header"><div data-appearance="plain" class="nav-list"><div class="min-w-0 flex-1">${item('New chat', 'aria-current="page"')}</div></div></div>
      <div data-app-action-sidebar-scroll="">
        <div><div class="px-row-x"><div data-appearance="plain" class="nav-list" id="menu-group">
          ${item('Scheduled', 'data-sidebar-destination="builtin:automations"')}
          ${item('Library', 'data-sidebar-destination="builtin:library"')}
          ${item('<span>Plugins</span>', 'data-sidebar-destination="builtin:skills"')}
          ${item('Explore', 'aria-haspopup="menu"')}
        </div></div></div>
        <section data-app-action-sidebar-section-heading="Pinned"><h3><button type="button" data-app-action-sidebar-section-toggle="" style="all:unset">Pinned</button></h3>
          <div role="list"><div role="listitem"><div class="row" role="group"><div class="tt" data-thread-title-trigger="true"><a class="title-link" href="/c/${pinnedId}"><span data-thread-title="true">${pinnedTitle}</span></a></div><div class="rail"></div></div></div></div>
        </section>
        <section data-app-action-sidebar-section-heading="Recents"><h3><button type="button" data-app-action-sidebar-section-toggle="" style="all:unset">Recents</button></h3>
          <div role="list" id="history"></div>
        </section>
      </div>
    </nav>
  </div>
</div></div></aside>`
  }
}
