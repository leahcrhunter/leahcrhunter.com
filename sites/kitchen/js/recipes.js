// Tab 2: the recipe box. A grid of cards; each card opens to have/need
// markers, a servings control, "cooked this" and "add missing to list".

import { store, prefs, mutate, api, today, fmtDay } from "./store.js";
import { h, clear, bulb, sheet, toast, run, qtyInput, emptyState } from "./ui.js";
import { UNITS, fmtLineQty, fmtBase, convert, plural } from "./units.js";
import { parseLine, matchIngredient, newIngredientName } from "./parse.js";
import { checkLine, batchesOf, planUse, ensureIngredient, shoppingFor, unmeasured } from "./stock.js";
import { field } from "./pantry.js";

const view = { search: "", tag: null, canMake: false, quick: false, loved: false };
let pane, current = null; // the open recipe id, or null for the grid
const servingsFor = new Map(); // recipe id -> servings chosen on this visit

export function mountRecipes(el) {
  pane = el;
  return { render, open, canMake };
}

function canMake() {
  view.canMake = true;
  gridParts = null;
  open(null);
}

function open(id) {
  current = id;
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  if (current != null && !store.recipe.has(current)) current = null;
  if (current != null) return renderCard(store.recipe.get(current));
  renderGrid();
}

// ---------------------------------------------------------------- the grid

// The grid keeps its search box between renders so typing isn't interrupted
// when the other phone changes something.
let gridParts;

function renderGrid() {
  if (!gridParts || !pane.contains(gridParts.head)) {
    const search = h("input", {
      type: "search", class: "search", placeholder: "search title or ingredient", "aria-label": "search recipes", value: view.search,
      oninput: () => { view.search = search.value.trim().toLowerCase(); drawGrid(); },
    });
    gridParts = {
      head: h("header", { class: "pane-head" }, h("h1", {}, "recipes", h("span", { class: "count recipe-count" })), h("button", { class: "btn btn-primary btn-small", onclick: addRecipe }, "+ add a recipe")),
      tools: h("div", { class: "toolbar" }, search, h("div", { class: "chips filter-chips" })),
      filtered: h("p", { class: "filtered-note" }),
      grid: h("div", { class: "recipe-grid" }),
    };
    clear(pane, gridParts.head, gridParts.tools, gridParts.filtered, gridParts.grid);
  }
  drawGrid();
}

function drawGrid() {
  const { tools, grid } = gridParts;
  const tags = [...new Set(store.recipes.flatMap((r) => r.tags))].sort();
  const toggle = (key, text) =>
    h("button", { class: `chip${view[key] ? " on" : ""}`, "aria-pressed": String(view[key]), onclick: () => { view[key] = !view[key]; drawGrid(); } }, text);
  clear(tools.querySelector(".filter-chips"),
    toggle("canMake", "can make now"),
    toggle("quick", "30 min or less"),
    toggle("loved", "rated 4+"),
    tags.map((t) => h("button", { class: `chip tag${view.tag === t ? " on" : ""}`, "aria-pressed": String(view.tag === t), onclick: () => { view.tag = view.tag === t ? null : t; drawGrid(); } }, t))
  );

  if (!store.recipes.length) {
    return clear(grid, emptyState("no recipes yet", "Paste a link from a recipe site, or type in a family favourite. Keep the ones you'd make again."));
  }
  const shown = store.recipes.filter((r) => {
    if (view.tag && !r.tags.includes(view.tag)) return false;
    if (view.quick && !((r.prep_min || 0) + (r.cook_min || 0) <= 30 && (r.prep_min || r.cook_min))) return false;
    if (view.loved && !(avgRating(r) >= 4)) return false;
    if (view.canMake && haveCount(r).missing > 0) return false;
    if (view.search) {
      const hay = [r.title, ...r.tags, ...r.lines.map((l) => store.ing.get(l.ingredient_id)?.name || l.original)].join(" ").toLowerCase();
      if (!hay.includes(view.search)) return false;
    }
    return true;
  });
  // newest first, so something just saved is easy to find
  shown.sort((a, b) => b.id - a.id);
  clear(grid, shown.length ? shown.map(recipeTile) : h("p", { class: "quiet" }, "nothing matches"));
  gridParts.head.querySelector(".recipe-count").textContent = store.recipes.length ? String(store.recipes.length) : "";

  // Never hide recipes without saying so: a filter left on shows how many are
  // hidden and a one-tap way back to all of them.
  const filtering = view.search || view.tag || view.canMake || view.quick || view.loved;
  clear(gridParts.filtered, filtering && store.recipes.length
    ? [`showing ${shown.length} of ${store.recipes.length} · `,
       h("button", { class: "link-btn", onclick: showAllRecipes }, "show all")]
    : []);
}

