// Tab 4: this week. Two halves: Monday-to-Sunday dinners picked from the
// recipe box (with one button to put what they need on the list), then the
// shared shopping list: grouped by aisle, live across both phones, and
// ticking an item puts it in the pantry.

import { store, prefs, mutate, today, addDays } from "./store.js";
import { h, clear, bulb, sheet, toast, run, qtyInput, emptyState } from "./ui.js";
import { fmtBase } from "./units.js";
import { parseQuick } from "./parse.js";
import { ensureIngredient, checkLine, shoppingFor } from "./stock.js";
import { toStored } from "./pantry.js";

// Walking order round a usual shop.
export const AISLES = [
  "fruit & veg", "bakery", "meat & fish", "dairy & eggs", "chilled", "tins & jars",
  "pasta, rice & grains", "baking", "herbs & spices", "oils & sauces", "drinks", "frozen", "household", "other",
];

// Ticks waiting for the server, so the tick shows the moment you tap.
const pending = new Map(); // shopping id -> ticked

export function mountWeek(pane) {
  const list = h("div", { class: "shop-list" });
  const planner = h("section", { class: "planner", "aria-label": "dinners" });
  pane.append(
    h("header", { class: "pane-head" }, h("h1", {}, "this week")),
    planner,
    h("h2", { class: "list-title" }, "shopping list"),
    addBar(),
    list
  );

  function render() {
    renderPlanner(planner, render);
    const rows = store.shopping.map((s) => ({ s, ing: store.ing.get(s.ingredient_id), ticked: pending.has(s.id) ? pending.get(s.id) : !!s.ticked }));
    const toBuy = rows.filter((r) => !r.ticked);
    const basket = rows.filter((r) => r.ticked);
    if (!rows.length) {
      return clear(list, emptyState("nothing on the list", "Add things as you run out, or send a recipe's missing ingredients here from its card."));
    }
    const groups = [];
    for (const aisle of AISLES) {
      const here = toBuy.filter((r) => (AISLES.includes(r.ing?.aisle) ? r.ing.aisle : "other") === aisle)
        .sort((a, b) => a.ing.name.localeCompare(b.ing.name));
      if (here.length) groups.push(h("section", { class: "group" }, h("h3", { class: "group-title" }, aisle), h("ul", { class: "rows" }, here.map(shopRow))));
    }
    if (!toBuy.length) groups.push(h("p", { class: "quiet all-done" }, bulb("on"), "all got. nice one."));
    if (basket.length) {
      groups.push(h("section", { class: "group basket" },
        h("h3", { class: "group-title" }, "in the basket", h("span", { class: "count" }, basket.length),
          h("button", { class: "ghost-btn", onclick: (e) => run(e.currentTarget, () => mutate("POST", "shopping/clear", {})) }, "clear")),
        h("ul", { class: "rows" }, basket.map(shopRow))
      ));
    }
    clear(list, groups);
  }

  function shopRow({ s, ing, ticked }) {
    const where = ing.category === "household" ? null : `→ ${ing.storage}`;
    return h("li", { class: `shop-row${ticked ? " ticked" : ""}` },
      h("button", {
        class: "tick", "aria-pressed": String(ticked), "aria-label": `${ticked ? "untick" : "tick"} ${ing.name}`,
        onclick: () => tick(s, !ticked),
      }, bulb(ticked ? "on" : "off")),
      h("button", { class: "row shop-main", onclick: () => editItem(s, ing) },
        h("span", { class: "row-main" },
          h("span", { class: "row-name" }, ing.name),
          h("span", { class: "row-meta" }, ticked ? where : s.label)
        ),
        h("span", { class: "row-qty" }, s.quantity == null ? "" : fmtBase(s.quantity, s.unit, prefs.units))
      )
    );
  }

  async function tick(s, ticked) {
    pending.set(s.id, ticked);
    render();
    await run(null, () => mutate("POST", `shopping/${s.id}/tick`, { ticked, date: today(), person: prefs.person }));
    pending.delete(s.id);
    render();
  }

  function addBar() {
    const input = h("input", {
      type: "text", class: "quick-input", autocomplete: "off", enterkeyhint: "done", list: "ingredient-names",
      placeholder: "add to the list: “onions 3”, “milk”", "aria-label": "add to the shopping list",
    });
    const form = h("form", {
      class: "quick-add",
      onsubmit: async (e) => {
        e.preventDefault();
        const p = parseQuick(input.value);
        if (!p.name) return input.focus();
        await run(form.querySelector(".add-btn"), async () => {
          const ing = await ensureIngredient(p.name, { unit: p.unit });
          const { quantity, unit } = p.qty == null ? { quantity: null, unit: ing.default_unit } : toStored(p.qty, p.unit, ing);
          await mutate("POST", "shopping", { person: prefs.person, items: [{ ingredient_id: ing.id, quantity, unit, reason: "manual" }] });
          input.value = "";
        });
      },
    }, bulb("off"), input, h("button", { class: "add-btn", "aria-label": "add" }, "+"));
    return h("div", { class: "quick-wrap" }, form);
  }

  return { render };
}

