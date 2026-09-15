// Talent Against Humanity — game engine
// Architecture: one browser tab is the HOST. It runs the entire game as
// authoritative state and talks to every other tab (a PLAYER) directly over
// WebRTC via PeerJS — no server, no database, just peers.
//
// The host treats itself as just another player internally: every game
// message that would be sent over the wire to a remote player is instead
// handed straight to the same `applyServerMessage` function locally. That
// means there is exactly one code path that renders the UI, whether you're
// the host or a guest.

const HOST_ID = "HOST";
const TARGET_SCORE = 5;
const HAND_SIZE = 7;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ"; // no O/I to avoid 0/1 confusion
const PEER_PREFIX = "tah-room-";

/* ----------------------------- shared state ----------------------------- */

const state = {
  role: null, // 'host' | 'player'
  peer: null,
  myId: null,
  myName: null,
  roomCode: null,
  isJudge: false,
  hand: [], // [{cardId, text}]
  players: [], // [{id, name, score}]
  lastBlackCard: null,
};

// Only populated on the host device.
const host = {
  active: false,
  connections: new Map(), // playerId -> PeerJS DataConnection
  players: new Map(), // playerId -> {id, name, score, hand: [cardId]}
  order: [],
  judgeIndex: 0,
  blackDeck: [],
  blackDiscard: [],
  whiteDeck: [],
  whiteDiscard: [],
  currentBlackId: null,
  submissions: new Map(), // playerId -> cardId
  subTokenMap: new Map(), // subToken -> playerId
  phase: "lobby",
};

/* -------------------------------- utils ---------------------------------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCode(len = 4) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function randomToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function playerListPublic() {
  return host.order.map((id) => {
    const p = host.players.get(id);
    return { id: p.id, name: p.name, score: p.score, isHost: id === HOST_ID };
  });
}

/* ------------------------------ delivery --------------------------------- */
// Route a message to a player: over the wire if remote, straight into the
// local UI reducer if it's us (the host).

function deliver(playerId, msg) {
  if (playerId === HOST_ID) {
    if (state.role === "host") applyServerMessage(msg);
    return;
  }
  const conn = host.connections.get(playerId);
  if (conn && conn.open) {
    try {
      conn.send(msg);
    } catch (e) {
      console.warn("send failed", e);
    }
  }
}

function broadcast(msg) {
  for (const id of host.order) deliver(id, msg);
}

/* ------------------------------ host logic -------------------------------- */

function hostCreateRoom(name, onReady, onError) {
  host.active = false;
  host.connections = new Map();
  host.players = new Map();
  host.order = [];
  host.judgeIndex = 0;
  host.blackDeck = [];
  host.blackDiscard = [];
  host.whiteDeck = [];
  host.whiteDiscard = [];
  host.currentBlackId = null;
  host.submissions = new Map();
  host.subTokenMap = new Map();
  host.phase = "lobby";

  const code = randomCode();
  const peer = new Peer(PEER_PREFIX + code, { debug: 1 });
  state.peer = peer;
  state.role = "host";
  state.myName = name;
  state.roomCode = code;
  state.myId = HOST_ID;

  peer.on("open", () => {
    host.active = true;
    host.players.set(HOST_ID, { id: HOST_ID, name, score: 0, hand: [] });
    host.order = [HOST_ID];
    host.phase = "lobby";
    onReady(code);
    renderLobby();
  });

  peer.on("connection", (conn) => {
    conn.on("open", () => {
      host.connections.set(conn.peer, conn);
      conn.on("data", (data) => handleClientMessage(conn.peer, data));
      conn.on("close", () => handlePlayerDisconnect(conn.peer));
    });
  });

  peer.on("error", (err) => {
    console.error(err);
    if (err.type === "unavailable-id") {
      // extremely unlikely with a fresh random code, but retry once
      peer.destroy();
      hostCreateRoom(name, onReady, onError);
    } else {
      onError(err);
    }
  });
}

