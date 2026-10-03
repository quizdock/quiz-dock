-- A quiz or a question can be deleted once it has been played: a quiz takes its
-- archived sessions with it, a question leaves them (history reads the snapshot).
ALTER TABLE "game_session_log" DROP CONSTRAINT "game_session_log_quiz_id_fkey";
ALTER TABLE "game_session_log" ADD CONSTRAINT "game_session_log_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question_result_stat" ALTER COLUMN "question_id" DROP NOT NULL;
ALTER TABLE "question_result_stat" DROP CONSTRAINT "question_result_stat_question_id_fkey";
ALTER TABLE "question_result_stat" ADD CONSTRAINT "question_result_stat_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "answer_log" ALTER COLUMN "question_id" DROP NOT NULL;
ALTER TABLE "answer_log" DROP CONSTRAINT "answer_log_question_id_fkey";
ALTER TABLE "answer_log" ADD CONSTRAINT "answer_log_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
