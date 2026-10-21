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

- **A. Native enhancer** (best-effort): the sidebar entry, an icon in the always-visible icon rail (so a collapsed sidebar still has a way in), dates beside native items, and a floating edge-tab launcher. It only *adds* its own `data-chp-*` nodes and never moves or removes React-owned ones. It fails silently when ChatGPT's DOM changes.
  - **The launcher is a safety net, not a feature.** Each entry is watched with an `IntersectionObserver`, because an entry can sit in the DOM yet be clipped to nothing (the v0.1.0 bug). If neither is actually on screen for 3 s, the edge tab appears. It disappears the moment one is. It never appears signed out.
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
  related/        ← local "related to this chat" engine (pure, unit-tested; see below)
    text.ts         tokenising, stopwords, generic words, light stemmer, aliases
    dictionary.ts   the data it knows: providers/tools, topics, activity rules, categories
    extract.ts      rule-based entities (PR, repo, ticket, provider…), topics, activity, category
    engine.ts       inverted index, time-sliced indexing, retrieval, scoring, evidence gate
    reasons.ts      hover explanations built from what actually matched
  ui/             React panel (shadow DOM), custom virtual list, settings, sort and date menus
    categories.ts   the one category table: filter chips, row icons and labels, the fallback to "Other"
    CategoryIcon.tsx  the glyphs (Lucide) behind that table; CategoryFilters.tsx  the chip row
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

## Category filters and row icons

`src/ui/categories.ts` is the single definition both the chips under the search box and the icon beside each row read from. The extractor assigns one of ten categories; the chips group them into eight (All plus seven) (Debugging and Security & access are listed under Engineering, Hiring & people under Other), so every chat is reachable from some chip. A category inherits its label and icon from its chip unless it names its own, so a debugging row keeps its bug icon and "Debugging" tooltip. A stored `category` that is not one of ours, or no signal at all, becomes **Other**. To add a category: add it to `related/dictionary.ts`, one row to `CATEGORIES`, and a glyph to `CategoryIcon.tsx` if it needs its own icon.

- **Chips stay quiet and on one line.** No numbers on them (the count for the current search and dates is the hover text). The row scrolls sideways and never wraps; a mouse wheel over it scrolls it horizontally (a non-passive listener, so it never reaches the list or the page), an edge fades while more lies beyond it, and the selected chip is scrolled into view on open and on change.
- **Filtering is local and cheap.** `view.ts` runs search and date first, counts the result per chip, then narrows by the selected chip. Counts therefore say what picking a chip would show. Classification is memoised per title (about 13 µs each, once).
- **A chip is not a search.** It leaves date groups at the user's own collapse state (Today stays open), where search and date filters expand everything. "Related to this chat" stays, narrowed to the same category.
- **The choice persists** in the `ui` storage entry next to the collapse state (`category`), and is read once at start-up (other tabs do not change it under you).

### How a conversation gets its category

`related/categorize.ts`, with its vocabulary in `CATEGORY_SIGNALS` / `PR_REVIEW_SIGNALS` in `related/dictionary.ts` (kept apart from `TOPICS` and `ACTIVITY_RULES`, which drive "Related to this chat": teaching the icon a word never changes what counts as related). Precedence:

1. **A stored `category`** on the conversation (an import or a future manual choice) wins (`categoryFor`). It survives reloads and syncs.
2. **Entities** the extractor recognised: a PR reference makes it a PR review; providers lean Payments; analytics tools (Mixpanel, CleverTap…) lean Analytics; other tools lean Engineering. History+ stores titles only, so there is no message content to use.
3. **The title**, normalised (lower case, punctuation as spaces). A PR, "code review" or "review … changes/diff/commits" is a **PR review, whatever it is about**. Otherwise every category is scored by the distinct keywords it matches (weight 3 settles it, 2 is clear, 1 is a hint; the last word, which usually names the activity, tips a close call), then:
   - Payments yields to Engineering/Debugging when the title is about building or fixing the system ("Paytm PreNotify architecture").
   - A clear fault ("crash", "not showing", "debug") makes an engineering title Debugging.
   - A message about hiring is People, not Writing ("Draft interview heads up").
   - Personal topics (trip, workout, recipe…) outweigh a lone "plan" or "ideas".
