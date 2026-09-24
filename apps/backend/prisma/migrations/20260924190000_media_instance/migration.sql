-- Dimensions of images and videos (read from the bytes; filled in for existing
-- media by the clean-up job), and the instance's own media (#62), provided by
-- administrators to every host.
ALTER TABLE "media_asset" ADD COLUMN "width" INTEGER;
ALTER TABLE "media_asset" ADD COLUMN "height" INTEGER;
ALTER TABLE "media_asset" ADD COLUMN "instance" BOOLEAN NOT NULL DEFAULT false;
