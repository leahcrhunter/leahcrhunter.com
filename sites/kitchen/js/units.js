// Units. The pantry, usage log and shopping list store a base unit
// ('g', 'ml' or 'count'); recipe lines keep whatever unit they were written in.
// Everything is shown in metric unless the app-wide toggle says 'us'.
//
// Crossing between weight, volume and count needs the ingredient:
//   density     grams per ml (flour ~0.52, i.e. 125 g a cup)
//   unit_weight grams per item (an onion ~150 g, a tin ~400 g)

export const CUP = 240; // ml; the round number most recipes are written against

// dim 'any' is for amounts you can't sensibly measure (a pinch, a handful):
// they only ask "do we have any?".
export const UNITS = {
  g: { dim: "mass", f: 1 },
  kg: { dim: "mass", f: 1000 },
  mg: { dim: "mass", f: 0.001 },
  oz: { dim: "mass", f: 28.35 },
  lb: { dim: "mass", f: 453.6 },
  ml: { dim: "vol", f: 1 },
  l: { dim: "vol", f: 1000 },
  cl: { dim: "vol", f: 10 },
  dl: { dim: "vol", f: 100 },
  tsp: { dim: "vol", f: 5 },
  tbsp: { dim: "vol", f: 15 },
  cup: { dim: "vol", f: CUP },
  "fl oz": { dim: "vol", f: 29.57 },
  pint: { dim: "vol", f: 568 }, // UK pint
  count: { dim: "count", f: 1 },
  clove: { dim: "count", f: 0.1 }, // garlic is counted in bulbs; a bulb is ~10 cloves
  tin: { dim: "count", f: 1 },
  pack: { dim: "count", f: 1 },
  jar: { dim: "count", f: 1 },
  bottle: { dim: "count", f: 1 },
  bag: { dim: "count", f: 1 },
  head: { dim: "count", f: 1 },
  bunch: { dim: "count", f: 1 },
  stick: { dim: "count", f: 1 },
  piece: { dim: "count", f: 1 },
  fillet: { dim: "count", f: 1 },
  cube: { dim: "count", f: 1 },
  pinch: { dim: "any" },
  dash: { dim: "any" },
  splash: { dim: "any" },
  handful: { dim: "any" },
  sprig: { dim: "any" },
  knob: { dim: "any" },
  drizzle: { dim: "any" },
  slice: { dim: "any" },
};

// What people type -> the keys above. Longest first when matching.
export const UNIT_WORDS = {
  g: ["g", "gr", "gram", "grams", "gramme", "grammes"],
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
  mg: ["mg"],
  oz: ["oz", "ounce", "ounces"],
  lb: ["lb", "lbs", "pound", "pounds"],
  ml: ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters"],
  l: ["l", "ltr", "litre", "litres", "liter", "liters"],
  cl: ["cl"],
  dl: ["dl"],
  tsp: ["tsp", "tsps", "teaspoon", "teaspoons", "tspn"],
  tbsp: ["tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons", "tblsp"],
  cup: ["cup", "cups"],
  "fl oz": ["fl oz", "fl. oz", "floz", "fluid ounce", "fluid ounces"],
  pint: ["pint", "pints", "pt"],
  clove: ["clove", "cloves"],
  tin: ["tin", "tins", "can", "cans"],
  pack: ["pack", "packs", "packet", "packets", "pkt"],
  jar: ["jar", "jars"],
  bottle: ["bottle", "bottles"],
  bag: ["bag", "bags"],
  head: ["head", "heads"],
  bunch: ["bunch", "bunches"],
  stick: ["stick", "sticks", "stalk", "stalks"],
  piece: ["piece", "pieces", "pc", "pcs"],
  fillet: ["fillet", "fillets"],
  cube: ["cube", "cubes"],
  pinch: ["pinch", "pinches"],
  dash: ["dash", "dashes"],
  splash: ["splash", "splashes"],
  handful: ["handful", "handfuls"],
  sprig: ["sprig", "sprigs"],
  knob: ["knob", "knobs"],
  drizzle: ["drizzle"],
  slice: ["slice", "slices", "rasher", "rashers"],
};

export const BASE_OF = { mass: "g", vol: "ml", count: "count" };

// Containers a pantry batch can be kept as ("2 tins", "a bag"). A tin, jar or
// bottle is one of the thing; a bag or pack holds an unknown amount.
export const PACKS = ["tin", "jar", "bottle", "bag", "pack"];
export const MULTI_PACKS = ["bag", "pack"];
const DIM_OF_BASE = { g: "mass", ml: "vol", count: "count" };

// Converts qty (in any unit above) to one of the base units, going via
// grams when it has to cross between weight, volume and count.
// Returns null when the ingredient doesn't say how.
export function convert(qty, from, toBase, ing) {
  if (qty == null) return null;
  const u = UNITS[from || "count"];
  if (!u || u.dim === "any") return null;
  let amount = qty * u.f;
  const target = DIM_OF_BASE[toBase];
  if (u.dim === target) return amount;

  let grams;
  if (u.dim === "mass") grams = amount;
  else if (u.dim === "vol") grams = ing?.density ? amount * ing.density : null;
  else grams = ing?.unit_weight ? amount * ing.unit_weight : null;
  if (grams == null) return null;

  if (target === "mass") return grams;
  if (target === "vol") return ing?.density ? grams / ing.density : null;
  return ing?.unit_weight ? grams / ing.unit_weight : null;
}

