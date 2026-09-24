-- Which devices play a question's sound: the projection only, the projection and
-- the remote players (the default), or every device. A quiz sets the default, a
-- question may override it (null = the default).
CREATE TYPE "AudioTarget" AS ENUM ('projection', 'projection_remote', 'everyone');

ALTER TABLE "quiz" ADD COLUMN "audio_target" "AudioTarget" NOT NULL DEFAULT 'projection_remote';
ALTER TABLE "question" ADD COLUMN "audio_target" "AudioTarget";