function showAllRecipes() {
  Object.assign(view, { search: "", tag: null, canMake: false, quick: false, loved: false });
  gridParts.tools.querySelector(".search").value = "";
  drawGrid();
}

function recipeTile(r) {
  const { have, total } = haveCount(r);
  const time = (r.prep_min || 0) + (r.cook_min || 0);
  const avg = avgRating(r);
  return h("a", { class: "recipe-tile", href: `#recipes/${r.id}` },
    photo(r),
    h("span", { class: "tile-body" },
      h("span", { class: "tile-title" }, r.title),
      h("span", { class: "tile-meta" },
        total ? h("span", { class: `have-count${have === total ? " all" : ""}` }, bulb(have === total ? "on" : "off"), `${have} of ${total}`) : null,
        time ? h("span", {}, `${time} min`) : null,
        avg ? h("span", { class: "tile-stars", "aria-label": `rated ${avg.toFixed(1)}` }, "★".repeat(Math.round(avg))) : null
      )
    )
  );
}

function photo(r, big = false) {
  if (r.photo_url) return h("img", { class: big ? "hero-photo" : "tile-photo", src: r.photo_url, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
  return h("span", { class: big ? "hero-photo placeholder" : "tile-photo placeholder", "aria-hidden": "true" }, r.title.trim()[0]?.toLowerCase() || "·");
}

function haveCount(r, scale = 1) {
  let have = 0, total = 0;
  for (const line of r.lines) {
    if (!line.ingredient_id || line.optional) continue;
    total++;
    if (checkLine(line, scale).status === "have") have++;
  }
  return { have, total, missing: total - have };
}

function avgRating(r) {
  const values = Object.values(r.ratings);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// ---------------------------------------------------------------- one card

function renderCard(r) {
  gridParts = null;
  const servings = servingsFor.get(r.id) || r.servings;
  const scale = servings / (r.servings || 1);
  const time = [r.prep_min && `${r.prep_min} min prep`, r.cook_min && `${r.cook_min} min cooking`].filter(Boolean).join(" · ");
  const missing = r.lines.filter((l) => !l.optional && ["need", "short"].includes(checkLine(l, scale).status));

  const setServings = (n) => { servingsFor.set(r.id, Math.max(1, n)); render(); };

  clear(pane,
    h("a", { class: "back-link", href: "#recipes" }, "← recipes"),
    h("article", { class: "recipe-card" },
      photo(r, true),
      h("div", { class: "card-head" },
        h("h1", { class: "card-title" }, r.title),
        h("p", { class: "card-meta" },
          [time, r.times_cooked ? `cooked ${r.times_cooked}× · last ${fmtDay(r.last_cooked)}` : "not cooked yet",
            r.source_url ? h("a", { href: r.source_url, target: "_blank", rel: "noopener" }, hostOf(r.source_url)) : null]
            .filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))
        ),
        r.tags.length ? h("p", { class: "chips" }, r.tags.map((t) => h("span", { class: "chip static" }, t))) : null,
        ratings(r)
      ),

      h("section", { class: "card-section" },
        h("div", { class: "section-head" },
          h("h2", {}, "ingredients"),
          h("div", { class: "servings", role: "group", "aria-label": "servings" },
            h("button", { class: "icon-btn", "aria-label": "fewer servings", onclick: () => setServings(servings - 1) }, "−"),
            h("span", {}, `serves ${servings}`),
            h("button", { class: "icon-btn", "aria-label": "more servings", onclick: () => setServings(servings + 1) }, "+")
          )
        ),
        h("ul", { class: "ingredient-lines" }, r.lines.map((l) => ingredientLine(l, scale))),
        h("div", { class: "btn-row" },
          h("button", { class: "btn btn-primary", onclick: () => cookSheet(r, scale) }, "cooked this"),
          missing.length
            ? h("button", { class: "btn", onclick: (e) => addMissing(r, scale, e.currentTarget) }, `add ${missing.length} missing to the list`)
            : h("span", { class: "quiet all-here" }, bulb("on"), "everything's in")
        )
      ),

      r.steps.length ? h("section", { class: "card-section" }, h("h2", {}, "method"), h("ol", { class: "steps" }, r.steps.map((s) => h("li", {}, s)))) : null,

      h("section", { class: "card-section" },
        h("h2", {}, "notes"),
        notesBox(r)
      ),

      h("div", { class: "btn-row subtle" },
        h("button", { class: "ghost-btn", onclick: () => editor(r) }, "edit"),
        h("button", {
          class: "ghost-btn danger",
          onclick: (e) => {
            if (!confirm(`Delete “${r.title}” from the box?`)) return;
            run(e.currentTarget, async () => { await mutate("DELETE", `recipes/${r.id}`); location.hash = "#recipes"; toast("deleted"); });
          },
        }, "delete")
      )
    )
  );
}

const STATUS = {
  have: ["on", "have it"],
  short: ["soon", "not quite enough"],
  need: ["off", "need it"],
  unknown: ["unknown", "not matched to an ingredient"],
};

function ingredientLine(line, scale) {
  const ing = store.ing.get(line.ingredient_id);
  const check = checkLine(line, scale);
  const [state, label] = STATUS[check.status];
  const qty = line.quantity == null ? null : line.quantity * scale;
  const amount = fmtLineQty(qty, line.unit, ing, prefs.units);
  // "2 red onions", but "2 cloves garlic" and "400 g tinned tomatoes"
  const name = ing && (line.unit || "count") === "count" && qty > 1 ? plural(ing.name, qty) : ing?.name;
  return h("li", { class: `ingredient-line ${check.status}${line.optional ? " optional" : ""}` },
    bulb(state, label),
    h("span", { class: "line-main" },
      h("span", { class: "line-text" }, amount ? h("strong", {}, amount + " ") : null, name || line.original, line.optional ? h("em", {}, " (optional)") : null),
      h("span", { class: "line-original" }, line.original),
      check.status === "short" && check.missing ? h("span", { class: "line-short" }, `short by ${fmtBase(check.missing.quantity, check.missing.unit, prefs.units)}`) : null
    )
  );
}

function ratings(r) {
  const me = prefs.person;
  const others = Object.entries(r.ratings).filter(([p]) => p !== me);
  const mine = r.ratings[me] || 0;
  return h("div", { class: "ratings" },
    me ? h("span", { class: "rate", role: "group", "aria-label": "your rating" },
      h("span", { class: "rate-who" }, me),
      [1, 2, 3, 4, 5].map((n) =>
        h("button", {
          class: `star${n <= mine ? " on" : ""}`, "aria-label": `${n} of 5`, "aria-pressed": String(n === mine),
          onclick: (e) => run(e.currentTarget, () => mutate("PUT", `recipes/${r.id}/rating`, { person: me, rating: n === mine ? 0 : n })),
        }, "★")
      )
    ) : null,
    others.map(([p, n]) => h("span", { class: "rate other" }, h("span", { class: "rate-who" }, p), h("span", { class: "stars-static" }, "★".repeat(n), h("span", { class: "dim" }, "★".repeat(5 - n)))))
  );
}

function notesBox(r) {
  const box = h("textarea", { class: "notes", rows: 3, placeholder: "add more garlic, double the sauce…", "aria-label": "notes" }, r.notes);
  box.value = r.notes;
  box.addEventListener("blur", () => {
    if (box.value === r.notes) return;
    run(null, async () => { await mutate("PUT", `recipes/${r.id}`, { notes: box.value }); toast("notes saved"); });
  });
  return box;
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "source"; }
}

