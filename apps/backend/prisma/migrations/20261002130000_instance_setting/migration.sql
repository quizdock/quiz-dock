-- Administration: the settings changed from the administration, over the environment.
CREATE TABLE "instance_setting" (
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by" TEXT NOT NULL,
    "user_id" CHAR(26),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instance_setting_pkey" PRIMARY KEY ("key")
);
