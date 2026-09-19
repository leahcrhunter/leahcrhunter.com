// Champions dex layer.
//
// The vendored @smogon/calc engine (smogon-calc.bundle.js) ships mainline
// data, and as of this bundle it knows every Champions Mega forme. Two
// things live here on top of it:
//
//   1. Which species can Mega Evolve, and into what (`megas`, from
//      regulation-mc.json — e.g. Charizard -> Charizard-Mega-X / -Mega-Y).
//   2. A small correction "diff" (champions-dex-overrides.json) for the
//      handful of formes whose Champions data differs from the engine's,
//      applied at Pokemon-construction time via @smogon/calc's own
//      `options.ability` / `options.overrides` fields rather than by
//      mutating the vendored dex.

const ChampionsDex = (() => {
  let overrides = {};
  let megas = {};

  async function load(url = 'champions-dex-overrides.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load Champions dex overrides from ${url}`);
    overrides = await res.json();
    return overrides;
  }

  // { baseSpecies: [formeName, ...] }
  function setMegas(map) { megas = map || {}; }

  function megaFormesFor(speciesName) { return megas[speciesName] || []; }
  function isMegaEligible(speciesName) { return megaFormesFor(speciesName).length > 0; }

  // "Charizard-Mega-X" -> "Mega Charizard X", "Meowstic-F-Mega" -> "Mega Meowstic (Female)".
  function megaLabel(forme) {
    const m = forme.match(/^(.+?)(-F|-M)?-Mega(?:-([XYZ]))?$/);
    if (!m) return forme;
    const sex = m[2] === '-F' ? ' (Female)' : '';
    return `Mega ${m[1]}${m[3] ? ` ${m[3]}` : ''}${sex}`;
  }

  // Builds a calc.Pokemon for the given species. `config` is { level, item,
  // ability, nature, evs, ivs, mega, status, boosts }. `mega` is the forme
  // name to use (e.g. "Salamence-Mega"), or falsy for the base forme; a
  // legacy `true` means the species' first forme. A Mega's ability is fixed
  // by the forme, so the configured ability is ignored in that case and the
  // engine's (or the override's) is used. `status` is a calc status id and
  // `boosts` is { atk, def, spa, spd, spe } from -6 to +6.
  function buildPokemon(gen, speciesName, config = {}) {
    let name = speciesName;
    let ability = config.ability;

    if (config.mega) {
      const formes = megaFormesFor(speciesName);
      name = config.mega === true ? formes[0] : config.mega;
      if (!name || !formes.includes(name)) {
        throw new Error(`${speciesName} has no Mega forme "${config.mega}" in Regulation M-C.`);
      }
      ability = undefined;
    }

    const ov = overrides[name];
    let overrideBlock;
    if (ov && typeof ov === 'object') {
      if (ov.ability) ability = ov.ability;
      if (ov.types || ov.baseStats) overrideBlock = { types: ov.types, baseStats: ov.baseStats };
    }

    return new window.calc.Pokemon(gen, name, {
      level: config.level ?? 50,
      item: config.item,
      ability,
      nature: config.nature,
      evs: config.evs,
      ivs: config.ivs,
      status: config.status || undefined,
      boosts: config.boosts,
      overrides: overrideBlock,
    });
  }

  return { load, setMegas, megaFormesFor, isMegaEligible, megaLabel, buildPokemon };
})();
