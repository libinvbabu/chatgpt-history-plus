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
    dictionary.ts   the data it knows: providers/tools, topics, activity rules (related engine only)
    extract.ts      rule-based entities (PR, repo, ticket, provider…), topics, activity
    taxonomy.ts     categories: 8 primaries, ~50 subcategories, their vocabulary, legacy ids
    classify.ts     title → primary, subcategory, topics, confidence (precedence rules, memoised)
    engine.ts       inverted index, time-sliced indexing, retrieval, scoring, evidence gate
    reasons.ts      hover explanations built from what actually matched
  ui/             React panel (shadow DOM), custom virtual list, settings, sort and date menus
    categories.ts   the one category table: filters, row icons and labels, legacy filter ids, More's list
    personalize.ts  which filters the bar shows, chosen from the history (pure, unit-tested)
    CategoryIcon.tsx  the glyphs (Lucide) behind that table; CategoryFilters.tsx  the bar and More
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

## Categories, filters and row icons

History+ files every conversation, from its title alone, under one **primary category** and, when the title says so clearly, one **subcategory**, plus a few secondary **topic** tags. Nothing is stored per conversation: categories are derived when needed and memoised by title, so a rules change reaches every synced conversation on the next page load, with no migration and no re-sync.

| Primary | Icon (Lucide) | Subcategories |
|---|---|---|
| Work | briefcase | Meetings, Career, Hiring, Strategy, Marketing, Sales, Management, Presentations, Product, Analytics, Payments |
| Learning | graduation-cap | Exam Prep, Research, Mathematics, Science, Languages, History |
| Writing | pen-line | Emails, Social Posts, Documents, Editing, Messages & Letters |
| Creative | palette | Design, Images, Stories & Poems, Brainstorming, Content Creation |
| Technology | code | PR Reviews, Debugging, Architecture, Backend, Frontend, Mobile, AI & ML, Infrastructure, Security |
| Planning | calendar-check | Scheduling, Goals & Habits, Events, To-dos, Decisions |
| Personal | heart | Travel, Cooking, Health & Fitness, Parenting, Shopping, Finance, Home, Entertainment |
| General | message-circle | none: anything the title does not say enough about |

The categories of 0.2 live on as subcategories: Reviews → Technology · PR Reviews, Engineering → Technology, Debugging and Security & access → Technology, Analytics, Payments and Product → Work, Hiring & people → Work · Hiring, Other → General. `LEGACY_CATEGORY_IDS` in `taxonomy.ts` maps the old ids wherever they turn up (a remembered filter, a stored `category`).

A row shows its subcategory's icon where that glyph says more than its primary's (a bug for Debugging, a plane for Travel, a pull request for PR Reviews), else its primary's. Hover text is "Technology · Debugging".

### How a conversation gets its category

`related/classify.ts`, with its vocabulary in `related/taxonomy.ts`. **Kept apart from** `TOPICS` and `ACTIVITY_RULES` in `dictionary.ts`, which drive "Related to this chat": `extract()` no longer computes a category at all, and the related engine never sees one, so teaching a category a word cannot change what counts as related (`tests/unit/related.test.ts` checks that chats sharing only a category are never suggested).

Every subcategory, and each primary's own vocabulary (words that name the area but no part of it, like "homework"), is a **facet** with weighted patterns: 3 settles it, 2 is clear, 1 is a hint. Each word counts once per facet. Known tools and providers add their weight to a facet (Mixpanel → Analytics, Kubernetes → Infrastructure, a payments provider → Payments). A primary scores the sum of its facets. A signal in the **head** of the title, the words before its first preposition (or the last word when there is none), adds a point: "Poster for a music festival" is about a poster. Then, first match wins:

1. A stored `category` (an import or a future manual choice), legacy ids mapped.
2. A PR, "code review" or "review … changes/diff/commits" → Technology · PR Reviews, whatever it is about.
3. An explicit "debug" → Technology · Debugging.
4. The highest primary, ties to the more specific reading (Technology, Work, Learning, Writing, Personal, Creative, Planning), then:
   - **Planning is an activity more often than a subject.** With only "plan"/"organize", any clear subject wins ("Plan a family trip to Kerala" → Personal · Travel). With a planning format (schedule, checklist, decision), a decisive subject wins ("Plan the product launch checklist" → Work · Product). A planning subject keeps it ("Plan my daughter's birthday party" → Planning · Events).
   - Payments yields to Technology when the title is about building or fixing the system ("Paytm PreNotify architecture").
   - **A message about hiring is hiring work**, not writing ("Draft interview heads up" → Work · Hiring).
   - Personal and Learning yield to a clearly technical title ("Health app architecture" → Technology).
   - Generic faults ("not working", "broken") count toward Debugging only in an already technical title, so "my washing machine is not working" stays out of Technology.
5. **General** when the best score is under 2: one weak hint is never enough.

The subcategory is the primary's best facet with a score of 2 or more (a clear fault in a technical title is always Debugging). **Confidence** comes from the evidence: *high* when a rule settled it or a decisive word leads by 2+, *medium* for a clear lead, *low* for a tie broken by order or weak hints only, *none* for General. Only medium and high count toward choosing filters.

Measured: about 45 µs per title, once. After each sync the app classifies new titles in 8 ms slices before the related engine indexes, so the list renders from the memo; counting and filtering 10,000 chats then takes under 1 ms.

