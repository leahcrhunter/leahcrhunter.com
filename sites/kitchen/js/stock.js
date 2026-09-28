// What's in the house, per ingredient, and how that compares with what a
// recipe asks for. Used by the pantry, the recipe cards and the list.

import { store, mutate } from "./store.js";
import { UNITS, BASE_OF, MULTI_PACKS, convert } from "./units.js";
import { matchIngredient, newIngredientName } from "./parse.js";

// Batches of one ingredient, soonest use-by first (no date last).
export function batchesOf(ingredientId) {
  return store.pantry
    .filter((p) => p.ingredient_id === ingredientId)
    .sort((a, b) => (a.expires || "9999").localeCompare(b.expires || "9999") || a.id - b.id);
}

// A batch whose amount can't be compared with a recipe: "some", or a bag or
// pack of something (a bag of potatoes isn't one potato).
export const unmeasured = (b) => b.quantity == null || MULTI_PACKS.includes(b.pack);

// For one recipe line (scaled): status is
//   'have'    enough in the pantry (or it's salt/oil/water, or unmeasurable)
//   'short'   some, but less than the recipe wants; `missing` says how much
//   'need'    none at all
//   'unknown' the line isn't matched to an ingredient
export function checkLine(line, scale = 1) {
  const ing = store.ing.get(line.ingredient_id);
  if (!ing) return { status: "unknown" };
  if (ing.always_have) return { status: "have", always: true };
  const batches = batchesOf(ing.id);
  const u = UNITS[line.unit || "count"];

  const wantedIn = (base) => (line.quantity == null || !u || u.dim === "any" ? null : convert(line.quantity * scale, line.unit, base, ing));

  if (!batches.length) {
    const qty = wantedIn(ing.default_unit);
    return { status: "need", missing: { quantity: qty, unit: ing.default_unit } };
  }
  if (line.quantity == null || !u || u.dim === "any") return { status: "have" };

  const base = BASE_OF[u.dim];
  const wanted = line.quantity * scale * u.f;
  let have = 0;
  for (const b of batches) {
    if (unmeasured(b)) return { status: "have" }; // "some": give it the benefit of the doubt
    const v = convert(b.quantity, b.unit, base, ing);
    if (v == null) return { status: "have" }; // can't compare (no density etc.): assume fine
    have += v;
  }
  if (have >= wanted * 0.98) return { status: "have" };
  const short = wanted - have;
  const inDefault = convert(short, base, ing.default_unit, ing);
  return {
    status: "short",
    missing: inDefault != null ? { quantity: inDefault, unit: ing.default_unit } : { quantity: short, unit: base },
  };
}

// Splits "take this much of an ingredient" across its batches, soonest
// use-by first. `amount` is in `base`; returns pantry uses for /api/pantry/use.
export function planUse(ingredientId, amount, base) {
  const ing = store.ing.get(ingredientId);
  const uses = [];
  let left = amount;
  for (const b of batchesOf(ingredientId)) {
    if (left <= 1e-9) break;
    if (MULTI_PACKS.includes(b.pack)) continue; // cooking doesn't use up a whole bag: take it out by hand
    if (b.quantity == null) {
      uses.push({ id: b.id, quantity: null }); // "some": can't measure, so assume we used it up
      break;
    }
    const avail = convert(b.quantity, b.unit, base, ing);
    if (avail == null) continue;
    const take = Math.min(avail, left);
    uses.push({ id: b.id, quantity: take >= avail - 1e-6 ? null : convert(take, base, b.unit, ing) });
    left -= take;
  }
  return uses;
}

// What to buy for one or more recipes: `entries` is [{ recipe, scale, label }].
// Amounts are added up across recipes (two dinners with onions need both
// lots), then what's in the pantry and what's already on the list (unticked)
// is taken off. Returns items ready for POST /api/shopping.
export function shoppingFor(entries) {
  const want = new Map(); // ingredient id -> { ing, qty (in its default unit), measured, labels }
  for (const { recipe, scale = 1, label } of entries) {
    for (const line of recipe.lines) {
      const ing = store.ing.get(line.ingredient_id);
      if (!ing || ing.always_have || line.optional) continue;
      const w = want.get(ing.id) || { ing, qty: 0, measured: false, labels: new Set() };
      w.labels.add(label);
      const u = UNITS[line.unit || "count"];
      if (line.quantity != null && u && u.dim !== "any") {
        const v = convert(line.quantity * scale, line.unit, ing.default_unit, ing);
        if (v != null) { w.qty += v; w.measured = true; }
      }
      want.set(ing.id, w);
    }
  }

  const items = [];
  for (const { ing, qty, measured, labels } of want.values()) {
    const base = ing.default_unit;
    // null means "some, can't say how much", which counts as enough
    const total = (rows) => rows.reduce((sum, r) => {
      if (sum == null || unmeasured(r)) return null;
      const v = convert(r.quantity, r.unit || base, base, ing);
      return v == null ? null : sum + v;
    }, 0);
    const stock = batchesOf(ing.id);
    const listed = store.shopping.filter((s) => !s.ticked && s.ingredient_id === ing.id);
    const have = total(stock), onList = total(listed);

    let quantity;
    if (!measured) {
      if (stock.length || listed.length) continue; // any at all will do
      quantity = null;
    } else {
      if (have == null || onList == null) continue;
      const missing = qty - have - onList;
      if (missing <= qty * 0.02) continue;
      // whole onions, and no "7.5 g garam masala": small amounts just mean "buy some"
      quantity = base === "count" ? Math.ceil(missing - 1e-6) : missing < 30 ? null : missing;
    }
    items.push({ ingredient_id: ing.id, quantity, unit: base, reason: "recipe", label: [...labels].join(" + ") });
  }
  return items;
}

// Finds the ingredient for a typed name, creating it if it's new.
// `hint` guesses the new ingredient's unit and storage.
// `strict` and `pack` go to matchIngredient.
export async function ensureIngredient(name, hint = {}) {
  const found = matchIngredient(name, store.ingredients, { strict: hint.strict, pack: hint.unit });
  if (found) return found;
  const clean = newIngredientName(name);
  if (!clean) throw new Error("what's it called?");
  const dim = UNITS[hint.unit]?.dim;
  const { id } = await mutate("POST", "ingredients", {
    name: clean,
    default_unit: dim && dim !== "any" ? BASE_OF[dim] : "count",
    storage: hint.location || "cupboard",
  });
  return store.ing.get(id);
}
