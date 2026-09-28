export const isMac = /mac|iphone|ipad/i.test(
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
)

export const SHORTCUT_LABEL = isMac ? '⇧⌘H' : 'Ctrl+Shift+H'

/** True while this content script's extension is still loaded (false after an update/reload). */
export function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}
