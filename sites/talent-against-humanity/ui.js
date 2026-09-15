// Talent Against Humanity — UI layer
// Pure DOM plumbing. Every function here is called from app.js's
// applyServerMessage reducer, or from a button handler that calls into
// app.js's host/client logic.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* --------------------------------- screens -------------------------------- */

function showScreen(name) {
  $$(".screen").forEach((el) => el.classList.add("hidden"));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.remove("hidden");
}

let bannerTimer = null;
function showError(message) {
  const b = $("#banner");
  b.textContent = message;
  b.classList.remove("hidden");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add("hidden"), 4500);
}

/* ---------------------------------- lobby ---------------------------------- */

function renderLobby() {
  $("#lobby-code").textContent = state.roomCode || "";
  const list = $("#lobby-players");
  list.innerHTML = "";
  const players = state.role === "host" ? playerListPublic() : state.players;
  players.forEach((p) => {
    const li = document.createElement("li");
    li.className = "player-chip";
    li.textContent = p.name + (p.isHost || p.id === "HOST" ? " (host)" : "");
    list.appendChild(li);
  });

  const startBtn = $("#btn-start-game");
  const hostNote = $("#lobby-host-note");
  const hint = $("#lobby-hint");
  if (state.role === "host") {
    hostNote.classList.add("hidden");
    if (players.length >= 2) {
      startBtn.classList.remove("hidden");
      hint.textContent = players.length < 3
        ? "You can start with 2, but this plays much better with 3+."
        : "Ready when you are.";
    } else {
      startBtn.classList.add("hidden");
      hint.textContent = "Waiting for at least one more player…";
    }
  } else {
    startBtn.classList.add("hidden");
    hostNote.classList.remove("hidden");
    hint.textContent = "Waiting for the host to start the game…";
  }
}

/* ---------------------------------- game ----------------------------------- */

let judgeIdOnScreen = null;

function resetRoundPanels() {
  ["phase-waiting-submit", "phase-judging-wait", "phase-reveal-wait", "reveal-area", "round-result-area", "hand-area", "btn-next-round"]
    .forEach((id) => $("#" + id).classList.add("hidden"));
}

function renderBlackCard(text) {
  const withBlank = text.replace(/_+/g, '<span class="blank">_____</span>');
  $("#black-card").innerHTML = withBlank;
}

