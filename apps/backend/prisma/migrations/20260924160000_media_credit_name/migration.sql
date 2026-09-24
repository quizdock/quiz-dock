-- The author's media library (#53): the credit a licence asks for (CC-BY), and
-- the name of the file picked, to find it again. Both optional: media uploaded
-- before have neither.
ALTER TABLE "media_asset" ADD COLUMN "credit" TEXT;
ALTER TABLE "media_asset" ADD COLUMN "name" TEXT;
