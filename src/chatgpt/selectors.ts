// Every assumption about ChatGPT's DOM lives here. Prefer semantic hooks
// (hrefs, aria, data-* attributes) over structure, and keep fallbacks ordered
// from most to least specific. Anything that uses these must fail silently.
//
// Observed layouts:
//   2025      nav[aria-label="Chat history"] with data-testids and a
//             "Search chats" menu row.
//   Sep 2026  (signed in) aside.app-shell-left-panel > #app-shell-sidebar.
//             A collapsed icon rail (nav[data-app-navigation-rail], inert,
//             display:none) duplicates New chat/Search — must be ignored.
//             nav[aria-label="Chat history"] holds: "New chat" as a text-only
//             <button>; a menu group of button[data-sidebar-destination]
//             (Scheduled, Library, Plugins) + Explore; then Pinned / Projects /
//             Recents sections of a[href="/c/{id}"] rows. Some rows add a
//             second, aria-hidden icon link to the same conversation.
//             Search is an icon-only header button.

export const SELECTORS = {
  sidebarRoot: ['nav[aria-label="Chat history"]', '#app-shell-sidebar', 'aside[aria-label="Sidebar"]', '#stage-slideover-sidebar'],
  sidebarNav: ['nav[aria-label="Sidebar"]', 'aside nav', 'nav'],
  newChat: ['a[aria-label="New chat"]', 'button[aria-label="New chat"]', '[data-testid="create-new-chat-button"]', 'a[href="/"]'],
  menuItem: ['[data-sidebar-destination]'],
  searchChats: ['[data-testid="search-conversations"]', '[data-testid*="search-chat" i]'],
  conversationLink: 'a[href*="/c/"]',
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
 * with dates, and place the History+ entry in.
 */
export function findSidebar(doc: Document = document): HTMLElement | null {
  for (const sel of SELECTORS.sidebarRoot) {
    for (const el of doc.querySelectorAll<HTMLElement>(sel)) {
      if (isUsable(el) && hasSidebarContent(el)) return el
    }
  }
  for (const sel of SELECTORS.sidebarNav) {
    for (const el of doc.querySelectorAll<HTMLElement>(sel)) {
      if (isUsable(el) && hasSidebarContent(el)) return el.closest<HTMLElement>('aside') ?? el
    }
  }
  return null
}

function textOf(el: Element): string {
  return (el.textContent ?? '').trim()
}

function findNewChat(root: HTMLElement): HTMLElement | null {
  const bySelector = queryUsable(root, SELECTORS.newChat)
  if (bySelector) return bySelector
  for (const el of root.querySelectorAll<HTMLElement>('a, button')) {
    if (NEW_CHAT_TEXT.test(el.getAttribute('aria-label') ?? textOf(el)) && !isHiddenCopy(el)) return el
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

/** Climb single-child wrappers so we act on the whole menu row. */
function rowOf(el: HTMLElement, stop: HTMLElement): HTMLElement {
  while (el.parentElement && el.parentElement !== stop && el.parentElement.childElementCount === 1) el = el.parentElement
  return el
}

export interface EntrySlot {
  parent: HTMLElement
  before: Node | null
  /** A native menu item to copy spacing from. */
  reference: HTMLElement
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

  // Sep 2026 layout: top of the menu group (Scheduled, Library, …), just under New chat.
  const menuItem = queryUsable(root, SELECTORS.menuItem)
  if (menuItem) return before(menuItem)

  // Unknown layout: first text menu item after New chat that isn't a chat,
  // GPT/project link or section header.
  const newChat = findNewChat(root)
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
