# Development

History+ is a Manifest V3 extension written in TypeScript, React and Vite, with zod/mini validation. This page covers how it's built and tested. The [README](../README.md) is the user-facing overview.

## Getting started

```bash
npm install
```

```bash
npm run build
```

Load `dist/` at `chrome://extensions` → Developer mode → **Load unpacked**. Use `npm run watch` for a dev build that rebuilds on change, then reload the extension.

## Architecture

The spec's key decision holds: there are **two products**, and B never depends on A.

- **A. Native enhancer** (best-effort): the sidebar entry and dates beside native items. It only *adds* its own `data-chp-*` nodes and never moves or removes React-owned ones. It fails silently when ChatGPT's DOM changes.
- **B. History engine**: sync, cache, search, grouping, and the panel. It lives in its own shadow root and needs no ChatGPT DOM.

```
src/
  chatgpt/        ← the ONLY code that knows ChatGPT internals
    api.ts          endpoints, 5xx/network retries, 429 → Retry-After, error classification
    adapter.ts      ConversationProvider: session → token (memory only) → paged list
    schemas.ts      zod/mini validation; malformed items skipped, odd fields → null
    selectors.ts    every DOM assumption, with fallbacks
  history/        ← provider-agnostic engine (pure, unit-tested)
    sync.ts         progressive pagination, adaptive pacing, incremental stop, backfill resume, deletion sweep
    repository.ts   merge + chrome.storage persistence
    grouping.ts     time buckets → flat rows for the virtual list
    search.ts       query parser, operators, matching, highlighting
    date-query.ts   natural date phrases → [start, end) ranges
  storage/        chrome.storage.local wrapper + schema migrations
  content/        content script: app controller, mount, sidebar observer, navigation
  ui/             React panel (shadow DOM), custom virtual list, settings
  background/     service worker: toolbar button + optional command → content script
```

