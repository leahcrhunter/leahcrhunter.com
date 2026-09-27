// "Paste a link": fetch a recipe page and read the schema.org Recipe data
// (JSON-LD) that most recipe sites publish. Returns a draft for the phone to
// check before saving; nothing is stored here.

const MAX_BYTES = 3_000_000;

export async function importRecipe(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return fail("that doesn't look like a link");
  }
  if (!["http:", "https:"].includes(url.protocol)) return fail("that doesn't look like a web link");

  let html;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; kitchen.leahcrhunter.com recipe import)", accept: "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return fail(`the site said no (${res.status}) — try typing it in instead`);
    html = (await res.text()).slice(0, MAX_BYTES);
  } catch {
    return fail("couldn't reach that site");
  }

  const recipe = findRecipe(html);
  if (!recipe) return fail("couldn't find a recipe on that page — try typing it in instead");

  return {
    draft: {
      title: clean(recipe.name) || "untitled recipe",
      source_url: url.toString(),
      photo_url: image(recipe.image),
      servings: servings(recipe.recipeYield),
      prep_min: minutes(recipe.prepTime),
      cook_min: minutes(recipe.cookTime) ?? minutes(recipe.totalTime),
      ingredients: asList(recipe.recipeIngredient || recipe.ingredients).map(clean).filter(Boolean),
      steps: steps(recipe.recipeInstructions),
      tags: [...asList(recipe.recipeCategory), ...asList(recipe.recipeCuisine)]
        .flatMap((t) => String(t).split(","))
        .map((t) => clean(t).toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
    },
  };
}

function fail(error) {
  return { error };
}

function findRecipe(html) {
  const blocks = html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const found = walk(data);
    if (found) return found;
  }
  return null;
}

// Recipe data can be at the top, in an array, or inside @graph.
function walk(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = walk(n, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (asList(node["@type"]).includes("Recipe")) return node;
  return walk(node["@graph"], depth + 1) || walk(node.mainEntity, depth + 1);
}

function asList(v) {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", frac12: "½", frac14: "¼", frac34: "¾", deg: "°" };

function clean(s) {
  if (s == null) return "";
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function image(v) {
  const first = asList(v)[0];
  if (!first) return null;
  const src = typeof first === "string" ? first : first.url || first.contentUrl;
  return typeof src === "string" && /^https?:\/\//.test(src) ? src : null;
}

function servings(v) {
  for (const y of asList(v)) {
    const m = String(y).match(/\d+/);
    if (m) return Math.min(50, Number(m[0]));
  }
  return 2;
}

// ISO 8601 durations: "PT1H30M" -> 90
function minutes(v) {
  const m = typeof v === "string" && v.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/i);
  if (!m) return null;
  const total = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
  return total || null;
}

// Strings, HowToStep objects, or HowToSections holding more steps.
function steps(v) {
  const out = [];
  const add = (node) => {
    if (!node) return;
    if (typeof node === "string") {
      clean(node).split(/\s*\n\s*|(?<=\.)\s{2,}/).filter(Boolean).forEach((s) => out.push(s));
    } else if (Array.isArray(node)) {
      node.forEach(add);
    } else if (asList(node["@type"]).includes("HowToSection")) {
      add(node.itemListElement);
    } else {
      const t = clean(node.text || node.name);
      if (t) out.push(t);
    }
  };
  add(v);
  return out.slice(0, 60);
}
