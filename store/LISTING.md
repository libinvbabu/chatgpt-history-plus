# Chrome Web Store submission kit

Everything the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) asks for, in the order it asks. Copy each field as-is.

## Package

```bash
npm run zip
```

Upload `release/chatgpt-history-plus-<version>.zip`.

## Store listing tab

**Name** (from the manifest): `History+ for ChatGPT`

**Summary** (from the manifest, 126 of 132 characters):

> Browse and search your ChatGPT history by date: timestamps, date groups and instant local search. Nothing leaves your browser.

**Description:**

```
Find any old ChatGPT conversation by when it happened.

You remember discussing something "around the third week of August" but not what the chat was called. ChatGPT's sidebar keeps only recent chats close at hand, and its search needs the right words. History+ adds the missing piece: time.

WHAT YOU GET
• Your whole history, grouped by date: Today, Yesterday, This week, Last week, then months and years, with week and day dividers.
• Dates beside every conversation in ChatGPT's own sidebar.
• Instant search that understands dates: "roadmap last month", "around sep 14", "invoice in aug", "created:2026-07".
• Switch between Last active and Created dates; hover any chat to see both.
• Keyboard-first: ⇧⌘H / Ctrl+Shift+H to open, ↑ ↓ to move, Enter to open, Esc to close.
• Opens beside the chat, so you can click through candidates without losing your place.
• Works with personal and Team/Business workspaces (separate caches), in light and dark mode.
• Fast with 10,000+ conversations.

PRIVATE BY DESIGN
• Reads only conversation titles, IDs and timestamps: the same list ChatGPT's sidebar shows. Never message content.
• Everything stays in your browser. No servers, no analytics, no third parties.
• Your ChatGPT session token is used in memory only and never stored.
• Clear all local data with one click in Settings.

Open source: https://github.com/libinvbabu/chatgpt-history-plus

History+ is an independent project, not affiliated with or endorsed by OpenAI. ChatGPT is a trademark of OpenAI.
```

**Category:** Productivity → Workflow & Planning. Productivity → Tools also fits.

**Language:** English

**Graphic assets** (all in this folder, all synthetic data):

| Field | File |
|---|---|
| Store icon (128×128) | `../public/icons/icon-128.png` |
| Screenshots (1280×800, upload in this order) | `screenshot-1-timeline.png`, `screenshot-2-search.png`, `screenshot-3-dates.png`, `screenshot-4-dark.png`, `screenshot-5-sidebar.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Marquee promo tile (1400×560, optional) | `promo-marquee-1400x560.png` |

**Links:**
- **Homepage URL:** https://github.com/libinvbabu/chatgpt-history-plus
- **Support URL:** https://github.com/libinvbabu/chatgpt-history-plus/issues

## Privacy practices tab

**Single purpose:**

> Lets users browse and search their own ChatGPT conversation history by date and title, directly on chatgpt.com.

**Permission justifications:**

- **storage:**

  > Stores the user's local index of ChatGPT conversation metadata (titles, IDs, timestamps) and their History+ settings on their device, so their history can be browsed and searched instantly without re-downloading it.

- **Host permission** (content script on `https://chatgpt.com/*`):

  > History+ only works on chatgpt.com. It adds its History+ panel and date labels to the ChatGPT page, and reads the signed-in user's conversation list from ChatGPT's own web app on that same site. It runs on no other website.

**Remote code:**

> No, I am not using remote code. All JavaScript is bundled in the package; nothing is fetched and executed at runtime.

**Data usage:** tick **Website content**. Conversation titles are content from chatgpt.com. Titles can contain anything the user typed, so this is the honest category, even though the data never leaves the device. Leave every other category unticked.

Then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/libinvbabu/chatgpt-history-plus/blob/main/PRIVACY.md

## Distribution tab

- **Visibility:** Public. You can choose Unlisted for a soft launch.
- **Regions:** All regions.
- **Price:** Free.

## Test instructions for reviewers

Paste into the "Test instructions" field if the dashboard offers it, otherwise into the reviewer notes:

```
1. Sign in at https://chatgpt.com with any account (a free account works). Having a few existing conversations helps.
2. Open History+ from the "History+" item in ChatGPT's left sidebar, with Ctrl+Shift+H (⇧⌘H on macOS), or with the toolbar icon.
3. The panel syncs conversation titles and dates (progress is shown), then groups them by date.
4. Type in the search box, e.g. a word from a chat title, or "last week". Click a result to open that conversation.
5. Settings (gear icon) → "Clear local data" removes everything the extension stored.
The extension only runs on chatgpt.com and makes requests only to chatgpt.com.
```
