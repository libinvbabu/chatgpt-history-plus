// Service worker: routes the keyboard command and toolbar button to the
// content script in the active tab. Neither needs the "tabs" permission.

import { TOGGLE_MESSAGE } from '../shared/messages'

async function toggle(tab?: chrome.tabs.Tab) {
  if (tab?.id === undefined) return
  try {
    await chrome.tabs.sendMessage(tab.id, { type: TOGGLE_MESSAGE })
  } catch {
    // No History+ content script in this tab (not chatgpt.com, or opened
    // before the extension loaded): open ChatGPT with the panel showing.
    await chrome.storage.local.set({ restore: { until: Date.now() + 20_000, open: true } })
    await chrome.tabs.create({ url: 'https://chatgpt.com/' })
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-history-plus') void toggle(tab)
})

chrome.action.onClicked.addListener((tab) => void toggle(tab))
