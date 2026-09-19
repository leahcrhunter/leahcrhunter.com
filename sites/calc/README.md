# Pokémon Champions damage calculator — Context Document

Companion doc to the main `leahcrhunter.com` project context. Covers a new tool:
a damage calculator for Pokémon Champions (Regulation M-C), built to hold Leah's
full VGC team and show damage ranges against a chosen opponent, following the
same static-site, no-build-step, one-folder-per-subdomain pattern as the rest
of the site (see the repo's own README, and `Start_of_the_project` /
`progress_from_talent-against-humanity` for that pattern in more detail).

## The big idea

Save your full team (stats, items, moves, Mega eligibility) once. Pick an
opponent species. See two things at a glance:

1. **My team's moves vs the opponent** — for each of my Pokémon's moves, the
   damage % range across the opponent's plausible bulk (0 Stat Points/neutral
   nature up to max Stat Points/boosting nature on the relevant defensive stat).
2. **The opponent's moves vs my team** — for each of the opponent's likely
   moves (auto-suggested from usage stats, editable), the damage % range
   against each of my Pokémon (my own spread is exact, so no bulk range is
   needed on my side, just the normal 85–100% roll).

## Why this isn't generic Gen 9 VGC — confirmed by research this session

Pokémon Champions is a standalone, free-to-play, competitive-only game (not a
Scarlet/Violet update), launched 8 April 2026. Confirmed mechanics for the
**current ruleset, Regulation Set M-C (9 September – 2 December 2026)**:

- Doubles, bring 6 / choose 4, all Pokémon auto-set to level 50.
- Species Clause and Item Clause.
- **Both Mega Evolution and Terastallization are active**, each usable once
  per battle — unusual; no mainline game has run both gimmicks at once before.
- Champions replaces the classic 0–252 EV / 0–31 IV system with **"Stat
  Points"** (roughly 0–32 per stat) and appears to hide/fix IVs entirely
  rather than exposing them to the player.
- Some of Champions' Mega Evolutions are **game-original** and don't exist
  correctly (or at all) in mainline damage-calc data — confirmed concretely
  this session (see "Verified technical finding" below).
- M-C added 24 new battle-eligible Pokémon (incl. Rillaboom, Salamence,
  Golisopod, Baxcalibur) and 6 new Megas (Mega Salamence, Mega Golisopod,
  Mega Baxcalibur, Mega Absol Z, Mega Garchomp Z, Mega Lucario Z) on top of
  everything carried over from M-A/M-B.
- Whenever M-C ends (currently scheduled through 2 December 2026), the legal
  species list and usage stats will need refreshing for whatever regulation
  follows.

## Decisions made this session (in order)

1. **Format**: Gen 9 / Pokémon Champions, doubles, Regulation M-C.
2. **Opponent movesets**: auto-suggest from usage stats, with room to add
   moves manually — not fully manual, not fully automatic.
3. **Opponent's Tera type**: skip guessing it for v1 (too uncertain to model
   usefully).
4. **Mega Evolution**: a per-Pokémon *select* ("Not Mega" / one option per
   forme — Charizard X/Y, Raichu X/Y, Absol/Absol Z, Garchomp/Garchomp Z,
   Lucario/Lucario Z have two), shown only when that species has a Mega,
   for **both** my team and the opponent. The stored value is the engine's
   forme name (`mega: 'Charizard-Mega-Y'`, `''` for none; a legacy `true`
   is migrated to the first forme on load). A Mega's ability is fixed by
   the forme, so the ability field is ignored when a Mega is selected. No
   held-item check, no "only one Mega per battle" enforcement — this is a
   pure damage-calc tool, not a battle-legality checker.
5. **Terastallization**: removed from scope entirely for now (both my team
   and the opponent) — cut after the Mega-toggle decision to keep the tool
   simpler; can be reintroduced later the same way Mega was added.
6. **Location**: new `sites/vgc-calc/` folder in the existing
   `leahcrhunter.com` repo, deployed the same way as `cv` and
   `talent-against-humanity` (Cloudflare Worker, `wrangler.jsonc` hostname
   map), suggested subdomain `calc.leahcrhunter.com`.

## Architecture

```
Champions dex overrides ─┐
Usage-stats data ────────┼──> Damage calc engine (@smogon/calc, custom-rebuilt) ──> Matchup view
My saved team (localStorage) ┘
```

- **Damage formula**: `@smogon/calc` (the library behind Pokémon Showdown's
  own damage calculator) supplies the actual Gen 9 mechanics — type
  effectiveness, STAB, weather, terrain, screens, abilities, items, doubles
  spread-move reduction. We never reimplement this math ourselves.
