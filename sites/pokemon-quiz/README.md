# Which Pokémon Are You?

A branching personality quiz at https://pokemon.leahcrhunter.com. Each question
has two answers, and each answer leads to a different next question, so every
run is 10 or 11 questions long and ends on exactly one of 1,231 results (every
Pokémon #0001–#1025 plus regional, Mega, Gigantamax, Primal and alternate forms).

## Files

| File            | What it is |
|-----------------|------------|
| `index.html`    | The whole app: intro, question screen, result card (HTML/CSS/JS, no build step) |
| `quiz-data.js`  | The question tree and results, **generated** — don't edit by hand |
| `blurbs.js`     | A hand-written paragraph per result (`BLURBS`, keyed by result name), shown under the traits on the result card — edit freely |
| `sprites/`      | One 96×96 gen 5 sprite per result, from [Pokémon Showdown](https://play.pokemonshowdown.com/sprites/gen5/) |
| `sprites/mega/` | Official artwork for the 96 Mega Evolutions, from [Serebii](https://www.serebii.net/pokemon/megaevolution.shtml), shrunk to 384px WebP |

`quiz-data.js` defines two arrays:

- `Q[i]` is question `i + 1`: `[text, optionA, nextA, optionB, nextB]`. A
  positive `next` is a question number; a negative one is a result, at index
  `-next - 1` in `R`.
- `R[i]` is a result: `n` name, `f` form, `d` Pokédex number, `t` type,
  `q` number of questions to reach it, `v` "your vibe" text, `s` sprite path
  under `sprites/` (or `null`), and `x` whether that sprite is the exact form
  (`false` means the regular form's sprite is standing in).

Each result has its own shareable link, e.g. `pokemon.leahcrhunter.com/#mega-charizard-x`;
the answer path shown for a shared link is rebuilt by walking the tree.

## Changing the questions

Edit the spreadsheet (`Pokemon_Personality_Quiz.xlsx`: tabs "Question tree"
and "Results"), then regenerate with
[`scripts/pokemon-quiz-data.py`](../../scripts/pokemon-quiz-data.py) — the
usage is at the top of that file. It checks that every question is reachable
and every result is reached exactly once, and lists results with no exact
sprite. It also downloads any sprite files not yet in `sprites/`, and lists
any that are no longer used.

If you add or rename a result, add a matching entry to `blurbs.js` too; a
result without one simply shows no paragraph.

## Mega artwork

The 96 Megas show Serebii's official artwork instead of a pixel sprite. All
three Mega Tatsugiri results use the Stretchy Form art. Mega Garchomp Z's
image is smaller (250px) than the others, as that's the largest Serebii has.
Every result currently has an exact image; if the spreadsheet gains a result
with none, it falls back to the regular form's sprite with a note.
