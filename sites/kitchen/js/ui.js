// Small DOM helpers shared by every tab: an element builder, bottom sheets,
// toasts, and the quantity picker.

import { UNITS, convert, unitChoices, niceUnit, fmtNumber } from "./units.js";
import { prefs } from "./store.js";

// h("button", { class: "x", onclick }, "text", child, [more])
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

// A little glowing bulb: 'on' (have it / done), 'off' (need it), 'soon', 'expired'.
export function bulb(state, label) {
  return h("span", { class: `bulb bulb-${state}`, role: label ? "img" : null, "aria-label": label || null, "aria-hidden": label ? null : "true" });
}

// ---------------------------------------------------------------- sheets

let openSheets = [];

// A panel that slides up from the bottom on a phone, or floats in the middle
// on a laptop. Returns { el, body, close }.
export function sheet(title, build, { onClose, wide } = {}) {
  const body = h("div", { class: "sheet-body" });
  const panel = h(
    "div",
    { class: `sheet${wide ? " sheet-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-head" },
      h("h2", {}, title),
      h("button", { class: "icon-btn", "aria-label": "close", onclick: () => close() }, "✕")
    ),
    body
  );
  const backdrop = h("div", { class: "sheet-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  const previousFocus = document.activeElement;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openSheets = openSheets.filter((s) => s !== api);
    backdrop.classList.add("leaving");
    setTimeout(() => backdrop.remove(), 180);
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.();
  }
  const api = { el: panel, body, close };
  openSheets.push(api);
  document.body.append(backdrop);
  append(body, [build(api)]);
  requestAnimationFrame(() => {
    const first = body.querySelector("[autofocus]") || panel.querySelector(".sheet-head .icon-btn");
    first?.focus({ preventScroll: true });
  });
  return api;
}

export function closeSheets() {
  [...openSheets].reverse().forEach((s) => s.close());
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && openSheets.length) openSheets.at(-1).close();
});

// ---------------------------------------------------------------- toasts

const toastHost = () => document.getElementById("toasts");

export function toast(message, { action, onAction, timeout = 4500, error = false } = {}) {
  const el = h("div", { class: `toast${error ? " toast-error" : ""}`, role: error ? "alert" : "status" }, h("span", {}, message));
  if (action) {
    el.append(h("button", { class: "toast-action", onclick: () => { onAction(); el.remove(); } }, action));
  }
  toastHost().append(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 250);
  }, timeout);
}

// Runs a write, showing any error as a toast and keeping the button from
// being double-tapped while it's in flight.
export async function run(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    if (err.message !== "signed out") toast(err.message, { error: true });
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------------------------------------------------------------- quantity picker

// A number box plus a unit dropdown for something stored in `base`
// ('g' | 'ml' | 'count'). value() gives the amount back in the base unit.
export function qtyInput(base, initial, { ing, label = "amount", autofocus = false } = {}) {
  const system = prefs.units;
  const units = unitChoices(base, system);
  let unit = initial != null ? niceUnit(initial, base, system) : units[0];
  const toShow = (q) => (q == null ? "" : fmtNumber(convertFrom(q, base, unit), { fractions: false }));
  const input = h("input", {
    type: "text", inputmode: "decimal", class: "qty-num", "aria-label": label, autocomplete: "off",
    value: toShow(initial), autofocus,
  });
  const select = h("select", { class: "qty-unit", "aria-label": "unit" },
    units.map((u) => h("option", { value: u, selected: u === unit }, u === "count" ? "×" : u))
  );
  select.addEventListener("change", () => {
    const current = read();
    unit = select.value;
    if (current != null) input.value = toShow(current);
  });
  function read() {
    const raw = input.value.trim().replace(",", ".");
    if (!raw) return null;
    const n = raw.includes("/") ? raw.split("/").reduce((a, b) => Number(a) / Number(b)) : Number(raw);
    if (!Number.isFinite(n)) return null;
    return convert(n, unit, base, ing);
  }
  return {
    el: h("span", { class: "qty-input" }, input, units.length > 1 ? select : h("span", { class: "qty-unit-fixed" }, "×")),
    input,
    value: read,
  };
}

function convertFrom(baseQty, base, unit) {
  const u = UNITS[unit];
  return u && u.dim !== "any" ? baseQty / u.f : baseQty;
}

// Chips: a row of mutually exclusive buttons.
export function chips(options, current, onPick, { label } = {}) {
  const row = h("div", { class: "chips", role: "group", "aria-label": label || null });
  for (const [value, text] of options) {
    row.append(
      h("button", {
        type: "button",
        class: `chip${value === current ? " on" : ""}`,
        "aria-pressed": String(value === current),
        onclick: () => {
          row.querySelectorAll(".chip").forEach((c) => { c.classList.remove("on"); c.setAttribute("aria-pressed", "false"); });
          const me = row.querySelector(`[data-v="${CSS.escape(String(value))}"]`);
          me.classList.add("on");
          me.setAttribute("aria-pressed", "true");
          onPick(value);
        },
        dataset: { v: String(value) },
      }, text)
    );
  }
  return row;
}

// An empty state with a jar holding one firefly.
export function emptyState(title, text) {
  const wrap = h("div", { class: "empty" });
  wrap.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true" class="empty-jar">
    <path d="M24 14 C24 6, 40 6, 40 14" stroke="#c9c2ad" stroke-width="1.3" fill="none" stroke-linecap="round"/>
    <rect x="21" y="10" width="22" height="7" rx="2.5" fill="#8a6a3f" stroke="#5f4a2a" stroke-width="1"/>
    <rect x="23" y="16" width="18" height="7" fill="rgba(244,238,224,0.08)" stroke="rgba(244,238,224,0.35)" stroke-width="1"/>
    <path d="M17 23 H47 V47 C47 54.5, 40.7 58 32 58 C23.3 58, 17 54.5, 17 47 Z" fill="rgba(244,238,224,0.07)" stroke="rgba(244,238,224,0.4)" stroke-width="1.3"/>
    <path d="M22 27 L22 49" stroke="rgba(244,238,224,0.25)" stroke-width="2" stroke-linecap="round"/>
    <circle class="empty-glow" cx="34" cy="40" r="9" fill="#f4d58d" opacity="0.5"/>
    <circle cx="34" cy="40" r="3" fill="#fff4d6"/></svg>`;
  wrap.append(h("p", { class: "empty-title" }, title), h("p", { class: "empty-text" }, text));
  return wrap;
}
