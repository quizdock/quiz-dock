-- One rating per player and per quiz of a room (#89): a room plays several
-- quizzes under one PIN, and rating the next one must not overwrite this one.
DROP INDEX "quiz_feedback_pin_player_id_key";

CREATE UNIQUE INDEX "quiz_feedback_pin_player_id_quiz_id_key" ON "quiz_feedback"("pin", "player_id", "quiz_id");
