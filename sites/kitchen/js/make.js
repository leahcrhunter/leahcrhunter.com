// Tab 3: what can we make? Looks through every recipe in the box (typed in or
// saved from the web) and ranks them by what's in the house, favouring food
// that's about to go off. Optionally also finds something new: Claude
// searching the web with an API key, or TheMealDB's free collection without.
// A prompt steers both ("chicken", "no cheese", "vegetarian").

import { store, prefs, api, mutate, freshness, daysUntil } from "./store.js";
import { h, clear, bulb, run, toast } from "./ui.js";
import { fmtLineQty } from "./units.js";
import { parseLine, matchIngredient } from "./parse.js";
import { checkLine, shoppingFor } from "./stock.js";
import { saveDraft } from "./recipes.js";
import { readRequest, breaks } from "./diet.js";

// Kept while switching tabs.
let asked = { prompt: "", usePantry: true }; // what the recipe box picks are for
let showAll = false;
let jitter = new Map(); // recipe id -> a small random nudge, fixed until the next ask
let result = null; // the new find: { draft, why, source, savedId }
let searching = false; // don't redraw over "searching…" when the data refreshes
let findError = null;
const shown = []; // titles suggested this visit, so "another one" doesn't repeat

export function mountMake(pane) {
  const prompt = h("textarea", {
    class: "make-prompt", rows: 2, maxlength: 500, "aria-label": "anything in mind?",
    placeholder: "anything in mind? (optional)\n“chicken”, “no cheese”, “something with the spinach”",
  });
  const usePantry = h("input", { type: "checkbox", checked: true });
  const findNew = h("input", { type: "checkbox", checked: true });
  const go = h("button", { class: "btn btn-primary make-go" }, "what can we make?");
  const keyPanel = h("div", { class: "key-panel" });
  const boxOut = h("section", { class: "box-picks", "aria-live": "polite" });
  const newOut = h("section", { class: "make-result", "aria-live": "polite" });
  let keyShown;

  pane.append(
    h("header", { class: "pane-head" }, h("h1", {}, "what can we make?")),
    h("form", { class: "make-ask", onsubmit: (e) => { e.preventDefault(); ask(); } },
      prompt,
      h("div", { class: "make-row" },
        h("div", { class: "make-options" },
          h("label", { class: "check-field" }, usePantry, "use up what's in the pantry"),
          h("label", { class: "check-field" }, findNew, "also find something new")
        ),
        go
      )
    ),
    keyPanel,
    boxOut,
    newOut
  );

  function ask() {
    asked = { prompt: prompt.value.trim(), usePantry: usePantry.checked };
    showAll = false;
    jitter = new Map();
    renderBox();
    if (findNew.checked) findSomethingNew();
    else { result = null; findError = null; renderNew(); }
  }

  // ---------------------------------------------------------------- the recipe box

  function renderBox() {
    const { exclude, words } = readRequest(asked.prompt);
    const soonIds = new Set(store.pantry.filter((p) => ["soon", "expired"].includes(freshness(p))).map((p) => p.ingredient_id));
    const picks = [];
    for (const r of store.recipes) {
      const names = r.lines.map((l) => store.ing.get(l.ingredient_id)?.name).filter(Boolean);
      // rule-outs are a hard no
      if (breaks({ title: r.title, ingredients: [...r.lines.map((l) => l.original), ...names] }, exclude).length) continue;
      // other words narrow it down: "chicken", "curry", "pasta"
      const hay = [r.title, ...r.tags, ...names, ...r.lines.map((l) => l.original)].join(" ").toLowerCase();
      const hits = words.filter((w) => hay.includes(w.replace(/(es|s)$/, "")));
      if (words.length && !hits.length) continue;

      const lines = r.lines.filter((l) => l.ingredient_id && !l.optional);
      const checks = lines.map((l) => ({ l, status: checkLine(l).status }));
      const have = checks.filter((c) => c.status === "have").length;
      const missing = [...new Set(checks.filter((c) => c.status !== "have").map((c) => store.ing.get(c.l.ingredient_id).name))];
      const usesSoon = [...new Set(lines.filter((l) => soonIds.has(l.ingredient_id)).map((l) => store.ing.get(l.ingredient_id).name))];
      const ratings = Object.values(r.ratings);
      const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      const sinceCooked = r.last_cooked ? -daysUntil(r.last_cooked) : Infinity;
      if (!jitter.has(r.id)) jitter.set(r.id, Math.random() * 1.5);

      const score =
        (lines.length ? have / lines.length : 0.5) * (asked.usePantry ? 10 : 2) +
        (asked.usePantry ? usesSoon.length * 3 : 0) +
        hits.length * 4 +
        (rating ? rating - 3 : 0) -
        (sinceCooked < 5 ? 4 : 0) + // had it this week
        jitter.get(r.id); // so asking again isn't always the same order
      picks.push({ r, have, total: lines.length, missing, usesSoon, score });
    }
    picks.sort((a, b) => b.score - a.score);

    const heading = h("h2", { class: "make-heading" }, "from our recipe box",
      store.recipes.length ? h("span", { class: "count" }, `${picks.length} of ${store.recipes.length} fit`) : null);
    if (!store.recipes.length) {
      return clear(boxOut, heading, h("p", { class: "quiet" }, "Nothing saved yet. Find something new below and save it, or add recipes on the recipes tab."));
    }
    if (!picks.length) {
      return clear(boxOut, heading, h("p", { class: "quiet" }, `Nothing in the box fits “${asked.prompt}”.`));
    }
    const visible = showAll ? picks : picks.slice(0, 3);
    clear(boxOut, heading,
      h("div", { class: "pick-cards" }, visible.map(pickCard)),
      picks.length > visible.length
        ? h("button", { class: "ghost-btn", onclick: () => { showAll = true; renderBox(); } }, `show all ${picks.length}`)
        : null
    );
  }

  function pickCard({ r, have, total, missing, usesSoon }) {
    const time = (r.prep_min || 0) + (r.cook_min || 0);
    return h("article", { class: "pick-card" },
      h("a", { class: "pick-photo", href: `#recipes/${r.id}`, tabindex: "-1", "aria-hidden": "true" },
        r.photo_url
          ? h("img", { src: r.photo_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" })
          : h("span", { class: "placeholder" }, r.title.trim()[0]?.toLowerCase() || "·")),
      h("div", { class: "pick-body" },
        h("a", { class: "pick-title", href: `#recipes/${r.id}` }, r.title),
        h("p", { class: "pick-meta" },
          total ? h("span", { class: `have-count${have === total ? " all" : ""}` }, bulb(have === total ? "on" : "off"), `have ${have} of ${total}`) : null,
          time ? h("span", {}, `${time} min`) : null
        ),
        usesSoon.length ? h("p", { class: "pick-soon" }, `uses up ${usesSoon.join(", ")}`) : null,
        missing.length ? h("p", { class: "pick-need" }, `need ${missing.join(", ")}`) : null,
        missing.length
          ? h("button", {
              class: "ghost-btn pick-add",
              onclick: (e) => {
                const items = shoppingFor([{ recipe: r, label: `for ${r.title}` }]);
                if (!items.length) return toast("it's all already on the list");
                run(e.currentTarget, async () => {
                  await mutate("POST", "shopping", { person: prefs.person, items });
                  toast(`${items.length} added to the list`, { action: "see list", onAction: () => { location.hash = "#week"; } });
                });
              },
            }, "+ add what's missing to the list")
          : null
      )
    );
  }

  // ---------------------------------------------------------------- something new

  async function findSomethingNew() {
    const soon = [], have = [];
    if (asked.usePantry) {
      for (const item of store.pantry) {
        const ing = store.ing.get(item.ingredient_id);
        if (!ing || ing.category === "household") continue;
        (["soon", "expired"].includes(freshness(item)) ? soon : have).push(item.name || ing.name);
      }
    }
    searching = true;
    findError = null;
    renderNew();
    try {
      const found = await api("POST", "recipes/find", {
        prompt: asked.prompt || null,
        soon: [...new Set(soon)],
        have: [...new Set(have)],
        avoid: [...store.recipes.map((r) => r.title), ...shown],
      });
      result = found;
      shown.push(found.draft.title);
    } catch (err) {
      findError = err.message;
    }
    searching = false;
    renderNew();
  }

  function renderNew() {
    const heading = h("h2", { class: "make-heading" }, "something new",
      h("span", { class: "count" }, store.finder?.key ? "from the web" : "from a free collection"));
    if (searching) {
      return clear(newOut, heading, h("div", { class: "make-searching" },
        h("span", { class: "search-glow", "aria-hidden": "true" }),
        h("p", {}, store.finder?.key ? "searching the web for something good…" : "looking for something good…"),
        store.finder?.key ? h("p", { class: "quiet" }, "this can take half a minute") : null
      ));
    }
    if (findError) {
      return clear(newOut, heading, h("p", { class: "quiet" }, findError),
        h("button", { class: "btn", onclick: findSomethingNew }, "try again"));
    }
    if (!result) return clear(newOut);

    const { draft, why, source, savedId } = result;
    const lines = draft.ingredients.map((original) => {
      const p = parseLine(original);
      const ing = matchIngredient(p.name, store.ingredients);
      return { original, ing, line: { ingredient_id: ing?.id ?? null, quantity: p.qty, unit: p.unit, optional: p.optional } };
    });
    const counted = lines.filter((l) => l.ing && !l.line.optional);
    const haveCount = counted.filter((l) => checkLine(l.line).status === "have").length;
    const time = (draft.prep_min || 0) + (draft.cook_min || 0);
    const host = (() => { try { return new URL(draft.source_url).hostname.replace(/^www\./, ""); } catch { return "source"; } })();

    const save = savedId
      ? h("a", { class: "btn", href: `#recipes/${savedId}` }, bulb("on"), "in the box: open it")
      : h("button", {
          class: "btn btn-primary",
          onclick: (e) => run(e.currentTarget, async () => {
            result.savedId = await saveDraft(draft);
            renderNew();
            toast("saved to the recipe box");
          }),
        }, "save to the recipe box");

    clear(newOut, heading, h("article", { class: "suggestion" },
      draft.photo_url
        ? h("img", { class: "hero-photo", src: draft.photo_url, alt: "", referrerpolicy: "no-referrer" })
        : h("span", { class: "hero-photo placeholder", "aria-hidden": "true" }, draft.title[0]?.toLowerCase() || "·"),
      h("div", { class: "card-head" },
        h("h2", { class: "card-title" }, draft.title),
        why ? h("p", { class: "suggestion-why" }, why) : null,
        h("p", { class: "card-meta" },
          [counted.length ? `you have ${haveCount} of ${counted.length}` : null, time ? `${time} min` : null, `serves ${draft.servings}`]
            .filter(Boolean).join(" · "),
          " · ", h("a", { href: draft.source_url, target: "_blank", rel: "noopener" }, host)
        )
      ),
      h("div", { class: "btn-row" }, save, h("button", { class: "btn", onclick: findSomethingNew }, "another one")),
      h("section", { class: "card-section" },
        h("h2", {}, "ingredients"),
        h("ul", { class: "ingredient-lines" }, lines.map(({ original, ing, line }) => {
          const status = ing ? checkLine(line).status : "unknown";
          const [state, label] = { have: ["on", "have it"], short: ["soon", "not quite enough"], need: ["off", "need it"], unknown: ["unknown", "not matched"] }[status];
          const amount = fmtLineQty(line.quantity, line.unit, ing, prefs.units);
          return h("li", { class: `ingredient-line ${status}` },
            bulb(state, label),
            h("span", { class: "line-main" },
              h("span", { class: "line-text" }, amount ? h("strong", {}, amount + " ") : null, ing?.name || original),
              ing ? h("span", { class: "line-original" }, original) : null
            )
          );
        }))
      ),
      draft.steps.length
        ? h("details", { class: "card-section method" }, h("summary", {}, h("h2", {}, "method")), h("ol", { class: "steps" }, draft.steps.map((s) => h("li", {}, s))))
        : null,
      source === "mealdb" ? h("p", { class: "quiet" }, "From TheMealDB's free collection.") : null
    ));
  }

  // ---------------------------------------------------------------- the API key

  // Where "something new" comes from: Claude searching the web (with an API
  // key), or TheMealDB's free collection until someone pastes one in.
  function renderKey() {
    const from = store.finder?.key ?? null;
    if (from === keyShown) return; // not under someone typing a key
    keyShown = from;
    if (from === "secret") return clear(keyPanel, h("p", { class: "key-on" }, bulb("on"), "new ideas: Claude searches the whole web"));
    if (from === "app") {
      return clear(keyPanel, h("p", { class: "key-on" }, bulb("on"), "new ideas: Claude searches the whole web",
        h("button", {
          class: "ghost-btn", onclick: (e) => {
            if (!confirm("Remove the Anthropic API key? New ideas will come from the free collection instead.")) return;
            run(e.currentTarget, async () => { await mutate("DELETE", "settings/anthropic-key"); toast("key removed"); });
          },
        }, "remove key")));
    }
    const input = h("input", { type: "password", placeholder: "sk-ant-…", autocomplete: "off", spellcheck: false, "aria-label": "Anthropic API key" });
    clear(keyPanel, h("details", { class: "key-card" },
      h("summary", {}, bulb("off"), h("span", {}, "new ideas come from a small free collection. ", h("strong", {}, "Search the whole web instead?"))),
      h("p", {}, "Paste an Anthropic API key and Claude will search the web for new ideas. Each search costs roughly 10 to 30p, billed to that key's account. Recipes from your own box are always free. ",
        h("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "Get a key"), "."),
      h("form", {
        class: "field-row",
        onsubmit: (e) => {
          e.preventDefault();
          run(e.submitter, async () => {
            await mutate("PUT", "settings/anthropic-key", { key: input.value.trim() });
            toast("connected: Claude will search the web from now on");
          });
        },
      }, input, h("button", { class: "btn btn-primary" }, "connect")),
      h("p", { class: "quiet" }, "It's kept on the server for both of you and never shown again, on any phone.")
    ));
  }

  // Redrawn whenever the data changes, so have / need stays live.
  function render() {
    renderKey();
    renderBox();
    renderNew();
  }

  render();
  return { render };
}
