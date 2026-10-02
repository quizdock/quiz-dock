-- Administration: the indexes its readings use.
-- The audit, newest first by id (its cursor), filtered by operation.
DROP INDEX "admin_audit_operation_at_idx";
CREATE INDEX "admin_audit_operation_id_idx" ON "admin_audit"("operation", "id");

-- The statistics: the games of a period, the last one ended.
CREATE INDEX "game_session_log_started_at_idx" ON "game_session_log"("started_at");
CREATE INDEX "game_session_log_ended_at_idx" ON "game_session_log"("ended_at");