// Units offered in a quantity picker for something stored in `base`.
export function unitChoices(base, system) {
  if (base === "g") return system === "us" ? ["oz", "lb", "g"] : ["g", "kg", "oz"];
  if (base === "ml") return system === "us" ? ["cup", "tbsp", "tsp", "fl oz", "ml"] : ["ml", "l", "tbsp", "tsp", "cup"];
  return ["count"];
}

// The unit a picker should start on for this amount.
export function niceUnit(qty, base, system) {
  if (base === "g") return system === "us" ? (qty >= 453.6 ? "lb" : "oz") : qty >= 1000 ? "kg" : "g";
  if (base === "ml") {
    if (system === "us") return qty >= 60 ? "cup" : qty >= 15 ? "tbsp" : "tsp";
    return qty >= 1000 ? "l" : "ml";
  }
  return "count";
}

// ---------------------------------------------------------------- formatting

const FRACTIONS = [[0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"], [1, ""]];

// 1.5 -> "1½", 0.33 -> "⅓", 2.4 -> "2.4"
export function fmtNumber(n, { fractions = true } = {}) {
  if (n == null || !Number.isFinite(n)) return "";
  if (n >= 10 || !fractions) return trim(n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100);
  const whole = Math.floor(n);
  const rest = n - whole;
  let best = FRACTIONS[0], err = Infinity;
  for (const f of FRACTIONS) if (Math.abs(rest - f[0]) < err) { best = f; err = Math.abs(rest - f[0]); }
  if (err > 0.04) return trim(Math.round(n * 10) / 10);
  const w = best[0] === 1 ? whole + 1 : whole;
  if (!best[1]) return String(w);
  return (w ? w : "") + best[1];
}

function trim(n) {
  return String(Number(n.toFixed(2)));
}

function roundMetric(n) {
  if (n >= 100) return Math.round(n / 5) * 5;
  if (n >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

// A base-unit amount, for the pantry and shopping list.
export function fmtBase(qty, base, system = "metric") {
  if (qty == null) return "some";
  if (base === "count") return fmtNumber(qty);
  if (base === "g") {
    if (system === "us") return qty >= 453.6 ? `${fmtNumber(qty / 453.6)} lb` : `${fmtNumber(qty / 28.35)} oz`;
    return qty >= 1000 ? `${trim(Math.round(qty / 10) / 100)} kg` : `${trim(roundMetric(qty))} g`;
  }
  if (base === "ml") {
    if (system === "us") return fmtUsVolume(qty);
    return qty >= 1000 ? `${trim(Math.round(qty / 10) / 100)} l` : `${trim(roundMetric(qty))} ml`;
  }
  return fmtNumber(qty);
}

function fmtUsVolume(ml) {
  if (ml < 14) return `${fmtNumber(ml / 5)} tsp`;
  if (ml < 59) return `${fmtNumber(ml / 15)} tbsp`;
  const cups = ml / CUP;
  return `${fmtNumber(cups)} ${cups > 1.1 ? "cups" : "cup"}`;
}

// A recipe line's amount: "2 cloves", "1 tsp", "250 g", "2 cups".
// Spoons stay spoons in both systems. In US mode, weights of things with a
// density (flour, sugar) show as cups, as the plan asks; the rest as oz.
export function fmtLineQty(qty, unit, ing, system = "metric") {
  if (qty == null) return "";
  unit = unit || "count";
  const u = UNITS[unit];
  if (!u) return `${fmtNumber(qty)} ${unit}`;
  if (u.dim === "any") return `${qty === 1 ? "a" : fmtNumber(qty)} ${plural(unit, qty)}`;
  if (u.dim === "count") return unit === "count" ? fmtNumber(qty) : `${fmtNumber(qty)} ${plural(unit, qty)}`;
  if (unit === "tsp" || unit === "tbsp") return `${fmtNumber(qty)} ${unit}`;

  const amount = qty * u.f; // grams or ml
  if (system === "us") {
    if (u.dim === "mass" && ing?.density && ing.default_unit !== "count" && amount / ing.density >= CUP / 4) {
      return fmtUsVolume(amount / ing.density);
    }
    return fmtBase(amount, BASE_OF[u.dim], "us");
  }
  // metric: cups of something with a density read better as grams
  if (u.dim === "vol" && ing?.density && ing.default_unit === "g") return fmtBase(amount * ing.density, "g");
  return fmtBase(amount, BASE_OF[u.dim], "metric");
}

export function plural(word, n) {
  if (n != null && n <= 1) return word;
  if (/s$/.test(word)) return word; // already plural ("eggs", "chickpeas")
  if (/(x|ch|sh)$/.test(word)) return word + "es";
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  if (/(tomato|potato)$/.test(word)) return word + "es";
  return word + "s";
}