Notable decisions (and where they differ from the spec's suggestions):

- **No MAIN-world bridge.** The isolated-world content script makes same-origin requests to chatgpt.com, so cookies are attached and page CSP doesn't apply. Patching `window.fetch` would add risk (AC9) for no gain, because incremental sync on panel open already picks up new or renamed chats within a page request.
- **Timestamps accept both formats.** The list endpoint has historically returned ISO strings, even though the spec's zod example uses numbers. `parseTimestamp` takes seconds, milliseconds, ISO with or without an offset, and microsecond fractions.
- **Accounts are isolated.** The cache key is `sha256(userId | workspaceId)`. Switching between a personal account and a Team workspace never mixes histories. A signed-out tab shows no cache at all, but an offline tab falls back to the last account's cache (AC7).
- **End of history** is detected by `total` or by an empty page, never by a short page, in case the server caps `limit`.
- **Sync resumes.** An interrupted first sync resumes from where it stopped, with one page of overlap. A pass that covers everything contiguously also removes chats deleted upstream.
- **Multi-tab.** A Web Lock (`navigator.locks`) allows one sync at a time; other tabs follow along through `chrome.storage.onChanged`.
- **Rate limits.** ChatGPT rate-limits `/backend-api/conversations` hard, and its own sidebar shares that budget. So:
  - Pages are at least 1 s apart. The pause doubles on every 429 and eases back after sustained success.
  - A 429 is never retried in a burst. The sync waits out `Retry-After` (else 20 s → 40 s → … → 5 min), shows a countdown, and retries the same page.
  - After 30 min of waiting in one run, it stops and sets a 5-minute cooldown. The learned pause and the cooldown are saved and shared across tabs and page loads, so automatic syncs hold off and then resume by themselves. "Retry now" still works.
  - A first sync of about 10,000 chats takes a few minutes at best. Results appear progressively, and an interrupted sync resumes where it stopped.
- **Navigation** clicks ChatGPT's own sidebar link when one exists (client-side routing). Otherwise it does a normal page load and restores the panel's query and scroll afterwards.
- **Keyboard shortcut** is an in-page listener. The manifest command has no default key, because a suggested key would override Chrome's own ⇧⌘H (Home) in *every* tab.

## Privacy & permissions

- Permissions: `storage` and a content script on `https://chatgpt.com/*`. No `tabs`, `cookies`, `webRequest`, `<all_urls>`, or `unlimitedStorage`.
- Stored locally: conversation id, title, created and updated time, archived flag, gizmo id. Collapse state and settings are stored too. Nothing else.
- The access token from `/api/auth/session` is held in a closure for one sync and then dropped. It is never written to `chrome.storage`, `localStorage`, IndexedDB, or logs.
- No analytics, no error reporting, no servers. The only hosts contacted are `chatgpt.com` endpoints the web app itself uses.
- See [PRIVACY.md](../PRIVACY.md) for store-ready disclosure text.

## Phase 0 spike: verifying against a real account

The APIs are undocumented, and the tests use a faithful mock, **not** live ChatGPT. Before relying on this, load the build on a real account and use **Settings → Copy diagnostics**. The report contains counts and field names only, no titles or ids. It answers most of the spec's §51 questions directly:

| Question | Where to look in diagnostics |
|---|---|
| Exact response schema | `lastSync.itemKeys`, `lastSync.responseKeys` |
| `create_time`/`update_time` present? which format? | `lastSync.createFormats` / `updateFormats` (`iso` / `number` / `missing` / `invalid`) |
| Archived conversations included? | `lastSync.archived`, `index.archived` |
| Project conversations included? | `lastSync.projectLike` (gizmo ids starting `g-p-`) |
| Total count exposed? | `lastSync.totalReported` vs `index.conversations` |
| Max practical offset | `lastSync.incomplete` / `note` ("stopped returning conversations after N of M") |
| Team/Business workspaces | run it while in a workspace; the `chatgpt-account-id` header is sent when the session says `structure: "workspace"` |
| Deleted chats | Settings → Full resync, then compare counts |

Verified on a real Business workspace (Sep 2026): sync works and native dates render. The sidebar selectors were rebuilt from a real signed-in DOM snapshot, whose layout is documented at the top of `src/chatgpt/selectors.ts` and mirrored by the e2e mock. Still unverified: whether Projects and archived chats are in `/backend-api/conversations`. Some pinned chats showed no date, which suggests project chats may be missing. If any of this differs, the fix belongs in `src/chatgpt/` only.

## Tests and scripts

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run typecheck
```

- `npm test` runs 80 unit tests: dates, date phrases, search and operators, grouping, schemas, retry/backoff, adapter, sync stop and resume, rate-limit pacing and cooldowns, migrations, the app controller (including a clear-during-sync race), and a 10k-row performance check. They run in `America/New_York` to catch DST bugs.
- `npm run test:e2e` builds the extension, loads it into Chromium, and drives a mock chatgpt.com (`tests/e2e/mock-chatgpt.ts`: the current and 2025 sidebar layouts, session, paginated API, all synthetic data). It covers sync pacing, waiting out 429s with a countdown, search without network, date phrases, keyboard and navigation, panel restore, collapse persistence, offline cache, signed-out state, 429 backoff, full resync and deletion, clearing data, the sidebar being removed, and 10,000 conversations.
- Other scripts: `npm run watch` (dev build), `npm run zip` (store package, see Releasing), `npm run icons`, `SHOTS=/tmp/shots npx playwright test screenshots` (UI captures).
- Bundle: `content.js` is about 317 KB minified, 98 KB gzipped.
- Measured with 10,000 conversations: search to rendered results in about 11 ms, and the panel opens in under 100 ms.

## Releasing

1. Bump `version` in `package.json`. It is the single source of truth, and the build writes it into the manifest.
2. `npm run zip` builds and writes `release/chatgpt-history-plus-<version>.zip` (the files the extension needs, nothing else).
3. `npm run store-assets` regenerates the Web Store screenshots and promo tiles in `store/` from the real extension running against the mock, using synthetic data only.
4. In the Chrome Web Store dashboard, open the item (`aeedfmgfjdpgbnfjddpommjjagdobacj`), then **Package → Upload new package**, and submit for review. The version must be higher than the published one. See [store/LISTING.md](../store/LISTING.md) for every listing field.
5. Once approved, users update automatically. The live listing is at <https://chromewebstore.google.com/detail/history+-for-chatgpt/aeedfmgfjdpgbnfjddpommjjagdobacj>.

## Not in V1 (by design)

Message-content search, AI summaries, favourites and tags, export, bulk actions, cloud sync, and the calendar heatmap (P1). The date menu's per-month counts and the week/day dividers cover most of the "jump to a date" need for now.
