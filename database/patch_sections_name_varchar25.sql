-- Allow longer section names (e.g. Pre Medical, Pre Engineer) up to 25 characters.
ALTER TABLE sections
  ALTER COLUMN name TYPE VARCHAR(25);
