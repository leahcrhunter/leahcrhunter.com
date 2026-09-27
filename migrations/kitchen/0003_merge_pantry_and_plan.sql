-- One pantry row per food per place: merge the duplicates that built up before
-- the Worker started merging on every write (MERGE_PANTRY in src/kitchen/api.js).
UPDATE pantry_items SET
  quantity  = (SELECT CASE WHEN count(p.quantity) = count(*) THEN sum(p.quantity) END FROM pantry_items p WHERE p.ingredient_id = pantry_items.ingredient_id AND p.location = pantry_items.location AND p.unit = pantry_items.unit),
  expires   = (SELECT min(p.expires) FROM pantry_items p WHERE p.ingredient_id = pantry_items.ingredient_id AND p.location = pantry_items.location AND p.unit = pantry_items.unit),
  purchased = (SELECT max(p.purchased) FROM pantry_items p WHERE p.ingredient_id = pantry_items.ingredient_id AND p.location = pantry_items.location AND p.unit = pantry_items.unit),
  opened    = (SELECT min(p.opened) FROM pantry_items p WHERE p.ingredient_id = pantry_items.ingredient_id AND p.location = pantry_items.location AND p.unit = pantry_items.unit),
  notes     = (SELECT coalesce(group_concat(DISTINCT p.notes), '') FROM pantry_items p WHERE p.ingredient_id = pantry_items.ingredient_id AND p.location = pantry_items.location AND p.unit = pantry_items.unit AND p.notes != '')
WHERE id IN (SELECT min(id) FROM pantry_items GROUP BY ingredient_id, location, unit HAVING count(*) > 1);

UPDATE shopping_list SET pantry_item_id = (
  SELECT min(p.id) FROM pantry_items k JOIN pantry_items p
    ON p.ingredient_id = k.ingredient_id AND p.location = k.location AND p.unit = k.unit
  WHERE k.id = shopping_list.pantry_item_id)
WHERE pantry_item_id IS NOT NULL;

DELETE FROM pantry_items WHERE id NOT IN (SELECT min(id) FROM pantry_items GROUP BY ingredient_id, location, unit);

-- The week planner: one dinner per day.
DELETE FROM meal_plan WHERE id NOT IN (SELECT max(id) FROM meal_plan GROUP BY date, meal);
CREATE UNIQUE INDEX meal_plan_day ON meal_plan (date, meal);
