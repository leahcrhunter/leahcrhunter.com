// Turning what people type into structured amounts, and matching food names
// to the shared ingredients list, which is what lets "2 red onions, sliced"
// in a recipe find "red onion" in the pantry.

import { UNITS, UNIT_WORDS } from "./units.js";

const UNICODE_FRACTIONS = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅕": 1 / 5, "⅛": 1 / 8, "⅜": 3 / 8, "⅝": 5 / 8, "⅞": 7 / 8 };
const FRAC_CHARS = Object.keys(UNICODE_FRACTIONS).join("");
const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, dozen: 12 };

// Words that describe how food is prepared rather than what it is.
const DESCRIPTORS = new Set(
  ("finely roughly thinly thickly coarsely freshly lightly chopped diced minced sliced grated crushed peeled " +
    "deseeded seeded halved quartered trimmed shredded torn beaten melted softened cubed julienned " +
    "large small medium big little ripe cold warm hot room temperature about approx approximately " +
    "heaped level rounded generous good quality organic free range skinless boneless drained rinsed " +
    "cooked uncooked dried fresh frozen extra optional plus more to taste serve serving garnish").split(" ")
);

const unitKey = (w) => w.toLowerCase().replace(/[.\s]/g, "");
const UNIT_LOOKUP = new Map();
for (const [unit, words] of Object.entries(UNIT_WORDS)) for (const w of words) UNIT_LOOKUP.set(unitKey(w), unit);
const UNIT_RE = new RegExp(
  `^(${Object.values(UNIT_WORDS).flat().sort((a, b) => b.length - a.length).map((w) => w.replace(/[.\s]/g, (c) => (c === "." ? "\\." : "\\s*"))).join("|")})\\.?(?![a-z])\\s*`,
  "i"
);

