-- Media files shared between the media that carry the same bytes, named after
-- their SHA-256. Existing media are adopted by the backend at start-up (it hashes
-- their files, which SQL cannot); until then `blob_sha256` stays null.
CREATE TABLE "media_blob" (
    "sha256" CHAR(64) NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_blob_pkey" PRIMARY KEY ("sha256")
);

ALTER TABLE "media_asset" ADD COLUMN "blob_sha256" CHAR(64);

CREATE INDEX "media_asset_blob_sha256_idx" ON "media_asset"("blob_sha256");

ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_blob_sha256_fkey" FOREIGN KEY ("blob_sha256") REFERENCES "media_blob"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;
