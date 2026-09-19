-- Text outline (subtitle-like halo over a background) is on by default for
-- slides and questions. Existing rows keep their setting, except the built-in
-- sample quizzes, which follow the new default.
ALTER TABLE "slide" ALTER COLUMN "text_outline" SET DEFAULT true;
ALTER TABLE "question" ALTER COLUMN "text_outline" SET DEFAULT true;

UPDATE "question" SET "text_outline" = true
WHERE "quiz_id" IN (SELECT "id" FROM "quiz" WHERE "title" IN ('Discover France', 'Discover Taiwan'));
UPDATE "slide" SET "text_outline" = true
WHERE "quiz_id" IN (SELECT "id" FROM "quiz" WHERE "title" IN ('Discover France', 'Discover Taiwan'));