// ---------------------------------------------------------------- the loop: list and pantry

function addMissing(r, scale, btn) {
  const items = shoppingFor([{ recipe: r, scale, label: `for ${r.title}` }]);
  if (!items.length) return toast("it's all already on the list");
  return run(btn, async () => {
    await mutate("POST", "shopping", { person: prefs.person, items });
    toast(`${items.length} added to this week's list`, { action: "see list", onAction: () => { location.hash = "#week"; } });
  });
}

// Confirm screen: how much of each thing came out of the pantry. Amounts
// start at what the recipe says; untick or change anything before saving.
function cookSheet(r, scale) {
  const rows = new Map(); // ingredient id -> { ing, base, amount }
  for (const line of r.lines) {
    const ing = store.ing.get(line.ingredient_id);
    if (!ing || ing.always_have) continue;
    const batches = batchesOf(ing.id);
    const row = rows.get(ing.id) || { ing, base: batches[0]?.unit, amount: 0, inStock: batches.length > 0, lines: [] };
    row.lines.push(line.original);
    const u = UNITS[line.unit || "count"];
    if (row.inStock && line.quantity != null && u && u.dim !== "any") {
      const v = convert(line.quantity * scale, line.unit, row.base, ing);
      if (v != null) row.amount += v;
    }
    rows.set(ing.id, row);
  }
  const inStock = [...rows.values()].filter((x) => x.inStock);
  const notIn = [...rows.values()].filter((x) => !x.inStock);

  sheet(`cooked ${r.title}`, ({ close }) => {
    const inputs = inStock.map((row) => {
      const q = qtyInput(row.base, row.amount || null, { ing: row.ing, label: `${row.ing.name} used` });
      const on = h("input", { type: "checkbox", checked: row.amount > 0, "aria-label": `take ${row.ing.name} out of the pantry` });
      const total = batchesOf(row.ing.id).reduce((s, b) => (s == null || unmeasured(b) ? null : s + (convert(b.quantity, b.unit, row.base, row.ing) ?? 0)), 0);
      return {
        row, q, on,
        el: h("li", { class: "cook-row" },
          h("label", { class: "cook-check" }, on, h("span", {}, row.ing.name, h("span", { class: "row-meta" }, ` have ${fmtBase(total, row.base, prefs.units)}`))),
          q.el
        ),
      };
    });
    return [
      h("p", { class: "sheet-summary" }, "This takes what you used out of the pantry (soonest use-by first) and logs it."),
      inputs.length ? h("ul", { class: "rows cook-list" }, inputs.map((i) => i.el)) : h("p", { class: "quiet" }, "None of this is in the pantry, so there's nothing to take out."),
      notIn.length ? h("p", { class: "quiet" }, `not in the pantry: ${notIn.map((x) => x.ing.name).join(", ")}`) : null,
      h("div", { class: "btn-row" },
        h("button", {
          class: "btn btn-primary",
          onclick: (e) => run(e.currentTarget, async () => {
            const uses = inputs
              .filter((i) => i.on.checked && i.q.value() > 0)
              .flatMap((i) => planUse(i.row.ing.id, i.q.value(), i.row.base));
            await mutate("POST", `recipes/${r.id}/cooked`, { date: today(), person: prefs.person, uses });
            close();
            toast(uses.length ? `enjoy! ${uses.length} ${uses.length === 1 ? "thing" : "things"} taken out of the pantry` : "enjoy!");
          }),
        }, "cooked it")
      ),
    ];
  });
}

