// Wraps the vendored @smogon/calc engine (window.calc) to produce the two
// views the matchup page needs:
//
//   1. myMovesVsOpponent(myTeam, opponent, field)
//      -> for each of my Pokemon's moves, the damage-% range across the
//         opponent's min-bulk and max-bulk configurations.
//   2. opponentMovesVsMyTeam(opponentMoves, myTeam, field)
//      -> for each opponent move (checked from usage stats or added by
//         hand) against each of my Pokemon, the plain min-max roll range
//         (my stats are exact, so no bulk range is needed on my side).
//   3. speedComparison(myTeam, opponent, field, trickRoom)
//      -> the opponent's estimated speed range (0 Spe Stat Points/neutral
//         up to max/+Spe) and, for each of my Pokemon, its exact speed and
//         whether it moves first. Speeds come from the calc's own
//         getFinalSpeed (exposed in the rebuilt bundle), so boosts, Choice
//         Scarf, paralysis, Tailwind and weather/terrain speed abilities
//         all use the real formula.
//
// Doubles spread-move reduction, weather, terrain, and screens are handled
// by passing a calc.Field through; this module doesn't reimplement any of
// that math itself.

const CalcEngine = (() => {
  const gen = window.calc.Generations.get(9);

  // Opponent bulk extremes, split by the attacking move's category since a
  // single nature only meaningfully boosts one defensive stat at a time.
  // min = worst-case defensively (takes the most damage), max = best-case.
  function bulkConfig(extreme, category) {
    const relevant = category === 'Physical' ? 'def' : 'spd';
    const evs = { hp: 0, [relevant]: 0 };
    let nature = 'Hardy'; // neutral
    if (extreme === 'max') {
      evs.hp = 252;
      evs[relevant] = 252;
      nature = category === 'Physical' ? 'Bold' : 'Calm';
    }
    return { evs, nature };
  }

  function buildOpponent(speciesName, baseConfig, extreme, moveCategory) {
    const bulk = bulkConfig(extreme, moveCategory);
    return ChampionsDex.buildPokemon(gen, speciesName, {
      ...baseConfig,
      evs: bulk.evs,
      nature: bulk.nature,
      ivs: StatPoints.ivsForCalc(),
    });
  }

  function damagePercentRange(gen_, attacker, defender, moveName, field) {
    const move = new window.calc.Move(gen_, moveName);
    const result = window.calc.calculate(gen_, attacker, defender, move, field);
    const range = result.range(); // [minHp, maxHp]
    const maxHp = defender.maxHP();
    // result.desc() throws on a zero-damage result (status move, or a type
    // immunity like Earthquake into a Flying-type), so don't ask for it.
    let desc;
    if (range[1] === 0) {
      desc = move.category === 'Status' ? `${moveName} is a status move` : `${moveName} doesn't affect ${defender.name}`;
    } else {
      try { desc = result.desc(); } catch (e) { desc = ''; }
    }
    return {
      minPct: +(100 * range[0] / maxHp).toFixed(1),
      maxPct: +(100 * range[1] / maxHp).toFixed(1),
      desc,
      category: move.category,
    };
  }

  // myTeam: array of { species, config: {...}, moves: [moveName, ...] }
  // opponent: { species, config: {...} } — config excludes evs/nature/ivs,
  // those get filled in per bulk extreme below.
  function myMovesVsOpponent(myTeam, opponent, field) {
    return myTeam.map((mon) => {
      const attacker = ChampionsDex.buildPokemon(gen, mon.species, mon.config);
      const moveResults = mon.moves.map((moveName) => {
        const category = new window.calc.Move(gen, moveName).category;
        const minDefender = buildOpponent(opponent.species, opponent.config, 'min', category);
        const maxDefender = buildOpponent(opponent.species, opponent.config, 'max', category);
        const atMin = damagePercentRange(gen, attacker, minDefender, moveName, field);
        const atMax = damagePercentRange(gen, attacker, maxDefender, moveName, field);
        return {
          move: moveName,
          category,
          minPct: Math.min(atMin.minPct, atMax.minPct),
          maxPct: Math.max(atMin.maxPct, atMax.maxPct),
          desc: `min bulk: ${atMin.desc} | max bulk: ${atMax.desc}`,
        };
      });
      return { species: mon.species, moves: moveResults };
    });
  }

  // opponentMoves: array of move names (from usage suggestions + manual adds)
  // myTeam: array of { species, config: {...} } — exact, known spreads
  function opponentMovesVsMyTeam(opponentSpecies, opponentConfig, opponentMoves, myTeam, field) {
    const attacker = ChampionsDex.buildPokemon(gen, opponentSpecies, opponentConfig);
    return myTeam.map((mon) => {
      const defender = ChampionsDex.buildPokemon(gen, mon.species, mon.config);
      const moveResults = opponentMoves.map((moveName) => {
        const { minPct, maxPct, desc, category } = damagePercentRange(gen, attacker, defender, moveName, field);
        return { move: moveName, category, minPct, maxPct, desc };
      });
      return { species: mon.species, moves: moveResults };
    });
  }

  // ---------- Speed ----------

  function finalSpeed(pokemon, field, side) {
    return window.calc.getFinalSpeed(gen, pokemon, field, side);
  }

  // Who moves first given two final speeds. Ties are a coin flip in-game.
  function order(mySpeed, oppSpeed, trickRoom) {
    if (mySpeed === oppSpeed) return 'tie';
    const faster = mySpeed > oppSpeed;
    return (faster !== !!trickRoom) ? 'me' : 'opp';
  }

  // Summarise, for one nature, which opponent Spe investments let me move
  // first. Outcomes are monotonic in Stat Points (a prefix under normal
  // speed order, a suffix under Trick Room), so a single threshold reads
  // naturally.
  function describeThreshold(label, outcomes, trickRoom) {
    const first = outcomes.map((o, sp) => (o === 'me' ? sp : null)).filter((x) => x !== null);
    const ties = outcomes.map((o, sp) => (o === 'tie' ? sp : null)).filter((x) => x !== null);
    const tieNote = ties.length ? ` (tie at ${ties[0]}${ties.length > 1 ? `–${ties[ties.length - 1]}` : ''})` : '';
    if (first.length === outcomes.length) return `${label}: always first`;
    if (first.length === 0) return `${label}: never first${tieNote}`;
    const bound = trickRoom ? `≥ ${first[0]}` : `≤ ${first[first.length - 1]}`;
    return `${label}: first if opp has ${bound} Spe SP${tieNote}`;
  }

  // field: a calc.Field whose attackerSide is the opponent's side and whose
  // defenderSide is mine (i.e. the 'oppAttacks' direction), so Tailwind
  // lands on the right Pokemon. trickRoom only flips the verdicts; the
  // damage engine doesn't care about it.
  function speedComparison(myTeam, opponent, field, trickRoom) {
    const oppSpeedAt = (points, plusNature) => finalSpeed(
      ChampionsDex.buildPokemon(gen, opponent.species, {
        ...opponent.config,
        evs: { spe: StatPoints.statPointsToEv(points) },
        nature: plusNature ? 'Timid' : 'Hardy',
        ivs: StatPoints.ivsForCalc(),
      }),
      field, field.attackerSide,
    );
    const spRange = [...Array(StatPoints.MAX_POINTS + 1).keys()];
    const oppNeutral = spRange.map((sp) => oppSpeedAt(sp, false));
    const oppPlus = spRange.map((sp) => oppSpeedAt(sp, true));
    const oppMin = oppNeutral[0];
    const oppMax = oppPlus[oppPlus.length - 1];

    const rows = myTeam.map((mon) => {
      const me = ChampionsDex.buildPokemon(gen, mon.species, mon.config);
      const speed = finalSpeed(me, field, field.defenderSide);
      const vsMin = order(speed, oppMin, trickRoom);
      const vsMax = order(speed, oppMax, trickRoom);
      let verdict; let detail = '';
      if (vsMin === 'me' && vsMax === 'me') {
        verdict = 'first';
      } else if (vsMin === 'opp' && vsMax === 'opp') {
        verdict = 'second';
      } else {
        verdict = 'depends';
        detail = [
          describeThreshold('+Spe', oppPlus.map((v) => order(speed, v, trickRoom)), trickRoom),
          describeThreshold('neutral', oppNeutral.map((v) => order(speed, v, trickRoom)), trickRoom),
        ].join(' · ');
      }
      return { species: mon.species, speed, verdict, detail };
    });

    return { oppMin, oppMax, trickRoom: !!trickRoom, rows };
  }

  return { myMovesVsOpponent, opponentMovesVsMyTeam, speedComparison, gen };
})();
