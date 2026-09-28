-- A pantry batch can have its own name ("sunflower oil", "red pepper") while
-- staying linked to the shared ingredient ("vegetable oil", "pepper") that
-- recipes match on. NULL shows the ingredient's name.
ALTER TABLE pantry_items ADD COLUMN name TEXT;
