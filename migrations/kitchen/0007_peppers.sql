-- Telling peppers apart: ground pepper is black pepper, chilli peppers are
-- chillies, and "pepper" the vegetable is named bell pepper (with "pepper"
-- kept as another name, so recipes still find it). Appends to whatever
-- aliases are there already, in case they've been edited.
UPDATE ingredients
SET aliases = trim(aliases || ', ground pepper, freshly ground pepper, cracked pepper, cracked black pepper, fresh ground pepper', ', ')
WHERE name = 'black pepper';

UPDATE ingredients
SET aliases = trim(aliases || ', chilli pepper, chili pepper, chilli peppers, red chilli pepper, green chilli pepper, red chili pepper, green chili pepper, hot pepper, jalapeño, jalapeño pepper, scotch bonnet, scotch bonnet pepper, habanero, habanero pepper, finger chilli, thai chilli', ', ')
WHERE name = 'chilli';

UPDATE ingredients
SET name = 'bell pepper', aliases = trim('pepper, ' || aliases, ', ')
WHERE name = 'pepper' AND NOT EXISTS (SELECT 1 FROM ingredients WHERE name = 'bell pepper');
