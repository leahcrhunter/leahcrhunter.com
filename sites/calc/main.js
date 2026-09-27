(async function () {
  let team = TeamStore.load();
  // True when the My Team cards have edits that "Save team" hasn't stored.
  let teamDirty = false;
  // Per-slot { status, boosts } for the current matchup. Not persisted.
  let battleState = {};
  let checkedOppMoves = new Set();
  let extraOppMoves = new Set();
  let regulation = { legal_species: [] };

  await ChampionsDex.load();
  await UsageStats.load();
  try {
    const res = await fetch('regulation-mc.json');
    regulation = await res.json();
  } catch (e) {
    console.warn('No regulation data loaded — species dropdowns will be empty.', e);
  }

  try {
    const res = await fetch('learnsets-mc.json');
    UI.setLearnsets((await res.json()).species || {});
  } catch (e) {
    console.warn('No learnset data loaded — move dropdowns will fall back to usage stats.', e);
  }

  UI.setSpeciesList(regulation.legal_species);
  UI.setItemList(regulation.legal_items || []);
  ChampionsDex.setMegas(regulation.megas || {});
  // Teams saved before Megas were selectable stored `mega: true`.
  const migrateMegas = (t) => t.map((m) => (m && m.mega === true ? { ...m, mega: ChampionsDex.megaFormesFor(m.species)[0] || '' } : m));
  team = migrateMegas(team);
  document.getElementById('opp-species').innerHTML = UI.speciesOptions('');
  document.getElementById('opp-item').innerHTML = UI.itemOptions('');
  document.getElementById('opp-boosts').innerHTML = UI.boostButtons('opp-boost', {});

  UI.renderTeamSwitcher(TeamStore.summaries(), TeamStore.activeIndex());
  UI.renderTeamSlots(team);
  UI.renderMatchupBoard(team, battleState);   // results filled by the initial recalc() below

  const saveTeamBtn = document.getElementById('save-team-btn');
  function setDirty(dirty) {
    teamDirty = dirty;
    saveTeamBtn.classList.toggle('has-changes', dirty);
  }

  // Whole team (re)loaded: new team switched to, or an import.
  function showTeam(newTeam) {
    team = migrateMegas(newTeam);
    battleState = {};
    setDirty(false);
    UI.renderTeamSwitcher(TeamStore.summaries(), TeamStore.activeIndex());
    UI.renderTeamSlots(team);
    UI.renderMatchupBoard(team, battleState); recalc();
  }

  // ---------- Team switcher ----------
  document.getElementById('team-switcher').addEventListener('click', (e) => {
    const btn = e.target.closest('.team-pick');
    if (!btn) return;
    const index = Number(btn.dataset.team);
    if (index === TeamStore.activeIndex()) return;
    if (teamDirty && !confirm('You have unsaved changes to this team. Switch anyway and lose them?')) return;
    showTeam(TeamStore.setActive(index));
  });

  // ---------- Tabs ----------
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ---------- Team slots (event delegation) ----------
  const slotsContainer = document.getElementById('team-slots');

  slotsContainer.addEventListener('input', (e) => {
    setDirty(true);
    if (e.target.classList.contains('f-sp')) {
      UI.enforceStatCap(e.target.closest('.mon-card'), e.target);
      return;
    }
    if (!e.target.classList.contains('f-species')) return;
    const card = e.target.closest('.mon-card');
    const species = e.target.value.trim();
    card.querySelector('.f-ability').value = '';   // abilities are per-species; let the popular one fill in
    UI.refreshCardForSpecies(card, species);
  });

  slotsContainer.addEventListener('change', () => setDirty(true));

  // Clear only resets the card; nothing is stored until Save team.
  slotsContainer.addEventListener('click', (e) => {
    if (!e.target.classList.contains('f-clear')) return;
    const card = e.target.closest('.mon-card');
    card.outerHTML = UI.renderMonCard(null, Number(card.dataset.index));
    setDirty(true);
  });

  // Save all six cards at once. An empty species means an empty slot.
  saveTeamBtn.addEventListener('click', () => {
    const cards = [...slotsContainer.querySelectorAll('.mon-card')];
    team = cards.map((card) => {
      const mon = UI.readMonFromCard(card);
      return mon.species ? mon : null;
    });
    TeamStore.save(team);
    // Battle state belongs to a slot's Pokémon; drop it where that changed.
    Object.keys(battleState).forEach((i) => { if (!team[i]) delete battleState[i]; });
    setDirty(false);
    UI.renderTeamSwitcher(TeamStore.summaries(), TeamStore.activeIndex());
    UI.renderMatchupBoard(team, battleState); recalc();
    UI.flashSaved(saveTeamBtn);
  });

  // ---------- Export / Import ----------
  const ieArea = document.getElementById('import-export-area');
  document.getElementById('export-team-btn').addEventListener('click', () => {
    ieArea.value = TeamStore.exportJson(team);
    ieArea.classList.remove('hidden');
  });
  document.getElementById('import-team-btn').addEventListener('click', () => {
    if (ieArea.classList.contains('hidden')) {
      ieArea.value = '';
      ieArea.classList.remove('hidden');
      return;
    }
    try {
      showTeam(TeamStore.importJson(ieArea.value));
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });

  // ---------- Opponent form ----------
  const oppSpeciesInput = document.getElementById('opp-species');
  const oppMegaWrap = document.getElementById('opp-mega-wrap');

  // Real usage data lists every move ever seen on a species (30+ for a
  // common one). Chip the 8 most used and pre-tick a realistic four; the
  // learnset dropdown below covers anything else.
  function refreshMoveSuggestions() {
    const species = oppSpeciesInput.value.trim();
    const suggestions = UsageStats.suggestedMoves(species).slice(0, 8);
    if (checkedOppMoves.size === 0) {
      suggestions.slice(0, 4).forEach((s) => checkedOppMoves.add(s.name));
    }
    UI.renderMoveSuggestions(suggestions, checkedOppMoves, extraOppMoves);
  }

  oppSpeciesInput.addEventListener('input', () => {
    const species = oppSpeciesInput.value.trim();
    oppMegaWrap.classList.toggle('hidden', !ChampionsDex.isMegaEligible(species));
    document.getElementById('opp-mega').innerHTML = `<option value="">Not Mega</option>${ChampionsDex.megaFormesFor(species).map((f) =>
      `<option value="${f}">${ChampionsDex.megaLabel(f)}</option>`).join('')}`;
    checkedOppMoves = new Set();
    extraOppMoves = new Set();
    refreshMoveSuggestions();
    document.getElementById('opp-move-add').innerHTML = UI.moveOptions(species, '');
  });

  document.getElementById('opp-move-suggestions').addEventListener('change', (e) => {
    if (!e.target.classList.contains('opp-move-check')) return;
    if (e.target.checked) checkedOppMoves.add(e.target.value);
    else checkedOppMoves.delete(e.target.value);
  });

  document.getElementById('opp-move-add-btn').addEventListener('click', () => {
    const input = document.getElementById('opp-move-add');
    const move = input.value;
    if (!move) return;
    extraOppMoves.add(move);
    checkedOppMoves.add(move);
    input.value = '';
    refreshMoveSuggestions();
  });

  // ---------- Battle state (my team, on the matchup board) ----------
  document.getElementById('matchup-board').addEventListener('change', (e) => {
    const row = e.target.closest('.mon-row[data-index]');
    if (!row) return;
    battleState[Number(row.dataset.index)] = UI.readBattleStateRow(row);
  });

  // Boost buttons (both sides) don't fire `change`, so they save their
  // row's state and recalc themselves.
  document.getElementById('tab-matchup').addEventListener('click', (e) => {
    const btn = e.target.closest('.boost-step');
    if (!btn) return;
    UI.stepBoost(btn);
    const row = btn.closest('.mon-row[data-index]');
    if (row) battleState[Number(row.dataset.index)] = UI.readBattleStateRow(row);
    recalc();
  });

  // ---------- Opponent battle state ----------
  function readOppBoosts() {
    return UI.readBoosts(document.getElementById('opp-boosts'), '.opp-boost');
  }

  // ---------- Field ----------
  function buildField(direction) {
    // direction: 'myAttacks' (defenderSide = opponent's screens) or
    // 'oppAttacks' (defenderSide = my screens).
    const myScreens = {
      isReflect: document.getElementById('field-my-reflect').checked,
      isLightScreen: document.getElementById('field-my-lightscreen').checked,
      isTailwind: document.getElementById('field-my-tailwind').checked,
    };
    const oppScreens = {
      isReflect: document.getElementById('field-opp-reflect').checked,
      isLightScreen: document.getElementById('field-opp-lightscreen').checked,
      isTailwind: document.getElementById('field-opp-tailwind').checked,
    };
    const base = {
      gameType: 'Doubles',
      weather: document.getElementById('field-weather').value || undefined,
      terrain: document.getElementById('field-terrain').value || undefined,
    };
    if (direction === 'myAttacks') {
      base.attackerSide = myScreens;
      base.defenderSide = oppScreens;
    } else {
      base.attackerSide = oppScreens;
      base.defenderSide = myScreens;
    }
    return new window.calc.Field(base);
  }

  // ---------- Run matchup ----------
  function monToCalcConfig(mon, index) {
    const evs = {};
    Object.entries(mon.statPoints || {}).forEach(([k, v]) => { evs[k] = StatPoints.statPointsToEv(v); });
    const state = battleState[index] || UI.battleStateDefaults();
    return {
      config: {
        level: 50,
        item: mon.item || undefined,
        ability: mon.ability || undefined,
        nature: mon.nature || 'Hardy',
        evs,
        ivs: StatPoints.ivsForCalc(),
        mega: mon.mega || undefined,
        status: state.status,
        boosts: state.boosts,
      },
      species: mon.species,
      moves: (mon.moves || []).filter(Boolean),
    };
  }

  // ---------- Live matchup ----------
  // Runs on every change inside the Matchup tab. Results are keyed by
  // slot index so they land on the right board row.
  const errorEl = document.getElementById('calc-error');
  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.classList.toggle('hidden', !msg);
  }

  function recalc() {
    const filledTeam = team.map((m, index) => ({ mon: m, index })).filter(({ mon }) => mon && mon.species);
    const opponentSpecies = oppSpeciesInput.value.trim();
    if (filledTeam.length === 0 || !opponentSpecies) {
      UI.updateMatchupResults(null, opponentSpecies, null);
      showError('');
      return;
    }

    const myTeamForEngine = filledTeam.map(({ mon, index }) => {
      const c = monToCalcConfig(mon, index);
      return { species: c.species, config: c.config, moves: c.moves };
    });

    const opponentConfig = {
      level: 50,
      item: document.getElementById('opp-item').value || undefined,
      ability: document.getElementById('opp-ability').value.trim() || undefined,
      mega: document.getElementById('opp-mega').value || undefined,
      status: document.getElementById('opp-status').value,
      boosts: readOppBoosts(),
    };

    try {
      const myVsOpp = CalcEngine.myMovesVsOpponent(
        myTeamForEngine,
        { species: opponentSpecies, config: opponentConfig },
        buildField('myAttacks'),
      );
      const oppVsMy = CalcEngine.opponentMovesVsMyTeam(
        opponentSpecies, opponentConfig, [...checkedOppMoves], myTeamForEngine, buildField('oppAttacks'),
      );
      const speed = CalcEngine.speedComparison(
        myTeamForEngine,
        { species: opponentSpecies, config: opponentConfig },
        buildField('oppAttacks'),
        document.getElementById('field-trick-room').checked,
      );

      // The engine returns arrays in filledTeam order; key them by slot.
      const results = {};
      filledTeam.forEach(({ index }, i) => {
        results[index] = { deals: myVsOpp[i].moves, takes: oppVsMy[i].moves, speed: speed.rows[i] };
      });
      UI.updateMatchupResults(results, opponentSpecies, speed);
      showError('');
    } catch (err) {
      console.error(err);
      showError(`Calc error: ${err.message}`);
    }
  }

  document.getElementById('tab-matchup').addEventListener('change', recalc);
  document.getElementById('opp-move-add-btn').addEventListener('click', recalc);
  recalc();
})();
