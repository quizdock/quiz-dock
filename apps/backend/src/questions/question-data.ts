import { Prisma } from '@prisma/client';
import type { QuestionIssue } from '@quiz-dock/contracts';
import type { QuestionContent } from './dto/question-content.schema';
import { normalizeAnswer, questionIssues } from './dto/question-content.schema';

/**
 * A question's content as rows, one way for every path that writes one: the
 * editor, an import, the samples, a copy. A new column or rule is added here.
 */

/** The question's own columns (its media slots aside: resolved by their caller). */
export function questionData(dto: QuestionContent) {
  const isNumeric = dto.type === 'numeric';
  return {
    type: dto.type,
    prompt: dto.prompt,
    answerExplanation: dto.answerExplanation || null,
    backgroundMediaId: dto.backgroundMediaId || null,
    backgroundGradient: dto.backgroundGradient ?? Prisma.JsonNull,
    textTone: dto.textTone,
    textOutline: dto.textOutline,
    timeLimitS: dto.timeLimitS,
    revealDelayS: dto.revealDelayS ?? null,
    audioTarget: dto.audioTarget ?? null,
    waveformSize: dto.waveformSize,
    mediaPosition: dto.mediaPosition,
    timerAfterMedia: dto.timerAfterMedia,
    // Un sondage ne rapporte aucun point (technique §4).
    pointsMode: dto.type === 'poll' ? 'none' : dto.pointsMode,
    scoring: dto.scoring,
    // A draft may leave them unset: null, not "unchanged" on an update.
    numericValue: isNumeric ? (dto.numericValue ?? null) : null,
    numericTolerance: isNumeric ? (dto.numericTolerance ?? null) : null,
    multiSelect: dto.type === 'image_choice' && dto.multiSelect,
  };
}

export function optionsData(dto: QuestionContent) {
  return dto.options.map((o, orderIndex) => ({
    orderIndex,
    text: o.text,
    mediaId: o.mediaId,
    alt: o.alt || null,
    color: o.color,
    shape: o.shape,
    isCorrect: o.isCorrect,
    correctOrderIndex: o.correctOrderIndex,
  }));
}

export function acceptedAnswersData(dto: QuestionContent) {
  return dto.acceptedAnswers.map((a) => ({ text: a.text, normalized: normalizeAnswer(a.text) }));
}

/** The media ids a question's content points at, as they are stored. */
export function questionMediaIds(dto: QuestionContent) {
  const visual = dto.media?.visual;
  return {
    visualMediaId: visual && 'assetId' in visual ? visual.assetId : null,
    audioMediaId: dto.media?.audio?.assetId ?? null,
  };
}

/** Every media a question holds: its two slots, its background, its answers' pictures. */
export function questionMediaHeld(q: {
  visualMediaId: string | null;
  audioMediaId: string | null;
  backgroundMediaId: string | null;
  options: { mediaId?: string | null }[];
}): (string | null | undefined)[] {
  return [q.visualMediaId, q.audioMediaId, q.backgroundMediaId, ...q.options.map((o) => o.mediaId)];
}

/** Everything to create a question at `orderIndex`, with its answers. */
export function questionCreateData(
  dto: QuestionContent,
  orderIndex: number,
  media: { visualMediaId: string | null; audioMediaId: string | null },
) {
  return {
    orderIndex,
    ...questionData(dto),
    ...media,
    options: { create: optionsData(dto) },
    acceptedAnswers: { create: acceptedAnswersData(dto) },
  };
}

/** What a stored question still needs to be played (`questionIssues` on its row). */
export function storedQuestionIssues(q: {
  type: QuestionContent['type'];
  prompt: string;
  visualMediaId: string | null;
  audioMediaId: string | null;
  multiSelect: boolean;
  numericValue: Prisma.Decimal | null;
  numericTolerance: Prisma.Decimal | null;
  options: {
    text: string | null;
    mediaId: string | null;
    alt: string | null;
    isCorrect: boolean;
  }[];
  acceptedAnswers: { text: string }[];
}): QuestionIssue[] {
  return questionIssues({
    ...q,
    media: { visual: q.visualMediaId, audio: q.audioMediaId },
    numericValue: q.numericValue?.toNumber() ?? null,
    numericTolerance: q.numericTolerance?.toNumber() ?? null,
  });
}
