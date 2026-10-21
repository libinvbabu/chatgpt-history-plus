# YouTube and Chrome Web Store: promo video

Files: `marketing/promo/history-plus-demo.mp4` (16:9, upload this one to YouTube), `marketing/promo/history-plus-social.mp4` (9:16, for Shorts, Reels, LinkedIn and X; build it with `npm run promo:build -- --social`), and `store/youtube-thumbnail.png` (1280×720). The videos are gitignored; generate them with `npm run promo` (see [scripts/promo/README.md](../scripts/promo/README.md)).

## Title

History+ for ChatGPT — Find Old Conversations Instantly

## Description

```
History+ is a free Chrome extension that makes ChatGPT history easier to search, browse and organize.

Find conversations by title, filter by smart categories picked from your own history, and navigate your history by date. When you open a chat, History+ shows related ones. Everything runs locally in your browser.

Try History+:
https://chromewebstore.google.com/detail/aeedfmgfjdpgbnfjddpommjjagdobacj

Open source:
https://github.com/libinvbabu/chatgpt-history-plus
```

The demo uses synthetic conversations; no real chat history appears in it. The music is original, generated for this video (no licence or credit needed). The voice is Kokoro, an open-weight (Apache-2.0) text-to-speech model; no credit is required, but you can add "Voice: Kokoro TTS" to the description if you'd like to be open that it is synthetic.

Suggested tags: ChatGPT, Chrome extension, ChatGPT history, productivity, search.

## Links

- Chrome Web Store: https://chromewebstore.google.com/detail/aeedfmgfjdpgbnfjddpommjjagdobacj
- GitHub: https://github.com/libinvbabu/chatgpt-history-plus

## Upload to YouTube

1. Go to YouTube Studio → **Create** → **Upload videos**, and choose `marketing/promo/history-plus-demo.mp4`.
2. Paste the title and description above.
3. **Thumbnail** → *Upload file* → `store/youtube-thumbnail.png`. Custom thumbnails need a phone-verified channel.
4. **Subtitles** (after upload, Studio → *Subtitles* → *Add* → *Upload file* → *With timing*): `marketing/promo/history-plus-demo.en.srt`.
5. Audience: *No, it's not made for kids*.
6. Visibility: **Public** (or Unlisted, if you only want it on the store listing). Publish, then copy the video URL.

For a Short, upload `marketing/promo/history-plus-social.mp4`. Vertical videos under 60 s become Shorts automatically.

## Add it to the Chrome Web Store listing

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → *History+ for ChatGPT* (`aeedfmgfjdpgbnfjddpommjjagdobacj`) → **Store listing**.
2. Paste the YouTube URL into **Promotional video** (under Graphic assets).
3. **Save draft**, then **Submit for review**. Listing changes are reviewed before they go live.
