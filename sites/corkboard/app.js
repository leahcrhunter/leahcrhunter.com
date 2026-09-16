// corkboard — notes, lists, photos and stickers pinned to a board.
// Everything lives in this browser's localStorage; "save file" / "load file"
// move a board between devices as JSON. No server involved.

(function () {
  'use strict';

  const STORAGE_KEY = 'corkboard.v1';
  const BOARD_W = 1200, BOARD_H = 760;
  const NOTE_COLORS = ['yellow', 'pink', 'mint', 'sky', 'peach', 'lilac'];
  const PIN_COLORS = ['#d84a5e', '#e2a03a', '#4f8fd6', '#5cae7a', '#a774d4'];
  const STICKERS = ['✨', '🌟', '🌙', '🍄', '🐝', '🦋', '🌻', '🍓', '🐸', '🪻', '🫧', '🧸',
                    '🍵', '🌈', '💛', '🐌', '🍂', '🕯️', '🐈', '🌷', '🍋', '🫶', '📌', '🎀'];

  const $ = (sel) => document.querySelector(sel);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ------------------------------------------------------------------ state

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) return parsed;
      }
    } catch (e) { /* fall through to a fresh board */ }
    return starterBoard();
  }

  function starterBoard() {
    return {
      items: [
        { id: uid(), type: 'note', x: 120, y: 110, rot: -3, z: 1, color: 'yellow', pin: PIN_COLORS[0],
          text: 'hi! this is your corkboard.\n\ndrag things around, click to edit, hover for the ✕.' },
        { id: uid(), type: 'list', x: 420, y: 150, rot: 2, z: 2, pin: PIN_COLORS[2],
          title: 'to do', rows: [{ text: 'pin a photo', done: false }, { text: 'add a sticker', done: true }, { text: 'water the plants', done: false }] },
        { id: uid(), type: 'sticker', x: 760, y: 120, rot: 12, z: 3, emoji: '🌙' },
        { id: uid(), type: 'sticker', x: 330, y: 470, rot: -8, z: 4, emoji: '🍄' }
      ]
    };
  }

  let saveTimer = null;
  function save(immediate) {
    clearTimeout(saveTimer);
    const doSave = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        flashStatus('saved');
      } catch (e) {
        banner("couldn't save — this browser's storage is full. try smaller photos, or 'save file'.");
      }
    };
    if (immediate) doSave(); else saveTimer = setTimeout(doSave, 300);
  }

  function nextZ() {
    return state.items.reduce((m, it) => Math.max(m, it.z || 0), 0) + 1;
  }

  function findItem(id) { return state.items.find((it) => it.id === id); }

  // ------------------------------------------------------------------ ui bits

  const statusHint = $('#status-hint');
  let statusTimer = null;
  function flashStatus(text) {
    statusHint.textContent = text;
    statusHint.classList.add('flash');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusHint.classList.remove('flash');
      statusHint.textContent = 'saved in this browser';
    }, 1200);
  }

  const bannerEl = $('#banner');
  let bannerTimer = null;
  function banner(text, ms = 4500) {
    bannerEl.textContent = text;
    bannerEl.classList.remove('hidden');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.add('hidden'), ms);
  }

  // ------------------------------------------------------------------ board scale

  const boardWrap = $('#board-wrap');
  const boardScale = $('#board-scale');
  let scale = 1;
  function fitBoard() {
    const available = boardWrap.clientWidth - 48;   // wrap padding
    // shrink to fit, but never below 0.6 — past that it's unreadable, so the
    // wrap scrolls sideways instead (see #board-wrap overflow in style.css)
    scale = Math.max(0.6, Math.min(1, available / BOARD_W));
    boardScale.style.setProperty('--scale', scale);
  }
  window.addEventListener('resize', fitBoard);
  fitBoard();

  // ------------------------------------------------------------------ rendering

  const itemsEl = $('#items');

  function render() {
    itemsEl.innerHTML = '';
    state.items.forEach((it) => itemsEl.appendChild(renderItem(it)));
  }

  function renderItem(it) {
    const el = document.createElement('div');
    el.className = `item item-${it.type}`;
    el.dataset.id = it.id;
    el.style.left = it.x + 'px';
    el.style.top = it.y + 'px';
    el.style.zIndex = it.z || 1;
    el.style.setProperty('--rot', (it.rot || 0) + 'deg');
    if (it.pin) el.style.setProperty('--pin', it.pin);

    const pin = document.createElement('span');
    pin.className = 'pin';
    el.appendChild(pin);

    if (it.type === 'photo') {
      const tape = document.createElement('span');
      tape.className = 'tape';
      el.appendChild(tape);
    }

    const x = document.createElement('button');
    x.className = 'item-x';
    x.title = 'take down';
    x.setAttribute('aria-label', 'Remove');
    x.textContent = '✕';
    x.addEventListener('click', () => removeItem(it.id));
    el.appendChild(x);

    ({ note: renderNote, list: renderList, photo: renderPhoto, sticker: renderSticker })[it.type](it, el);
    return el;
  }

  // single-line inline text (titles, list rows, captions)
  function editable(className, value, placeholder, onInput) {
    const d = document.createElement('div');
    d.className = className;
    d.contentEditable = 'true';
    d.spellcheck = false;
    d.dataset.placeholder = placeholder;
    d.textContent = value || '';
    d.addEventListener('input', () => onInput(d.textContent));
    d.addEventListener('paste', (e) => {          // keep pasted text plain
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); d.blur(); } });
    return d;
  }

  // multi-line text (note body). A real textarea, because contenteditable
  // mangles line breaks; it grows to fit its contents.
  function textarea(className, value, placeholder, onInput) {
    const t = document.createElement('textarea');
    t.className = className;
    t.spellcheck = false;
    t.placeholder = placeholder;
    t.rows = 1;
    t.value = value || '';
    const grow = () => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
    t.addEventListener('input', () => { grow(); onInput(t.value); });
    requestAnimationFrame(grow);
    return t;
  }

  function renderNote(it, el) {
    el.dataset.color = it.color || 'yellow';
    el.appendChild(textarea('note-text', it.text, 'write something…', (t) => { it.text = t; save(); }));

    const colors = document.createElement('div');
    colors.className = 'note-colors';
    NOTE_COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.title = c;
      b.style.setProperty('--c', paperColor(c));
      b.addEventListener('click', () => { it.color = c; el.dataset.color = c; save(); });
      colors.appendChild(b);
    });
    el.appendChild(colors);
  }

  function paperColor(name) {
    return { yellow: '#fff3a8', pink: '#ffd3e0', mint: '#d2f2df', sky: '#d3e7ff', peach: '#ffe0c2', lilac: '#e6d8ff' }[name];
  }

  function renderList(it, el) {
    el.appendChild(editable('list-title', it.title, 'title', (t) => { it.title = t; save(); }));

    const rows = document.createElement('div');
    rows.className = 'list-rows';
    el.appendChild(rows);

    function addRow(row, focus) {
      const r = document.createElement('div');
      r.className = 'list-row' + (row.done ? ' done' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!row.done;
      cb.addEventListener('change', () => { row.done = cb.checked; r.classList.toggle('done', cb.checked); save(); });
      const text = editable('row-text', row.text, '…', (t) => { row.text = t; save(); });
      text.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {                       // new row below
          e.preventDefault();
          const idx = it.rows.indexOf(row);
          const fresh = { text: '', done: false };
          it.rows.splice(idx + 1, 0, fresh);
          const next = addRow(fresh, true);
          r.after(next);
          save();
        } else if (e.key === 'Backspace' && text.textContent === '' && it.rows.length > 1) {
          e.preventDefault();                          // delete empty row
          const idx = it.rows.indexOf(row);
          it.rows.splice(idx, 1);
          const prev = r.previousElementSibling;
          r.remove();
          if (prev) focusEnd(prev.querySelector('.row-text'));
          save();
        }
      });
      r.append(cb, text);
      if (focus) setTimeout(() => focusEnd(text), 0);
      return r;
    }

    if (!it.rows || !it.rows.length) it.rows = [{ text: '', done: false }];
    it.rows.forEach((row) => rows.appendChild(addRow(row)));

    const add = document.createElement('button');
    add.className = 'list-add';
    add.textContent = '+ add';
    add.addEventListener('click', () => {
      const fresh = { text: '', done: false };
      it.rows.push(fresh);
      rows.appendChild(addRow(fresh, true));
      save();
    });
    el.appendChild(add);
  }

  function focusEnd(el) {
    if (!el) return;
    el.focus();
    if (el.tagName === 'TEXTAREA') { el.selectionStart = el.selectionEnd = el.value.length; return; }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function renderPhoto(it, el) {
    const img = document.createElement('img');
    img.src = it.src;
    img.alt = it.caption || 'pinned photo';
    img.draggable = false;
    el.appendChild(img);
    el.appendChild(editable('caption', it.caption, 'caption', (t) => { it.caption = t; img.alt = t || 'pinned photo'; save(); }));
  }

  function renderSticker(it, el) {
    const s = document.createElement('span');
    s.className = 'emoji';
    s.textContent = it.emoji;
    el.appendChild(s);
  }

  // ------------------------------------------------------------------ add / remove

  function addItem(partial) {
    const it = Object.assign({
      id: uid(),
      x: rand(80, BOARD_W - 320), y: rand(80, BOARD_H - 300),
      rot: rand(-6, 6), z: nextZ(), pin: pick(PIN_COLORS)
    }, partial);
    state.items.push(it);
    const el = renderItem(it);
    itemsEl.appendChild(el);
    save();
    const first = el.querySelector('[contenteditable], textarea');
    if (first) setTimeout(() => focusEnd(first), 0);
    return el;
  }

  function removeItem(id) {
    state.items = state.items.filter((it) => it.id !== id);
    const el = itemsEl.querySelector(`[data-id="${id}"]`);
    if (el) el.remove();
    save();
  }

  // ------------------------------------------------------------------ dragging

  let drag = null;

  itemsEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.item');
    if (!el) return;
    if (e.target.closest('button, input, label')) return;

    const editing = e.target.closest('[contenteditable], textarea');
    if (editing && document.activeElement === editing) return;   // selecting text, not dragging

    const it = findItem(el.dataset.id);
    it.z = nextZ();
    el.style.zIndex = it.z;

    drag = { el, it, startX: e.clientX, startY: e.clientY, ox: it.x, oy: it.y, moved: false, editTarget: editing, pointerId: e.pointerId };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  itemsEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = (e.clientX - drag.startX) / scale;
    const dy = (e.clientY - drag.startY) / scale;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.el.classList.add('dragging'); }
    const w = drag.el.offsetWidth, h = drag.el.offsetHeight;
    drag.it.x = Math.max(-w * 0.4, Math.min(BOARD_W - w * 0.6, drag.ox + dx));
    drag.it.y = Math.max(-20, Math.min(BOARD_H - h * 0.5, drag.oy + dy));
    drag.el.style.left = drag.it.x + 'px';
    drag.el.style.top = drag.it.y + 'px';
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.el.classList.remove('dragging');
    if (drag.moved) {
      // a small settle-wobble so it feels pinned
      drag.it.rot = Math.max(-10, Math.min(10, (drag.it.rot || 0) + rand(-1.5, 1.5)));
      drag.el.style.setProperty('--rot', drag.it.rot + 'deg');
    } else if (drag.editTarget) {
      focusEnd(drag.editTarget);
    }
    save();
    drag = null;
  }
  itemsEl.addEventListener('pointerup', endDrag);
  itemsEl.addEventListener('pointercancel', endDrag);

  // ------------------------------------------------------------------ tray

  document.querySelectorAll('.tool[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.add;
      if (kind === 'note') addItem({ type: 'note', color: pick(NOTE_COLORS), text: '' });
      if (kind === 'list') addItem({ type: 'list', title: '', rows: [{ text: '', done: false }] });
      if (kind === 'photo') $('#file-photo').click();
      if (kind === 'sticker') togglePicker();
    });
  });

  // sticker picker
  const picker = $('#sticker-picker');
  const grid = $('#sticker-grid');
  STICKERS.forEach((emoji) => {
    const b = document.createElement('button');
    b.textContent = emoji;
    b.addEventListener('click', () => {
      addItem({ type: 'sticker', emoji, rot: rand(-15, 15) });
      picker.classList.add('hidden');
    });
    grid.appendChild(b);
  });
  function togglePicker() { picker.classList.toggle('hidden'); }
  document.addEventListener('pointerdown', (e) => {
    if (!picker.classList.contains('hidden') && !e.target.closest('#sticker-picker, [data-add="sticker"]')) picker.classList.add('hidden');
  });

  // photos: shrink before storing so a few of them fit in localStorage
  $('#file-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const src = await shrinkImage(file, 720);
      addItem({ type: 'photo', src, caption: '', rot: rand(-4, 4) });
    } catch (err) {
      banner("couldn't read that image");
    }
  });

  function shrinkImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // export / import / clear
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `corkboard-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.items)) throw new Error('bad file');
        state = parsed;
        render();
        save(true);
        banner('board loaded');
      } catch (err) {
        banner("that didn't look like a corkboard file");
      }
    };
    reader.readAsText(file);
  });

  $('#btn-clear').addEventListener('click', () => {
    if (!state.items.length) return;
    if (!confirm('Take everything down? (save a file first if you want to keep it)')) return;
    state = { items: [] };
    render();
    save(true);
  });

  // ------------------------------------------------------------------ fairy lights

  function drawLights() {
    const svg = $('#lights');
    const W = BOARD_W + 36;
    svg.setAttribute('viewBox', `0 0 ${W} 150`);
    svg.innerHTML = '';

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = `<filter id="bulbBlur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>`;
    svg.appendChild(defs);

    // three gentle swags across the top of the frame
    const swags = 3, y0 = 30;
    let d = `M 0 ${y0}`;
    for (let i = 0; i < swags; i++) {
      const x1 = (W / swags) * (i + 0.5), x2 = (W / swags) * (i + 1);
      d += ` Q ${x1} ${y0 + 62} ${x2} ${y0}`;
    }
    const wire = document.createElementNS(ns, 'path');
    wire.setAttribute('d', d);
    wire.setAttribute('class', 'wire');
    svg.appendChild(wire);

    const len = wire.getTotalLength();
    const count = Math.round(W / 58);
    for (let i = 1; i < count; i++) {
      const p = wire.getPointAtLength((len / count) * i);
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'bulb-group');
      g.style.setProperty('--dur', rand(2.2, 4.2).toFixed(2) + 's');
      g.style.setProperty('--delay', (-rand(0, 4)).toFixed(2) + 's');
      const y = p.y + 10;
      g.innerHTML =
        `<rect class="cap" x="${p.x - 2}" y="${p.y}" width="4" height="6" rx="1"/>` +
        `<circle class="bulb-glow" cx="${p.x}" cy="${y + 4}" r="12"/>` +
        `<circle class="bulb" cx="${p.x}" cy="${y + 4}" r="3.2"/>`;
      svg.appendChild(g);
    }
  }

  // ------------------------------------------------------------------ fireflies (same family as the landing page)

  (function fireflies() {
    const canvas = $('#firefly-canvas');
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W, H, flies = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function seed() {
      flies = [];
      const n = reduced ? 6 : 16;
      for (let i = 0; i < n; i++) {
        flies.push({ x: rand(0, W), y: rand(0, H), angle: rand(0, Math.PI * 2), wander: rand(0, 6),
                     ws: rand(0.003, 0.008), speed: rand(0.12, 0.3), r: rand(1.4, 2.4),
                     phase: rand(0, 6), ps: rand(0.012, 0.025) });
      }
    }
    let prev = performance.now();
    function loop(t) {
      const dt = Math.min(2.2, (t - prev) / 16.67 || 1);
      prev = t;
      ctx.clearRect(0, 0, W, H);
      flies.forEach((f) => {
        f.wander += f.ws * dt; f.phase += f.ps * dt;
        f.angle += Math.sin(f.wander) * 0.02 * dt;
        const s = (reduced ? 0.3 : 1) * f.speed * dt;
        f.x += Math.cos(f.angle) * s; f.y += Math.sin(f.angle) * s;
        if (f.x < -20) f.x = W + 20; if (f.x > W + 20) f.x = -20;
        if (f.y < -20) f.y = H + 20; if (f.y > H + 20) f.y = -20;

        const glow = 0.5 + Math.sin(f.phase) * 0.5;
        const a = 0.2 + glow * 0.6;
        const r = f.r * (1 + glow * 0.6);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 6);
        g.addColorStop(0, `rgba(244,213,141,${a * 0.9})`);
        g.addColorStop(0.35, `rgba(244,213,141,${a * 0.25})`);
        g.addColorStop(1, 'rgba(244,213,141,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, r * 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255,244,214,${Math.min(1, a + 0.2)})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      requestAnimationFrame(loop);
    }
    resize(); seed();
    window.addEventListener('resize', () => { resize(); seed(); });
    requestAnimationFrame(loop);
  })();

  // ------------------------------------------------------------------ go

  drawLights();
  render();
})();