// ---------------------------------------------------------------- adding and editing

function addRecipe() {
  sheet("add a recipe", ({ close }) => {
    const url = h("input", { type: "url", placeholder: "https://…", autofocus: true, "aria-label": "recipe link", inputmode: "url" });
    const status = h("p", { class: "quiet", "aria-live": "polite" });
    return [
      h("form", {
        class: "form",
        onsubmit: (e) => {
          e.preventDefault();
          run(e.submitter, async () => {
            status.textContent = "reading the page…";
            try {
              const { draft } = await api("POST", "recipes/import", { url: url.value });
              close();
              editor(null, draft);
            } finally {
              status.textContent = "";
            }
          });
        },
      },
        h("div", { class: "field" }, h("label", { class: "field-label" }, "paste a link"), h("div", { class: "field-row" }, url, h("button", { class: "btn btn-primary" }, "fetch"))),
        status
      ),
      h("div", { class: "or" }, h("span", {}, "or")),
      h("button", { class: "btn wide", onclick: () => { close(); editor(null, null); } }, "type it in"),
    ];
  });
}

// One-tap save for a found recipe (a draft from recipes/import or
// recipes/find): lines are matched to ingredients as the editor would,
// with new ingredients created as needed. Returns the new recipe's id.
export async function saveDraft(draft) {
  const ingredients = [];
  for (const original of draft.ingredients) {
    const p = parseLine(original);
    const ing = p.name ? matchIngredient(p.name, store.ingredients) || (await ensureIngredient(p.name, { unit: p.unit })) : null;
    ingredients.push({ ingredient_id: ing?.id ?? null, quantity: p.qty, unit: p.unit, optional: p.optional, original });
  }
  const { id } = await mutate("POST", "recipes", {
    title: draft.title, servings: draft.servings || 2, prep_min: draft.prep_min ?? null, cook_min: draft.cook_min ?? null,
    tags: draft.tags || [], photo_url: draft.photo_url || null, source_url: draft.source_url || null,
    steps: draft.steps || [], ingredients, date: today(),
  });
  return id;
}