function readNumber(s) {
  s = s.replace(/^\s+/, "");
  let m, value;
  if ((m = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)/))) value = Number(m[1]) + Number(m[2]) / Number(m[3]);
  else if ((m = s.match(/^(\d+)\s*\/\s*(\d+)/))) value = Number(m[1]) / Number(m[2]);
  else if ((m = s.match(new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*([${FRAC_CHARS}])?`)))) value = Number(m[1].replace(",", ".")) + (m[2] ? UNICODE_FRACTIONS[m[2]] : 0);
  else if ((m = s.match(new RegExp(`^([${FRAC_CHARS}])`)))) value = UNICODE_FRACTIONS[m[1]];
  else if ((m = s.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half|dozen)\b\s*/i))) value = WORD_NUMBERS[m[1].toLowerCase()];
  else return null;
  let rest = s.slice(m[0].length);
  // ranges like "2-3" or "2 to 3": take the larger, so there's enough
  const range = rest.match(/^\s*(?:-|–|to|or)\s*(\d+(?:[.,]\d+)?)/i);
  if (range) {
    value = Math.max(value, Number(range[1].replace(",", ".")));
    rest = rest.slice(range[0].length);
  }
  return { value, rest };
}

function readUnit(s) {
  s = s.replace(/^\s+/, "");
  const m = s.match(UNIT_RE);
  if (!m) return null;
  return { unit: UNIT_LOOKUP.get(unitKey(m[1])), rest: s.slice(m[0].length) };
}

// "2 red onions, finely sliced" ->
//   { qty: 2, unit: "count", name: "red onions", optional: false, original: ... }
export function parseLine(original) {
  let s = String(original)
    .replace(/^[\s\-–•*▢□]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const optional = /\b(optional|to serve|for serving|to garnish|for garnish|if you like)\b/i.test(s);
  // drop notes in brackets, including nested ones: "(, sliced (Note 1))"
  for (let prev; prev !== s; ) { prev = s; s = s.replace(/\([^()]*\)/g, " "); }
  s = s.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  let qty = null, unit = null;
  const n = readNumber(s);
  if (n) {
    qty = n.value;
    s = n.rest;
    // "2 x 400g tins chopped tomatoes": two tins
    const times = s.match(/^\s*x\s*\d+(?:[.,]\d+)?\s*(?:g|ml)\s+(tins?|cans?|jars?|packs?|packets?)\b\s*/i);
    if (times) {
      unit = readUnit(times[1]).unit;
      s = s.slice(times[0].length);
    }
  }
  if (!unit) {
    const u = readUnit(s);
    if (u) {
      unit = u.unit;
      s = u.rest;
      if (qty == null) qty = 1;
      // "400g tin of chopped tomatoes": the weight is the useful bit, drop the container
      // "200g / 6 oz chicken": keep the first measurement, drop the conversion
      s = s.replace(/^\/\s*[\d.,½¼¾⅓⅔]+\s*[a-z.]+\s*/i, "");
      if (["g", "ml"].includes(unit)) s = s.replace(/^(tins?|cans?|jars?|packs?|packets?|bags?)\b\s*(of\s+)?/i, "");
    }
  }
  if (qty != null && !unit) unit = "count";
  s = s.replace(/^of\s+/i, "");

  let name = s
    .split(/,|;| - | – /)[0]
    .split(/\s+or\s+/i)[0]
    .replace(/\b(to taste|to serve|for serving|for frying|for greasing)\b.*$/i, "")
    .replace(/[.:*]+$/, "")
    .trim();
  // "3 garlic cloves", "1 small bunch of coriander", "1 chicken stock cube":
  // a counting word inside the name is really the unit
  if (unit === "count") {
    const words = name.split(" ");
    const at = words.length > 1 ? words.findIndex((w) => UNITS[UNIT_LOOKUP.get(unitKey(w))]?.dim === "count") : -1;
    if (at >= 0) {
      unit = UNIT_LOOKUP.get(unitKey(words[at]));
      words.splice(at, words[at + 1]?.toLowerCase() === "of" ? 2 : 1);
      name = words.join(" ");
    }
  }
  return { qty, unit, name, optional, original: String(original).trim() };
}

// For the add bars: "milk 2 l", "2 l milk", "6 eggs", "eggs x6", "flour 1.5kg".
export function parseQuick(text) {
  const t = String(text).trim();
  const lead = parseLine(t);
  if (lead.qty != null) return lead;
  const m = t.match(new RegExp(`^(.*?)\\s+x?\\s*((?:\\d+(?:[.,]\\d+)?|\\d+\\s*/\\s*\\d+|[${FRAC_CHARS}])\\s*[a-z. ]*)$`, "i"));
  if (m) {
    const tail = parseLine(m[2]);
    if (tail.qty != null && (!tail.name || tail.name.toLowerCase() === "x")) {
      return { qty: tail.qty, unit: tail.unit, name: m[1].trim(), optional: false, original: t };
    }
  }
  return { qty: null, unit: null, name: t, optional: false, original: t };
}

// ---------------------------------------------------------------- matching

export function normWord(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (/(tomato|potato)es$/.test(w)) return w.slice(0, -2);
  if (/(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

export function normName(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(normWord)
    .join(" ");
}

let cache = { list: null, index: null };
function indexOf(ingredients) {
  if (cache.list === ingredients) return cache.index;
  const index = new Map();
  for (const ing of ingredients) {
    for (const n of [ing.name, ...String(ing.aliases || "").split(",")]) {
      const key = normName(n);
      if (key && !index.has(key)) index.set(key, ing);
    }
  }
  // names win over aliases if they collide
  for (const ing of ingredients) index.set(normName(ing.name), ing);
  cache = { list: ingredients, index };
  return index;
}

// Best ingredient for a free-text name, or null. Tries the whole name, then
// without preparation words, then the longest run of words that matches
// (preferring the end: "chopped red onion" finds "red onion" before "onion").
export function matchIngredient(name, ingredients) {
  const index = indexOf(ingredients);
  const full = normName(name);
  if (!full) return null;
  if (index.has(full)) return index.get(full);
  const words = full.split(" ");
  const core = words.filter((w) => !DESCRIPTORS.has(w));
  if (index.has(core.join(" "))) return index.get(core.join(" "));
  for (const ws of [core, words]) {
    for (let len = ws.length - 1; len >= 1; len--) {
      for (let start = ws.length - len; start >= 0; start--) {
        const key = ws.slice(start, start + len).join(" ");
        if (index.has(key)) return index.get(key);
      }
    }
  }
  return null;
}

// A tidy name for a new ingredient made from free text: "Red Onions" -> "red onion".
export function newIngredientName(name) {
  const words = String(name).toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ").trim().split(/\s+/).filter((w) => !DESCRIPTORS.has(w));
  if (!words.length) return String(name).trim().toLowerCase();
  words[words.length - 1] = normWord(words[words.length - 1]);
  return words.join(" ");
}