- **Champions dex layer** (`champions-dex.js`): knows which species Mega
  into what (`megas` in `regulation-mc.json`, 77 species / 82 formes, all
  present in the vendored engine) and applies
  `champions-dex-overrides.json`, a *diff* keyed by engine forme name for
  the few formes whose Champions data differs (currently Mega Staraptor →
  Contrary, Mega Floette → Fairy Aura). Checked 19 Sep 2026: every other
  Mega's engine ability matches the top ability on the Reg M-C ladder; the
  Z-Megas and Mega Eelektross/Scovillain have no ladder data yet and are
  unverified.
- **Team storage**: `localStorage` only, no backend, no accounts. Export/
  Import as JSON is the only backup/multi-device path (`team-store.js`).
- **Usage stats**: `usage-stats.js` loads a static JSON file for the
  opponent-moveset auto-suggest. Not fetched live — refreshed by hand
  occasionally from a real usage-stats source and committed.
- **Stat Points**: `stat-points.js` is the single conversion point
  between what the Champions UI shows (Stat Points, ~0–32) and what
  `@smogon/calc` consumes (classic EVs 0–252). **The conversion formula in
  there right now is an unverified placeholder** (`points * 8`, capped at
  252) pieced together from community forum discussion, not a confirmed
  in-game table. This is the single most important thing to verify/fix
  before trusting any calculated number.

## Verified technical finding (important — don't re-litigate this)

Installed `@smogon/calc` (npm, v0.11.0) and confirmed directly, in Node:

```js
const p = new calc.Pokemon(gen9, 'Staraptor-Mega');
// p.ability === 'Intimidate'
```

Pokémon Champions' Mega Staraptor actually has **Contrary**, not Intimidate
(per community documentation of Champions-original Megas — an independent
open-source MCP server for Champions damage calc hit and solved this exact
problem the same way). This confirms the dex-override layer is necessary,
not speculative — it's already needed for at least one real species, and
likely for the other Champions-original Megas (Z-Mega Absol/Garchomp/Lucario,
Mega Salamence/Golisopod/Baxcalibur) too, none of which have been checked
against a reliable source yet.

**The correct override mechanism** (verified working end-to-end): pass
`ability` and `overrides: { baseStats: {...}, types: [...] }` directly in the
`Pokemon` constructor's options object — `@smogon/calc` deep-merges
`overrides` onto its internal species data at construction time, then runs
its normal nature/EV stat calculation on top of the corrected base stats.
Do **not** try to mutate `calc.SPECIES` directly — tested, and it does not
propagate (the library resolves species through a separate cached lookup).

```js
new calc.Pokemon(gen9, 'Staraptor-Mega', {
  ability: 'Contrary',
  overrides: { baseStats: { hp: 85, at: 140, df: 100, sa: 60, sd: 90, sp: 110 } },
  level: 50, evs: { atk: 252 }, nature: 'Adamant',
});
// -> p.ability === 'Contrary', p.stats correctly reflects nature/EVs on the
//    corrected base stats.
```

## A second bug found and fixed this session

`@smogon/calc`'s own prebuilt browser file, `dist/production.min.js` (the
one its `package.json` points browser consumers at via the `unpkg` field),
contains an unresolved `require('./desc')` call inside `calculate()` itself
(not just in the text-formatting methods). In a real browser, with no
`require` global, this throws immediately the first time `calculate()` runs.
**Do not vendor that file directly.**

Fix applied: rebuilt a clean, fully self-contained bundle with esbuild
instead of using the package's split `dist/production.min.js` +
`dist/data/production.min.js` files:

```bash
npm install @smogon/calc@0.11.0 esbuild
cat > entry.js <<'EOF'
const calc = require('@smogon/calc');
// getFinalSpeed lives in the calc's internal mechanics/util and isn't
// re-exported from index.js; expose it so the speed comparison uses the
// real formula (boosts, Choice Scarf, paralysis, Tailwind, weather/terrain
// speed abilities) instead of a hand-rolled copy.
const util = require('@smogon/calc/dist/mechanics/util');
calc.getFinalSpeed = util.getFinalSpeed;
window.calc = calc;
EOF
npx esbuild entry.js --bundle --platform=browser --format=iife --minify \
  --outfile=smogon-calc.bundle.js
```

This was tested end-to-end in a Node shim (`global.window = {}`, then
`vm.runInThisContext` on the bundle) and confirmed working, including
`result.desc()` (which the original prebuilt file could not do), doubles
`Field` mechanics (terrain reduced/boosted damage correctly), and the
Mega-override mechanism above. The working file is
`smogon-calc.bundle.js` in the scaffold — **this is the one
`index.html` loads. Don't swap back to the package's own dist files.**