Test sets (`tests/unit/fixtures/`): `category-titles.ts`, the 63-title developer audit from 0.2 carried over (62 unchanged; "Mobile game ideas" is now Personal · Entertainment at low confidence); `personas.ts`, 149 titles from seven kinds of user plus 23 deliberately misleading ones, all filed as a person would; and a 50-title held-out set that was never used for tuning (94% exact, 98% primary when written; the test asserts 90%/95%). On the persona set, 0.2's rules put 39% of titles in the right primary and 50% under Other.

### The filter bar

`ui/personalize.ts`. Nobody is asked what they do; the bar is chosen from the history:

1. Count conversations per primary and subcategory (medium confidence or better).
2. Eligible: at least 3 conversations and 5% of the history; a subcategory also needs 5 conversations and 15–90% of its primary (one that is nearly all of it would only repeat it). General is never chosen; it is in More.
3. The three largest families (a primary and its subcategories) with at least 5% each get a slot, so one dominant area cannot fill the bar.
4. Every other eligible filter follows by size, at most 3 per family while another family has something eligible.
5. Ties go to taxonomy order. The bar shows the first 5, each family together, primary first. Thresholds are in `PERSONALIZE`.

**Stability.** The choice (`ranked`), with the history size it came from, is stored per account under `flt:<accountKey>`. It is made again only when the history changes by at least 25 conversations and 10% (50% while the first sync runs), when the first sync completes, or when `PERSONALIZE_VERSION` changes. Once settled, a new choice never lands while the panel is open: it waits for it to close. Filters already in the bar count 1.2× when choosing again, so near-ties do not swap. The selected filter is never moved: picked from More, it joins the end of the row while selected.

**Customize.** More → *Customize filters*: pin (always in the bar, first, even with nothing in it) or hide (never chosen automatically; still in More). *Reset to automatic* clears both and chooses afresh. Settings has the same reset. Pins and hides are per account, so a personal account and a Team workspace keep their own.

**The row and More.** One row that scrolls sideways and never wraps: no numbers on chips (the count for the current search and dates is the hover text), a mouse wheel scrolls it horizontally, an edge fades while more lies beyond it, and the selected chip is scrolled into view. More stays at the right edge outside the scrolling part. It lists every primary (always) and each subcategory the history has, grouped and indented, with counts for the current search and dates, a search box, and arrow-key navigation. `view.ts` runs search and date first, counts the result per filter, then narrows by the selected one, so counts say what picking a filter would show. A filter is not a search: date groups keep the user's collapse state (Today stays open), and "Related to this chat" stays, narrowed to the same filter.

**Migration from 0.2.** No schema change. The selected chip in `ui.category` is mapped on read (`engineering` → `technology`, `other` → `general`; unknown → All). Stored conversation categories are mapped through the same table. Nothing is re-synced and nothing is rewritten.

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

- `npm test` runs 268 unit tests: dates, date phrases, search and operators, grouping, schemas, retry/backoff, adapter, sync stop and resume, rate-limit pacing and cooldowns, migrations, the app controller (including a clear-during-sync race), category classification across seven user personas, filter personalization and stability, related-conversation regressions, and 10k-row performance checks. They run in `America/New_York` to catch DST bugs.
- `npm run test:e2e` builds the extension, loads it into Chromium, and drives a mock chatgpt.com (`tests/e2e/mock-chatgpt.ts`: the current and 2025 sidebar layouts, session, paginated API, all synthetic data). It covers sync pacing, waiting out 429s with a countdown, search without network, date phrases, keyboard and navigation, panel restore, collapse persistence, offline cache, signed-out state, 429 backoff, full resync and deletion, clearing data, the sidebar being removed, and 10,000 conversations.
- Other scripts: `npm run watch` (dev build), `npm run zip` (store package, see Releasing), `npm run icons`, `SHOTS=/tmp/shots npx playwright test screenshots` (UI captures; `-g "capture categories"` for the filter bar, More, Customize, light/dark and three widths). `npm run promo` records the promotional videos and YouTube thumbnail from the real extension on synthetic history ([scripts/promo/README.md](../scripts/promo/README.md)).
- Bundle: `content.js` is about 405 KB minified, 129 KB gzipped (the category vocabulary and classifier add about 36 KB, 13 KB gzipped, over 0.2).
- Measured with 10,000 conversations: search to rendered results in about 11 ms, and the panel opens in under 100 ms.

## Releasing

1. Bump `version` in `package.json`. It is the single source of truth, and the build writes it into the manifest.
2. `npm run zip` builds and writes `release/chatgpt-history-plus-<version>.zip` (the files the extension needs, nothing else).
3. `npm run store-assets` regenerates the Web Store screenshots and promo tiles in `store/` from the real extension running against the mock, using synthetic data only.
4. In the Chrome Web Store dashboard, open the item (`aeedfmgfjdpgbnfjddpommjjagdobacj`), then **Package → Upload new package**, and submit for review. The version must be higher than the published one. See [store/LISTING.md](../store/LISTING.md) for every listing field.
5. Once approved, users update automatically. The live listing is at <https://chromewebstore.google.com/detail/history+-for-chatgpt/aeedfmgfjdpgbnfjddpommjjagdobacj>.

## Not in V1 (by design)

Message-content search, AI summaries, favourites and tags, export, bulk actions, cloud sync, and the calendar heatmap (P1). The date menu's per-month counts and the week/day dividers cover most of the "jump to a date" need for now.
