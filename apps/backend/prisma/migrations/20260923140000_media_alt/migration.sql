-- Alternative text for a media (#43): a question whose image *is* the question
-- cannot be answered with a screen reader without it. Null everywhere to start —
-- nothing was ever authored, and an empty alt stays valid for decoration.
ALTER TABLE "media_asset" ADD COLUMN "alt" TEXT;
