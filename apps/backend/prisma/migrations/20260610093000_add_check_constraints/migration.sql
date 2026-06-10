-- Contraintes CHECK non exprimables dans le schéma Prisma (PSL).
-- Source : specifications/SPECIFICATIONS-DONNEES.md §2.3 / §2.6.

-- Temps limite d'une question : 5 à 120 s (RG-03).
ALTER TABLE "question" ADD CONSTRAINT "question_time_limit_s_check" CHECK ("time_limit_s" BETWEEN 5 AND 120);

-- Tolérance numérique (type numeric) : positive ou nulle.
ALTER TABLE "question" ADD CONSTRAINT "question_numeric_tolerance_check" CHECK ("numeric_tolerance" IS NULL OR "numeric_tolerance" >= 0);

-- Taille d'un média : strictement positive. La borne haute (limite d'upload) reste
-- une politique applicative configurable (cf. roadmap P2-BACK-5), pas une contrainte DB figée.
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_size_bytes_check" CHECK ("size_bytes" > 0);