// Recipe editor. Ingredients are pasted or typed one per line and split into
// structured lines as you go; each shows which ingredient it matched, and
// you can correct that before saving.
export function editor(recipe, draft) {
  const src = recipe || draft || {};
  const overrides = new Map(); // original line -> typed ingredient name
  if (recipe) for (const l of recipe.lines) if (l.ingredient_id) overrides.set(l.original, store.ing.get(l.ingredient_id)?.name);
  const optionalLines = new Set(recipe ? recipe.lines.filter((l) => l.optional).map((l) => l.original) : []);
  const startLines = recipe ? recipe.lines.map((l) => l.original) : draft?.ingredients || [];

  sheet(recipe ? "edit recipe" : "new recipe", ({ close }) => {
    const title = h("input", { type: "text", value: src.title || "", required: true, autofocus: !draft });
    const servings = h("input", { type: "number", min: 1, max: 50, value: src.servings || 2 });
    const prep = h("input", { type: "number", min: 0, value: src.prep_min ?? "", placeholder: "min" });
    const cook = h("input", { type: "number", min: 0, value: src.cook_min ?? "", placeholder: "min" });
    const tags = h("input", { type: "text", value: (src.tags || []).join(", "), placeholder: "weeknight, pasta, batch cook" });
    const photoUrl = h("input", { type: "url", value: src.photo_url || "", placeholder: "https://… (optional)" });
    const sourceUrl = h("input", { type: "url", value: src.source_url || "", placeholder: "https://… (optional)" });
    const lines = h("textarea", { rows: 8, placeholder: "one per line:\n2 red onions, sliced\n400 g tin chopped tomatoes\n1 tsp ground cumin" });
    lines.value = startLines.join("\n");
    const steps = h("textarea", { rows: 8, placeholder: "one step per line" });
    steps.value = (src.steps || []).join("\n");
    const preview = h("ul", { class: "match-list" });

    const parsed = () =>
      lines.value.split("\n").map((s) => s.trim()).filter(Boolean).map((original) => {
        const p = parseLine(original);
        const typed = overrides.get(original);
        const ing = matchIngredient(typed || p.name, store.ingredients);
        return { ...p, typed, ing, optional: p.optional || optionalLines.has(original) };
      });

    function drawPreview() {
      clear(preview, parsed().map((p) => {
        const input = h("input", {
          type: "text", list: "ingredient-names", value: p.typed || p.ing?.name || newIngredientName(p.name), "aria-label": `ingredient for ${p.original}`,
          onchange: () => { overrides.set(p.original, input.value.trim()); drawPreview(); },
        });
        const opt = h("input", {
          type: "checkbox", checked: p.optional, "aria-label": "optional",
          onchange: () => { opt.checked ? optionalLines.add(p.original) : optionalLines.delete(p.original); },
        });
        return h("li", { class: `match${p.ing ? "" : " new"}` },
          h("span", { class: "match-original" }, p.original),
          h("span", { class: "match-arrow", "aria-hidden": "true" }, "→"),
          input,
          h("span", { class: "match-flag" }, p.ing ? "" : "new"),
          h("label", { class: "match-opt" }, opt, "optional")
        );
      }));
    }
    let t;
    lines.addEventListener("input", () => { clearTimeout(t); t = setTimeout(drawPreview, 250); });
    drawPreview();

    async function save(e) {
      e.preventDefault();
      await run(e.submitter, async () => {
        const ingredients = [];
        for (const p of parsed()) {
          const name = p.typed || p.name;
          const ing = name ? p.ing || (await ensureIngredient(name, { unit: p.unit })) : null;
          ingredients.push({ ingredient_id: ing?.id ?? null, quantity: p.qty, unit: p.unit, optional: p.optional, original: p.original });
        }
        const body = {
          title: title.value,
          servings: Number(servings.value) || 2,
          prep_min: prep.value === "" ? null : Number(prep.value),
          cook_min: cook.value === "" ? null : Number(cook.value),
          tags: tags.value.split(",").map((s) => s.trim()).filter(Boolean),
          photo_url: photoUrl.value || null,
          source_url: sourceUrl.value || null,
          steps: steps.value.split(/\n+/).map((s) => s.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean),
          ingredients,
          date: today(),
        };
        if (recipe) {
          await mutate("PUT", `recipes/${recipe.id}`, body);
          close();
          toast("saved");
        } else {
          const { id } = await mutate("POST", "recipes", body);
          close();
          toast("in the box");
          location.hash = `#recipes/${id}`;
        }
      });
    }

    return h("form", { class: "form", onsubmit: save },
      field("title", title),
      h("div", { class: "field-grid" }, field("serves", servings), field("prep", prep), field("cooking", cook)),
      field("tags", tags),
      h("div", { class: "field" }, h("label", { class: "field-label" }, "ingredients"), lines),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "matched to"), preview),
      h("div", { class: "field" }, h("label", { class: "field-label" }, "method"), steps),
      field("photo link", photoUrl),
      field("source link", sourceUrl),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-primary" }, recipe ? "save" : "save to the box"))
    );
  }, { wide: true });
}
