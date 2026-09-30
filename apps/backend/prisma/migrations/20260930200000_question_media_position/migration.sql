-- Where a question's picture or video sits against its text on the projection.
CREATE TYPE "MediaPosition" AS ENUM ('bottom', 'top', 'left', 'right');
ALTER TABLE "question" ADD COLUMN "media_position" "MediaPosition" NOT NULL DEFAULT 'bottom';
