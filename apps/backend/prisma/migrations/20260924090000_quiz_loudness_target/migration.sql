-- The level a quiz brings its sounds and videos to at playback: loud (-14 LUFS,
-- streaming), balanced (-16, the default) or calm (-23, broadcast).
ALTER TABLE "quiz" ADD COLUMN "loudness_target_lufs" INTEGER NOT NULL DEFAULT -16;
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_loudness_target_lufs_check" CHECK ("loudness_target_lufs" IN (-14, -16, -23));