## Matchup board (layout changed 19 Sep 2026)

The Matchup tab is: opponent & field → opponent's move chips → **one row
per saved Pokémon** (`UI.renderMatchupBoard`, rebuilt only when the team
changes) with identity + speed verdict + its own status/stage controls on
the left, **Deals** (its moves vs the opponent's bulk range) in the middle
and **Takes** (the ticked opponent moves vs its exact spread) on the right.
There is no Calculate button any more: `recalc()` in `main.js` runs on any
`change` inside the tab and fills the rows via `UI.updateMatchupResults`,
which only touches the result cells so inputs keep focus. Status moves show
"status", type immunities show "immune". Errors go to `#calc-error` inline.

## Battle state, speed and status (added 18 Sep 2026)

The Matchup tab now carries *battle state* on top of the saved team build:

- **Status and stat stages, both sides.** The opponent form has a status
  select and Atk/Def/SpA/SpD/Spe stage inputs (−6…+6); each of my Pokémon
  has the same controls on its own row of the matchup board. These are passed straight
  into `calc.Pokemon` as `status` / `boosts`, so burn halving physical
  damage, Guts, Facade, paralysis speed, etc. are all the engine's own
  handling — nothing reimplemented. Battle state is deliberately **not**
  persisted with the team (it's what's true in this fight, not the build);
  it resets on reload and is dropped when a slot is cleared.
- **Tailwind (either side) and Trick Room** on the field form. Tailwind goes
  into the calc `Side`; Trick Room only flips the speed verdicts.
- **Speed** on each board row: the opponent's estimated final speed
  range (0 Spe Stat Points/neutral nature → max/+Spe nature, with their
  item/status/stages/field applied) and, for each of my Pokémon, its exact
  final speed and a turn-order verdict — "Moves first", "Moves second", or
  "Depends on their spread" with the Stat-Point threshold per nature
  (e.g. "+Spe: first if opp has ≤ 15 Spe SP (tie at 16)"). Speeds come from
  `calc.getFinalSpeed`, exposed by the bundle rebuild above. Because one
  Spe Stat Point is one speed point at level 50, thresholds are exact —
  but they inherit the placeholder Stat Points → EV conversion, so treat
  them with the same caution as every other number until that's verified.

## What's built and verified vs. what's just scaffolded

**Built and verified (tested in a Node shim simulating the browser):**
- `smogon-calc.bundle.js` — the custom, working, self-contained calc
  engine bundle.
- `champions-dex.js` — override layer. `ChampionsDex.buildPokemon(gen,
  'Staraptor', {mega: true})` correctly returns Contrary, not Intimidate.
- `calc-engine.js` — both `myMovesVsOpponent(...)` and
  `opponentMovesVsMyTeam(...)` produce sensible damage-% ranges, confirmed
  with real calls (e.g. Rillaboom Wood Hammer vs Incineroar in Grassy
  Terrain doubles).

**UI layer — now verified in a real (headless Chrome) browser, 18 Sep 2026:**
the full flow was driven end-to-end (save team, Mega toggle visibility,
reload persistence, tab switch, opponent move suggestions incl. untick and
manual add, status/stages/Tailwind/Trick Room, calculate) with no page or
calc errors, and the numbers matched hand-checks (burn halves, +2 Atk
doubles, −1 Atk is ×⅔, speed ties land on the expected Stat Point). The
list below is kept for the record of what that run covered.

**Originally written without a browser run:**
- `index.html`, `style.css` — full two-tab UI (My Team / Matchup).
- `ui.js`, `main.js` — DOM rendering and all event wiring (tab
  switching, team-slot save/clear, species-driven Mega-toggle visibility,
  move-suggestion checkboxes, field-conditions form, Export/Import JSON).
- `team-store.js` — localStorage CRUD, straightforward, low risk.
- `stat-points.js` — works as written, but see the placeholder-formula
  warning above.

**This means: open `index.html` in an actual browser first and shake out any
DOM/wiring bugs before trusting the UI layer.** The calculation core
underneath it is the part that's been proven; the interactive shell around
it hasn't had a real browser run yet.

## Data files (all real as of 19 Sep 2026)

- `champions-dex-overrides.json` — real, tiny: the two confirmed ability
  corrections above. Add entries only where Champions differs from the
  engine (keys: `ability`, `types`, `baseStats`).
- `regulation-mc.json` — **real data** (19 Sep 2026): all 269 species/forms
  usable in Champions Ranked under M-C, as `@smogon/calc` names, scraped from
  Serebii's Champions "Available Pokémon" roster (sprite suffixes give the
  regional forms) and cross-checked against Game8's and MetaVGC's M-C roster
  pages. Forms Champions folds into one entry but which change stats/types
  (Rotom appliances, Indeedee-F, Lycanroc forms, Aegislash Shield/Blade,
  all three Paldean Tauros breeds, …) are listed separately. Every name was
  verified to construct in the vendored engine. Drives the species
  `<select>` on both tabs (`UI.setSpeciesList`); a saved species that isn't
  on the list is still shown as an option so old teams don't silently
  change. Also carries `legal_items`: the full held-item pool (85 — 57 items
  + 28 berries) from Serebii's Champions items page, cross-checked against
  champdex.com. **Champions deliberately restricts items**: no Choice
  Band/Specs, Assault Vest, Safety Goggles, Covert Cloak, Clear Amulet,
  Weakness Policy, Eviolite, Booster Energy. Mega Stones are left out since
  the Mega toggle covers that. Item fields are dropdowns too. Regenerate
  both lists whenever the regulation changes.
