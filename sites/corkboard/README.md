# corkboard

A little interactive corkboard — sticky notes, to-do lists, polaroid photos and
emoji stickers, pinned to a board under a string of fairy lights, with fireflies
drifting past.

Part of **[leahcrhunter.com](https://leahcrhunter.com)**; served at
`board.leahcrhunter.com` by the monorepo's single Cloudflare Worker.

## What you can do

- **note** — a sticky note in one of six paper colours (hover the note to change it)
- **list** — a to-do list; `Enter` adds a row, `Backspace` on an empty row removes it
- **photo** — pin an image from your device; it's shrunk to ≤720px before storing
- **sticker** — pick an emoji from the tray
- drag anything around; click text to edit; hover for the ✕ to take it down
- **save file / load file** — export the whole board as JSON and import it elsewhere

## Where the board lives

There's no server. The board is saved to `localStorage` in whichever browser
you're using, so it's private, free, and works offline — but it's *per browser*:
your phone and your laptop each have their own board. Use **save file** →
**load file** to carry one across, or as a backup.

Browsers give `localStorage` roughly 5 MB, which is plenty of notes but only a
handful of photos (each is ~50–150 KB after shrinking). If it fills up, a banner
tells you the last change couldn't be saved.

### If you want one board everywhere

The natural next step is a tiny API on the same Worker: `GET /api/board` and
`PUT /api/board` backed by a Cloudflare KV namespace, with a secret in the
`Authorization` header so only you can write. `app.js` already funnels every
change through `save()`, so it's a one-function swap on the client side.

## Files

```
index.html   — structure: board, tool tray, sticker picker
style.css    — cork texture, wooden frame, pins, paper, lights, tray
app.js       — state + localStorage, rendering, dragging, fairy lights, fireflies
```

No dependencies, no build step. Fonts (Newsreader, IBM Plex Sans, Caveat) come
from Google Fonts.

## Running locally

From the repo root:

```bash
npx wrangler dev --host board.leahcrhunter.com
```

or just open `index.html` in a browser — it's all static.
