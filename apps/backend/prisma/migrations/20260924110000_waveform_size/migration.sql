-- How thick a question's waveform is drawn on the screens: S (1em), M (2.5em, the
-- default) or L (5em).
CREATE TYPE "WaveformSize" AS ENUM ('S', 'M', 'L');

ALTER TABLE "question" ADD COLUMN "waveform_size" "WaveformSize" NOT NULL DEFAULT 'M';
