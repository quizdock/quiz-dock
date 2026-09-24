-- A question whose sound or video outlasts its timer is stretched to the end of
-- the media plus this pause, set once per quiz — never cut mid-play.
ALTER TABLE "quiz" ADD COLUMN "media_tail_s" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_media_tail_s_check" CHECK ("media_tail_s" BETWEEN 0 AND 30);
