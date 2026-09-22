-- The identity of a shared template (RG-17), minted at the first share and kept
-- across a withdrawal: everyone holding a copy keeps seeing the same template.
-- Null for every existing quiz — nothing has been shared before this.
ALTER TABLE "quiz" ADD COLUMN "publication_id" CHAR(26);
