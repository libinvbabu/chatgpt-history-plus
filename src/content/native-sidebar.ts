// Best-effort enhancements to ChatGPT's own page:
//   1. a "History+" menu entry (under New chat, or after "Search chats")
//   2. a "History+" icon in the icon rail, which stays visible when the
//      conversation panel is collapsed
//   3. a small date beside each conversation link
//   4. a floating launcher, shown only while neither entry can actually be
//      seen (a layout change we don't know yet, a clipped row, a narrow window)
//
// We only ever add our own nodes (marked with data-chp-*), never move or
// remove React-owned ones. If ChatGPT's DOM changes, these quietly stop
// working and the History+ panel is unaffected.

import { CONVERSATION_HREF, SELECTORS, findEntrySlot, findRailSlot, isHiddenCopy, type EntrySlot, type RailSlot } from '../chatgpt/selectors'
import type { HistoryIndex, TimestampMode } from '../history/types'
import { effectiveTime } from '../history/types'
import { formatCompact, formatFull } from '../utils/dates'
import { SHORTCUT_LABEL } from '../shared/platform'
import type { Theme } from './theme'

const DATE_ATTR = 'data-chp-date'
const ENTRY_ATTR = 'data-chp-entry'
const RAIL_ATTR = 'data-chp-rail-entry'
const LAUNCHER_ATTR = 'data-chp-launcher'
const STYLE_ID = 'chp-native-style'

/** How long no entry may be visible before the launcher appears. Rides out a React re-render. */
const LAUNCHER_DELAY_MS = 3000
/** Smallest visible size (px, each way) that counts as an entry being on screen. */
const MIN_VISIBLE_PX = 8

const PAGE_CSS = `
[${DATE_ATTR}]{flex:none;align-self:center;margin-inline-start:8px;font-size:11px;line-height:16px;opacity:.55;white-space:nowrap;font-variant-numeric:tabular-nums}
a:hover>[${DATE_ATTR}="trailing"],a:focus-visible>[${DATE_ATTR}="trailing"]{display:none}
[${ENTRY_ATTR}],[${RAIL_ATTR}]{display:block}
`

const ENTRY_CSS = `
:host{display:block;padding:var(--chp-inset,0)}
button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:var(--chp-gap,8px);width:100%;min-height:var(--chp-h,36px);padding:var(--chp-pad,6px 10px);border-radius:var(--chp-radius,10px);cursor:pointer;font:inherit;font-size:var(--chp-font,14px);line-height:var(--chp-lh,20px);color:var(--chp-color,inherit)}
button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 8%,transparent)}
button:focus-visible{outline:2px solid color-mix(in srgb,currentColor 40%,transparent);outline-offset:-2px}
.icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:var(--chp-icon-box,20px)}
svg{width:var(--chp-icon,20px);height:var(--chp-icon,20px)}
.label{flex:1}
.kbd{opacity:0;font-size:12px;color:color-mix(in srgb,currentColor 55%,transparent);transition:opacity .12s}
button:hover .kbd,button:focus-visible .kbd{opacity:1}
`

const RAIL_CSS = `
:host{display:block}
button{all:unset;box-sizing:border-box;display:grid;place-items:center;width:100%;height:var(--chp-h,36px);border-radius:var(--chp-radius,10px);cursor:pointer;color:var(--chp-color,inherit)}
button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 8%,transparent);color:var(--chp-color-hover,var(--chp-color,inherit))}
button:focus-visible{outline:2px solid color-mix(in srgb,currentColor 40%,transparent);outline-offset:-2px}
svg{width:var(--chp-icon,20px);height:var(--chp-icon,20px)}
`

