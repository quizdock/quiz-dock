-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('host', 'player', 'admin');

-- CreateEnum
CREATE TYPE "quiz_status" AS ENUM ('draft', 'ready', 'archived');

-- CreateEnum
CREATE TYPE "quiz_visibility" AS ENUM ('private', 'unlisted');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('single_choice', 'multiple_choice', 'true_false', 'text_input', 'numeric', 'ordering', 'poll');

-- CreateEnum
CREATE TYPE "points_mode" AS ENUM ('standard', 'double', 'none');

-- CreateEnum
CREATE TYPE "option_color" AS ENUM ('red', 'blue', 'yellow', 'green');

-- CreateEnum
CREATE TYPE "option_shape" AS ENUM ('triangle', 'diamond', 'circle', 'square');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('image', 'audio');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('lobby', 'in_progress', 'ended', 'archived');

-- CreateTable
CREATE TABLE "user" (
    "id" CHAR(26) NOT NULL,
    "keycloak_sub" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" CITEXT,
    "role" "user_role" NOT NULL DEFAULT 'player',
    "locale" TEXT NOT NULL DEFAULT 'fr',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz" (
    "id" CHAR(26) NOT NULL,
    "owner_id" CHAR(26) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "cover_media_id" CHAR(26),
    "status" "quiz_status" NOT NULL DEFAULT 'draft',
    "visibility" "quiz_visibility" NOT NULL DEFAULT 'private',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "question_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question" (
    "id" CHAR(26) NOT NULL,
    "quiz_id" CHAR(26) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "type" "question_type" NOT NULL,
    "prompt" TEXT NOT NULL,
    "media_id" CHAR(26),
    "time_limit_s" INTEGER NOT NULL DEFAULT 20,
    "points_mode" "points_mode" NOT NULL DEFAULT 'standard',
    "numeric_value" DECIMAL(65,30),
    "numeric_tolerance" DECIMAL(65,30),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_option" (
    "id" CHAR(26) NOT NULL,
    "question_id" CHAR(26) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "text" TEXT,
    "media_id" CHAR(26),
    "color" "option_color" NOT NULL,
    "shape" "option_shape" NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "correct_order_index" INTEGER,

    CONSTRAINT "answer_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accepted_answer" (
    "id" CHAR(26) NOT NULL,
    "question_id" CHAR(26) NOT NULL,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "accepted_answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_asset" (
    "id" CHAR(26) NOT NULL,
    "owner_id" CHAR(26) NOT NULL,
    "url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "kind" "media_kind" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_session_log" (
    "id" CHAR(26) NOT NULL,
    "quiz_id" CHAR(26) NOT NULL,
    "host_id" CHAR(26) NOT NULL,
    "pin" CHAR(6) NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'ended',
    "language" TEXT NOT NULL,
    "player_count" INTEGER NOT NULL DEFAULT 0,
    "success_rate" DECIMAL(65,30),
    "full_capture" BOOLEAN NOT NULL DEFAULT false,
    "quiz_snapshot" JSONB,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6) NOT NULL,
    "retain_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_session_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_result_log" (
    "id" CHAR(26) NOT NULL,
    "session_log_id" CHAR(26) NOT NULL,
    "user_id" CHAR(26),
    "nickname" TEXT NOT NULL,
    "final_score" INTEGER NOT NULL DEFAULT 0,
    "final_rank" INTEGER NOT NULL,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "answered_count" INTEGER NOT NULL DEFAULT 0,
    "avg_response_ms" INTEGER,
    "max_streak" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_result_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_result_stat" (
    "id" CHAR(26) NOT NULL,
    "session_log_id" CHAR(26) NOT NULL,
    "question_id" CHAR(26) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "correct_count" INTEGER NOT NULL DEFAULT 0,
    "answer_count" INTEGER NOT NULL DEFAULT 0,
    "success_rate" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "avg_response_ms" INTEGER,
    "distribution" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "question_result_stat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answer_log" (
    "id" CHAR(26) NOT NULL,
    "session_log_id" CHAR(26) NOT NULL,
    "player_result_log_id" CHAR(26) NOT NULL,
    "question_id" CHAR(26) NOT NULL,
    "order_index" INTEGER NOT NULL,
    "answer_value" JSONB NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "response_ms" INTEGER NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "answer_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_keycloak_sub_key" ON "user"("keycloak_sub");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "quiz_owner_id_status_idx" ON "quiz"("owner_id", "status");

-- CreateIndex
CREATE INDEX "question_quiz_id_idx" ON "question"("quiz_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_quiz_id_order_index_key" ON "question"("quiz_id", "order_index");

-- CreateIndex
CREATE INDEX "answer_option_question_id_idx" ON "answer_option"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "answer_option_question_id_order_index_key" ON "answer_option"("question_id", "order_index");

-- CreateIndex
CREATE INDEX "accepted_answer_question_id_normalized_idx" ON "accepted_answer"("question_id", "normalized");

-- CreateIndex
CREATE INDEX "media_asset_owner_id_idx" ON "media_asset"("owner_id");

-- CreateIndex
CREATE INDEX "game_session_log_quiz_id_idx" ON "game_session_log"("quiz_id");

-- CreateIndex
CREATE INDEX "game_session_log_host_id_started_at_idx" ON "game_session_log"("host_id", "started_at");

-- CreateIndex
CREATE INDEX "game_session_log_retain_until_idx" ON "game_session_log"("retain_until");

-- CreateIndex
CREATE INDEX "player_result_log_session_log_id_final_rank_idx" ON "player_result_log"("session_log_id", "final_rank");

-- CreateIndex
CREATE INDEX "player_result_log_user_id_session_log_id_idx" ON "player_result_log"("user_id", "session_log_id");

-- CreateIndex
CREATE INDEX "question_result_stat_session_log_id_order_index_idx" ON "question_result_stat"("session_log_id", "order_index");

-- CreateIndex
CREATE INDEX "answer_log_session_log_id_order_index_idx" ON "answer_log"("session_log_id", "order_index");

-- CreateIndex
CREATE INDEX "answer_log_player_result_log_id_idx" ON "answer_log"("player_result_log_id");

-- AddForeignKey
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_cover_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question" ADD CONSTRAINT "question_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question" ADD CONSTRAINT "question_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_option" ADD CONSTRAINT "answer_option_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_option" ADD CONSTRAINT "answer_option_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accepted_answer" ADD CONSTRAINT "accepted_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_session_log" ADD CONSTRAINT "game_session_log_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_session_log" ADD CONSTRAINT "game_session_log_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_result_log" ADD CONSTRAINT "player_result_log_session_log_id_fkey" FOREIGN KEY ("session_log_id") REFERENCES "game_session_log"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_result_log" ADD CONSTRAINT "player_result_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_result_stat" ADD CONSTRAINT "question_result_stat_session_log_id_fkey" FOREIGN KEY ("session_log_id") REFERENCES "game_session_log"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_result_stat" ADD CONSTRAINT "question_result_stat_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_log" ADD CONSTRAINT "answer_log_session_log_id_fkey" FOREIGN KEY ("session_log_id") REFERENCES "game_session_log"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_log" ADD CONSTRAINT "answer_log_player_result_log_id_fkey" FOREIGN KEY ("player_result_log_id") REFERENCES "player_result_log"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answer_log" ADD CONSTRAINT "answer_log_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
