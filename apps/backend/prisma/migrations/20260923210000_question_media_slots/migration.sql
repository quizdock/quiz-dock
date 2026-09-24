-- A question gets two media slots: a visual (image or uploaded video) and an
-- audio track (MP3). A video excludes the audio slot; that rule lives in the API
-- and the shared contract — the kinds sit on `media_asset`, out of a CHECK's reach.

-- The former audio never played anywhere (#42): its rows go, without conversion.
-- Their files stay on the volume until a media clean-up removes them.
UPDATE "question" SET "media_id" = NULL
  WHERE "media_id" IN (SELECT "id" FROM "media_asset" WHERE "kind" = 'audio');
UPDATE "question" SET "background_media_id" = NULL
  WHERE "background_media_id" IN (SELECT "id" FROM "media_asset" WHERE "kind" = 'audio');
UPDATE "answer_option" SET "media_id" = NULL
  WHERE "media_id" IN (SELECT "id" FROM "media_asset" WHERE "kind" = 'audio');
UPDATE "slide" SET "media_id" = NULL
  WHERE "media_id" IN (SELECT "id" FROM "media_asset" WHERE "kind" = 'audio');
UPDATE "quiz" SET "cover_media_id" = NULL
  WHERE "cover_media_id" IN (SELECT "id" FROM "media_asset" WHERE "kind" = 'audio');
DELETE FROM "media_asset" WHERE "kind" = 'audio';

-- Kinds and origins.
ALTER TYPE "media_kind" ADD VALUE 'video';
CREATE TYPE "audio_origin" AS ENUM ('upload', 'recording');

-- What the players need without decoding the file: length, waveform, loudness.
ALTER TABLE "media_asset"
  ADD COLUMN "duration_ms" INTEGER,
  ADD COLUMN "peaks" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
  ADD COLUMN "audio_origin" "audio_origin",
  ADD COLUMN "loudness_lufs" DOUBLE PRECISION,
  ADD COLUMN "peak_dbfs" DOUBLE PRECISION;

-- The single media of a question becomes its visual slot (images are kept).
ALTER TABLE "question" RENAME COLUMN "media_id" TO "visual_media_id";
ALTER TABLE "question" RENAME CONSTRAINT "question_media_id_fkey" TO "question_visual_media_id_fkey";
ALTER TABLE "question" ADD COLUMN "audio_media_id" CHAR(26);
ALTER TABLE "question" ADD CONSTRAINT "question_audio_media_id_fkey"
  FOREIGN KEY ("audio_media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
