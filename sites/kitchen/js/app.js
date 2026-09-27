// The shell: header with fairy lights, the four tabs, routing by #hash,
// and keeping every tab in step with the shared data.

import { store, prefs, refresh, onChange, startPolling } from "./store.js";
import { h, $, clear, sheet, toast, closeSheets } from "./ui.js";
import { fairyLights, fireflies } from "./ambient.js";
import { mountPantry } from "./pantry.js";
import { mountRecipes } from "./recipes.js";
import { mountMake } from "./make.js";
import { mountWeek } from "./week.js";
import { ingredientsSheet } from "./ingredients.js";

const panes = {
  pantry: mountPantry($("#pane-pantry")),
  recipes: mountRecipes($("#pane-recipes")),
  make: mountMake($("#pane-make")),
  week: mountWeek($("#pane-week")),
};
let active = "pantry";

// ---------------------------------------------------------------- routing: #pantry, #recipes/12, #week

function route() {
  const [tab, arg] = location.hash.replace(/^#/, "").split("/");
  active = panes[tab] ? tab : "pantry";
  document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.id !== `pane-${active}`; });
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === active;
    t.classList.toggle("on", on);
    if (on) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  if (active === "recipes") {
    if (arg === "can-make") return panes.recipes.canMake();
    panes.recipes.open(arg ? Number(arg) : null);
  } else {
    panes[active].render();
  }
}
window.addEventListener("hashchange", () => { closeSheets(); route(); });

// Re-draw the open tab when the data changes, but not under someone's
// fingers while they're typing recipe notes.
function renderActive() {
  const focused = document.activeElement;
  if (focused?.matches?.("textarea.notes")) {
    focused.addEventListener("blur", () => setTimeout(renderActive, 0), { once: true });
    return;
  }
  panes[active].render();
}

onChange(() => {
  renderActive();
  clear($("#ingredient-names"), store.ingredients.map((i) => h("option", { value: i.name })));
  $("#person").textContent = prefs.person || "who's this?";
});

// ---------------------------------------------------------------- header controls

function drawUnits() {
  document.querySelectorAll(".units button").forEach((b) => {
    const on = b.dataset.units === prefs.units;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}
document.querySelectorAll(".units button").forEach((b) =>
  b.addEventListener("click", () => {
    prefs.units = b.dataset.units;
    drawUnits();
    renderActive();
  })
);

// There's one shared password, so each phone just says who's holding it
// (for "added by Leah" and each person's recipe ratings).
function askPerson() {
  sheet("who's this?", ({ close }) => {
    const input = h("input", { type: "text", value: prefs.person, placeholder: "your name", autofocus: true, maxlength: 40, "aria-label": "your name" });
    const pick = (name) => {
      prefs.person = name.trim();
      $("#person").textContent = prefs.person || "who's this?";
      close();
      renderActive();
    };
    return [
      h("p", { class: "sheet-summary" }, "So the other phone knows who added what. Remembered on this device."),
      store.people.length ? h("div", { class: "chips" }, store.people.map((p) => h("button", { class: `chip${p === prefs.person ? " on" : ""}`, onclick: () => pick(p) }, p))) : null,
      h("form", { class: "field-row", onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) pick(input.value); } }, input, h("button", { class: "btn btn-primary" }, "that's me")),
    ];
  });
}
$("#person").addEventListener("click", askPerson);

$("#menu").addEventListener("click", () =>
  sheet("kitchen", ({ close }) => [
    h("button", { class: "row menu-row", onclick: () => { close(); ingredientsSheet(); } },
      h("span", { class: "row-main" }, h("span", { class: "row-name" }, "ingredients"), h("span", { class: "row-meta" }, "names, aliases, aisles, how long things keep"))),
    h("button", { class: "row menu-row", onclick: () => { close(); askPerson(); } },
      h("span", { class: "row-main" }, h("span", { class: "row-name" }, "switch person"), h("span", { class: "row-meta" }, `this phone is ${prefs.person || "nobody yet"}`))),
    h("a", { class: "row menu-row", href: "/logout" },
      h("span", { class: "row-main" }, h("span", { class: "row-name" }, "sign out"), h("span", { class: "row-meta" }, "this device only"))),
  ])
);

// ---------------------------------------------------------------- go

fairyLights($("#lights"));
fireflies($("#fireflies"));
drawUnits();
$("#person").textContent = prefs.person || "who's this?";
route();

refresh()
  .then(() => {
    document.body.classList.add("ready");
    if (!prefs.person) askPerson();
  })
  .catch((err) => toast(`couldn't load: ${err.message}`, { error: true, timeout: 10000 }));

// Every 4 s while the list is open (so you can split up in the shop), 20 s otherwise.
startPolling(() => (active === "week" ? 4000 : 20000));
