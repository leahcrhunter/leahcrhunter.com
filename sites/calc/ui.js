const UI = (() => {
  const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  // Natures grouped by the stat they raise, in the order the stat columns
  // appear elsewhere. The stored value is still the nature name (that's
  // what the engine wants); the dropdown shows the effect. Hardy stands in
  // for all five neutral natures.
  const NATURES = [
    ['Hardy', null, null],
    ['Lonely', 'Atk', 'Def'], ['Adamant', 'Atk', 'SpA'], ['Naughty', 'Atk', 'SpD'], ['Brave', 'Atk', 'Spe'],
    ['Bold', 'Def', 'Atk'], ['Impish', 'Def', 'SpA'], ['Lax', 'Def', 'SpD'], ['Relaxed', 'Def', 'Spe'],
    ['Modest', 'SpA', 'Atk'], ['Mild', 'SpA', 'Def'], ['Rash', 'SpA', 'SpD'], ['Quiet', 'SpA', 'Spe'],
    ['Calm', 'SpD', 'Atk'], ['Gentle', 'SpD', 'Def'], ['Careful', 'SpD', 'SpA'], ['Sassy', 'SpD', 'Spe'],
    ['Timid', 'Spe', 'Atk'], ['Hasty', 'Spe', 'Def'], ['Jolly', 'Spe', 'SpA'], ['Naive', 'Spe', 'SpD'],
  ];
  const NEUTRAL_NATURES = ['Hardy', 'Docile', 'Serious', 'Bashful', 'Quirky'];

  function natureLabel(name) {
    const entry = NATURES.find(([n]) => n === name);
    if (entry && entry[1]) return `+${entry[1]} −${entry[2]} (${name})`;
    if (NEUTRAL_NATURES.includes(name)) return `Neutral (${name})`;
    return name;
  }

  const BOOST_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];
  const STATUSES = [['', 'Healthy'], ['brn', 'Burned'], ['par', 'Paralyzed'], ['psn', 'Poisoned'],
    ['tox', 'Badly poisoned'], ['slp', 'Asleep'], ['frz', 'Frozen']];

  // Battle state lives on the Matchup tab and isn't persisted -- it's what's
  // true right now in this fight, not part of the team build.
  function battleStateDefaults() {
    return { status: '', boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
  }

  function statusOptions(selected) {
    return STATUSES.map(([v, label]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${label}</option>`).join('');
  }

  function monDefaults() {
    return {
      species: '', item: '', ability: '', nature: 'Hardy',
      statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      mega: '', moves: ['', '', '', ''],
    };
  }

  function natureOptions(selected) {
    // A saved neutral nature other than Hardy is kept rather than remapped.
    const names = NATURES.map(([n]) => n);
    if (selected && !names.includes(selected)) names.unshift(selected);
    return names.map((n) => `<option value="${n}" ${n === selected ? 'selected' : ''}>${natureLabel(n)}</option>`).join('');
  }

  // Legal species for the current regulation, as @smogon/calc names
  // (e.g. "Raichu-Alola"). Set once from main.js after the regulation
  // JSON loads; every species <select> is built from it.
  let speciesList = [];
  function setSpeciesList(list) { speciesList = list.slice(); }

  const FORM_WORDS = {
    Alola: 'Alolan', Galar: 'Galarian', Hisui: 'Hisuian', Paldea: 'Paldean',
    F: 'Female', Eternal: 'Eternal Flower', 'Low-Key': 'Low Key',
  };
  const NO_SPLIT = new Set(['Kommo-o']);

  // "Tauros-Paldea-Combat" -> "Tauros (Paldean, Combat)"; plain names unchanged.
  function speciesLabel(name) {
    if (NO_SPLIT.has(name)) return name;
    const dash = name.indexOf('-');
    if (dash === -1) return name;
    const base = name.slice(0, dash);
    let rest = name.slice(dash + 1);
    if (FORM_WORDS[rest]) return `${base} (${FORM_WORDS[rest]})`;
    const parts = rest.split('-').map((w) => FORM_WORDS[w] || w);
    return `${base} (${parts.join(', ')})`;
  }

  // `selected` is kept as an option even if it isn't in the legal list
  // (an old saved team, or a species/item from a previous regulation) so
  // the dropdown never silently changes what's stored.
  function optionsFor(list, selected, placeholder, label) {
    const names = list.includes(selected) || !selected ? list : [selected, ...list];
    const opts = names.map((n) =>
      `<option value="${n}" ${n === selected ? 'selected' : ''}>${label(n)}</option>`);
    return `<option value="" ${selected ? '' : 'selected'}>${placeholder}</option>${opts.join('')}`;
  }

  function speciesOptions(selected) {
    return optionsFor(speciesList, selected, '— choose —', speciesLabel);
  }

  // Held items legal in the current regulation (Champions restricts the
  // pool heavily, so this is short). Same lifecycle as speciesList.
  let itemList = [];
  function setItemList(list) { itemList = list.slice(); }

  function itemOptions(selected) {
    return optionsFor(itemList, selected, '— none —', (n) => n);
  }

  // Champions learnsets: { speciesName: [moveName, ...] }. Set from main.js
  // after learnsets-mc.json loads. Species missing from it (a scrape gap)
  // fall back to whatever usage stats know, so the dropdown is never empty
  // for a species we have any data on.
  let learnsets = {};
  function setLearnsets(map) { learnsets = map; }

  function movesFor(species) {
    const known = learnsets[species];
    if (known && known.length) return known;
    return UsageStats.suggestedMoves(species).map((m) => m.name).sort();
  }

  function moveOptions(species, selected) {
    return optionsFor(movesFor(species), selected, '— none —', (n) => n);
  }

  // "Not Mega" plus one option per forme. `selected` is a forme name.
  function megaOptions(species, selected) {
    const formes = ChampionsDex.megaFormesFor(species);
    return `<option value="">Not Mega</option>${formes.map((f) =>
      `<option value="${f}" ${f === selected ? 'selected' : ''}>${ChampionsDex.megaLabel(f)}</option>`).join('')}`;
  }

  function moveSelects(species, moves) {
    return [0, 1, 2, 3].map((i) =>
      `<select class="f-move" data-slot="${i}">${moveOptions(species, moves[i] || '')}</select>`).join('');
  }

  // Top-4 moves by usage for a species, for pre-filling a fresh slot.
  function popularMoves(species) {
    return UsageStats.suggestedMoves(species).slice(0, 4).map((m) => m.name);
  }

  // Called when a card's species changes: rebuild the move dropdowns for
  // the new learnset, pre-filled with the popular set, and fill in the
  // most-used ability if the field is empty. Everything stays editable.
  function refreshCardForSpecies(cardEl, species) {
    const moves = species ? popularMoves(species) : [];
    cardEl.querySelector('.moves-grid').innerHTML = moveSelects(species, moves);
    cardEl.querySelector('.f-mega').innerHTML = megaOptions(species, '');
    cardEl.querySelector('.mega-toggle').classList.toggle('hidden', !ChampionsDex.isMegaEligible(species));
    const abilityEl = cardEl.querySelector('.f-ability');
    if (!abilityEl.value.trim()) {
      const top = UsageStats.suggestedAbilities(species)[0];
      if (top) abilityEl.value = top.name;
    }
  }

  function renderMonCard(mon, index) {
    const m = mon || monDefaults();
    const megaShown = ChampionsDex.isMegaEligible(m.species);
    return `
      <div class="mon-card" data-index="${index}">
        <h3>Slot ${index + 1}</h3>
        <label>Species
          <select class="f-species">${speciesOptions(m.species)}</select>
        </label>
        <label>Item
          <select class="f-item">${itemOptions(m.item)}</select>
        </label>
        <label>Ability
          <input type="text" class="f-ability" value="${m.ability}">
        </label>
        <label>Nature
          <select class="f-nature">${natureOptions(m.nature)}</select>
        </label>
        <div class="stat-points-grid">
          ${STAT_KEYS.map((k) => `
            <label>${k.toUpperCase()}
              <input type="number" min="0" max="${StatPoints.MAX_POINTS}" class="f-sp" data-stat="${k}" value="${m.statPoints[k]}">
            </label>`).join('')}
        </div>
        <label class="mega-toggle ${megaShown ? '' : 'hidden'}">Mega Evolution
          <select class="f-mega">${megaOptions(m.species, m.mega)}</select>
        </label>
        <div class="moves-grid">
          ${moveSelects(m.species, m.moves)}
        </div>
        <div class="card-footer">
          <button class="btn-danger f-clear" type="button">Clear slot</button>
          <button class="btn-secondary f-save" type="button">Save</button>
        </div>
      </div>`;
  }

  function renderTeamSlots(team) {
    const container = document.getElementById('team-slots');
    const slots = [0, 1, 2, 3, 4, 5].map((i) => renderMonCard(team[i], i));
    container.innerHTML = slots.join('');
  }

  function readMonFromCard(cardEl) {
    const statPoints = {};
    cardEl.querySelectorAll('.f-sp').forEach((input) => {
      statPoints[input.dataset.stat] = Math.max(0, Math.min(StatPoints.MAX_POINTS, Number(input.value) || 0));
    });
    const moves = [...cardEl.querySelectorAll('.f-move')].map((i) => i.value.trim()).filter(Boolean);
    return {
      species: cardEl.querySelector('.f-species').value.trim(),
      item: cardEl.querySelector('.f-item').value.trim(),
      ability: cardEl.querySelector('.f-ability').value.trim(),
      nature: cardEl.querySelector('.f-nature').value,
      statPoints,
      mega: cardEl.querySelector('.f-mega').value,
      moves,
    };
  }

  // The matchup board: one row per filled slot, rendered when the team
  // changes. The left column holds the identity and the per-matchup
  // battle-state controls; the Deals / Takes columns are filled in
  // separately by updateMatchupResults so re-running the calc never
  // rebuilds (and un-focuses) the inputs.
  // team: the saved team; battleState: { [slotIndex]: { status, boosts } }.
  function renderMatchupBoard(team, battleState) {
    const container = document.getElementById('matchup-board');
    const rows = team.map((mon, index) => {
      if (!mon || !mon.species) return '';
      const st = battleState[index] || battleStateDefaults();
      const meta = [mon.item, mon.ability].filter(Boolean).join(' · ');
      return `
        <div class="mon-row" data-index="${index}">
          <div class="mon-id">
            <div class="mon-name">${mon.mega ? ChampionsDex.megaLabel(mon.mega) : speciesLabel(mon.species)}</div>
            ${meta ? `<div class="mon-meta">${meta}</div>` : ''}
            <div class="mon-speed"></div>
            <div class="mon-state">
              <select class="bs-status" aria-label="Status">${statusOptions(st.status)}</select>
              <div class="stage-grid">
                ${BOOST_KEYS.map((k) => `<label>${k.charAt(0).toUpperCase() + k.slice(1).replace('sp', 'Sp')}<input type="number" class="bs-boost" data-stat="${k}" min="-6" max="6" value="${st.boosts[k]}"></label>`).join('')}
              </div>
            </div>
          </div>
          <div class="mon-col mon-deals"><h4>Deals</h4><div class="mon-col-body"></div></div>
          <div class="mon-col mon-takes"><h4>Takes</h4><div class="mon-col-body"></div></div>
        </div>`;
    }).filter(Boolean);
    container.innerHTML = rows.length ? rows.join('') : '<p class="hint">Save a Pokémon on the My Team tab first.</p>';
  }

  function moveList(moves, emptyText) {
    if (!moves.length) return `<p class="hint">${emptyText}</p>`;
    return `<table class="move-table">${moves.map((mv) =>
      `<tr><td>${mv.move}</td><td>${pctRangeCell(mv.minPct, mv.maxPct, mv.desc, mv.category)}</td></tr>`).join('')}</table>`;
  }

  // results: { [slotIndex]: { deals: [...], takes: [...], speed: row } } or
  // null to clear (no opponent chosen yet). opponentSpecies is the calc
  // name; speedSummary is the object from CalcEngine.speedComparison.
  function updateMatchupResults(results, opponentSpecies, speedSummary) {
    const vs = document.getElementById('vs-name');
    const summary = document.getElementById('speed-summary');
    vs.textContent = opponentSpecies ? `vs ${speciesLabel(opponentSpecies)}` : '';
    if (!results) {
      summary.classList.add('hidden');
      document.querySelectorAll('#matchup-board .mon-row').forEach((row) => {
        row.querySelector('.mon-speed').innerHTML = '';
        row.querySelector('.mon-deals .mon-col-body').innerHTML = '<p class="hint">Pick an opponent above.</p>';
        row.querySelector('.mon-takes .mon-col-body').innerHTML = '<p class="hint">Pick an opponent above.</p>';
      });
      return;
    }
    const oppLabel = speciesLabel(opponentSpecies);
    summary.innerHTML = `${oppLabel}'s estimated speed: <span class="pct-range">${speedSummary.oppMin}–${speedSummary.oppMax}</span>
      (0 Spe Stat Points, neutral nature → max Stat Points, +Spe nature; their item, status, stages and field applied). Ties are a coin flip.${speedSummary.trickRoom ? ' <strong>Trick Room: slower moves first.</strong>' : ''}`;
    summary.classList.remove('hidden');
    document.querySelectorAll('#matchup-board .mon-row').forEach((row) => {
      const r = results[Number(row.dataset.index)];
      if (!r) return;
      row.querySelector('.mon-speed').innerHTML = `<span class="speed-num">Spe ${r.speed.speed}</span> · ${speedVerdictCell(r.speed)}`;
      row.querySelector('.mon-deals .mon-col-body').innerHTML = moveList(r.deals, 'No moves saved for this Pokémon.');
      row.querySelector('.mon-takes .mon-col-body').innerHTML = moveList(r.takes, 'No opponent moves ticked.');
    });
  }

  function readBattleStateRow(rowEl) {
    const boosts = {};
    rowEl.querySelectorAll('.bs-boost').forEach((input) => {
      boosts[input.dataset.stat] = clampBoost(input.value);
    });
    return { status: rowEl.querySelector('.bs-status').value, boosts };
  }

  function clampBoost(value) {
    return Math.max(-6, Math.min(6, Math.trunc(Number(value) || 0)));
  }

  function renderMoveSuggestions(suggestions, checked, extraMoves) {
    const container = document.getElementById('opp-move-suggestions');
    const known = suggestions.map((s) => `
      <label class="move-chip">
        <input type="checkbox" class="opp-move-check" value="${s.name}" ${checked.has(s.name) ? 'checked' : ''}>
        ${s.name} <span class="usage">${Math.round(s.usage * 100)}%</span>
      </label>`);
    const added = [...extraMoves].filter((m) => !suggestions.some((s) => s.name === m)).map((m) => `
      <label class="move-chip">
        <input type="checkbox" class="opp-move-check" value="${m}" checked>
        ${m} <span class="usage">added</span>
      </label>`);
    container.innerHTML = known.concat(added).join('') || '<p class="hint">No usage data for this species yet — add moves by hand below.</p>';
  }

  function pctRangeCell(minPct, maxPct, desc, category) {
    if (maxPct === 0) {
      const label = category === 'Status' ? 'status' : 'immune';
      return `<span class="pct-range none" title="${desc || ''}">${label}</span>`;
    }
    const cls = maxPct >= 100 ? 'ko' : (maxPct <= 20 ? 'safe' : '');
    const title = desc ? ` title="${desc.replace(/"/g, '&quot;')}"` : '';
    return `<span class="pct-range ${cls}"${title}>${minPct}–${maxPct}%</span>`;
  }

  function speedVerdictCell(row) {
    const label = { first: 'Moves first', second: 'Moves second', depends: 'Depends on their spread' }[row.verdict];
    const cls = { first: 'good', second: 'bad', depends: 'mixed' }[row.verdict];
    const detail = row.detail ? `<div class="hint">${row.detail}</div>` : '';
    return `<span class="verdict ${cls}">${label}</span>${detail}`;
  }

  // Brief "Saved ✓" on the button so a save is visibly acknowledged.
  function flashSaved(btn) {
    const label = btn.textContent;
    btn.textContent = 'Saved ✓';
    btn.classList.add('is-saved');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('is-saved'); }, 1400);
  }

  return {
    flashSaved,
    renderTeamSlots, readMonFromCard, renderMoveSuggestions, monDefaults,
    renderMatchupBoard, updateMatchupResults, readBattleStateRow, battleStateDefaults, clampBoost,
    setSpeciesList, speciesOptions, speciesLabel, setItemList, itemOptions,
    setLearnsets, movesFor, moveOptions, refreshCardForSpecies,
  };
})();
