-- Administration: the audit of every administrative action, append-only.
CREATE TABLE "admin_audit" (
    "id" CHAR(26) NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "via" VARCHAR(8) NOT NULL,
    "actor" TEXT NOT NULL,
    "user_id" CHAR(26),
    "address" TEXT,
    "operation" VARCHAR(64) NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "outcome" VARCHAR(16) NOT NULL,
    "code" VARCHAR(64),
    "duration_ms" INTEGER NOT NULL,

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_at_idx" ON "admin_audit"("at");
CREATE INDEX "admin_audit_operation_at_idx" ON "admin_audit"("operation", "at");
