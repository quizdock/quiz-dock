-- Listen first, then answer: the question's timer starts when its sound or video
-- ends instead of with the question.
ALTER TABLE "question" ADD COLUMN "timer_after_media" BOOLEAN NOT NULL DEFAULT false;
