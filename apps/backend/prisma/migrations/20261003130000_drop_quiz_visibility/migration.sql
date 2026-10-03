-- A quiz is shared through `shared`; `visibility` was never read nor written since
-- it stopped being exposed (#21, closed): the column and its type go.
ALTER TABLE "quiz" DROP COLUMN "visibility";
DROP TYPE "quiz_visibility";
