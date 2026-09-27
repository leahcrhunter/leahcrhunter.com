// Tab 1: everything in the house, soonest use-by first.

import { store, prefs, mutate, today, addDays, fmtDay, freshness, daysUntil } from "./store.js";
import { h, clear, bulb, sheet, toast, run, chips, qtyInput, emptyState } from "./ui.js";
import { UNITS, BASE_OF, convert, fmtBase, niceUnit, fmtNumber } from "./units.js";
import { parseQuick, matchIngredient } from "./parse.js";
import { ensureIngredient } from "./stock.js";

export const LOCATIONS = ["fridge", "freezer", "cupboard", "spice rack"];
const FREEZER_DAYS = 90;
const view = { location: "all", search: "" };

export function mountPantry(pane) {
  const list = h("div", { class: "pantry-list" });
  const search = h("input", {
    type: "search", class: "search", placeholder: "search", "aria-label": "search the pantry",
    oninput: () => { view.search = search.value.trim().toLowerCase(); render(); },
  });

  pane.append(
    h("header", { class: "pane-head" },
      h("h1", {}, "pantry"),
      h("button", { class: "ghost-btn", onclick: quickCheck }, "quick check")
    ),
    quickAdd(),
    h("div", { class: "toolbar" },
      chips([["all", "everything"], ...LOCATIONS.map((l) => [l, l])], view.location, (v) => { view.location = v; render(); }, { label: "location" }),
      search
    ),
    list
  );

  function render() {
    const items = store.pantry
      .map((item) => ({ item, ing: store.ing.get(item.ingredient_id) }))
      .filter(({ item, ing }) => ing && (view.location === "all" || item.location === view.location))
      .filter(({ ing }) => !view.search || [ing.name, ing.aliases, ing.category].join(" ").toLowerCase().includes(view.search))
      .sort((a, b) => (a.item.expires || "9999").localeCompare(b.item.expires || "9999") || a.ing.name.localeCompare(b.ing.name));

    if (!store.pantry.length) {
      return clear(list, emptyState("the pantry's empty", "Add what's in the fridge and cupboards to get started: type it above, like “milk 2 l” or “6 eggs”."));
    }
    if (!items.length) return clear(list, h("p", { class: "quiet" }, "nothing matches"));

    const soon = items.filter(({ item }) => ["expired", "soon"].includes(freshness(item)));
    const rest = items.filter((x) => !soon.includes(x));
    const sections = [];
    if (soon.length) sections.push(section("use soon", soon, "soon"));
    if (view.location === "all") {
      for (const loc of LOCATIONS) {
        const here = rest.filter(({ item }) => item.location === loc);
        if (here.length) sections.push(section(loc, here));
      }
    } else if (rest.length) {
      sections.push(section(soon.length ? "the rest" : view.location, rest));
    }
    clear(list, sections);
  }

  return { render };
}

function section(title, rows, kind = "") {
  return h("section", { class: `group ${kind}` },
    h("h2", { class: "group-title" }, title, h("span", { class: "count" }, rows.length)),
    h("ul", { class: "rows" }, rows.map(({ item, ing }) => h("li", {}, pantryRow(item, ing))))
  );
}

function pantryRow(item, ing) {
  const f = freshness(item);
  return h("button", { class: `row p-row ${f || ""}`, onclick: () => itemSheet(item) },
    bulb(f === "expired" ? "expired" : f === "soon" ? "soon" : "on"),
    h("span", { class: "row-main" },
      h("span", { class: "row-name" }, ing.name),
      h("span", { class: "row-meta" }, describe(item).join(" · "))
    ),
    h("span", { class: "row-qty" }, fmtBase(item.quantity, item.unit, prefs.units))
  );
}

function describe(item, { long = false } = {}) {
  const bits = [];
  if (long || view.location === "all") bits.push(item.location);
  const n = daysUntil(item.expires);
  if (n == null) bits.push(`bought ${fmtDay(item.purchased)}`);
  else if (n < 0) bits.push(`past its use-by (${fmtDay(item.expires)})`);
  else if (n === 0) bits.push("use today");
  else if (n < 7 && n > 1) bits.push(`use within ${n} days`);
  else bits.push(`use by ${fmtDay(item.expires)}`);
  if (item.opened) bits.push(`opened ${fmtDay(item.opened)}`);
  if (long && item.expires) bits.push(`bought ${fmtDay(item.purchased)}`);
  if (long && item.added_by) bits.push(`added by ${item.added_by}`);
  return bits;
}

