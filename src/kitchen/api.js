// JSON endpoints under kitchen.leahcrhunter.com/api/. Deliberately thin: the
// phone does the parsing, unit maths and matching (it already has all the data
// in hand), and this file stores the results. Every write bumps meta.rev,
// which the phones poll to notice each other's changes.

import { importRecipe } from "./import.js";
import { findRecipe } from "./find.js";

const LOCATIONS = ["fridge", "freezer", "cupboard", "spice rack"];
const BASE_UNITS = ["g", "ml", "count"];
const REASONS = ["used", "cooked", "used up", "thrown away"];

class BadRequest extends Error {}
const bad = (msg) => { throw new BadRequest(msg); };

// ---------------------------------------------------------------- field checks

const text = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : bad("expected a number"));
const int = (v) => (v == null || v === "" ? null : Number.isInteger(Number(v)) ? Number(v) : bad("expected a whole number"));
const id = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : bad("bad id"));
const bool = (v) => (v ? 1 : 0);
const date = (v) => (v == null || v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : bad("bad date"));
const oneOf = (list) => (v) => (list.includes(v) ? v : bad(`expected one of ${list.join(", ")}`));
const today = (v) => date(v) || bad("today's date is required");
const list = (v, max = 100) => (Array.isArray(v) ? v.slice(0, max) : bad("expected a list"));

const INGREDIENT = {
  name: (v) => text(v, 80) || bad("name is required"),
  aliases: (v) => text(v, 500) || "",
  category: (v) => text(v, 40) || "other",
  default_unit: oneOf(BASE_UNITS),
  aisle: (v) => text(v, 40) || "other",
  storage: oneOf(LOCATIONS),
  density: num,
  unit_weight: num,
  shelf_days: int,
  always_have: bool,
};

const PANTRY = {
  ingredient_id: id,
  quantity: num,
  unit: oneOf(BASE_UNITS),
  location: oneOf(LOCATIONS),
  purchased: (v) => date(v) || bad("purchased date is required"),
  expires: date,
  opened: date,
  added_by: (v) => text(v, 40),
  notes: (v) => text(v, 500) || "",
};

const RECIPE = {
  title: (v) => text(v, 200) || bad("title is required"),
  source_url: (v) => text(v, 1000),
  photo_url: (v) => text(v, 1000),
  servings: (v) => int(v) || 2,
  prep_min: int,
  cook_min: int,
  steps: (v) => JSON.stringify(list(v, 200).map((s) => String(s).slice(0, 4000))),
  tags: (v) => JSON.stringify(list(v, 30).map((s) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean)),
  notes: (v) => text(v, 4000) || "",
};

// Checks the fields that are present; `required` lists fields that must be.
function pick(body, spec, required = []) {
  const out = {};
  for (const [key, check] of Object.entries(spec)) {
    if (key in body) out[key] = check(body[key]);
    else if (required.includes(key)) out[key] = check(undefined);
  }
  return out;
}

function insert(db, table, row) {
  const cols = Object.keys(row);
  return db
    .prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
    .bind(...Object.values(row));
}

function update(db, table, rowId, row) {
  const cols = Object.keys(row);
  if (!cols.length) bad("nothing to change");
  return db
    .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...Object.values(row), rowId);
}

// The same food in the same place is one pantry row, not several: after
// every write, batches that match on ingredient, location and unit are merged
// into the oldest row. The merged row keeps the earliest use-by (so "use soon"
// still warns about the older food), the latest purchase date, and is "some"
// if any batch was unmeasured. Same SQL as migrations/kitchen/0003.
const SAME = "p.ingredient_id = pantry_items.ingredient_id AND p.location = pantry_items.location AND p.unit = pantry_items.unit";
const MERGE_PANTRY = [
  `UPDATE pantry_items SET
     quantity  = (SELECT CASE WHEN count(p.quantity) = count(*) THEN sum(p.quantity) END FROM pantry_items p WHERE ${SAME}),
     expires   = (SELECT min(p.expires) FROM pantry_items p WHERE ${SAME}),
     purchased = (SELECT max(p.purchased) FROM pantry_items p WHERE ${SAME}),
     opened    = (SELECT min(p.opened) FROM pantry_items p WHERE ${SAME}),
     notes     = (SELECT coalesce(group_concat(DISTINCT p.notes), '') FROM pantry_items p WHERE ${SAME} AND p.notes != '')
   WHERE id IN (SELECT min(id) FROM pantry_items GROUP BY ingredient_id, location, unit HAVING count(*) > 1)`,
  // a ticked list item points at the batch it created; follow it into the merged row
  `UPDATE shopping_list SET pantry_item_id = (
     SELECT min(p.id) FROM pantry_items k JOIN pantry_items p
       ON p.ingredient_id = k.ingredient_id AND p.location = k.location AND p.unit = k.unit
     WHERE k.id = shopping_list.pantry_item_id)
   WHERE pantry_item_id IS NOT NULL`,
  `DELETE FROM pantry_items WHERE id NOT IN (SELECT min(id) FROM pantry_items GROUP BY ingredient_id, location, unit)`,
];

