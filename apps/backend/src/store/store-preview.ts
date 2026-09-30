import { createHash } from 'node:crypto';
import { NO_QUESTION_MEDIA } from '@quiz-dock/contracts';
import { normalizeAnswer } from '../questions/dto/question-content.schema';
import type { QuestionDto } from '../questions/dto/question.dto';
import type { SlideDto } from '../slides/dto/slide.dto';
import {
  BundleContentError,
  type ImportedAsset,
  fromBundle,
} from '../quizzes/portable/quiz-bundle';
import { quizBundleSchema } from '../quizzes/portable/quiz-bundle.schema';

/** A template's steps, in the shape of a quiz's: the editor's preview draws them as such. */
export interface TemplateSteps {
  questions: QuestionDto[];
  slides: SlideDto[];
  /** Each stand-in media id, and where the catalogue serves that file. */
  media: Record<string, string>;
  /**
   * What a copy would refuse, `null` when the template reads whole: the item
   * (1-based), or `null` for the manifest as a whole.
   */
  invalid: { item: number | null } | null;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A stable 26-character id for a bundle path: what the import gives an uploaded media. */
function standInId(path: string): string {
  const bytes = createHash('sha256').update(path).digest();
  return Array.from(bytes.subarray(0, 26), (b) => CROCKFORD[b % 32]).join('');
}

/** A media's kind by its extension (the preview reads no file). */
function kindOf(path: string): ImportedAsset['kind'] {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext === 'mp4' ? 'video' : ext === 'mp3' || ext === 'm4a' ? 'audio' : 'image';
}

/**
 * What taking a copy of the template would create, read through the import itself
 * (`fromBundle`), so the preview shows exactly that. Media keep stand-in ids,
 * mapped to the catalogue's URLs (`urlOf`); nothing is written anywhere.
 */
export function templateSteps(
  manifest: unknown,
  templateId: string,
  urlOf: (path: string) => string | null,
): TemplateSteps {
  const media: Record<string, string> = {};
  const idFor = (path: string) => {
    const id = standInId(path);
    const url = urlOf(path);
    if (url) media[id] = url;
    return id;
  };
  const parsed = quizBundleSchema.safeParse(manifest);
  if (!parsed.success) {
    const item = parsed.error.issues.find((i) => i.path[0] === 'items')?.path[1];
    return {
      questions: [],
      slides: [],
      media,
      invalid: { item: typeof item === 'number' ? item + 1 : null },
    };
  }
  let imported: ReturnType<typeof fromBundle>;
  try {
    imported = fromBundle(parsed.data, idFor, kindOf);
  } catch (err) {
    if (!(err instanceof BundleContentError)) throw err;
    return { questions: [], slides: [], media, invalid: { item: err.item + 1 } };
  }
  const questionId = (i: number) => `${templateId}-q${i}`;
  const questions: QuestionDto[] = imported.questions.map((q, i) => ({
    id: questionId(i),
    quizId: templateId,
    orderIndex: i,
    type: q.type,
    prompt: q.prompt,
    media: q.media ?? NO_QUESTION_MEDIA,
    answerExplanation: q.answerExplanation ?? null,
    backgroundMediaId: q.backgroundMediaId ?? null,
    backgroundGradient: q.backgroundGradient ?? null,
    textTone: q.textTone,
    textOutline: q.textOutline,
    timeLimitS: q.timeLimitS,
    revealDelayS: q.revealDelayS ?? null,
    audioTarget: q.audioTarget ?? null,
    waveformSize: q.waveformSize,
    mediaPosition: q.mediaPosition,
    timerAfterMedia: q.timerAfterMedia,
    pointsMode: q.type === 'poll' ? 'none' : q.pointsMode,
    scoring: q.scoring,
    numericValue: q.numericValue == null ? null : String(q.numericValue),
    numericTolerance: q.numericTolerance == null ? null : String(q.numericTolerance),
    multiSelect: q.multiSelect,
    options: q.options.map((o, j) => ({
      id: `${questionId(i)}-o${j}`,
      orderIndex: j,
      text: o.text ?? null,
      mediaId: o.mediaId ?? null,
      alt: o.alt ?? null,
      color: o.color,
      shape: o.shape,
      isCorrect: o.isCorrect,
      correctOrderIndex: o.correctOrderIndex ?? null,
    })),
    acceptedAnswers: q.acceptedAnswers.map((a, j) => ({
      id: `${questionId(i)}-a${j}`,
      text: a.text,
      normalized: normalizeAnswer(a.text),
    })),
  }));
  const slides: SlideDto[] = imported.slides.map((s, i) => ({
    id: `${templateId}-s${i}`,
    quizId: templateId,
    beforeQuestionId: s.beforeQuestion === null ? null : questionId(s.beforeQuestion),
    orderIndex: s.orderIndex,
    blocks: s.content.blocks,
    mediaId: s.content.mediaId ?? null,
    gradient: s.content.gradient ?? null,
    videoMediaId: s.content.videoMediaId ?? null,
    videoLoop: s.content.videoLoop,
    videoSound: s.content.videoSound,
    audioMediaId: s.content.audioMediaId ?? null,
    waveformSize: s.content.waveformSize,
    audioTarget: s.content.audioTarget ?? null,
    textTone: s.content.textTone,
    textOutline: s.content.textOutline,
    displayDelayS: s.content.displayDelayS ?? null,
  }));
  return { questions, slides, media, invalid: null };
}
