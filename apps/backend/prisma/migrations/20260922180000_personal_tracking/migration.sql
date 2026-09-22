-- Personalised tracking (RG-16): a per-session switch. Off, the archive keeps the
-- per-question aggregates and this summary only — no `player_result_log`, and
-- therefore no `answer_log`. Sessions archived so far all kept them, hence true.
ALTER TABLE "game_session_log" ADD COLUMN "personal_tracking" BOOLEAN NOT NULL DEFAULT true;