// Runs the statements as one transaction, tidies the pantry, and bumps rev.
async function write(db, statements) {
  const results = await db.batch([
    ...statements,
    ...MERGE_PANTRY.map((sql) => db.prepare(sql)),
    db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value"),
  ]);
  return { results, rev: results.at(-1).results[0].value };
}

function addDays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- pantry use

// Takes food out of the pantry and logs it. Each use is
// { id, quantity (null = all of it), reason, recipe_id }.
async function useStatements(db, uses, day, person) {
  uses = list(uses, 200).map((u) => ({
    id: id(u.id),
    quantity: num(u.quantity),
    reason: oneOf(REASONS)(u.reason),
    recipe_id: u.recipe_id == null ? null : id(u.recipe_id),
  }));
  if (!uses.length) return [];
  const ids = uses.map((u) => u.id);
  const { results: items } = await db
    .prepare(`SELECT * FROM pantry_items WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all();
  const byId = new Map(items.map((i) => [i.id, i]));

  const out = [];
  for (const u of uses) {
    const item = byId.get(u.id);
    if (!item) continue; // already gone (the other phone got there first)
    const all = u.quantity == null || item.quantity == null || item.quantity - u.quantity < 1e-6;
    out.push(
      all
        ? db.prepare("DELETE FROM pantry_items WHERE id = ?").bind(item.id)
        : db.prepare("UPDATE pantry_items SET quantity = quantity - ? WHERE id = ?").bind(u.quantity, item.id),
      insert(db, "usage_log", {
        ingredient_id: item.ingredient_id,
        quantity: all ? item.quantity : u.quantity,
        unit: item.unit,
        date: day,
        reason: u.reason,
        recipe_id: u.recipe_id,
        person,
      })
    );
  }
  return out;
}

// ---------------------------------------------------------------- the finder's API key

// A Worker secret wins; otherwise the key someone pasted into the app.
async function anthropicKey(db, env) {
  if (env.ANTHROPIC_API_KEY) return { key: env.ANTHROPIC_API_KEY, from: "secret" };
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'anthropic_api_key'").first();
  return row ? { key: row.value, from: "app" } : { key: null, from: null };
}

// ---------------------------------------------------------------- routes

const routes = {
  "GET state": async ({ db, env }) => {
    const since = addDays(new Date().toISOString().slice(0, 10), -60);
    const [meta, ingredients, pantry, recipes, lines, ratings, shopping, staples, usage, plan] = await db.batch([
      db.prepare("SELECT value FROM meta WHERE key = 'rev'"),
      db.prepare("SELECT * FROM ingredients ORDER BY name"),
      db.prepare("SELECT * FROM pantry_items"),
      db.prepare("SELECT * FROM recipes ORDER BY title"),
      db.prepare("SELECT * FROM recipe_ingredients ORDER BY recipe_id, position"),
      db.prepare("SELECT * FROM recipe_ratings"),
      db.prepare("SELECT * FROM shopping_list ORDER BY id"),
      db.prepare("SELECT * FROM staples"),
      db.prepare("SELECT * FROM usage_log WHERE date >= ? ORDER BY date DESC, id DESC").bind(since),
      db.prepare("SELECT * FROM meal_plan WHERE date >= ? ORDER BY date").bind(addDays(since, 50)),
    ]);
    return {
      rev: meta.results[0].value,
      ingredients: ingredients.results,
      pantry: pantry.results,
      recipes: recipes.results.map((r) => ({ ...r, steps: JSON.parse(r.steps), tags: JSON.parse(r.tags) })),
      recipeLines: lines.results,
      ratings: ratings.results,
      shopping: shopping.results,
      staples: staples.results,
      usage: usage.results,
      plan: plan.results,
      // only whether there's a key and where it lives, never the key itself
      finder: { key: (await anthropicKey(db, env)).from },
    };
  },

  "GET rev": async ({ db }) => ({ rev: (await db.prepare("SELECT value FROM meta WHERE key = 'rev'").first()).value }),

  // -- ingredients

  "POST ingredients": async ({ db, body }) => {
    const row = pick(body, INGREDIENT, ["name"]);
    // Adding a name that already exists (the other phone just added it) returns that one.
    const cols = Object.keys(row);
    const { rev } = await write(db, [
      db.prepare(`INSERT OR IGNORE INTO ingredients (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...Object.values(row)),
    ]);
    const found = await db.prepare("SELECT id FROM ingredients WHERE name = ?").bind(row.name).first();
    return { rev, id: found.id };
  },

  "PUT ingredients/:id": async ({ db, body, params }) => write(db, [update(db, "ingredients", params.id, pick(body, INGREDIENT))]),

  // -- pantry

  "POST pantry": async ({ db, body }) => {
    const rows = list(body.items).map((item) => insert(db, "pantry_items", pick(item, PANTRY, ["ingredient_id", "unit", "location", "purchased"])));
    const { results, rev } = await write(db, rows);
    return { rev, ids: results.slice(0, rows.length).map((r) => r.meta.last_row_id) };
  },

  "PUT pantry/:id": async ({ db, body, params }) => write(db, [update(db, "pantry_items", params.id, pick(body, PANTRY))]),

  // Deleting outright is for mistakes; food that was eaten or binned goes through /use.
  "DELETE pantry/:id": async ({ db, params }) => write(db, [db.prepare("DELETE FROM pantry_items WHERE id = ?").bind(params.id)]),

  "POST pantry/use": async ({ db, body }) =>
    write(db, await useStatements(db, body.uses, today(body.date), text(body.person, 40))),

  // -- recipes

  "POST recipes": async ({ db, body }) => {
    const row = { ...pick(body, RECIPE, ["title"]), created: today(body.date) };
    // New rows get the highest id, and the batch is one transaction, so max(id) is this recipe.
    const { results, rev } = await write(db, [insert(db, "recipes", row), ...lineStatements(db, body.ingredients, "(SELECT max(id) FROM recipes)")]);
    return { rev, id: results[0].meta.last_row_id };
  },

  "PUT recipes/:id": async ({ db, body, params }) => {
    const statements = [];
    const row = pick(body, RECIPE);
    if (Object.keys(row).length) statements.push(update(db, "recipes", params.id, row));
    if ("ingredients" in body) {
      statements.push(db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(params.id));
      statements.push(...lineStatements(db, body.ingredients, params.id));
    }
    return write(db, statements);
  },

  "DELETE recipes/:id": async ({ db, params }) =>
    write(db, [
      db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(params.id),
      db.prepare("DELETE FROM recipe_ratings WHERE recipe_id = ?").bind(params.id),
      db.prepare("UPDATE usage_log SET recipe_id = NULL WHERE recipe_id = ?").bind(params.id),
      db.prepare("DELETE FROM meal_plan WHERE recipe_id = ?").bind(params.id),
      db.prepare("DELETE FROM recipes WHERE id = ?").bind(params.id),
    ]),

  "POST recipes/:id/cooked": async ({ db, body, params }) => {
    const day = today(body.date);
    const uses = list(body.uses || [], 200).map((u) => ({ ...u, reason: "cooked", recipe_id: params.id }));
    return write(db, [
      ...(await useStatements(db, uses, day, text(body.person, 40))),
      db.prepare("UPDATE recipes SET times_cooked = times_cooked + 1, last_cooked = ? WHERE id = ?").bind(day, params.id),
    ]);
  },

  "PUT recipes/:id/rating": async ({ db, body, params }) => {
    const person = text(body.person, 40) || bad("who's rating?");
    const rating = int(body.rating);
    return write(db, [
      rating
        ? db
            .prepare(
              `INSERT INTO recipe_ratings (recipe_id, person, rating) VALUES (?, ?, ?)
               ON CONFLICT (recipe_id, person) DO UPDATE SET rating = excluded.rating`
            )
            .bind(params.id, person, Math.min(5, Math.max(1, rating)))
        : db.prepare("DELETE FROM recipe_ratings WHERE recipe_id = ? AND person = ?").bind(params.id, person),
    ]);
  },

  // "What can we make?": one recipe from the web, optionally steered by a prompt.
  "POST recipes/find": async ({ db, env, body }) => {
    const strings = (v, n) => (Array.isArray(v) ? v.slice(0, n).map((s) => text(s, 80)).filter(Boolean) : []);
    const found = await findRecipe((await anthropicKey(db, env)).key, {
      prompt: text(body.prompt, 500),
      soon: strings(body.soon, 20),
      have: strings(body.have, 80),
      avoid: strings(body.avoid, 60),
    });
    return found.error ? bad(found.error) : found;
  },

  // Paste in an Anthropic API key for the finder. It's checked with a free call
  // (listing models) before it's kept, and never sent back out.
  "PUT settings/anthropic-key": async ({ db, body }) => {
    const key = text(body.key, 300) || bad("paste a key first");
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) bad("that doesn't look like an Anthropic API key (they start sk-ant-)");
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (res.status === 401 || res.status === 403) bad("Anthropic didn't accept that key: check it was copied in full");
    if (!res.ok) bad(`couldn't check the key with Anthropic just now (${res.status}), try again`);
    return write(db, [
      db.prepare("INSERT INTO settings (key, value) VALUES ('anthropic_api_key', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key),
    ]);
  },

  "DELETE settings/anthropic-key": async ({ db }) =>
    write(db, [db.prepare("DELETE FROM settings WHERE key = 'anthropic_api_key'")]),

  "POST recipes/import": async ({ body }) => {
    const found = await importRecipe(text(body.url, 2000) || bad("paste a link first"));
    return found.error ? bad(found.error) : found;
  },

  // -- shopping list

  // Adding something that's already on the list (same ingredient and unit,
  // not yet ticked) merges into that line: "onions: 2 for curry + 1 for soup".
  "POST shopping": async ({ db, body }) => {
    const person = text(body.person, 40);
    const { results: open } = await db.prepare("SELECT * FROM shopping_list WHERE ticked = 0").all();
    const statements = [];
    for (const raw of list(body.items)) {
      const item = {
        ingredient_id: id(raw.ingredient_id),
        quantity: num(raw.quantity),
        unit: raw.unit == null ? null : oneOf(BASE_UNITS)(raw.unit),
        reason: oneOf(["restock", "recipe", "manual"])(raw.reason || "manual"),
        label: text(raw.label, 200) || (person ? `added by ${person}` : ""),
        added_by: person,
      };
      const same = open.find((o) => o.ingredient_id === item.ingredient_id && (o.unit === item.unit || o.quantity == null || item.quantity == null));
      if (same) {
        const quantity = same.quantity != null && item.quantity != null ? same.quantity + item.quantity : same.quantity ?? item.quantity;
        const label = [same.label, item.label].filter(Boolean).join(" + ");
        statements.push(db.prepare("UPDATE shopping_list SET quantity = ?, unit = ?, label = ? WHERE id = ?").bind(quantity, same.unit ?? item.unit, label, same.id));
        Object.assign(same, { quantity, label, unit: same.unit ?? item.unit });
      } else {
        statements.push(insert(db, "shopping_list", item));
      }
    }
    return write(db, statements);
  },

  "PUT shopping/:id": async ({ db, body, params }) =>
    write(db, [update(db, "shopping_list", params.id, pick(body, { quantity: num, unit: oneOf(BASE_UNITS), label: (v) => text(v, 200) || "" }))]),

  "DELETE shopping/:id": async ({ db, params }) => write(db, [db.prepare("DELETE FROM shopping_list WHERE id = ?").bind(params.id)]),

  // -- dinner plan: one dinner per day, a recipe from the box or a note

  "PUT plan/:day": async ({ db, body, params }) => {
    const note = body.note == null ? null : oneOf(["leftovers", "eating out"])(body.note);
    const recipeId = body.recipe_id == null ? null : id(body.recipe_id);
    if (!note && !recipeId) bad("pick a recipe");
    return write(db, [
      db.prepare(
        `INSERT INTO meal_plan (date, meal, recipe_id, servings, note) VALUES (?, 'dinner', ?, ?, ?)
         ON CONFLICT (date, meal) DO UPDATE SET recipe_id = excluded.recipe_id, servings = excluded.servings, note = excluded.note`
      ).bind(params.day, recipeId, int(body.servings), note),
    ]);
  },

  "DELETE plan/:day": async ({ db, params }) =>
    write(db, [db.prepare("DELETE FROM meal_plan WHERE date = ? AND meal = 'dinner'").bind(params.day)]),

  "POST shopping/clear": async ({ db }) => write(db, [db.prepare("DELETE FROM shopping_list WHERE ticked = 1")]),

  // Ticking puts the food in the pantry with today's date and the ingredient's
  // default use-by; un-ticking takes that batch back out again.
  "POST shopping/:id/tick": async ({ db, body, params }) => {
    const day = today(body.date);
    const row = await db
      .prepare("SELECT s.*, i.category, i.storage, i.shelf_days, i.default_unit FROM shopping_list s JOIN ingredients i ON i.id = s.ingredient_id WHERE s.id = ?")
      .bind(params.id)
      .first();
    if (!row) bad("that's not on the list any more");

    if (body.ticked && !row.ticked) {
      if (row.category === "household") {
        return write(db, [db.prepare("UPDATE shopping_list SET ticked = 1 WHERE id = ?").bind(row.id)]);
      }
      const pantry = {
        ingredient_id: row.ingredient_id,
        quantity: row.quantity,
        unit: row.unit || row.default_unit,
        location: row.storage,
        purchased: day,
        expires: row.shelf_days ? addDays(day, row.shelf_days) : null,
        added_by: text(body.person, 40),
      };
      return write(db, [
        insert(db, "pantry_items", pantry),
        db.prepare("UPDATE shopping_list SET ticked = 1, pantry_item_id = (SELECT max(id) FROM pantry_items) WHERE id = ?").bind(row.id),
      ]);
    }
    if (!body.ticked && row.ticked) {
      // Take back what the tick added. It may have been merged into food that
      // was already there, so subtract when we can rather than delete.
      const item = row.pantry_item_id && (await db.prepare("SELECT * FROM pantry_items WHERE id = ?").bind(row.pantry_item_id).first());
      const statements = [];
      if (item) {
        const partial = item.quantity != null && row.quantity != null && item.unit === (row.unit || row.default_unit) && item.quantity - row.quantity > 1e-6;
        statements.push(partial
          ? db.prepare("UPDATE pantry_items SET quantity = quantity - ? WHERE id = ?").bind(row.quantity, item.id)
          : db.prepare("DELETE FROM pantry_items WHERE id = ?").bind(item.id));
      }
      statements.push(db.prepare("UPDATE shopping_list SET ticked = 0, pantry_item_id = NULL WHERE id = ?").bind(row.id));
      return write(db, statements);
    }
    return { rev: null };
  },
};

