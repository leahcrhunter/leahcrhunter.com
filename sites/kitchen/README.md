# kitchen

A private kitchen app for two: what we have, what to cook, what to buy.
Four tabs share one set of data: **pantry**, **recipes**, **what can we make?**
and **this week**. Same night-sky look as the rest of the site: fairy lights
along the top, fireflies behind, and a lit bulb for everything you have.

Part of **[leahcrhunter.com](https://leahcrhunter.com)**, served at
`kitchen.leahcrhunter.com` by the monorepo's single Cloudflare Worker. Unlike
the other sites it has a login and a database.

## What's built

Build phases 1 to 4 of the plan, plus the dinner planner and a web recipe finder:

- **Foundations**: shared-password login, D1 database, starter ingredients
  list (~170 foods with aliases, aisles, where they live and how long they
  keep), the four-tab shell, metric / US toggle, add to home screen.
- **Pantry**: quick add (`milk 2 l`, `6 eggs`), use some, used up, thrown
  away, move (into the freezer pushes the use-by out 3 months), opened today;
  a "use soon" section at the top; filter by where it lives; a quick check
  that walks one shelf as a checklist. Everything that leaves the pantry is
  written to the usage log. The same food in the same place is always one
  row: adding more milk to the fridge tops up the milk that's there (keeping
  the earlier use-by, so "use soon" still warns about the older carton).
- **Recipes**: paste a link (reads the schema.org data recipe sites publish)
  or type it in; ingredient lines are matched to the ingredients list, and you
  can correct the matches before saving. Each card has have / need bulbs, a
  servings control, per-person ratings, notes, **cooked this** (takes the food
  out of the pantry, soonest use-by first) and **add missing to the list**.
- **What can we make?**: looks through every recipe in the box (typed in or
  saved from the web) and ranks them by how much is in the house, favouring
  food that's about to go off, recipes you rated well, and not what you had
  this week. An optional prompt narrows it ("chicken", "pie") and rules
  things out ("no cheese", "vegetarian"). This part is free and runs on the
  phone. Ticking "also find something new" adds one idea from outside the
  box (see step 3 below); **save to the recipe box** saves it in one tap.
- **Recipes** shows every saved recipe, newest first, with a count. If a
  search or filter is hiding some, it says "showing 2 of 5 · show all".
- **This week**: Monday to Sunday dinners picked from the recipe box (or
  "leftovers" / "eating out"), with one button that adds everything those
  dinners need to the list. Amounts are added up across the week, and what's
  in the pantry or already on the list is taken off. On a Sunday it opens on
  next week.
- **Shopping list** (on "this week"): shared and live (the other phone sees a
  tick within ~4 s), grouped by aisle, duplicates merge. Ticking puts the food
  in the pantry with today's date and its usual use-by; un-ticking undoes that.

Not built yet: suggested dinners for the week and restocking from the usage
log and staples (the rest of phase 5), cook mode and waste stats (phase 7).

## One-off setup

1. **Create the database** and put its id in `wrangler.jsonc`
   (replace `REPLACE-WITH-ID-FROM-wrangler-d1-create`):
   ```bash
   npx wrangler d1 create kitchen
   npx wrangler d1 migrations apply kitchen --remote
   ```
   Until the real id is in, deploys of the whole Worker (every site) will fail.
2. **Set the password.** Pick one, then:
   ```bash
   node scripts/kitchen-password.mjs            # prints pbkdf2-sha256:...
   npx wrangler secret put KITCHEN_PASSWORD_HASH  # paste that line
   openssl rand -base64 32                       # a random signing key
   npx wrangler secret put KITCHEN_SESSION_SECRET # paste that
   ```
   Changing either secret later signs every device out.
3. **Web recipe finder** (optional): create an API key at
   console.anthropic.com and either paste it into "what can we make?" (it's
   checked, kept in the database, and never sent back to a phone) or set it
   as a secret with `npx wrangler secret put ANTHROPIC_API_KEY` (the secret
   wins if both are set). Each search runs Claude Opus 5 with web search:
   roughly 10 to 30p a press, mostly the search results it reads. Without a
   key, ideas come from TheMealDB's free collection (a few hundred recipes).
   Either way, anything ruled out in the prompt ("no cheese", "vegetarian",
   "nut free") is checked against the real ingredient list before a
   suggestion is shown (`sites/kitchen/js/diet.js`, shared with the Worker).
4. Push. The subdomain and its certificate are created on deploy.
5. On each phone: open the site, log in once, then **Add to Home Screen**.

## How it's wired

```
sites/kitchen/              the front end (plain HTML/CSS/JS modules, no build)
  index.html, style.css     shell and look
  login.html                the only page served without a login
  js/app.js                 header, tabs, routing (#pantry, #recipes/12, #week)
  js/store.js               the shared data, polling for the other phone's changes
  js/units.js, parse.js     units, "2 red onions, sliced" -> 2 × red onion
  js/stock.js               have / need, taking food out soonest use-by first
  js/pantry.js, recipes.js, week.js, make.js, ingredients.js   the tabs
src/kitchen/
  index.js                  login gate in front of static files and /api/
  auth.js                   password check, signed cookie, rate limit
  api.js                    JSON endpoints over D1
  import.js                 recipe-from-a-link
  find.js                   "what can we make?": Claude + web search, or TheMealDB
migrations/kitchen/         the D1 schema and starter ingredients
scripts/kitchen-password.mjs
```

- **Privacy**: every path except the login page, the stylesheet, the
  fairy-light script, the manifest and icons needs the session cookie
  (HttpOnly, Secure, SameSite=Lax, 400 days). Failed logins are limited to 5
  per IP per 15 minutes and 50 overall per hour. Writes must be same-origin
  JSON, so another site can't post to the API with the cookie.
- **Who's who**: there's one password, so each phone just says whose it is
  (remembered in that browser). That name goes on "added by" and ratings.
- **Live**: every write bumps a revision number; phones poll `/api/rev` (every
  4 s on the list, 20 s elsewhere, never in the background) and reload the
  data when it changes.
- **Units**: the pantry and list store `g`, `ml` or a count; recipe lines keep
  the unit they were written in. Crossing between weight, volume and count
  uses each ingredient's `density` (grams per ml) and `unit_weight` (grams
  each), editable from the menu → ingredients.

## Running locally

From the repo root:

```bash
npx wrangler d1 migrations apply kitchen --local
printf 'KITCHEN_PASSWORD_HASH=%s\nKITCHEN_SESSION_SECRET=dev\n' "$(node scripts/kitchen-password.mjs)" > .dev.vars
npx wrangler dev --host kitchen.leahcrhunter.com
```

then open http://localhost:8787. `.dev.vars` is gitignored.