function renderScoreboard(players) {
  const board = $("#scoreboard");
  board.innerHTML = "";
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  sorted.forEach((p) => {
    const row = document.createElement("div");
    row.className = "score-row" + (p.id === judgeIdOnScreen ? " is-judge" : "");
    row.innerHTML = `<span class="score-name">${p.id === judgeIdOnScreen ? "⚖ " : ""}${escapeHtml(p.name)}</span><span class="score-num">${p.score}</span>`;
    board.appendChild(row);
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function renderRoundStart(msg) {
  showScreen("game");
  resetRoundPanels();
  judgeIdOnScreen = msg.judgeId;
  renderBlackCard(msg.blackCard);
  renderScoreboard(msg.players);

  $("#judge-banner").textContent = msg.isJudge
    ? "You're judging this round"
    : `${msg.judgeName} is judging this round`;
  $("#sub-progress").textContent = `${msg.submittedCount} / ${msg.totalNeeded} submitted`;

  if (msg.isJudge) {
    $("#phase-judging-wait").classList.remove("hidden");
  } else {
    $("#phase-waiting-submit").classList.remove("hidden");
    renderHand(msg.hand);
  }
}

function renderHand(hand) {
  const area = $("#hand-area");
  area.classList.remove("hidden");
  area.innerHTML = "";
  hand.forEach((card) => {
    const el = document.createElement("button");
    el.className = "white-card";
    el.type = "button";
    el.textContent = card.text;
    el.addEventListener("click", () => {
      $$(".white-card", area).forEach((c) => (c.disabled = true));
      el.classList.add("selected");
      sendToHost({ type: "submit", cardId: card.cardId });
      $("#phase-waiting-submit .phase-note").textContent = "Card's in. Waiting on everyone else…";
    });
    area.appendChild(el);
  });
}

function renderSubmissionCount(count, total) {
  $("#sub-progress").textContent = `${count} / ${total} submitted`;
}

function renderReveal(msg) {
  resetRoundPanels();
  renderBlackCard(msg.blackCard);
  const area = $("#reveal-area");
  area.classList.remove("hidden");
  area.innerHTML = "";

  if (!msg.isJudge) $("#phase-reveal-wait").classList.remove("hidden");

  msg.submissions.forEach((sub) => {
    const el = document.createElement("button");
    el.className = "white-card reveal-card";
    el.type = "button";
    el.textContent = sub.text;
    if (msg.isJudge) {
      el.addEventListener("click", () => {
        $$(".reveal-card", area).forEach((c) => (c.disabled = true));
        sendToHost({ type: "pick", subToken: sub.subToken });
      });
    } else {
      el.disabled = true;
    }
    area.appendChild(el);
  });
}

function renderRoundResult(msg) {
  resetRoundPanels();
  renderScoreboard(msg.scores);

  const area = $("#round-result-area");
  area.classList.remove("hidden");
  area.innerHTML = "";

  const winnerLine = document.createElement("p");
  winnerLine.className = "winner-line";
  winnerLine.innerHTML = `🏆 <strong>${escapeHtml(msg.winnerName)}</strong> takes the round with &ldquo;${escapeHtml(msg.winningCardText)}&rdquo;`;
  area.appendChild(winnerLine);

  const recap = document.createElement("ul");
  recap.className = "recap-list";
  msg.revealed.forEach((r) => {
    const li = document.createElement("li");
    li.className = r.isWinner ? "recap-winner" : "";
    li.innerHTML = `<span class="recap-name">${escapeHtml(r.name)}</span> &mdash; ${escapeHtml(r.cardText)}`;
    recap.appendChild(li);
  });
  area.appendChild(recap);

  if (msg.gameOver) {
    setTimeout(() => renderGameOver(msg), 2400);
    return;
  }

  if (state.role === "host") {
    $("#btn-next-round").classList.remove("hidden");
  } else {
    const note = document.createElement("p");
    note.className = "fineprint";
    note.textContent = "Waiting for the host to start the next round…";
    area.appendChild(note);
  }
}

function renderGameOver(msg) {
  showScreen("gameover");
  const sorted = msg.scores.slice().sort((a, b) => b.score - a.score);
  $("#gameover-title").textContent = `${msg.winnerName} wins the round of hiring.`;
  const list = $("#gameover-scores");
  list.innerHTML = "";
  sorted.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name} — ${p.score}`;
    list.appendChild(li);
  });

  if (state.role === "host") {
    $("#btn-play-again").classList.remove("hidden");
    $("#gameover-note").textContent = "";
  } else {
    $("#btn-play-again").classList.add("hidden");
    $("#gameover-note").textContent = "Ask the host to start a new game whenever you're ready to go again.";
  }
}

/* ------------------------------- event wiring ------------------------------- */

function validateName(raw) {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 18 ? name : null;
}

document.addEventListener("DOMContentLoaded", () => {
  $("#btn-go-host").addEventListener("click", () => showScreen("host-setup"));
  $("#btn-go-join").addEventListener("click", () => showScreen("join-setup"));
  $$(".btn-back").forEach((b) =>
    b.addEventListener("click", () => showScreen(b.dataset.back))
  );

  $("#btn-create-room").addEventListener("click", () => {
    const name = validateName($("#host-name").value);
    if (!name) return showError("Enter a name first.");
    const btn = $("#btn-create-room");
    btn.disabled = true;
    btn.textContent = "Creating room…";
    hostCreateRoom(
      name,
      () => {
        btn.disabled = false;
        btn.textContent = "Create room";
        showScreen("lobby");
      },
      (err) => {
        btn.disabled = false;
        btn.textContent = "Create room";
        showError("Couldn't create a room — check your connection and try again.");
        console.error(err);
      }
    );
  });

  $("#btn-join-room").addEventListener("click", () => {
    const name = validateName($("#join-name").value);
    const code = $("#join-code").value.trim().toUpperCase();
    if (!name) return showError("Enter a name first.");
    if (code.length !== 4) return showError("Room codes are 4 letters — check with the host.");
    const btn = $("#btn-join-room");
    btn.disabled = true;
    btn.textContent = "Joining…";
    clientJoinRoom(code, name, (err) => {
      btn.disabled = false;
      btn.textContent = "Join room";
      showError("Couldn't find that room. Double check the code with the host.");
      console.error(err);
    });
  });

  $("#btn-start-game").addEventListener("click", () => hostStartGame());
  $("#btn-next-round").addEventListener("click", () => {
    $("#btn-next-round").classList.add("hidden");
    hostAdvanceRound();
  });
  $("#btn-play-again").addEventListener("click", () => hostRestartGame());

  initFireflies();
});

/* ------------------------------ ambient fireflies --------------------------- */
// A quieter cousin of the homepage's firefly canvas — same visual language,
// dialled down so it doesn't compete with the cards.

function initFireflies() {
  const canvas = document.getElementById("firefly-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w, h;
  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  const N = reduceMotion ? 8 : 16;
  const flies = Array.from({ length: N }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.15,
    vy: (Math.random() - 0.5) * 0.15,
    r: 1.4 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
  }));

  function tick(t) {
    ctx.clearRect(0, 0, w, h);
    flies.forEach((f) => {
      if (!reduceMotion) {
        f.x += f.vx;
        f.y += f.vy;
        if (f.x < 0 || f.x > w) f.vx *= -1;
        if (f.y < 0 || f.y > h) f.vy *= -1;
      }
      const glow = 0.35 + 0.35 * Math.sin(t / 900 + f.phase);
      ctx.beginPath();
      const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 6);
      grad.addColorStop(0, `rgba(244,213,141,${0.55 * glow})`);
      grad.addColorStop(1, "rgba(244,213,141,0)");
      ctx.fillStyle = grad;
      ctx.arc(f.x, f.y, f.r * 6, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
