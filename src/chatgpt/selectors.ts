// Every assumption about ChatGPT's DOM lives here. Prefer semantic hooks
// (hrefs, aria, data-* attributes) over structure, and keep fallbacks ordered
// from most to least specific. Anything that uses these must fail silently.
//
// Observed layouts (all must keep working; the e2e mock renders each):
//   2025      nav[aria-label="Chat history"] with data-testids and a
//             "Search chats" menu row.
//   28 Sep 26 aside.app-shell-left-panel > #app-shell-sidebar. A collapsed
//             icon rail (nav[data-app-navigation-rail], inert, display:none)
//             duplicates New chat/Search. nav[aria-label="Chat history"]
//             holds a text-only "New chat" <button>, a menu group of
//             button[data-sidebar-destination] (Scheduled, Library, Plugins),
//             then Pinned / Projects / Recents sections of a[href="/c/{id}"]
//             rows. Some rows add a second, aria-hidden icon link.
//   30 Sep 26 The rail is now visible and owns the [data-sidebar-destination]
//             buttons (Home, Space, Scheduled, Plugins). The conversation nav
//             is nav[aria-label="Home"]: a header (toolbar + "New chat") that
//             is sized to its own rows (anything added there is clipped), then
//             [data-app-action-sidebar-scroll] with the sections. The Recents
//             header has a hover-only icon button also labelled "New chat",
//             and the logo is a[href="/"].

export const SELECTORS = {
  /** Conversation navs, most specific first. */
  sidebarNav: ['nav[aria-label="Chat history"]', 'nav[aria-label="Home"]', 'nav'],
  /** Wider containers, for layouts whose "New chat" sits outside the nav (signed-out pages). */
  sidebarContainer: ['#app-shell-sidebar', 'aside[aria-label="Sidebar"]', '#stage-slideover-sidebar'],
  newChat: ['[data-testid="create-new-chat-button"]', 'a[aria-label="New chat"]', 'button[aria-label="New chat"]'],
  menuItem: ['[data-sidebar-destination]'],
  scrollArea: '[data-app-action-sidebar-scroll]',
  searchChats: ['[data-testid="search-conversations"]', '[data-testid*="search-chat" i]'],
  conversationLink: 'a[href*="/c/"]',
  /** A native list of rows; the entry should join the list, not wrap around it. */
  navList: '[data-appearance]',
} as const

/** Visible text of the old "Search chats" row, for when no test id matches. */
export const SEARCH_CHATS_TEXT = /^search( chats?)?$/i
/** The "⌘K" / "Ctrl K" hint ChatGPT renders inside that row. */
const SHORTCUT_HINT = /\s*(⌘|ctrl\s*\+?)\s*k$/i
const NEW_CHAT_TEXT = /^new chat$/i
const HIDDEN_COPY = '[inert], [aria-hidden="true"], [data-app-navigation-rail]'

export const CONVERSATION_HREF = /\/c\/([A-Za-z0-9_-]{1,128})(?:[/?#]|$)/
export const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,128}$/

export function conversationIdFromPath(path: string): string | null {
  return CONVERSATION_HREF.exec(path)?.[1] ?? null
}

/** Inside an inert/aria-hidden duplicate such as the collapsed sidebar rail. Cheap: no layout. */
export function isHiddenCopy(el: Element): boolean {
  return !!el.closest(HIDDEN_COPY)
}

/** Rendered and interactive. Forces layout, so only use it for discovery, not per-row work. */
export function isUsable(el: Element): boolean {
  return !isHiddenCopy(el) && el.getClientRects().length > 0
}

function queryUsable(root: ParentNode, selectors: readonly string[]): HTMLElement | null {
  for (const sel of selectors) {
    try {
      for (const el of root.querySelectorAll<HTMLElement>(sel)) if (isUsable(el)) return el
    } catch {
      // Invalid selector in this browser; try the next one.
    }
  }
  return null
}

function hasSidebarContent(el: HTMLElement): boolean {
  return !!(el.querySelector(SELECTORS.conversationLink) || el.querySelector(SELECTORS.menuItem[0]) || findNewChat(el))
}

/**
 * The visible sidebar container: the one we observe for changes, decorate
 * with dates, and place the History+ entry in. Prefers the conversation
 * <nav>; never the icon rail.
 */
export function findSidebar(doc: Document = document): HTMLElement | null {
  const usableNav = (el: HTMLElement) => isUsable(el) && !el.matches('[data-app-navigation-rail]')
  for (const sel of SELECTORS.sidebarNav) {
    for (const el of doc.querySelectorAll<HTMLElement>(sel)) {
      if (usableNav(el) && el.querySelector(SELECTORS.conversationLink)) return el
    }
  }
  for (const sel of SELECTORS.sidebarContainer) {
    for (const el of doc.querySelectorAll<HTMLElement>(sel)) {
      if (isUsable(el) && hasSidebarContent(el)) return el
    }
  }
  for (const el of doc.querySelectorAll<HTMLElement>('nav')) {
    if (usableNav(el) && hasSidebarContent(el)) return el.closest<HTMLElement>('aside') ?? el
  }
  return null
}

function textOf(el: Element): string {
  return (el.textContent ?? '').trim()
}

/**
 * The main "New chat" row. Matched by visible text first: in the Sep-30
 * layout an icon-only button inside the Recents header shares its label.
 */
function findNewChat(root: HTMLElement): HTMLElement | null {
  const candidate = (el: HTMLElement) => !isHiddenCopy(el) && !el.closest('section')
  for (const el of root.querySelectorAll<HTMLElement>('a, button')) {
    if (NEW_CHAT_TEXT.test(textOf(el)) && candidate(el)) return el
  }
  for (const sel of SELECTORS.newChat) {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) if (candidate(el)) return el
  }
  return null
}

