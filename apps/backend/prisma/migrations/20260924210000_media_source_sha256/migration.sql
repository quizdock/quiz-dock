-- The SHA-256 of the file an author picked, before conversion: the same video
-- uploaded again is recognised even though its re-encoding never gives the same
-- bytes. Looked up among the author's own media and the instance's only.
ALTER TABLE "media_asset" ADD COLUMN "source_sha256" CHAR(64);

CREATE INDEX "media_asset_owner_id_source_sha256_idx" ON "media_asset"("owner_id", "source_sha256");
