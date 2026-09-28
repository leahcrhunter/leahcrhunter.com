-- What a pantry batch came in, when that's how it's counted: 'tin', 'jar',
-- 'bottle', 'bag' or 'pack' ("2 tins", "a bag of potatoes"). quantity is then
-- the number of them and unit is 'count'. NULL is the usual g / ml / count.
ALTER TABLE pantry_items ADD COLUMN pack TEXT;
