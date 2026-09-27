// "What can we make?": find one real recipe on the web to suggest.
//
// With an Anthropic API key (a Worker secret, or one pasted into the app),
// Claude searches the web (the server-side web_search tool) for a recipe page
// that fits the prompt and the pantry, and names up to three candidate pages.
// The first one whose recipe data we can read (import.js) and that keeps to
// anything ruled out ("no cheese", "vegetarian": diet.js) is returned as a
// draft card. Without a key it falls back to TheMealDB's free API, a much
// smaller collection, with the same rule-out check.
//
// Plain fetch rather than the Anthropic SDK: this repo has no dependencies or
// build step, and Cloudflare deploys it with a bare `npx wrangler deploy`.

import { importRecipe } from "./import.js";
// shared with the app, which runs the same rule-out check on the recipe box
import { readRequest, breaks, describe } from "../../sites/kitchen/js/diet.js";

const MODEL = "claude-opus-5";
const IDEAS = [
  "a curry", "a noodle dish", "a traybake", "a soup", "a pasta dish", "a stew", "tacos or wraps",
  "a rice bowl", "a pie", "a salad that's a proper dinner", "a stir-fry", "something from Korea",
  "something from Mexico", "something Middle Eastern", "something from West Africa", "something Japanese",
  "something Italian", "something Indian", "something Greek", "something from Vietnam", "a comfort-food classic",
];

export async function findRecipe(apiKey, ask) {
  const request = readRequest(ask.prompt);
  return apiKey ? fromTheWeb(apiKey, ask, request) : fromMealDb(ask, request);
}

function ruledOut(exclude) {
  return exclude.map((e) => e.label).join(", ");
}

// ---------------------------------------------------------------- Claude + web search

const SYSTEM = `You help two people at home decide what to cook for dinner by finding one real recipe on the web.

Search the web and pick recipe pages that:
- are the recipe itself (not a round-up, category page, video-only page or paywalled page), from sites that publish full ingredient lists and methods, such as BBC Good Food, Serious Eats, RecipeTin Eats, Budget Bytes, NYT Cooking's free recipes, Delicious, Olive or food blogs;
- fit what they asked for, if they asked for anything, and otherwise make a pleasant surprise that isn't the obvious choice;
- never contain anything they've ruled out ("no cheese", "vegetarian", allergies): that is a hard rule, so check the page's full ingredient list, including toppings, garnishes and optional extras, and skip any recipe that breaks it;
- lean on food they already have, especially anything that needs using soon, when that doesn't fight what they asked for;
- aren't one of the recipes they already have saved.

Only give URLs you actually saw in your search results. Finish with a fenced json block and nothing after it:
\`\`\`json
{"candidates": [{"url": "https://...", "title": "...", "why": "one warm, specific sentence on why this suits them tonight"}]}
\`\`\`
List up to three candidates, best first; the app shows the first one it can read.`;

async function fromTheWeb(apiKey, { prompt, soon, have, avoid }, { exclude }) {
  const lines = [
    prompt ? `What we're in the mood for: ${prompt}` : `No particular request, surprise us. One idea to start from: ${pick(IDEAS)}.`,
    exclude.length ? `Must not contain: ${describe(exclude)}.` : null,
    soon.length ? `Needs using soon: ${soon.join(", ")}.` : null,
    have.length ? `Also in the house: ${have.join(", ")}.` : null,
    avoid.length ? `Already saved or just suggested (pick something else): ${avoid.join("; ")}.` : null,
  ];
  const messages = [{ role: "user", content: lines.filter(Boolean).join("\n") }];

  let response;
  // pause_turn means the server paused a long search; send it back to carry on
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        // if a safety classifier declines, the API retries on its recommended model
        fallbacks: "default",
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      }),
    });
    if (!res.ok) {
      console.error("anthropic", res.status, await res.text());
      if (res.status === 401 || res.status === 403) return { error: "the Anthropic API key was turned down: check it, or paste a new one below" };
      if (res.status === 429) return { error: "the recipe finder is busy, try again in a minute" };
      return { error: "the recipe finder isn't working right now" };
    }
    response = await res.json();
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  if (response.stop_reason === "refusal") return { error: "couldn't search for that one, try asking differently" };

  // URLs that really came back from search, to check the answer against
  const seen = new Set();
  for (const block of response.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) seen.add(r.url);
    }
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const candidates = parseCandidates(text).filter((c) => /^https?:\/\//.test(c?.url || ""));
  candidates.sort((a, b) => Number(seen.has(b.url)) - Number(seen.has(a.url)));
  if (!candidates.length) return { error: "didn't find anything this time, try again?" };

  let brokeRules = false;
  for (const c of candidates.slice(0, 3)) {
    const found = await importRecipe(c.url);
    if (!found.draft) continue;
    // double-check the rule-outs against the real ingredient list
    if (breaks(found.draft, exclude).length) { brokeRules = true; continue; }
    return { draft: found.draft, why: String(c.why || ""), source: "web" };
  }
  if (brokeRules) return { error: `everything it found had ${ruledOut(exclude)} in it after all, try again?` };
  return { error: `found “${candidates[0].title || candidates[0].url}” but couldn't read the recipe from the page`, link: candidates[0].url };
}

