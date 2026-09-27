// The shared ingredients list: names, aliases, where things live, how long
// they keep. Opened from the menu; it's what every tab matches food against.

import { store, mutate } from "./store.js";
import { h, clear, sheet, toast, run } from "./ui.js";
import { CUP } from "./units.js";
import { LOCATIONS, field } from "./pantry.js";
import { AISLES } from "./week.js";

export function ingredientsSheet() {
  sheet("ingredients", () => {
    const search = h("input", { type: "search", class: "search", placeholder: "search", "aria-label": "search ingredients", autofocus: true });
    const list = h("ul", { class: "rows ing-list" });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const shown = store.ingredients.filter((i) => !q || `${i.name} ${i.aliases}`.toLowerCase().includes(q));
      clear(list, shown.map((ing) =>
        h("li", {}, h("button", { class: "row", onclick: () => editIngredient(ing, draw) },
          h("span", { class: "row-main" },
            h("span", { class: "row-name" }, ing.name),
            h("span", { class: "row-meta" }, [ing.aisle, ing.storage, ing.shelf_days ? `keeps ${ing.shelf_days} days` : null, ing.always_have ? "always have" : null].filter(Boolean).join(" · "))
          )
        ))
      ));
    };
    search.addEventListener("input", draw);
    draw();
    return [h("p", { class: "sheet-summary" }, "Everything the app matches food against. Aliases let “zucchini” find “courgette”."), search, list];
  }, { wide: true });
}

function editIngredient(ing, after) {
  sheet(ing.name, ({ close }) => {
    const num = (v) => h("input", { type: "number", step: "any", min: 0, value: v ?? "" });
    const name = h("input", { type: "text", value: ing.name, required: true });
    const aliases = h("input", { type: "text", value: ing.aliases, placeholder: "other names, comma-separated" });
    const category = h("input", { type: "text", value: ing.category });
    const aisle = h("select", {}, AISLES.map((a) => h("option", { value: a, selected: a === ing.aisle }, a)));
    const storage = h("select", {}, LOCATIONS.map((l) => h("option", { value: l, selected: l === ing.storage }, l)));
    const unit = h("select", {}, [["count", "counted (eggs, onions)"], ["g", "weighed (g)"], ["ml", "measured (ml)"]].map(([v, t]) => h("option", { value: v, selected: v === ing.default_unit }, t)));
    const shelf = num(ing.shelf_days);
    const perCup = num(ing.density ? Math.round(ing.density * CUP) : null);
    const each = num(ing.unit_weight);
    const always = h("input", { type: "checkbox", checked: !!ing.always_have });

    return h("form", {
      class: "form",
      onsubmit: (e) => {
        e.preventDefault();
        run(e.submitter, async () => {
          await mutate("PUT", `ingredients/${ing.id}`, {
            name: name.value, aliases: aliases.value, category: category.value, aisle: aisle.value, storage: storage.value,
            default_unit: unit.value, shelf_days: shelf.value || null,
            density: perCup.value ? Number(perCup.value) / CUP : null, unit_weight: each.value || null,
            always_have: always.checked,
          });
          close();
          after();
          toast("saved");
        });
      },
    },
      field("name", name),
      field("also called", aliases),
      h("div", { class: "field-grid" }, field("aisle", aisle), field("lives in", storage)),
      h("div", { class: "field-grid" }, field("usually", unit), field("keeps (days)", shelf)),
      h("div", { class: "field-grid" }, field("grams per cup", perCup), field("grams each", each)),
      field("category", category),
      h("label", { class: "check-field" }, always, " always in the house (salt, oil): never counts as missing"),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-primary" }, "save"))
    );
  });
}
