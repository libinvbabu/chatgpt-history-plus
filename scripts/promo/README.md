# Promo video

Generates the History+ promotional videos and YouTube thumbnail from the **real extension**. It records the built panel doing real searches, filters and navigation against synthetic history. Nothing in the video is mocked up or animated by hand.

| Output | Spec |
|---|---|
| `marketing/promo/history-plus-demo.mp4` (gitignored) | 1920×1080, H.264 High, 30 fps, ~37 s, voice-over and music, −14 LUFS (Chrome Web Store / YouTube) |
| `marketing/promo/history-plus-demo.en.srt` (gitignored) | Subtitles for the voice-over, for YouTube |
| `marketing/promo/history-plus-social.mp4` (gitignored, opt-in) | 1080×1920, H.264 High, 30 fps, ~28 s, silent track (Shorts, Reels, LinkedIn, X). Only with `npm run promo:build -- --social` |
| `store/youtube-thumbnail.png` | 1280×720 |
| `store/youtube-copy.md` | Title, description, upload steps (written by hand, not generated) |

## Regenerate

```bash
npm run promo
```

That runs the three steps below. Run them again after any UI change. The videos are gitignored (they would bloat history); host them on YouTube or attach them to a GitHub release. The thumbnail is committed with the other store assets.

```bash
npm run promo:voice
```

Speaks `narration.json` with [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (82M parameters, Apache-2.0), locally on the CPU, using the `af_heart` voice. Writes a WAV per line and `voice.json` (their durations) to `.promo/voice/`. The first run installs `kokoro-js` 1.2.1 into `.promo/tools/` (about 400 MB, kept out of `package.json` so CI never downloads it) and caches the model in `.promo/models/` (about 330 MB from Hugging Face). After that it takes about 6 s.

```bash
npm run promo:record
```

Builds `dist/`, launches Chromium with the extension, and plays the storyboard while recording. It writes frames, a timeline and stills to `.promo/recording/` (gitignored, about 200 MB). Takes about 45 s. Add `HEADED=1` to watch it. With a voice-over generated, each scene holds until its line has been spoken, so **run `promo:voice` before `promo:record`** whenever the narration changes. The build warns if a line overruns its scene.

```bash
npm run promo:build
```

Renders the browser frame, captions, end cards and thumbnail (HTML → PNG via Playwright), synthesises the music, mixes the soundtrack, then composes the video with ffmpeg (the vertical cut too, with `-- --social`; its crop assumes the clicks stay in the panel's top ~540 px). Takes about 15 s and needs no browser recording, so you can iterate on captions without recording again.

ffmpeg comes from the `ffmpeg-static` dev dependency (it includes libx264). Set `FFMPEG_PATH` to use another build.

## How it works

- **Real UI, synthetic data.** `record.spec.ts` reuses the e2e stand-in for chatgpt.com (`tests/e2e/mock-chatgpt.ts`), switched to dark mode and fed `fixtures/conversations.ts`: 1,280 invented chats. The extension is the normal production build. Search, the category filter bar (chosen by History+ from this history) and its More menu, date groups, "Related to this chat" and navigation all run their real code.
- **Fixed date.** The fixture's "now" is Thursday 15 Oct 2026, 3:40 PM in New York. Content scripts run in an isolated world that Playwright's clock can't reach, so `harness.ts` copies `dist/` to `.promo/extension/` and prepends a small clock shift to *that copy's* `content.js`. `dist/` and `src/` are never touched, and nothing promo-related ships.
- **Explicit checks, not long sleeps.** Every step waits for real state before going on: the search value and that every visible title contains the query, `aria-pressed` on chips, `aria-expanded` on groups, the opened chat's title and `aria-current`, that each category filter shows one chat and hides another, and the related count. The pointer only clicks targets that are on screen, so a chip scrolled out of its row or a menu item below the fold fails the recording instead of producing a misclick. Pauses exist only so viewers can read. If the UI changes so a step no longer works, the recording fails rather than producing a wrong video.
- **Recording.** The CDP screencast captures 2× JPEG frames (about 32 fps) with wall-clock timestamps. `--force-device-scale-factor=2` is required: without it, headless Chromium sends 1× frames. The page draws its own cursor (headless has none), with a soft ring on clicks; it is injected into the stand-in page only. `timeline.json` records named marks (`search`, `category`, `dates`, `related`…) that the build uses to time captions.
- **Composition.** `build.mjs` holds each frame until the next one to produce constant 30 fps, scales it into a browser frame (16:9), or crops the icon rail and panel and enlarges them into a card (9:16), then overlays captions with short alpha fades and crossfades into the end card. Output is yuv420p BT.709 with AAC audio. The vertical cut gets a silent track, because some platforms reject video with no audio stream.
- **Soundtrack (16:9).** `music.mjs` synthesises an original bed in code: a Cmaj7 – Am7 – Fmaj7 – G6 loop with pad, soft keys, bass, kick and shaker, plus reverb. It is fitted to about 96 BPM so the G6 resolves to Cmaj7 exactly as the end card arrives. No samples and no third-party audio, so there is nothing to license or credit. Each voice line starts at its mark plus `offset`; the music ducks about 8 dB under the voice through a sidechain compressor; a two-pass EBU R128 loudnorm brings the mix to −14 LUFS integrated with a −1.5 dBTP peak (YouTube's playback level). Between lines the music sits about 7–8 LU below the voice.

## Changing things

- **Words and picks** (the search query, the category filters, which chat each scene opens): `STORY` in `fixtures/conversations.ts`. The filter bar is personalised, so a filter in `STORY.categories.chip` must be one History+ actually puts in the bar for this history; anything else goes through More (`STORY.categories.more`). A new query needs matching titles in `NAMED`. Keep the query's words out of `POOL`, so the results stay exactly the named ones.
- **Captions and timing:** `WIDE_CAPTIONS`, `TALL_CAPTIONS` and `SOCIAL` in `build.mjs`, all keyed to marks. Pacing (how long each moment holds) lives in `record.spec.ts`.
- **Layout:** `WIDE` / `TALL` in `build.mjs`. The vertical card shows CSS y 0–545 of the recording, so keep the storyboard's clicks within the top ~540 px of the panel.
- **Narration:** `narration.json`. `text` is the subtitle, and `say` is what Kokoro reads; spell names for pronunciation there ("History Plus"). Other voices: `af_bella`, or `am_michael` (lower-rated). Then run `promo:voice` and `promo:record` again.
- **Music:** the generated bed's chords, tempo and instruments are at the top of `music.mjs`; its level under the voice is `volume=0.30` in `soundtrack()` in `build.mjs`. To use a track you have the rights to instead, run `PROMO_MUSIC=path/to/track.mp3 npm run promo:build` (it is trimmed and faded to length), and credit it in `store/youtube-copy.md` if its licence requires.

## Honesty rules for edits

The video shows only shipped behaviour. Search matches **titles** (not message content), and categories and related chats come from titles too. Don't caption full-text search, AI summaries, or anything paid. The fixture contains no real conversations, people or accounts.