// An edge tab, vertically centred: the one spot that composer, headers and
// sidebars all leave alone, at any window size.
const LAUNCHER_CSS = `
:host{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147482000;--bg:#fff;--fg:#0d0d0d;--bd:rgba(0,0,0,.16)}
:host([data-theme='dark']){--bg:#2f2f2f;--fg:#ececec;--bd:rgba(255,255,255,.2)}
button{all:unset;box-sizing:border-box;display:grid;place-items:center;width:30px;height:44px;border:1px solid var(--bd);border-right:0;border-radius:12px 0 0 12px;background:var(--bg);color:var(--fg);box-shadow:0 2px 10px rgba(0,0,0,.14);opacity:.85;cursor:pointer;transition:width .12s,opacity .12s}
button:hover,button:focus-visible{width:36px;opacity:1}
button:focus-visible{outline:2px solid color-mix(in srgb,var(--fg) 45%,transparent);outline-offset:-2px}
svg{width:18px;height:18px}
`

const CLOCK_SVG =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.4 7.2A7 7 0 1 1 3 10"/><path d="M3 4v3.4h3.4"/><path d="M10 6.4V10l2.4 1.6"/></svg>'

// The extension icon (scripts/icons.mjs): blue tile, white clock-with-arrow. The
// rail has nothing else in colour, so this is what draws the eye. Inline rather
// than a packaged PNG: crisp at any zoom, and no web-accessible resource for
// sites to fingerprint the extension with.
const TILE_SVG =
  '<svg viewBox="0 0 128 128" aria-hidden="true"><defs><linearGradient id="chp-tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b7cf2"/><stop offset="1" stop-color="#2d4bbf"/></linearGradient></defs><rect x="2" y="2" width="124" height="124" rx="30" fill="url(#chp-tile)"/><path d="M34.96 51.68A30.80 30.80 0 1 1 33.20 64.00M33.20 37.60v14.96h14.96M64.00 48.16V64.00l10.56 7.04" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export interface NativeSidebarOptions {
  onOpen(): void
}

export interface SidebarView {
  /** The conversation panel; null when collapsed away or not found. */
  nav: HTMLElement | null
  /** The always-visible icon rail, in layouts that have one. */
  rail: HTMLElement | null
  index: HistoryIndex | null
  mode: TimestampMode
  showDates: boolean
  /** The floating launcher may appear (not while signed out or still identifying). */
  allowLauncher: boolean
  theme: Theme
}

export class NativeSidebar {
  private entry: HTMLElement | null = null
  private railEntry: HTMLElement | null = null
  private launcher: HTMLElement | null = null
  private launcherOn = false
  private launcherTimer: ReturnType<typeof setTimeout> | undefined
  private allowLauncher = false
  private theme: Theme = 'light'
  /** Whether each of our entries is really on screen: connected, not clipped away, not collapsed to nothing. */
  private readonly onScreen = new WeakMap<Element, boolean>()
  private readonly visibility = new IntersectionObserver((records) => {
    for (const r of records) {
      this.onScreen.set(r.target, r.isIntersecting && r.intersectionRect.width >= MIN_VISIBLE_PX && r.intersectionRect.height >= MIN_VISIBLE_PX)
    }
    this.syncLauncher()
  })

  constructor(private readonly opts: NativeSidebarOptions) {}

  update(view: SidebarView): void {
    ensurePageStyle()
    this.allowLauncher = view.allowLauncher
    this.theme = view.theme
    if (view.nav) this.placeEntry(view.nav)
    if (view.rail) this.placeRailEntry(view.rail)
    if (view.nav) {
      if (view.showDates && view.index) decorateDates(view.nav, view.index, view.mode)
      else removeDates(view.nav)
    }
    this.syncLauncher()
  }

  destroy(): void {
    clearTimeout(this.launcherTimer)
    this.visibility.disconnect()
    for (const el of [this.entry, this.railEntry, this.launcher]) el?.remove()
    this.entry = this.railEntry = this.launcher = null
    removeDates(document)
    document.getElementById(STYLE_ID)?.remove()
  }

  private placeEntry(root: HTMLElement) {
    const slot = findEntrySlot(root)
    if (!slot) return
    const entry = (this.entry ??= this.createEntry())
    insertAt(entry, slot)
    matchNativeItem(entry, slot)
  }