function hostAddPlayer(peerId, name) {
  if (host.phase !== "lobby") {
    deliver(peerId, { type: "error", message: "The game has already started — ask the host for the next one." });
    return;
  }
  if ([...host.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    deliver(peerId, { type: "error", message: "Someone in the room already has that name." });
    return;
  }
  host.players.set(peerId, { id: peerId, name, score: 0, hand: [] });
  host.order.push(peerId);
  deliver(peerId, { type: "joined", you: { id: peerId, name }, roomCode: state.roomCode });
  broadcast({ type: "lobby_update", players: playerListPublic() });
}

function handleClientMessage(peerId, data) {
  switch (data.type) {
    case "join":
      hostAddPlayer(peerId, data.name);
      break;
    case "submit":
      hostHandleSubmit(peerId, data.cardId);
      break;
    case "pick":
      hostHandleJudgePick(peerId, data.subToken);
      break;
    default:
      console.warn("unknown message from client", data);
  }
}

function handlePlayerDisconnect(peerId) {
  if (!host.players.has(peerId)) return;
  host.connections.delete(peerId);
  host.players.delete(peerId);
  const wasJudge = currentJudgeId() === peerId;
  host.order = host.order.filter((id) => id !== peerId);
  host.submissions.delete(peerId);

  if (host.order.length < 2) {
    broadcast({ type: "lobby_update", players: playerListPublic() });
    return;
  }

  if (host.phase === "submitting" || host.phase === "revealing") {
    if (wasJudge) {
      // judge vanished mid-round — restart the round cleanly with a new judge
      host.judgeIndex = host.judgeIndex % host.order.length;
      startRound();
      return;
    }
    if (host.phase === "submitting" && allNonJudgeSubmitted()) {
      revealSubmissions();
    }
  }
  broadcast({ type: "lobby_update", players: playerListPublic() });
}

function currentJudgeId() {
  return host.order[host.judgeIndex % host.order.length];
}

function refillBlackDeck() {
  if (host.blackDeck.length === 0) {
    host.blackDeck = shuffle(host.blackDiscard.length ? host.blackDiscard : BLACK_CARDS.map((_, i) => i));
    host.blackDiscard = [];
  }
}

function refillWhiteDeck() {
  if (host.whiteDeck.length === 0) {
    host.whiteDeck = shuffle(host.whiteDiscard.length ? host.whiteDiscard : WHITE_CARDS.map((_, i) => i));
    host.whiteDiscard = [];
  }
}

function drawWhite() {
  refillWhiteDeck();
  return host.whiteDeck.pop();
}

function hostStartGame() {
  if (host.order.length < 2) return;
  host.blackDeck = shuffle(BLACK_CARDS.map((_, i) => i));
  host.blackDiscard = [];
  host.whiteDeck = shuffle(WHITE_CARDS.map((_, i) => i));
  host.whiteDiscard = [];
  host.judgeIndex = 0;
  for (const p of host.players.values()) {
    p.hand = [];
    p.score = 0;
    for (let i = 0; i < HAND_SIZE; i++) p.hand.push(drawWhite());
  }
  startRound();
}

function startRound() {
  refillBlackDeck();
  host.currentBlackId = host.blackDeck.pop();
  host.submissions = new Map();
  host.subTokenMap = new Map();
  host.phase = "submitting";
  const judgeId = currentJudgeId();

  for (const id of host.order) {
    const p = host.players.get(id);
    const isJudge = id === judgeId;
    deliver(id, {
      type: "round_start",
      blackCard: BLACK_CARDS[host.currentBlackId],
      judgeId,
      judgeName: host.players.get(judgeId).name,
      isJudge,
      hand: isJudge ? null : p.hand.map((cid) => ({ cardId: cid, text: WHITE_CARDS[cid] })),
      players: playerListPublic(),
      submittedCount: 0,
      totalNeeded: host.order.length - 1,
    });
  }
}

function allNonJudgeSubmitted() {
  const judgeId = currentJudgeId();
  const needed = host.order.filter((id) => id !== judgeId);
  return needed.every((id) => host.submissions.has(id));
}

function hostHandleSubmit(playerId, cardId) {
  if (host.phase !== "submitting") return;
  if (playerId === currentJudgeId()) return;
  if (host.submissions.has(playerId)) return;
  if (!host.players.has(playerId)) return;

  const p = host.players.get(playerId);
  const idx = p.hand.indexOf(cardId);
  if (idx === -1) return;
  p.hand.splice(idx, 1);
  host.submissions.set(playerId, cardId);

  const judgeId = currentJudgeId();
  const count = host.submissions.size;
  const needed = host.order.length - 1;
  for (const id of host.order) {
    deliver(id, { type: "submission_count", submittedCount: count, totalNeeded: needed });
  }
  if (allNonJudgeSubmitted()) revealSubmissions();
}

function revealSubmissions() {
  host.phase = "revealing";
  const entries = [...host.submissions.entries()]; // [playerId, cardId]
  const shuffled = shuffle(entries);
  const payload = [];
  for (const [playerId, cardId] of shuffled) {
    const token = randomToken();
    host.subTokenMap.set(token, playerId);
    payload.push({ subToken: token, text: WHITE_CARDS[cardId] });
  }
  const judgeId = currentJudgeId();
  for (const id of host.order) {
    deliver(id, {
      type: "reveal",
      blackCard: BLACK_CARDS[host.currentBlackId],
      submissions: payload,
      isJudge: id === judgeId,
    });
  }
}

function hostHandleJudgePick(judgeId, subToken) {
  if (host.phase !== "revealing") return;
  if (judgeId !== currentJudgeId()) return;
  const winnerId = host.subTokenMap.get(subToken);
  if (!winnerId) return;

  const winnerCardId = host.submissions.get(winnerId);
  const winner = host.players.get(winnerId);
  winner.score += 1;

  // reveal authorship of every card now the round is decided
  const revealed = [...host.submissions.entries()].map(([pid, cid]) => ({
    playerId: pid,
    name: host.players.get(pid).name,
    cardText: WHITE_CARDS[cid],
    isWinner: pid === winnerId,
  }));

  // discard used white cards, refill everyone's hand back up
  for (const [pid, cid] of host.submissions.entries()) {
    host.whiteDiscard.push(cid);
    const p = host.players.get(pid);
    if (p) p.hand.push(drawWhite());
  }
  host.blackDiscard.push(host.currentBlackId);

  host.phase = "roundresult";
  const gameOver = winner.score >= TARGET_SCORE;
  const scores = playerListPublic();

  for (const id of host.order) {
    deliver(id, {
      type: "round_result",
      winnerId,
      winnerName: winner.name,
      winningCardText: WHITE_CARDS[winnerCardId],
      revealed,
      scores,
      gameOver,
    });
  }

  if (gameOver) {
    host.phase = "gameover";
  }
}

function hostAdvanceRound() {
  host.judgeIndex = (host.judgeIndex + 1) % host.order.length;
  startRound();
}

function hostRestartGame() {
  for (const p of host.players.values()) p.score = 0;
  host.judgeIndex = 0;
  hostStartGame();
}

/* ------------------------------ client logic ------------------------------ */

function clientJoinRoom(code, name, onError) {
  const peer = new Peer({ debug: 1 });
  state.peer = peer;
  state.role = "player";
  state.myName = name;
  state.roomCode = code;

  peer.on("open", () => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    state.hostConn = conn;
    conn.on("open", () => {
      conn.send({ type: "join", name });
    });
    conn.on("data", (data) => applyServerMessage(data));
    conn.on("close", () => {
      showError("Lost connection to the host. They may have closed the room.");
    });
    conn.on("error", (err) => onError(err));
  });

  peer.on("error", (err) => onError(err));
}

