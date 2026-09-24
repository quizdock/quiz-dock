import { Prisma } from '@prisma/client';

/**
 * Anything shaped like a media id (a ULID) in a text: a Markdown image's URL, a
 * slide's image block, a frozen snapshot. Matches that are quiz or question ids
 * fall away when joined to `media_asset`.
 */
const MEDIA_ID = '([0-9A-HJKMNP-TV-Z]{26})';

/**
 * Every (quiz, media) use, in one pass over the quizzes: the slots, the
 * options, the slides, and the ids found in their texts. The same places
 * `MediaService.isReferenced` looks one media at a time — read here once for a
 * whole page, where a `LIKE` per media would scan every text again for each.
 */
export const QUIZ_MEDIA_REFS = Prisma.sql`
  SELECT q.id AS quiz_id, q.cover_media_id AS media_id FROM quiz q WHERE q.cover_media_id IS NOT NULL
  UNION ALL
  SELECT x.quiz_id, v.media_id FROM question x
    CROSS JOIN LATERAL (VALUES (x.visual_media_id), (x.audio_media_id), (x.background_media_id)) v (media_id)
    WHERE v.media_id IS NOT NULL
  UNION ALL
  SELECT x.quiz_id, o.media_id FROM answer_option o JOIN question x ON x.id = o.question_id
    WHERE o.media_id IS NOT NULL
  UNION ALL
  SELECT s.quiz_id, s.media_id FROM slide s WHERE s.media_id IS NOT NULL
  UNION ALL
  SELECT q.id, r[1] FROM quiz q, regexp_matches(COALESCE(q.description, ''), ${MEDIA_ID}, 'g') r
  UNION ALL
  SELECT x.quiz_id, r[1] FROM question x,
    regexp_matches(x.prompt || ' ' || COALESCE(x.answer_explanation, ''), ${MEDIA_ID}, 'g') r
  UNION ALL
  SELECT x.quiz_id, r[1] FROM answer_option o JOIN question x ON x.id = o.question_id,
    regexp_matches(COALESCE(o.text, ''), ${MEDIA_ID}, 'g') r
  UNION ALL
  SELECT s.quiz_id, r[1] FROM slide s, regexp_matches(s.blocks::text, ${MEDIA_ID}, 'g') r`;

/** The media ids the archived sessions show (their frozen snapshots), in one pass. */
export const ARCHIVED_MEDIA_REFS = Prisma.sql`
  SELECT DISTINCT r[1] AS media_id
  FROM game_session_log g, regexp_matches(g.quiz_snapshot::text, ${MEDIA_ID}, 'g') r`;
