-- Run once on existing databases created before students.phone was widened.
-- Allows several contact numbers in students.phone (comma-separated), up to ~200 chars.

ALTER TABLE students
  ALTER COLUMN phone TYPE VARCHAR(200);