function lineStatements(db, lines, recipeIdSql) {
  const recipeRef = typeof recipeIdSql === "number" ? "?" : recipeIdSql;
  return list(lines || [], 100).map((line, position) => {
    const values = [
      line.ingredient_id == null ? null : id(line.ingredient_id),
      num(line.quantity),
      text(line.unit, 20),
      bool(line.optional),
      text(line.original, 300) || "",
    ];
    const stmt = db.prepare(
      `INSERT INTO recipe_ingredients (recipe_id, position, ingredient_id, quantity, unit, optional, original)
       VALUES (${recipeRef}, ?, ?, ?, ?, ?, ?)`
    );
    return recipeRef === "?" ? stmt.bind(recipeIdSql, position, ...values) : stmt.bind(position, ...values);
  });
}

// "PUT pantry/:id" -> matches ["pantry", "12"] with params.id = 12
const table = Object.entries(routes).map(([key, fn]) => {
  const [method, pattern] = key.split(" ");
  return { method, parts: pattern.split("/"), fn };
});

export async function handleApi(request, env, path) {
  const method = request.method;
  if (method !== "GET") {
    // The session cookie rides along on cross-site requests too; insisting on
    // a same-origin JSON request means another site can't write here.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "wrong origin" }, { status: 403 });
    if (!(request.headers.get("content-type") || "").startsWith("application/json")) {
      return Response.json({ error: "expected JSON" }, { status: 415 });
    }
  }

  const parts = path.split("/").filter(Boolean);
  const route = table.find(
    (r) => r.method === method && r.parts.length === parts.length && r.parts.every((p, i) => p.startsWith(":") || p === parts[i])
  );
  if (!route) return Response.json({ error: "not found" }, { status: 404 });

  const params = {};
  route.parts.forEach((p, i) => { if (p.startsWith(":")) params[p.slice(1)] = parts[i]; });

  try {
    if (params.id !== undefined) params.id = id(params.id);
    if (params.day !== undefined) params.day = date(params.day) || bad("bad date");
    const body = method === "GET" ? {} : await request.json().catch(() => bad("couldn't read that"));
    const result = await route.fn({ db: env.KITCHEN_DB, env, body: body || {}, params });
    const { results, ...rest } = result; // don't send raw D1 results back
    return Response.json(rest, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    console.error(err);
    return Response.json({ error: "something went wrong on the server" }, { status: 500 });
  }
}