  private placeRailEntry(rail: HTMLElement) {
    const slot = findRailSlot(rail)
    if (!slot) return
    const entry = (this.railEntry ??= this.createRailEntry())
    insertAt(entry, slot)
    matchRailItem(entry, slot)
  }

  private createEntry(): HTMLElement {
    const host = document.createElement('div')
    host.setAttribute(ENTRY_ATTR, '')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${ENTRY_CSS}</style><button type="button" aria-label="Open History+ (${SHORTCUT_LABEL})"><span class="icon">${CLOCK_SVG}</span><span class="label">History+</span><span class="kbd">${SHORTCUT_LABEL}</span></button>`
    this.bindOpen(root)
    this.visibility.observe(host)
    return host
  }

  private createRailEntry(): HTMLElement {
    const host = document.createElement('div')
    host.setAttribute(RAIL_ATTR, '')
    const root = host.attachShadow({ mode: 'open' })
    const label = `History+ (${SHORTCUT_LABEL})`
    root.innerHTML = `<style>${RAIL_CSS}</style><button type="button" aria-label="${label}" title="${label}">${TILE_SVG}</button>`
    this.bindOpen(root)
    this.visibility.observe(host)
    return host
  }

  private createLauncher(): HTMLElement {
    const host = document.createElement('div')
    host.setAttribute(LAUNCHER_ATTR, '')
    const root = host.attachShadow({ mode: 'open' })
    const label = `Open History+ (${SHORTCUT_LABEL})`
    root.innerHTML = `<style>${LAUNCHER_CSS}</style><button type="button" aria-label="${label}" title="${label}">${CLOCK_SVG}</button>`
    this.bindOpen(root)
    return host
  }

  private bindOpen(root: ShadowRoot) {
    root.querySelector('button')!.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.opts.onOpen()
    })
  }

  private isOnScreen(host: HTMLElement | null): boolean {
    return !!host?.isConnected && this.onScreen.get(host) === true
  }

  private launcherNeeded(): boolean {
    return this.allowLauncher && !this.isOnScreen(this.entry) && !this.isOnScreen(this.railEntry)
  }

  /** Show the launcher once no entry has been visible for a while; hide it the moment one is. */
  private syncLauncher() {
    if (!this.launcherNeeded()) {
      clearTimeout(this.launcherTimer)
      this.launcherTimer = undefined
      this.launcherOn = false
      this.launcher?.remove()
      return
    }
    if (this.launcherOn) {
      this.mountLauncher()
      return
    }
    this.launcherTimer ??= setTimeout(() => {
      this.launcherTimer = undefined
      if (!this.launcherNeeded()) return
      this.launcherOn = true
      this.mountLauncher()
    }, LAUNCHER_DELAY_MS)
  }

  private mountLauncher() {
    const host = (this.launcher ??= this.createLauncher())
    if (host.getAttribute('data-theme') !== this.theme) host.setAttribute('data-theme', this.theme)
    // ChatGPT's renderer can replace <body>'s children; re-attach if so.
    if (!host.isConnected) document.body.append(host)
  }
}

/** Put `entry` at `slot`, touching the DOM only if it isn't already there. */
function insertAt(entry: HTMLElement, slot: { parent: HTMLElement; before: Node | null }) {
  const inPlace = entry.parentElement === slot.parent && (slot.before === entry || entry.nextSibling === slot.before)
  if (!inPlace) slot.parent.insertBefore(entry, slot.before)
}

// Computed styles, not getBoundingClientRect: rects include CSS zoom, which
// would then be applied a second time to the entry.
const px = (v: string | undefined) => (v && /^\d+(\.\d+)?px$/.test(v) ? v : undefined)

function setVars(host: HTMLElement, vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) if (v && host.style.getPropertyValue(k) !== v) host.style.setProperty(k, v)
}

/** Copy spacing, type and colour from the neighbouring native item so the entry looks native. */
function matchNativeItem(host: HTMLElement, slot: EntrySlot) {
  const ref = slot.reference
  const s = getComputedStyle(ref)
  // The element holding the label text, and the row that lays out icon + label.
  const textEl = [ref, ...ref.querySelectorAll<HTMLElement>('*')].find((e) => [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) ?? ref
  const t = getComputedStyle(textEl)
  const svg = ref.querySelector('svg')
  const line = textEl.parentElement && textEl.parentElement !== ref.parentElement ? textEl.parentElement : ref
  const iconBox = svg ? [...line.children].find((c) => c.contains(svg)) : undefined
  const gap = getComputedStyle(line).columnGap
  const vars: Record<string, string | undefined> = {
    '--chp-pad': s.padding,
    '--chp-radius': s.borderRadius,
    '--chp-h': px(s.height),
    '--chp-gap': gap && gap !== 'normal' && gap !== '0px' ? gap : '8px',
    '--chp-font': t.fontSize,
    '--chp-lh': t.lineHeight,
    '--chp-color': t.color,
    '--chp-icon': svg ? px(getComputedStyle(svg).width) : undefined,
    '--chp-icon-box': iconBox ? px(getComputedStyle(iconBox).width) : undefined,
  }
  if (slot.paddingFrom) {
    const p = getComputedStyle(slot.paddingFrom)
    vars['--chp-inset'] = `0 ${p.paddingRight} 0 ${p.paddingLeft}`
  }
  setVars(host, vars)
}

/** Copy size, radius and colours from a native rail button, so the icon looks like its neighbours. */
function matchRailItem(host: HTMLElement, slot: RailSlot) {
  const ref = slot.reference
  const s = getComputedStyle(ref)
  const svg = ref.querySelector('svg')
  setVars(host, {
    '--chp-h': px(s.height),
    '--chp-radius': s.borderRadius,
    '--chp-color': s.color,
    // ChatGPT brightens rail icons on hover through this variable.
    '--chp-color-hover': s.getPropertyValue('--button-text-color-hover').trim() || undefined,
    '--chp-icon': svg ? px(getComputedStyle(svg).width) : undefined,
  })
}

function ensurePageStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = PAGE_CSS
  ;(document.head ?? document.documentElement).append(style)
}

function decorateDates(nav: HTMLElement, index: HistoryIndex, mode: TimestampMode) {
  const now = new Date()
  for (const link of nav.querySelectorAll<HTMLAnchorElement>(SELECTORS.conversationLink)) {
    // Skip decorative duplicates (a row's aria-hidden icon link, the hidden rail).
    if (isHiddenCopy(link)) {
      link.querySelector(`:scope > [${DATE_ATTR}]`)?.remove()
      continue
    }
    const id = CONVERSATION_HREF.exec(link.getAttribute('href') ?? '')?.[1]
    const conv = id ? index.conversations[id] : undefined
    const ts = conv ? effectiveTime(conv, mode) : null
    let span = link.querySelector<HTMLElement>(`:scope > [${DATE_ATTR}]`)
    if (ts == null) {
      span?.remove()
      continue
    }
    const text = formatCompact(ts, now)
    if (!span) {
      span = document.createElement('span')
      // Sit before ChatGPT's trailing "…" menu if there is one, and hide on
      // hover so the menu button has room.
      const trailing = [...link.children].find((c) => c.matches('button') || c.querySelector('button'))
      span.setAttribute(DATE_ATTR, trailing ? 'trailing' : '')
      span.setAttribute('aria-hidden', 'true')
      link.insertBefore(span, trailing ?? null)
    }
    if (span.textContent !== text) {
      span.textContent = text
      span.title = formatFull(ts)
    }
  }
}

function removeDates(root: ParentNode) {
  for (const el of root.querySelectorAll(`[${DATE_ATTR}]`)) el.remove()
}