function sendToHost(msg) {
  if (state.role === "host") {
    if (msg.type === "submit") hostHandleSubmit(HOST_ID, msg.cardId);
    if (msg.type === "pick") hostHandleJudgePick(HOST_ID, msg.subToken);
    return;
  }
  if (state.hostConn && state.hostConn.open) state.hostConn.send(msg);
}

/* --------------------------- shared UI reducer ----------------------------- */
// This runs identically for the host's own tab and every remote player.

function applyServerMessage(msg) {
  switch (msg.type) {
    case "joined":
      state.myId = msg.you.id;
      state.roomCode = msg.roomCode;
      showScreen("lobby");
      break;
    case "lobby_update":
      state.players = msg.players;
      renderLobby();
      break;
    case "error":
      showError(msg.message);
      break;
    case "round_start":
      state.isJudge = msg.isJudge;
      state.hand = msg.hand || [];
      state.players = msg.players;
      state.lastBlackCard = msg.blackCard;
      renderRoundStart(msg);
      break;
    case "submission_count":
      renderSubmissionCount(msg.submittedCount, msg.totalNeeded);
      break;
    case "reveal":
      renderReveal(msg);
      break;
    case "round_result":
      state.players = msg.scores;
      renderRoundResult(msg);
      break;
    default:
      console.warn("unknown server message", msg);
  }
}

/* app.js continues in ui.js for rendering (kept separate on purpose) */
