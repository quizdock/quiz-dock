-- The room a session was played in (#89): the sessions of one room are read
-- together (its quizzes, its standings). Null for sessions archived before rooms.
ALTER TABLE "game_session_log" ADD COLUMN "room_id" CHAR(32);

CREATE INDEX "game_session_log_room_id_idx" ON "game_session_log"("room_id");
