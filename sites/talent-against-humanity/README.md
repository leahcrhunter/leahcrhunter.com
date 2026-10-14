# Talent Against Humanity

A [Cards Against Humanity](https://www.cardsagainsthumanity.com/)-style party game, entirely
made up of jokes about life in recruitment and HR

Part of **[leahcrhunter.com](https://leahcrhunter.com)** — lives in the site monorepo alongside the
site (CV, etc.), following the same hub-and-subdomain pattern.

▶ **[Live demo](#deploying)** — see below for how this gets hosted.

## How it plays

Standard Cards Against Humanity rules:

1. Someone hosts a room and shares a 4-letter code.
2. Everyone else joins from their own device (phone, laptop, whatever) using that code.
3. Each round, one player is the judge. Everyone else picks a white card from
   their hand to answer the black prompt card.
4. Answers are revealed anonymously; the judge picks a winner; that player scores
   a point.
5. Judge rotates each round. First to 5 points wins.

3–8 players is the sweet spot. Works with 2 for testing, but it's a lot less funny.

## Architecture — no server, on purpose

This isn't a client/server game — it's **peer-to-peer**, using
[PeerJS](https://peerjs.com/) (a thin wrapper around WebRTC):

- The **host's browser tab is the entire game engine.** It shuffles the decks, deals
  hands, tracks scores, and decides what happens each round. There is no backend,
  no database, and nothing about the game state ever touches a server.
- When you "host a room," PeerJS opens a WebRTC peer with a chosen ID (the room
  code). When a player "joins a room," their browser opens a direct WebRTC
  connection to the host's browser.
- The **only** thing that goes anywhere near a third party is the initial handshake
  (who's-where signalling), which PeerJS routes through its own free public broker.
  Once two devices are connected, all game traffic — names, hands, submissions,
  scores — flows directly between those two devices.
- The host's own browser tab runs through *exactly* the same rendering code path as
  every remote player's tab. Internally, the host just treats itself as a player
  and delivers its own messages straight into the UI instead of over the wire. One
  reducer (`applyServerMessage` in `app.js`), no special-cased host UI.

This means: the whole thing is three plain JS files and no build step, and it's
free to run forever, because there's no server to pay for.

**Trade-off, stated plainly:** because the host's tab *is* the server, if the host
closes their tab or loses their connection, the game ends for everyone. That's a
fair trade for a free, zero-infrastructure party game — just don't make the host
the first person to leave for another beer.

### Files

```
index.html   — structure & screens (landing, host/join, lobby, game, game over)
style.css    — visual theme, matches the rest of leahcrhunter.com
cards.js     — the actual card content (black prompts + white answers)
app.js       — game engine: PeerJS networking + host-authoritative state machine
ui.js        — DOM rendering and button wiring
```

No dependencies, no `npm install`, no build tooling. The only external thing
loaded is the PeerJS client library from a CDN in `index.html`.

## Running it locally

Any static file server works, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Open it in two different browser tabs (or two devices on the same network) to test
hosting and joining.

## Deploying

This folder lives inside the [leahcrhunter.com](https://github.com/leahcrhunter/leahcrhunter.com)
monorepo (under `sites/`) and is served by the site's single Cloudflare Worker,
which maps `cards.leahcrhunter.com` to this folder. Every `git push` to `main`
redeploys it — see the top-level README for how the routing works.

## A note on the content

The card text in `cards.js` riffs on the everyday absurdities of recruiting and HR work
(scorecards, pipelines, ghosting, 'culture fit', and so on). It's general-purpose satire,
not a commentary on any particular employer or hiring process — edit `cards.js` to add
your own.

## Possible next steps

- A short "how to play" overlay on first load
- Reconnect handling if a player's tab refreshes mid-game (currently they'd need
  to rejoin as a new player)
- A custom, tighter room-code scheme if PeerJS's public broker ever gets flaky
  under load (fine for a friend group; would need TURN servers or a Cloudflare
  Durable Objects backend for anything larger)
