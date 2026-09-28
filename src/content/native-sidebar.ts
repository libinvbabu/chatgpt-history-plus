// Best-effort enhancements to ChatGPT's own sidebar:
//   1. a "History+" menu entry (under New chat, or after "Search chats")
//   2. a small date beside each conversation link
//
// We only ever add our own nodes (marked with data-chp-*), never move or
// remove React-owned ones. If ChatGPT's DOM changes, these quietly stop
// working and the History+ panel is unaffected.

import { CONVERSATION_HREF, SELECTORS, findEntrySlot, isHiddenCopy, type EntrySlot } from '../chatgpt/selectors'
import type { HistoryIndex, TimestampMode } from '../history/types'
import { effectiveTime } from '../history/types'
import { formatCompact, formatFull } from '../utils/dates'
import { SHORTCUT_LABEL } from '../shared/platform'

const DATE_ATTR = 'data-chp-date'
const ENTRY_ATTR = 'data-chp-entry'
const STYLE_ID = 'chp-native-style'

const PAGE_CSS = `
[${DATE_ATTR}]{flex:none;align-self:center;margin-inline-start:8px;font-size:11px;line-height:16px;opacity:.55;white-space:nowrap;font-variant-numeric:tabular-nums}
a:hover>[${DATE_ATTR}="trailing"],a:focus-visible>[${DATE_ATTR}="trailing"]{display:none}
[${ENTRY_ATTR}]{display:block}
`

const ENTRY_CSS = `
:host{display:block}
button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:var(--chp-gap,8px);width:100%;min-height:var(--chp-h,36px);padding:var(--chp-pad,6px 10px);border-radius:var(--chp-radius,10px);cursor:pointer;font:inherit;font-size:var(--chp-font,14px);line-height:var(--chp-lh,20px);color:var(--chp-color,inherit)}
button:hover,button:focus-visible{background:color-mix(in srgb,currentColor 8%,transparent)}
button:focus-visible{outline:2px solid color-mix(in srgb,currentColor 40%,transparent);outline-offset:-2px}
.icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:var(--chp-icon-box,20px)}
svg{width:var(--chp-icon,20px);height:var(--chp-icon,20px)}
.label{flex:1}
.kbd{opacity:0;font-size:12px;color:color-mix(in srgb,currentColor 55%,transparent);transition:opacity .12s}
button:hover .kbd,button:focus-visible .kbd{opacity:1}
`

const CLOCK_SVG =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.4 7.2A7 7 0 1 1 3 10"/><path d="M3 4v3.4h3.4"/><path d="M10 6.4V10l2.4 1.6"/></svg>'

export interface NativeSidebarOptions {
  onOpen(): void
}

export class NativeSidebar {
  private entry: HTMLElement | null = null

  constructor(private readonly opts: NativeSidebarOptions) {}

  update(nav: HTMLElement | null, index: HistoryIndex | null, mode: TimestampMode, showDates: boolean): void {
    ensurePageStyle()
    if (nav) this.placeEntry(nav)
    if (!nav) return
    if (showDates && index) decorateDates(nav, index, mode)
    else removeDates(nav)
  }

  destroy(): void {
    this.entry?.remove()
    this.entry = null
    removeDates(document)
    document.getElementById(STYLE_ID)?.remove()
  }

  private placeEntry(root: HTMLElement) {
    const slot = findEntrySlot(root)
    if (!slot) return
    const entry = (this.entry ??= this.createEntry())
    const inPlace = entry.parentElement === slot.parent && (slot.before === entry || entry.nextSibling === slot.before)
    if (!inPlace) slot.parent.insertBefore(entry, slot.before)
    matchNativeItem(entry, slot)
  }

  private createEntry(): HTMLElement {
    const host = document.createElement('div')
    host.setAttribute(ENTRY_ATTR, '')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${ENTRY_CSS}</style><button type="button" aria-label="Open History+ (${SHORTCUT_LABEL})"><span class="icon">${CLOCK_SVG}</span><span class="label">History+</span><span class="kbd">${SHORTCUT_LABEL}</span></button>`
    root.querySelector('button')!.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.opts.onOpen()
    })
    return host
  }
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
  // Computed styles, not getBoundingClientRect: rects include CSS zoom, which
  // would then be applied a second time to the entry.
  const px = (v: string | undefined) => (v && /^\d+(\.\d+)?px$/.test(v) ? v : undefined)
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
  for (const [k, v] of Object.entries(vars)) if (v && host.style.getPropertyValue(k) !== v) host.style.setProperty(k, v)
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
