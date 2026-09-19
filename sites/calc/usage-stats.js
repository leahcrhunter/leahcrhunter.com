// Loads the (periodically refreshed, offline) usage-stats bundle and
// exposes suggested moves/abilities for a given species. See README.md
// "Refreshing usage stats" for how usage-mc.json is regenerated.
const UsageStats = (() => {
  let data = { species: {} };

  async function load(url = 'usage-mc.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load usage stats from ${url}`);
    data = await res.json();
    return data;
  }

  // A species' Mega forms are tracked separately upstream (e.g.
  // "Salamence-Mega"), and for a Pokémon that's usually Mega'd that's
  // where the data is. Merge base + Mega entries, keeping the higher usage
  // for anything that appears in both.
  // `includeMega` is off for abilities: Champions-original Megas have
  // abilities the engine doesn't know, and they're only valid post-Mega.
  // A form with no data of its own (Squawkabilly-Blue, Lycanroc-Dusk…)
  // borrows its base species' entry.
  function merged(speciesName, field, includeMega) {
    let keys = Object.keys(data.species).filter((k) => k === speciesName || (includeMega && k.startsWith(`${speciesName}-Mega`)));
    if (!keys.length && speciesName.includes('-') && speciesName !== 'Kommo-o') {
      return merged(speciesName.slice(0, speciesName.indexOf('-')), field, includeMega);
    }
    const best = new Map();
    keys.forEach((k) => (data.species[k][field] || []).forEach(({ name, usage }) => {
      if (!best.has(name) || best.get(name) < usage) best.set(name, usage);
    }));
    return [...best].map(([name, usage]) => ({ name, usage })).sort((a, b) => b.usage - a.usage);
  }

  // Returns [{ name, usage }] sorted by usage desc, or [] if we have no
  // data for that species yet — the UI still offers the full learnset.
  function suggestedMoves(speciesName) { return merged(speciesName, 'moves', true); }
  function suggestedAbilities(speciesName) { return merged(speciesName, 'abilities', false); }

  return { load, suggestedMoves, suggestedAbilities };
})();