function parseCandidates(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const loose = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  for (const chunk of [...fenced.reverse(), loose]) {
    try {
      const data = JSON.parse(chunk);
      if (Array.isArray(data?.candidates)) return data.candidates;
    } catch {
      /* try the next one */
    }
  }
  return [];
}

// ---------------------------------------------------------------- TheMealDB (no key)

const MEALDB = "https://www.themealdb.com/api/json/v1/1";

const CATEGORIES = ["beef", "chicken", "dessert", "lamb", "pasta", "pork", "seafood", "side", "starter", "vegan", "vegetarian", "breakfast", "goat"];

async function fromMealDb({ prompt, soon, avoid }, { exclude, words }) {
  const get = async (path) => (await (await fetch(`${MEALDB}/${path}`)).json()).meals || [];
  const skip = new Set(avoid.map((t) => t.toLowerCase()));
  const labels = new Set(exclude.map((e) => e.label));
  const q = encodeURIComponent;

  try {
    // Gather candidates: by name, then each word as a main ingredient, cuisine
    // or category ("no cheese" leaves no words, so it's anything at all).
    let meals = [];
    const add = (list) => { for (const m of list) if (!skip.has(m.strMeal.toLowerCase()) && !meals.some((x) => x.idMeal === m.idMeal)) meals.push(m); };
    if (labels.has("meat") && !labels.has("dairy")) add(await get("filter.php?c=Vegetarian"));
    if (labels.has("meat") && labels.has("dairy")) add(await get("filter.php?c=Vegan"));
    if (words.length) {
      add(await get(`search.php?s=${q(words.join(" "))}`));
      for (const word of words) {
        if (meals.length >= 12) break;
        add(await get(`filter.php?i=${q(word.replace(/s$/, ""))}`));
        add(await get(`filter.php?a=${q(word[0].toUpperCase() + word.slice(1))}`));
        if (CATEGORIES.includes(word)) add(await get(`filter.php?c=${q(word[0].toUpperCase() + word.slice(1))}`));
      }
    } else if (!prompt) {
      for (const food of shuffle(soon)) {
        add(await get(`filter.php?i=${q(food.replace(/\s+/g, "_"))}`));
        if (meals.length) break;
      }
    }
    if (words.length && !meals.length) return { error: `nothing for “${prompt}” in the free recipe collection, try other words` };
    const searched = meals.length > 0;

    // Try candidates in a random order (or random meals, if there were none)
    // until one keeps to the rule-outs.
    const queue = shuffle(meals).slice(0, 10);
    for (let tries = 0; tries < 15; tries++) {
      let meal = searched ? queue[tries] : (await get("random.php"))[0];
      if (!meal) break;
      if (!meal.strInstructions) meal = (await get(`lookup.php?i=${meal.idMeal}`))[0];
      if (!meal || skip.has(meal.strMeal.toLowerCase())) continue;
      // it's for dinner: no puddings, breakfasts, sides or starters unless that's what was asked for
      if (["Dessert", "Breakfast", "Side", "Starter"].includes(meal.strCategory) && !words.includes(meal.strCategory.toLowerCase())) continue;
      const draft = mealToDraft(meal);
      if (breaks(draft, exclude).length) continue;
      return { draft, why: "", source: "mealdb" };
    }
    return { error: `couldn't find one without ${ruledOut(exclude)} in the free recipe collection, try other words` };
  } catch {
    return { error: "couldn't reach the recipe collection" };
  }
}

function mealToDraft(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m[`strIngredient${i}`] || "").trim();
    if (name) ingredients.push(`${(m[`strMeasure${i}`] || "").trim()} ${name}`.trim());
  }
  return {
    title: m.strMeal,
    source_url: m.strSource || `https://www.themealdb.com/meal/${m.idMeal}`,
    photo_url: m.strMealThumb || null,
    servings: 4,
    prep_min: null,
    cook_min: null,
    ingredients,
    steps: String(m.strInstructions || "").split(/\r?\n+/).map((s) => s.replace(/^(step\s*)?\d+[.:)]?\s*/i, "").trim()).filter((s) => s.length > 3),
    tags: [m.strCategory, m.strArea].filter(Boolean).map((t) => t.toLowerCase()),
  };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function shuffle(list) {
  return [...list].sort(() => Math.random() - 0.5);
}