function editItem(s, ing) {
  sheet(ing.name, ({ close }) => {
    const q = qtyInput(s.unit || ing.default_unit, s.quantity, { ing, label: "how much", autofocus: true });
    return [
      s.label ? h("p", { class: "sheet-summary" }, s.label) : null,
      h("form", {
        class: "field-row",
        onsubmit: (e) => {
          e.preventDefault();
          run(e.submitter, async () => {
            await mutate("PUT", `shopping/${s.id}`, { quantity: q.value(), unit: s.unit || ing.default_unit });
            close();
          });
        },
      }, h("label", { class: "field-label" }, "how much"), q.el, h("button", { class: "btn btn-primary" }, "save")),
      h("div", { class: "btn-row subtle" },
        h("button", {
          class: "ghost-btn danger",
          onclick: (e) => run(e.currentTarget, async () => { await mutate("DELETE", `shopping/${s.id}`); close(); toast(`took ${ing.name} off the list`); }),
        }, "take off the list")
      ),
    ];
  });
}

// ---------------------------------------------------------------- dinners

// 0 = this week, 1 = next week... On a Sunday this week is all but over,
// and Sunday is when the plan says to plan, so start on next week.
let weekOffset = new Date().getDay() === 0 ? 1 : 0;

function monday(offset) {
  const now = new Date();
  const back = (now.getDay() + 6) % 7; // days since Monday
  return addDays(today(), -back + offset * 7);
}

function renderPlanner(el, rerender) {
  const start = monday(weekOffset);
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const planFor = (day) => store.plan.find((p) => p.date === day && p.meal === "dinner");
  const label = (day, opts) => new Date(day + "T12:00").toLocaleDateString(undefined, opts);
  const move = (n) => { weekOffset += n; rerender(); };

  const entries = days
    .map((day) => ({ day, plan: planFor(day) }))
    // dinners already eaten don't need shopping for
    .filter(({ day, plan }) => day >= today() && plan?.recipe_id && store.recipe.has(plan.recipe_id))
    .map(({ day, plan }) => {
      const recipe = store.recipe.get(plan.recipe_id);
      const scale = (plan.servings || recipe.servings) / (recipe.servings || 1);
      return { recipe, scale, label: `for ${label(day, { weekday: "long" })}'s ${recipe.title}` };
    });
  const needed = shoppingFor(entries);

  clear(el,
    h("div", { class: "planner-head" },
      h("h2", {}, "dinners"),
      h("div", { class: "week-nav" },
        h("button", { class: "icon-btn", "aria-label": "previous week", onclick: () => move(-1) }, "‹"),
        h("span", {}, weekOffset === 0 ? "this week" : weekOffset === 1 ? "next week" : `${label(days[0], { day: "numeric", month: "short" })} – ${label(days[6], { day: "numeric", month: "short" })}`),
        h("button", { class: "icon-btn", "aria-label": "next week", onclick: () => move(1) }, "›")
      )
    ),
    h("ul", { class: "days" }, days.map((day) => {
      const plan = planFor(day);
      const recipe = plan?.recipe_id ? store.recipe.get(plan.recipe_id) : null;
      let body, lit = null;
      if (recipe) {
        const lines = recipe.lines.filter((l) => l.ingredient_id && !l.optional);
        const have = lines.filter((l) => checkLine(l).status === "have").length;
        lit = bulb(have === lines.length ? "on" : "off");
        body = h("span", { class: "row-main" },
          h("span", { class: "row-name" }, recipe.title),
          h("span", { class: `row-meta${have === lines.length ? " all-in" : ""}` }, lines.length ? `have ${have} of ${lines.length}` : "")
        );
      } else if (plan?.note) {
        body = h("span", { class: "row-main" }, h("span", { class: "row-name day-note" }, plan.note));
      } else {
        body = h("span", { class: "row-main" }, h("span", { class: "day-empty" }, "+ choose dinner"));
      }
      return h("li", { class: `day${day === today() ? " today" : ""}${day < today() ? " past" : ""}` },
        h("button", { class: "row day-row", onclick: () => pickDinner(day, plan) },
          h("span", { class: "day-name" }, h("span", {}, label(day, { weekday: "short" })), h("span", { class: "day-date" }, label(day, { day: "numeric" }))),
          lit,
          body
        ),
        recipe ? h("a", { class: "icon-btn day-open", href: `#recipes/${recipe.id}`, "aria-label": `open ${recipe.title}` }, "→") : null
      );
    })),
    entries.length
      ? h("div", { class: "btn-row planner-foot" },
          needed.length
            ? h("button", {
                class: "btn",
                onclick: (e) => run(e.currentTarget, async () => {
                  await mutate("POST", "shopping", { person: prefs.person, items: needed });
                  toast(`${needed.length} added to the list for these dinners`);
                }),
              }, `add ${needed.length} ${needed.length === 1 ? "thing" : "things"} these dinners need to the list`)
            : h("span", { class: "quiet all-here" }, bulb("on"), "everything for these dinners is in, or on the list")
        )
      : null
  );
}