// ---------------------------------------------------------------- quick add

function quickAdd() {
  const input = h("input", {
    type: "text", class: "quick-input", autocomplete: "off", enterkeyhint: "done",
    placeholder: "add food: “milk 2 l”, “6 eggs”", "aria-label": "add food to the pantry",
    oninput: preview,
  });
  const hint = h("p", { class: "quick-hint", "aria-live": "polite" });
  const more = h("button", { type: "button", class: "ghost-btn", onclick: () => itemForm(null, parseQuick(input.value)) }, "more…");
  const form = h("form", { class: "quick-add", onsubmit: submit }, bulb("on"), input, h("button", { class: "add-btn", "aria-label": "add" }, "+"), more);

  function preview() {
    const p = parseQuick(input.value);
    if (!p.name) return (hint.textContent = "");
    const ing = matchIngredient(p.name, store.ingredients);
    const where = ing?.storage || "cupboard";
    const qty = p.qty != null ? `${fmtNumber(p.qty)}${p.unit && p.unit !== "count" ? " " + p.unit : ""}` : null;
    const until = ing?.shelf_days ? `use by ${fmtDay(addDays(today(), ing.shelf_days))}` : null;
    hint.textContent = [ing ? ing.name : `new: ${p.name}`, qty, where, until].filter(Boolean).join(" · ");
  }

  async function submit(e) {
    e.preventDefault();
    const p = parseQuick(input.value);
    if (!p.name) return input.focus();
    await run(form.querySelector(".add-btn"), async () => {
      const ing = await ensureIngredient(p.name, { unit: p.unit });
      const { unit, quantity } = toStored(p.qty, p.unit, ing);
      // if it joins food that's already there, undo puts that row back as it was
      const before = store.pantry.find((b) => b.ingredient_id === ing.id && b.location === ing.storage && b.unit === unit);
      const { ids } = await mutate("POST", "pantry", {
        items: [{
          ingredient_id: ing.id, quantity, unit, location: ing.storage, purchased: today(),
          expires: ing.shelf_days ? addDays(today(), ing.shelf_days) : null, added_by: prefs.person,
        }],
      });
      input.value = "";
      hint.textContent = "";
      toast(`added ${ing.name} to the ${ing.storage}`, {
        action: "undo",
        onAction: () => run(null, () => before
          ? mutate("PUT", `pantry/${before.id}`, { quantity: before.quantity, purchased: before.purchased, expires: before.expires })
          : mutate("DELETE", `pantry/${ids[0]}`)),
      });
    });
  }
  return h("div", { class: "quick-wrap" }, form, hint);
}

// A typed amount -> what the pantry stores (a base unit). Counted food with
// no amount is one of it; weighed food with no amount is "some".
export function toStored(qty, unit, ing) {
  if (qty == null) return { unit: ing.default_unit, quantity: ing.default_unit === "count" ? 1 : null };
  const asDefault = convert(qty, unit || "count", ing.default_unit, ing);
  if (asDefault != null) return { unit: ing.default_unit, quantity: asDefault };
  const dim = UNITS[unit || "count"]?.dim;
  if (!dim || dim === "any") return { unit: ing.default_unit, quantity: null };
  return { unit: BASE_OF[dim], quantity: qty * UNITS[unit].f };
}

// ---------------------------------------------------------------- one item

