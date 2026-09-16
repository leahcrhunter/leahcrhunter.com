# leahcrhunter.com

Everything that runs on [leahcrhunter.com](https://leahcrhunter.com), in one repo.
One folder under `sites/` per site; a single Cloudflare Worker serves all of
them, picking the folder by hostname.

| Folder                            | Deploys to                       | What it is                          |
|-----------------------------------|----------------------------------|-------------------------------------|
| `sites/home/`                     | https://leahcrhunter.com         | Landing page (fireflies)            |
| `sites/cv/`                       | https://cv.leahcrhunter.com      | CV                                  |
| `sites/talent-against-humanity/`  | https://cards.leahcrhunter.com   | Cards-Against-Humanity-style game — see its own [README](sites/talent-against-humanity/README.md) |
| `sites/corkboard/`                | https://board.leahcrhunter.com   | Interactive corkboard: notes, lists, photos, stickers — see its [README](sites/corkboard/README.md) |
| `sites/ocean/`                    | https://ocean.leahcrhunter.com   | The Five Factor Snapshot — a Big Five (OCEAN) self-reflection quiz |

All plain HTML/CSS/JS — no build step, no dependencies.

## How it's wired

```
wrangler.jsonc   — the Worker config: hostname → folder map, custom domains
src/index.js     — ~20 lines: rewrites cv.leahcrhunter.com/x → /cv/x and serves it
sites/           — the public files; every folder here is one site
```

[`wrangler.jsonc`](wrangler.jsonc) uploads `sites/` as static assets and lists
each hostname twice: once in `vars.SITES` (which folder it maps to) and once in
`routes` (so Cloudflare attaches the domain to the Worker and creates the DNS
record). `sites/.assetsignore` keeps READMEs etc. from being served.

## Editing

Edit the files in the relevant folder, commit, push. Cloudflare redeploys the
Worker automatically within a minute or so.

## Adding a new subdomain

1. Make `sites/<folder>/index.html`.
2. In `wrangler.jsonc`, add one line to `vars.SITES` and one to `routes`:
   ```jsonc
   "SITES": { ..., "new.leahcrhunter.com": "<folder>" },
   "routes": [ ..., { "pattern": "new.leahcrhunter.com", "custom_domain": true } ]
   ```
3. Push. The DNS record and certificate are created on deploy.
4. Add an icon for it in `sites/home/index.html` (duplicate a `.project-icon` block).

## Running locally

```bash
npx wrangler dev --host cv.leahcrhunter.com   # pick the site by hostname
```

then open http://localhost:8787. Without `--host`, dev serves the first
hostname in `routes` (the landing page).

## Cloudflare setup (one-off)

1. Dashboard → **Workers & Pages → Create → Workers → Import a repository**,
   pick this repo, production branch `main`. Leave the build command empty and
   the deploy command as `npx wrangler deploy` (the default).
2. If the old per-folder **Pages** projects still exist, remove their custom
   domains first (a hostname can only belong to one project), then delete them
   once the Worker is live.

Or from a terminal: `npx wrangler login && npx wrangler deploy`.