function pickDinner(day, plan) {
  const title = new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  sheet(title, ({ close }) => {
    const save = (body, btn) => run(btn, async () => { await mutate("PUT", `plan/${day}`, body); close(); });
    const search = h("input", { type: "search", class: "search", placeholder: "search the recipe box", "aria-label": "search recipes", autofocus: true });
    const grid = h("ul", { class: "rows pick-list" });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const recipes = store.recipes
        .filter((r) => !q || [r.title, ...r.tags].join(" ").toLowerCase().includes(q))
        .map((r) => {
          const lines = r.lines.filter((l) => l.ingredient_id && !l.optional);
          return { r, have: lines.filter((l) => checkLine(l).status === "have").length, total: lines.length };
        })
        // the ones you could cook now first
        .sort((a, b) => (b.total ? b.have / b.total : 0) - (a.total ? a.have / a.total : 0) || a.r.title.localeCompare(b.r.title));
      clear(grid, recipes.length
        ? recipes.map(({ r, have, total }) => h("li", {},
            h("button", { class: `row${plan?.recipe_id === r.id ? " chosen" : ""}`, onclick: (e) => save({ recipe_id: r.id }, e.currentTarget) },
              bulb(total && have === total ? "on" : "off"),
              h("span", { class: "row-main" }, h("span", { class: "row-name" }, r.title),
                h("span", { class: "row-meta" }, [total ? `have ${have} of ${total}` : null, ...r.tags.slice(0, 2)].filter(Boolean).join(" · "))))))
        : h("li", { class: "quiet pick-empty" }, store.recipes.length ? "nothing matches" : "the recipe box is empty: add recipes first, or find one on “what can we make?”"));
    };
    search.addEventListener("input", draw);
    draw();
    return [
      h("div", { class: "chips" },
        h("button", { class: `chip${plan?.note === "leftovers" ? " on" : ""}`, onclick: (e) => save({ note: "leftovers" }, e.currentTarget) }, "leftovers"),
        h("button", { class: `chip${plan?.note === "eating out" ? " on" : ""}`, onclick: (e) => save({ note: "eating out" }, e.currentTarget) }, "eating out"),
        plan ? h("button", { class: "chip", onclick: (e) => run(e.currentTarget, async () => { await mutate("DELETE", `plan/${day}`); close(); }) }, "clear this day") : null
      ),
      search,
      grid,
    ];
  }, { wide: true });
}
