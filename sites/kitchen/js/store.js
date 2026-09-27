// The one copy of the shared data on this phone, kept fresh by polling
// /api/rev (cheap) and re-reading /api/state when the other phone changed
// something. Per-device preferences (who's holding the phone, metric or US)
// live in localStorage.

export const store = {
  rev: -1,
  ingredients: [],
  pantry: [],
  recipes: [],
  recipeLines: [],
  ratings: [],
  shopping: [],
  staples: [],
  usage: [],
  plan: [],
  finder: { key: null }, // where the recipe finder's API key lives: "secret" | "app" | null
  // derived
  ing: new Map(),
  recipe: new Map(),
  people: [],
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

// ---------------------------------------------------------------- server

export async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: method === "GET" ? {} : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    credentials: "same-origin",
  });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `that didn't work (${res.status})`);
  return data;
}

export async function refresh() {
  Object.assign(store, await api("GET", "state"));
  derive();
  listeners.forEach((fn) => fn());
}

// Writes, then reloads everything (the data is small) so every tab agrees.
export async function mutate(method, path, body) {
  const result = await api(method, path, body);
  await refresh();
  return result;
}

function derive() {
  store.ing = new Map(store.ingredients.map((i) => [i.id, i]));
  store.recipe = new Map(store.recipes.map((r) => [r.id, { ...r, lines: [], ratings: {} }]));
  for (const line of store.recipeLines) store.recipe.get(line.recipe_id)?.lines.push(line);
  for (const r of store.ratings) {
    const recipe = store.recipe.get(r.recipe_id);
    if (recipe) recipe.ratings[r.person] = r.rating;
  }
  store.recipes = [...store.recipe.values()];
  const names = new Set();
  for (const row of [...store.pantry, ...store.shopping]) if (row.added_by) names.add(row.added_by);
  for (const row of [...store.usage, ...store.ratings]) if (row.person) names.add(row.person);
  if (prefs.person) names.add(prefs.person);
  store.people = [...names].sort();
}

// Faster while the shopping list is open (so ticks show up on the other
// phone within a few seconds), slower otherwise, paused when hidden.
// `interval()` is asked every second, so switching tabs changes the pace at once.
export function startPolling(interval) {
  let last = Date.now(), busy = false;
  const check = async (force = false) => {
    if (busy || document.hidden || (!force && Date.now() - last < interval())) return;
    busy = true;
    last = Date.now();
    try {
      const { rev } = await api("GET", "rev");
      if (rev !== store.rev) await refresh();
    } catch {
      /* offline for a moment; try again next time */
    } finally {
      busy = false;
    }
  };
  setInterval(check, 1000);
  document.addEventListener("visibilitychange", () => check(true));
}

// ---------------------------------------------------------------- this device

function load(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: fine, it just won't be remembered */
  }
}

export const prefs = {
  get person() { return load("kitchen.person", ""); },
  set person(v) { save("kitchen.person", v); },
  get units() { return load("kitchen.units", "metric"); },
  set units(v) { save("kitchen.units", v); },
};

// ---------------------------------------------------------------- dates (local, not UTC)

export function today() {
  return isoDate(new Date());
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

export function daysUntil(day) {
  if (!day) return null;
  const [y, m, d] = day.split("-").map(Number);
  const [ty, tm, td] = today().split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}

// "today", "tomorrow", "in 3 days", "yesterday", "4 days ago", "12 Oct"
export function fmtDay(day) {
  const n = daysUntil(day);
  if (n == null) return "";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1 && n < 7) return `in ${n} days`;
  if (n < -1 && n > -7) return `${-n} days ago`;
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// 'expired' | 'soon' (within 3 days) | 'ok' | null (no date)
export function freshness(item) {
  const n = daysUntil(item.expires);
  if (n == null) return null;
  if (n < 0) return "expired";
  if (n <= 3) return "soon";
  return "ok";
}
