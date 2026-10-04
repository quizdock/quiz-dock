-- `locale` becomes the host's interface language (#209): absent = the instance's. Its
-- old default (`fr`) was never chosen by anyone, so every value goes.
ALTER TABLE "user" ALTER COLUMN "locale" DROP DEFAULT;
ALTER TABLE "user" ALTER COLUMN "locale" DROP NOT NULL;
UPDATE "user" SET "locale" = NULL;
