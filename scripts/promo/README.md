# Promo video

Generates the History+ promotional videos and YouTube thumbnail from the **real extension**. It records the built panel doing real searches, filters and navigation against synthetic history. Nothing in the video is mocked up or animated by hand.

| Output | Spec |
|---|---|
| `marketing/promo/history-plus-demo.mp4` (gitignored) | 1920×1080, H.264 High, 30 fps, ~33 s (Chrome Web Store / YouTube) |
| `marketing/promo/history-plus-social.mp4` (gitignored) | 1080×1920, H.264 High, 30 fps, ~27 s (Shorts, Reels, LinkedIn, X) |
| `store/youtube-thumbnail.png` | 1280×720 |
| `store/youtube-copy.md` | Title, description, upload steps (written by hand, not generated) |

## Regenerate

```bash
npm run promo
```

That runs the two steps below. Run them again after any UI change. The videos are gitignored (they would bloat history); host them on YouTube or attach them to a GitHub release. The thumbnail is committed with the other store assets.

```bash
npm run promo:record
```

Builds `dist/`, launches Chromium with the extension, and plays the storyboard while recording. It writes frames, a timeline and stills to `.promo/recording/` (gitignored, about 200 MB). Takes about 45 s. Add `HEADED=1` to watch it.

```bash
npm run promo:build
```

Renders the browser frame, captions, end cards and thumbnail (HTML → PNG via Playwright), then composes the videos with ffmpeg. Takes about 15 s and needs no browser recording, so you can iterate on captions without recording again.

ffmpeg comes from the `ffmpeg-static` dev dependency (it includes libx264). Set `FFMPEG_PATH` to use another build.

## How it works

- **Real UI, synthetic data.** `record.spec.ts` reuses the e2e stand-in for chatgpt.com (`tests/e2e/mock-chatgpt.ts`), switched to dark mode and fed `fixtures/conversations.ts`: 1,280 invented chats. The extension is the normal production build. Search, chips, date groups, "Related to this chat" and navigation all run their real code.
- **Fixed date.** The fixture's "now" is Thursday 15 Oct 2026, 3:40 PM in New York. Content scripts run in an isolated world that Playwright's clock can't reach, so `harness.ts` copies `dist/` to `.promo/extension/` and prepends a small clock shift to *that copy's* `content.js`. `dist/` and `src/` are never touched, and nothing promo-related ships.
- **Explicit checks, not long sleeps.** Every step waits for real state before going on: the search value and that every visible title contains the query, `aria-pressed` on chips, `aria-expanded` on groups, the opened chat's title and `aria-current`, and the related count. Pauses exist only so viewers can read. If the UI changes so a step no longer works, the recording fails rather than producing a wrong video.
- **Recording.** The CDP screencast captures 2× JPEG frames (about 32 fps) with wall-clock timestamps. `--force-device-scale-factor=2` is required: without it, headless Chromium sends 1× frames. The page draws its own cursor (headless has none), with a soft ring on clicks; it is injected into the stand-in page only. `timeline.json` records named marks (`search`, `category`, `dates`, `related`…) that the build uses to time captions.
- **Composition.** `build.mjs` holds each frame until the next one to produce constant 30 fps, scales it into a browser frame (16:9), or crops the icon rail and panel and enlarges them into a card (9:16), then overlays captions with short alpha fades and crossfades into the end card. Output is yuv420p BT.709 with a silent AAC track (some platforms reject video with no audio stream).

## Changing things

- **Words and picks** (the search query, which chat each scene opens): `STORY` in `fixtures/conversations.ts`. A new query needs matching titles in `NAMED`. Keep the query's words out of `POOL`, so the results stay exactly the named ones.
- **Captions and timing:** `WIDE_CAPTIONS`, `TALL_CAPTIONS` and `SOCIAL` in `build.mjs`, all keyed to marks. Pacing (how long each moment holds) lives in `record.spec.ts`.
- **Layout:** `WIDE` / `TALL` in `build.mjs`. The vertical card shows CSS y 0–545 of the recording, so keep the storyboard's clicks within the top ~540 px of the panel.
- **Music:** none is included. To add a track you have commercial rights to, map it in place of the `anullsrc` input in `renderVideo`, and credit it in `store/youtube-copy.md` if its licence requires.

## Honesty rules for edits

The video shows only shipped behaviour. Search matches **titles** (not message content), and categories and related chats come from titles too. Don't caption full-text search, AI summaries, or anything paid. The fixture contains no real conversations, people or accounts.
