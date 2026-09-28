import { CONVERSATION_HREF, CONVERSATION_ID } from '../chatgpt/selectors'

export type NavigationResult = 'spa' | 'reload' | 'new-tab' | 'invalid'

/**
 * Opens a conversation. If ChatGPT's own sidebar already has a link to it,
 * clicking that link lets ChatGPT's router do a client-side navigation.
 * Otherwise fall back to a normal page load.
 */
export function navigateToConversation(id: string, opts: { newTab?: boolean; beforeReload?: () => void } = {}): NavigationResult {
  if (!CONVERSATION_ID.test(id)) return 'invalid'
  const path = `/c/${id}`
  if (opts.newTab) {
    window.open(path, '_blank', 'noopener')
    return 'new-tab'
  }
  const native = findNativeLink(id)
  if (native) {
    native.click()
    return 'spa'
  }
  opts.beforeReload?.()
  location.assign(path)
  return 'reload'
}

function findNativeLink(id: string): HTMLAnchorElement | null {
  // Our own links live in a shadow root, so document queries only see ChatGPT's.
  for (const a of document.querySelectorAll<HTMLAnchorElement>(`a[href*="/c/${id}"]`)) {
    if (CONVERSATION_HREF.exec(a.getAttribute('href') ?? '')?.[1] === id) return a
  }
  return null
}