function itemSheet(item) {
  const ing = store.ing.get(item.ingredient_id);
  sheet(ing.name, ({ close }) => {
    const use = qtyInput(item.unit, null, { ing, label: "how much did you use?" });
    const act = (reason, quantity, btn) =>
      run(btn, async () => {
        await mutate("POST", "pantry/use", { date: today(), person: prefs.person, uses: [{ id: item.id, quantity, reason }] });
        close();
        if (reason === "used up") {
          toast(`${ing.name}: all gone`, { action: "add to list", onAction: () => addToList(ing, item) });
        } else if (reason === "thrown away") {
          toast(`${ing.name} logged as thrown away`);
        } else {
          toast(`used ${fmtBase(quantity, item.unit, prefs.units)} ${ing.name}`);
        }
      });

    return [
      h("p", { class: "sheet-summary" },
        h("strong", {}, fmtBase(item.quantity, item.unit, prefs.units)), " · ", describe(item, { long: true }).join(" · ")),
      item.notes ? h("p", { class: "sheet-note" }, item.notes) : null,

      item.quantity != null
        ? h("form", { class: "field-row", onsubmit: (e) => { e.preventDefault(); const q = use.value(); if (q > 0) act("used", q, e.submitter); else use.input.focus(); } },
            h("label", { class: "field-label" }, "used some"), use.el, h("button", { class: "btn" }, "use"))
        : null,

      h("div", { class: "btn-row" },
        h("button", { class: "btn btn-primary", onclick: (e) => act("used up", null, e.currentTarget) }, "used up"),
        h("button", { class: "btn btn-waste", onclick: (e) => act("thrown away", null, e.currentTarget) }, "thrown away")
      ),

      h("div", { class: "field" },
        h("span", { class: "field-label" }, "move to"),
        chips(LOCATIONS.map((l) => [l, l]), item.location, (loc) => move(item, ing, loc, close), { label: "move to" })
      ),

      h("div", { class: "btn-row subtle" },
        !item.opened ? h("button", { class: "ghost-btn", onclick: (e) => run(e.currentTarget, async () => { await mutate("PUT", `pantry/${item.id}`, { opened: today() }); close(); toast(`${ing.name} marked opened`); }) }, "opened today") : null,
        h("button", { class: "ghost-btn", onclick: () => { close(); itemForm(item); } }, "edit"),
        h("button", { class: "ghost-btn danger", onclick: (e) => run(e.currentTarget, async () => { await mutate("DELETE", `pantry/${item.id}`); close(); toast(`removed ${ing.name}`); }) }, "added by mistake")
      ),
    ];
  });
}

// Into the freezer pushes the use-by out to three months; the toast can undo that.
async function move(item, ing, location, close) {
  const change = { location };
  const extend = location === "freezer" && item.location !== "freezer";
  if (extend) change.expires = addDays(today(), FREEZER_DAYS);
  await run(null, async () => {
    await mutate("PUT", `pantry/${item.id}`, change);
    close();
    if (extend) {
      toast(`frozen: use by ${fmtDay(change.expires)}`, {
        action: "keep old date", onAction: () => run(null, () => mutate("PUT", `pantry/${item.id}`, { expires: item.expires })),
      });
    } else toast(`${ing.name} moved to the ${location}`);
  });
}

export function addToList(ing, item) {
  const weekday = new Date().toLocaleDateString(undefined, { weekday: "long" });
  return run(null, async () => {
    await mutate("POST", "shopping", {
      person: prefs.person,
      items: [{ ingredient_id: ing.id, quantity: item?.quantity ?? null, unit: item?.unit ?? ing.default_unit, reason: "restock", label: `used up ${weekday}` }],
    });
    toast(`${ing.name} is on the list`);
  });
}

// ---------------------------------------------------------------- add / edit form

const FORM_UNITS = ["count", "g", "kg", "ml", "l", "oz", "lb", "cup", "tbsp", "tsp"];

