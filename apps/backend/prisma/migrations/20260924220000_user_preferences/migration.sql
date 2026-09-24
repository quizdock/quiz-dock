-- What an account remembers wherever it signs in (the participant access picked
-- at the last launch, to begin with). Empty for every existing account.
ALTER TABLE "user" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';