- `usage-mc.json` — **real data** (19 Sep 2026): move / ability / item usage
  for 253 species and Mega forms, scraped from Pikalytics' Reg M-C pokedex
  (`/pokedex/gen9championsvgc2026regmc/<Name>`, one page per species, moves
  in `#moves_wrapper` etc.). Ladder data only reveals moves actually used,
  so percentages are low and only meaningful for ordering. Drives: the
  **team-card autofill** (top-4 moves + most-used ability when a species is
  picked — all still editable) and the opponent chips (top 8 shown, top 4
  pre-ticked). Mega entries are merged into the base species for moves
  but not abilities (Champions-original Mega abilities like Aura Guard
  aren't in the engine). Forms with no data borrow the base species'.
- `learnsets-mc.json` — **real data** (19 Sep 2026): the Champions
  learnset for all 269 species/forms, from Serebii's Champions Pokédex
  (`serebii.net/pokedex-champions/<slug>/`, "Standard Moves" tables; form
  tables split by header — Alolan/Galarian/Hisuian/Paldean, Tauros breeds,
  Lycanroc/Toxtricity forms, Meowstic/Indeedee/Basculegion sexes; Rotom
  appliances = base + signature move). Every move name verified against
  the engine. Drives the move dropdowns on team cards and the opponent's
  "add a move" dropdown.

## Folder layout

```
sites/calc/
├── index.html
├── style.css
├── smogon-calc.bundle.js       <- the fixed, working bundle (load this)
├── smogon-calc-package.json    <- just the @smogon/calc package.json, for reference
├── champions-dex.js
├── stat-points.js
├── calc-engine.js
├── team-store.js
├── usage-stats.js
├── ui.js
├── main.js
├── champions-dex-overrides.json
├── regulation-mc.json
├── learnsets-mc.json
├── usage-mc.json
```

Flat, like the other sites in this repo (no subfolders — everything is
loaded by relative path from `index.html`). Served at
`calc.leahcrhunter.com`. This README is kept out of the public build by
`sites/.assetsignore`.

## Next steps, roughly in priority order

1. ~~Open `index.html` in a real browser~~ — done, see above. Only leftover
   nit: status moves (e.g. Will-O-Wisp) show as `0–0%` in the opponent
   table; worth filtering `category === 'Status'` out or labelling them.
2. **Pin down the real Stat Points → EV conversion** in `stat-points.js`
   — currently a guess. Also confirm whether IVs are truly fixed for every
   Pokémon and at what value (currently assumed 31 across the board).
3. **Verify the unverified Megas** — Absol/Garchomp/Lucario-Mega-Z and
   Mega Eelektross/Scovillain have engine data but no ladder usage to check
   it against; confirm ability/types/base stats from an in-game source and
   add overrides if they differ.
4. ~~Build out the real M-C legal-species list~~ — done, see
   `regulation-mc.json` above. Species are now dropdowns, not free text.
   Mega selection is done too (see decision 4).
5. ~~Source real usage-stats data~~ — done (see `usage-mc.json` /
   `learnsets-mc.json` above). Still worth doing: a small refresh script
   (fetch Pikalytics + Serebii → write both JSONs → commit) so it can be
   re-run by hand when the meta shifts or the regulation changes; the
   scrape was done ad hoc this time.
6. ~~Rename the `.sample.json` files~~ — done; no sample files remain.
7. **Wire into the repo** — done: lives at `sites/calc/` (not `vgc-calc`),
   `calc.leahcrhunter.com` is in `wrangler.jsonc`'s `vars.SITES` and
   `routes`; its firefly jar is on the homepage project row. Still to do: push.
8. **Optional, later**: reintroduce Terastallization the same way Mega was
   added (per-Pokémon toggle, both sides) once the rest is solid — it was
   cut for scope, not because it's a bad idea.