function itemForm(item, typed) {
  const ing0 = item ? store.ing.get(item.ingredient_id) : typed?.name ? matchIngredient(typed.name, store.ingredients) : null;
  const startUnit = item ? (item.quantity != null ? niceUnit(item.quantity, item.unit, prefs.units) : item.unit) : typed?.unit || ing0?.default_unit || "count";
  const startQty = item ? (item.quantity != null ? item.quantity / UNITS[startUnit].f : "") : typed?.qty ?? "";

  sheet(item ? `edit ${ing0.name}` : "add to the pantry", ({ close }) => {
    const name = h("input", { type: "text", list: "ingredient-names", value: ing0?.name || typed?.name || "", required: true, autofocus: !item, autocomplete: "off" });
    const qty = h("input", { type: "text", inputmode: "decimal", value: startQty === "" ? "" : fmtNumber(startQty, { fractions: false }), placeholder: "some" });
    const unit = h("select", {}, FORM_UNITS.map((u) => h("option", { value: u, selected: u === startUnit }, u === "count" ? "×" : u)));
    const location = h("select", {}, LOCATIONS.map((l) => h("option", { value: l, selected: l === (item?.location || ing0?.storage || "cupboard") }, l)));
    const purchased = h("input", { type: "date", value: item?.purchased || today(), required: true });
    const expires = h("input", { type: "date", value: item?.expires || (ing0?.shelf_days && !item ? addDays(today(), ing0.shelf_days) : "") });
    const opened = h("input", { type: "date", value: item?.opened || "" });
    const notes = h("input", { type: "text", value: item?.notes || "", placeholder: "anything to remember" });

    // picking a known food fills in where it lives and how long it keeps
    name.addEventListener("change", () => {
      const ing = matchIngredient(name.value, store.ingredients);
      if (!ing || item) return;
      location.value = ing.storage;
      if (ing.shelf_days) expires.value = addDays(purchased.value || today(), ing.shelf_days);
      if (!qty.value) unit.value = ing.default_unit;
    });

    const quick = (days) => h("button", { type: "button", class: "chip", onclick: () => { expires.value = days == null ? "" : addDays(purchased.value || today(), days); } }, days == null ? "none" : days === 3 ? "3 days" : days === 7 ? "1 week" : "1 month");

    async function save(e) {
      e.preventDefault();
      await run(e.submitter, async () => {
        const ing = await ensureIngredient(name.value, { unit: unit.value, location: location.value });
        const n = qty.value.trim() ? Number(qty.value.replace(",", ".")) : null;
        if (n != null && !Number.isFinite(n)) throw new Error("the amount should be a number");
        const stored = toStored(n, unit.value, ing);
        const row = {
          ingredient_id: ing.id, ...stored, location: location.value, purchased: purchased.value,
          expires: expires.value || null, opened: opened.value || null, notes: notes.value,
        };
        if (item) await mutate("PUT", `pantry/${item.id}`, row);
        else await mutate("POST", "pantry", { items: [{ ...row, added_by: prefs.person }] });
        close();
        toast(item ? "saved" : `added ${ing.name}`);
      });
    }

    return h("form", { class: "form", onsubmit: save },
      field("food", name),
      h("div", { class: "field" }, h("label", { class: "field-label" }, "how much"), h("span", { class: "qty-input" }, qty, unit)),
      field("where", location),
      field("bought", purchased),
      h("div", { class: "field" },
        h("label", { class: "field-label" }, "use by"),
        expires,
        h("div", { class: "chips" }, quick(3), quick(7), quick(30), quick(null))
      ),
      field("opened", opened),
      field("notes", notes),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-primary" }, item ? "save" : "add"))
    );
  });
}

export function field(label, input) {
  const id = `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h("div", { class: "field" }, h("label", { class: "field-label", for: id }, label), input);
}

// ---------------------------------------------------------------- quick check

// Walk one shelf as a checklist (still here / gone) so a full audit takes minutes.
function quickCheck() {
  let location = "fridge";
  const gone = new Set();
  sheet("quick check", ({ close }) => {
    const list = h("ul", { class: "rows check-list" });
    const draw = () => {
      const here = store.pantry
        .filter((p) => p.location === location)
        .map((item) => ({ item, ing: store.ing.get(item.ingredient_id) }))
        .sort((a, b) => a.ing.name.localeCompare(b.ing.name));
      clear(list, here.length ? here.map(({ item, ing }) => {
        const btn = h("button", {
          class: `row check-row${gone.has(item.id) ? " gone" : ""}`, "aria-pressed": String(gone.has(item.id)),
          onclick: () => { gone.has(item.id) ? gone.delete(item.id) : gone.add(item.id); draw(); },
        },
          bulb(gone.has(item.id) ? "off" : "on"),
          h("span", { class: "row-main" }, h("span", { class: "row-name" }, ing.name), h("span", { class: "row-meta" }, fmtBase(item.quantity, item.unit, prefs.units))),
          h("span", { class: "check-state" }, gone.has(item.id) ? "gone" : "still here")
        );
        return h("li", {}, btn);
      }) : h("li", { class: "quiet" }, `nothing in the ${location}`));
    };
    draw();
    return [
      h("p", { class: "sheet-summary" }, "Tap anything that's no longer there."),
      chips(LOCATIONS.map((l) => [l, l]), location, (l) => { location = l; draw(); }, { label: "which shelf" }),
      list,
      h("div", { class: "btn-row" },
        h("button", {
          class: "btn btn-primary",
          onclick: (e) => run(e.currentTarget, async () => {
            if (gone.size) {
              await mutate("POST", "pantry/use", { date: today(), person: prefs.person, uses: [...gone].map((id) => ({ id, quantity: null, reason: "used up" })) });
            }
            close();
            toast(gone.size ? `cleared ${gone.size} ${gone.size === 1 ? "thing" : "things"}` : "all present and correct");
          }),
        }, "done")
      ),
    ];
  });
}
