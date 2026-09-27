// Client-side only. No backend, no account system — the teams live in this
// browser's localStorage. Export/Import as JSON is the only backup or
// multi-device path for now.
//
// Three team slots, one of them "active" (the one the My Team tab edits and
// the Matchup tab calcs against). Stored shape:
//   { active: 0, teams: [[mon, ...], [mon, ...], [mon, ...]] }
const TeamStore = (() => {
  const KEY = 'vgc-calc:teams';
  const LEGACY_KEY = 'vgc-calc:my-team';   // single team, before multi-team
  const TEAM_COUNT = 3;

  function emptyState() {
    return { active: 0, teams: Array.from({ length: TEAM_COUNT }, () => []) };
  }

  function normalise(state) {
    const out = emptyState();
    if (state && Array.isArray(state.teams)) {
      state.teams.slice(0, TEAM_COUNT).forEach((t, i) => { out.teams[i] = Array.isArray(t) ? t : []; });
      const a = Number(state.active);
      out.active = a >= 0 && a < TEAM_COUNT ? a : 0;
    }
    return out;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalise(JSON.parse(raw));
      // Carry a pre-multi-team save over into Team 1.
      const legacy = localStorage.getItem(LEGACY_KEY);
      const state = emptyState();
      if (legacy) state.teams[0] = JSON.parse(legacy) || [];
      return state;
    } catch (e) {
      console.error('Could not read saved teams, starting empty.', e);
      return emptyState();
    }
  }

  function saveState(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  // The active team's array of mons.
  function load() {
    const state = loadState();
    return state.teams[state.active];
  }

  function activeIndex() {
    return loadState().active;
  }

  // Replace the active team wholesale (the My Team tab's "Save team").
  function save(team) {
    const state = loadState();
    state.teams[state.active] = team;
    saveState(state);
  }

  // Make team `index` active and return its mons.
  function setActive(index) {
    const state = loadState();
    state.active = index;
    saveState(state);
    return state.teams[index];
  }

  // Short per-team summaries for the switcher: [{ count }, ...].
  function summaries() {
    return loadState().teams.map((t) => ({ count: t.filter((m) => m && m.species).length }));
  }

  function exportJson(team) {
    return JSON.stringify(team, null, 2);
  }

  // Imports into the active team.
  function importJson(jsonText) {
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of Pokemon.');
    save(parsed);
    return parsed;
  }

  // Shape of one team member, for reference:
  // {
  //   species: 'Rillaboom',
  //   item: 'Assault Vest',
  //   ability: 'Grassy Surge',
  //   nature: 'Adamant',
  //   statPoints: { hp: 4, atk: 32, def: 4, spa: 0, spd: 20, spe: 6 },   // each ≤ 32, total ≤ 66
  //   mega: '',             // '' or a Mega forme name from regulation-mc.json's megas map, e.g. 'Charizard-Mega-Y'
  //   moves: ['Wood Hammer', 'Fake Out', 'U-turn', 'Grassy Glide'],
  // }

  return { TEAM_COUNT, load, save, activeIndex, setActive, summaries, exportJson, importJson };
})();