function findSearchChats(root: HTMLElement): HTMLElement | null {
  const bySelector = queryUsable(root, SELECTORS.searchChats)
  if (bySelector) return bySelector
  // A text row, not an icon-only button: match visible text, not aria-label.
  const candidates = root.querySelectorAll<HTMLElement>('a, button, [role="button"]')
  for (let i = 0; i < candidates.length && i < 60; i++) {
    const el = candidates[i]!
    if (SEARCH_CHATS_TEXT.test(textOf(el).replace(SHORTCUT_HINT, '')) && isUsable(el)) return el
  }
  return null
}

/** Climb single-child wrappers so we act on the whole menu row, stopping at a native list. */
function rowOf(el: HTMLElement, stop: HTMLElement): HTMLElement {
  while (el.parentElement && el.parentElement !== stop && el.parentElement.childElementCount === 1 && !el.parentElement.matches(SELECTORS.navList)) {
    el = el.parentElement
  }
  return el
}

export interface EntrySlot {
  parent: HTMLElement
  before: Node | null
  /** A native menu item to copy spacing from. */
  reference: HTMLElement
  /** When the entry starts its own group, copy horizontal padding from this container. */
  paddingFrom?: HTMLElement
}

/** The nearest ancestor (below `root`) that insets its rows horizontally. */
function insetContainer(el: HTMLElement, root: HTMLElement): HTMLElement | undefined {
  for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (parseFloat(s.paddingLeft) > 0 || parseFloat(s.paddingRight) > 0) return p
  }
  return undefined
}

/** Where the History+ entry goes, and which native item it should look like. */
export function findEntrySlot(root: HTMLElement): EntrySlot | null {
  const before = (el: HTMLElement): EntrySlot | null => {
    const row = rowOf(el, root)
    return row.parentElement ? { parent: row.parentElement, before: row, reference: el } : null
  }
  const after = (el: HTMLElement): EntrySlot | null => {
    const row = rowOf(el, root)
    return row.parentElement ? { parent: row.parentElement, before: row.nextSibling, reference: el } : null
  }

  // 2025 layout: right after "Search chats".
  const search = findSearchChats(root)
  if (search) return after(search)

  // 28 Sep layout: top of the menu group (Scheduled, Library, …), just under New chat.
  const menuItem = queryUsable(root, SELECTORS.menuItem)
  if (menuItem) return before(menuItem)

  const newChat = findNewChat(root)

  // 30 Sep layout: no menu group, and the header around New chat clips extra
  // rows. Start the scrolling list instead, where the menu group used to be,
  // aligned with New chat.
  const scroll = root.querySelector<HTMLElement>(SELECTORS.scrollArea)
  if (scroll && newChat && isUsable(scroll)) {
    return { parent: scroll, before: scroll.firstChild, reference: newChat, paddingFrom: insetContainer(newChat, root) }
  }

  // Unknown layout: first text menu item after New chat that isn't a chat,
  // GPT/project link or section header.
  for (const el of root.querySelectorAll<HTMLElement>('a, button')) {
    if (newChat && (el === newChat || newChat.contains(el) || !(newChat.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))) continue
    const href = el.getAttribute('href') ?? ''
    if (CONVERSATION_HREF.test(href) || href.startsWith('/g/') || el.closest(`${SELECTORS.conversationLink}, section, [data-chp-entry]`)) continue
    if (!textOf(el) || !isUsable(el)) continue
    return before(el)
  }

  // Last resort: directly after New chat.
  return newChat ? after(newChat) : null
}
