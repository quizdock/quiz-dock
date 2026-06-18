-- CreateTable
CREATE TABLE "quiz_feedback" (
    "id" CHAR(26) NOT NULL,
    "quiz_id" CHAR(26) NOT NULL,
    "pin" CHAR(6) NOT NULL,
    "player_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quiz_feedback_quiz_id_created_at_idx" ON "quiz_feedback"("quiz_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_feedback_pin_player_id_key" ON "quiz_feedback"("pin", "player_id");

-- AddForeignKey
ALTER TABLE "quiz_feedback" ADD CONSTRAINT "quiz_feedback_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Note Likert bornée à 1..5 (cohérent avec les autres contraintes CHECK du schéma).
ALTER TABLE "quiz_feedback" ADD CONSTRAINT "quiz_feedback_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
