// Shared by the Worker (src/kitchen/find.js) and the app (js/make.js).
// Reading "no cheese", "without mushrooms", "vegetarian", "dairy-free" out of a
// "what can we make?" prompt, and checking a recipe against them. A rule-out
// is a hard rule: a suggestion that breaks it is never shown, however it was found.

// A word people rule out -> the ingredient words that count as it.
const GROUPS = {
  cheese: ["cheese", "parmesan", "parmigiano", "cheddar", "mozzarella", "feta", "halloumi", "ricotta", "mascarpone", "gruyere", "gruyère", "brie", "camembert", "paneer", "pecorino", "gouda", "emmental", "stilton", "gorgonzola", "manchego", "burrata", "quark", "grana padano", "comte", "comté", "taleggio", "fontina", "provolone", "monterey jack", "queso", "cotija"],
  dairy: ["milk", "cream", "butter", "buttermilk", "yoghurt", "yogurt", "creme fraiche", "crème fraîche", "ghee", "kefir", "custard", "ice cream", "condensed milk"],
  meat: ["chicken", "beef", "pork", "lamb", "bacon", "ham", "sausage", "chorizo", "turkey", "duck", "mince", "steak", "prosciutto", "pancetta", "salami", "veal", "venison", "goat", "mutton", "lardons", "pepperoni", "gelatine", "gelatin", "oxtail", "liver", "rabbit", "guanciale", "meatballs"],
  fish: ["fish", "salmon", "tuna", "cod", "haddock", "prawn", "shrimp", "anchovy", "anchovies", "mackerel", "sardine", "crab", "mussel", "squid", "scallop", "lobster", "clam", "oyster", "trout", "sea bass", "fish sauce", "oyster sauce", "worcestershire sauce", "hake", "pollock", "monkfish", "kipper"],
  egg: ["egg", "eggs", "mayonnaise", "mayo"],
  nuts: ["nut", "nuts", "almond", "cashew", "peanut", "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "pine nut", "brazil nut", "praline", "marzipan", "nutella"],
  gluten: ["flour", "bread", "pasta", "spaghetti", "noodle", "couscous", "barley", "rye", "breadcrumbs", "panko", "pastry", "tortilla", "pitta", "pita", "naan", "soy sauce", "seitan", "bulgur", "semolina", "farro", "spelt", "orzo", "gnocchi", "biscuit", "cracker", "beer", "wheat"],
  pork: ["pork", "bacon", "ham", "sausage", "chorizo", "prosciutto", "pancetta", "salami", "lardons", "pepperoni", "guanciale", "gelatine", "gelatin"],
  alcohol: ["wine", "beer", "vodka", "rum", "brandy", "sherry", "cider", "whisky", "whiskey", "port", "mirin", "sake", "marsala", "vermouth", "liqueur"],
};
GROUPS.seafood = GROUPS.fish;
GROUPS.shellfish = ["prawn", "shrimp", "crab", "mussel", "scallop", "lobster", "clam", "oyster", "langoustine", "crayfish"];
GROUPS.lactose = GROUPS.dairy;

// Diet words that rule out whole groups.
const DIETS = {
  vegetarian: ["meat", "fish"],
  veggie: ["meat", "fish"],
  pescatarian: ["meat"],
  vegan: ["meat", "fish", "dairy", "cheese", "egg", "honey"],
  "plant based": ["meat", "fish", "dairy", "cheese", "egg"],
  "plant-based": ["meat", "fish", "dairy", "cheese", "egg"],
  halal: ["pork", "alcohol"],
  kosher: ["pork", "shellfish"],
  coeliac: ["gluten"],
  celiac: ["gluten"],
};
// "dairy free" also means no cheese; so does "no dairy"
const ALSO = { dairy: ["cheese"], lactose: ["cheese"], meat: ["pork"] };

const STOP = new Set(("a an and the some something anything with for of to in on dinner tonight tea supper i we us want fancy like would " +
  "please make cook cooking recipe recipes meal meals idea ideas quick easy simple nice good tasty really very that is it our but just").split(" "));

// "quick pasta, no cheese or mushrooms, dairy free" ->
//   { exclude: [{ label: "cheese", words: [...] }, ...], words: ["pasta"] }
export function readRequest(prompt) {
  let rest = ` ${String(prompt || "").toLowerCase().replace(/[’']/g, "")} `;
  const excluded = new Map(); // label -> words

  const addTerm = (term) => {
    term = term.trim().replace(/\s+/g, " ").replace(/^(any|the|all)\s+/, "");
    if (!term || STOP.has(term)) return;
    const key = GROUPS[term] ? term : GROUPS[term.replace(/s$/, "")] ? term.replace(/s$/, "") : null;
    if (key) {
      excluded.set(key, GROUPS[key]);
      for (const extra of ALSO[key] || []) excluded.set(extra, GROUPS[extra]);
    } else {
      excluded.set(term, [term]);
    }
  };

  for (const [diet, groups] of Object.entries(DIETS)) {
    if (rest.includes(` ${diet} `) || rest.includes(` ${diet},`) || rest.includes(` ${diet}.`)) {
      groups.forEach(addTerm);
      rest = rest.replaceAll(diet, " ");
    }
  }
  // "dairy-free", "gluten free", "nut free"
  rest = rest.replace(/\b([a-z]+)[\s-]free\b/g, (_, term) => { addTerm(term); return " "; });
  // "no cheese", "without mushrooms or olives", "not spicy", "hold the onions", "allergic to nuts"
  rest = rest.replace(
    /\b(?:no|without|not|avoid|avoiding|hold the|minus|except|allergic to|allergy to|cant have|cannot have|dont like|hate)\s+([a-z][a-z\s-]*?)(?=[,.;!?]|\bbut\b|\bwith\b|\bplease\b|$)/g,
    (_, list) => {
      list.split(/\s*(?:,|\band\b|\bor\b|\bnor\b|&)\s*/).forEach(addTerm);
      return " ";
    }
  );

  const words = rest.split(/[^a-z-]+/).filter((w) => w.length > 2 && !STOP.has(w));
  return { exclude: [...excluded].map(([label, list]) => ({ label, words: list })), words };
}

// Things whose names contain a ruled-out word but aren't it.
const LOOKALIKES = /\b(?:(?:peanut|almond|cashew|nut|seed|apple) butter|butter ?beans?|cream of tartar|coconut (?:milk|cream|yog(?:h)?urt)|(?:oat|almond|soy|soya|rice|plant|coconut) (?:milk|cream|yog(?:h)?urt)|vegan (?:cheese|butter|mayo(?:nnaise)?)|dairy[- ]free \w+|egg[- ]free \w+|gluten[- ]free \w+)\b/g;

// The rule-outs a recipe breaks, by label: [] means it's fine.
// Whole words only: "nut" doesn't match "nutmeg" or "coconut", "egg" doesn't match "eggplant".
export function breaks(draft, exclude) {
  const hay = ` ${[draft.title, ...(draft.ingredients || [])].join(" \n ").toLowerCase()} `.replace(LOOKALIKES, " ");
  const has = (w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|es)?(?![a-z])`).test(hay);
  return exclude.filter(({ words }) => words.some(has)).map(({ label }) => label);
}

// For the prompt sent to Claude: "cheese (including parmesan, cheddar, ...)".
export function describe(exclude) {
  return exclude.map(({ label, words }) => (words.length > 1 ? `${label} (including ${words.filter((w) => w !== label).slice(0, 12).join(", ")})` : label)).join("; ");
}
