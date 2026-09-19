// Client-side only. No backend, no account system — the team lives in this
// browser's localStorage. Export/Import as JSON is the only backup or
// multi-device path for now.
const TeamStore = (() => {
  const KEY = 'vgc-calc:my-team';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Could not read saved team, starting empty.', e);
      return [];
    }
  }

  function save(team) {
    localStorage.setItem(KEY, JSON.stringify(team));
  }

  function addOrUpdate(team, index, mon) {
    const next = [...team];
    next[index] = mon;
    save(next);
    return next;
  }

  function remove(team, index) {
    const next = team.filter((_, i) => i !== index);
    save(next);
    return next;
  }

  function exportJson(team) {
    return JSON.stringify(team, null, 2);
  }

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
  //   statPoints: { hp: 4, atk: 32, def: 4, spa: 0, spd: 20, spe: 28 },
  //   mega: '',             // '' or a Mega forme name from regulation-mc.json's megas map, e.g. 'Charizard-Mega-Y'
  //   moves: ['Wood Hammer', 'Fake Out', 'U-turn', 'Grassy Glide'],
  // }

  return { load, save, addOrUpdate, remove, exportJson, importJson };
})();