4. **Other** when the best score is under 2: one weak hint is never enough.

Categories are derived when the list renders and memoised per title for the page's lifetime; they are never written to storage. A rules change therefore reaches every previously synced conversation on the next page load, with no migration and no re-sync. `tests/unit/fixtures/category-titles.ts` is the audit set (63 titles, including the ambiguous "review", "payment", "plan" and "analysis" cases); `tests/unit/categorize.test.ts` pins each one.

## Time format

`Settings.timeFormat` (`12h` default, `24h`) is passed down to every formatter in `utils/dates.ts` (rows, tooltips, related rows, and the dates added to ChatGPT's own sidebar). Absent or unrecognised stored values become `12h`.

## Related to this chat

`src/related/` finds the chats most related to the open one. It uses **titles and timestamps only**, because that is all History+ stores; nothing is persisted, and nothing leaves the page.

- **Extraction** (`extract.ts`, rules only): GitHub URLs and `org/repo#N` → repo and PR entities; `PR #N`, `#N` → PR number; `ABC-123` → ticket; providers and tools from `dictionary.ts` with aliases normalised (`Phone Pe` = `PhonePe`); specific topics (`subscriptions`, `incidents`…); one activity (`code_review`, `debugging`…); one category for the icon. Add a row to `dictionary.ts` to teach it a name, or `defineEntity()` at runtime.
- **Index** (`engine.ts`): stems, adjacent-word pairs, entity keys and topic keys in an in-memory inverted index. `plan()` diffs the history (one cheap pass); `step(budgetMs)` extracts and posts changed titles in 8 ms slices, so a first backfill of thousands never blocks the page. Unchanged titles do no work; a timestamp-only change does not invalidate results. Results are cached by chat and index version. The app re-plans (debounced) whenever the history changes, and clears the index on sign-out or *Clear local data*.
- **Ranking:** candidates come from postings of the active chat's non-generic keys (exact PR/ticket identifiers always followed). Each is scored `0.40·entities + 0.25·topics&activity + 0.25·text + 0.10·recency` (entities and topics are down-weighted the more common they are; text is TF-IDF cosine; recency is a 180-day half-life, so old but strongly related chats still rank). A candidate must first pass an **evidence gate**: the same PR/issue/ticket, or a shared repo/project with support, or near-identical text, or a shared tool plus a shared topic and a specific word, and so on. "Both are engineering", "both say *review*" and "both mention Animall" never pass. Generic words (`review`, `help`, `fix`…) count for almost nothing. Near-identical titles are collapsed.
- **Explanations** (`reasons.ts`) come only from signals that matched ("Same PR number (#4294)", "Both about PhonePe"), shown as hover text.
- **Index levels:** each chat is `title` (nothing extractable), `metadata` (title-derived entities/topics/activity) or `content`. Title-only pairs must be near-duplicates, because a short title is weak evidence. `setContent(id, signals)` accepts content-derived signals (see `signalsFromText`, which keeps entities, topics and top keywords, never the text, and drops identifier-shaped tokens) from a future opt-in capture or export importer; unchanged hashes are skipped. Nothing calls it yet.
- **Tuning:** `WEIGHTS` and `TEXT_ONLY_MIN` in `engine.ts`; the scenarios in `tests/unit/related.test.ts` pin the behaviour. Measured on a synthetic 10,000-title history: indexing 78 ms in 10 slices (worst slice ≈11 ms), query ≈1 ms; 30,000 titles: 225 ms in 26 slices, query ≈2 ms.

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
- Other scripts: `npm run watch` (dev build), `npm run zip` (store package, see Releasing), `npm run icons`, `SHOTS=/tmp/shots npx playwright test screenshots` (UI captures). `npm run promo` records the promotional videos and YouTube thumbnail from the real extension on synthetic history ([scripts/promo/README.md](../scripts/promo/README.md)).
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
