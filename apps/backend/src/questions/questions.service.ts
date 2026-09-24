import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import type { QuestionContent } from './dto/question-content.schema';
import { normalizeAnswer } from './dto/question-content.schema';
import type { ReorderQuestionsDto } from './dto/reorder-questions.dto';
import { QUESTION_MEDIA_INCLUDE, questionMediaOf, resolveQuestionMedia } from './question-media';

export const QUESTION_INCLUDE = {
  options: { orderBy: { orderIndex: 'asc' } },
  acceptedAnswers: true,
  ...QUESTION_MEDIA_INCLUDE,
} satisfies Prisma.QuestionInclude;

type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

/** A question as the editor reads it: its media as the contract's two slots. */
export function toQuestionOutput(q: QuestionRow) {
  const { visualMedia, audioMedia, ...rest } = q;
  return { ...rest, media: questionMediaOf({ visualMedia, audioMedia }) };
}

/** Décalage temporaire pour réordonner sans violer @@unique([quizId, orderIndex]). */
const REORDER_OFFSET = 1000;

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  async add(ownerId: string, quizId: string, dto: QuestionContent) {
    await this.assertQuizOwned(ownerId, quizId);
    const agg = await this.prisma.question.aggregate({
      where: { quizId },
      _max: { orderIndex: true },
    });
    const orderIndex = (agg._max.orderIndex ?? -1) + 1;
    const media = await resolveQuestionMedia(this.prisma, ownerId, dto.media);
    const [question] = await this.prisma.$transaction([
      this.prisma.question.create({
        data: {
          quizId,
          orderIndex,
          ...this.contentData(dto),
          ...media,
          options: { create: this.optionsCreate(dto) },
          acceptedAnswers: { create: this.answersCreate(dto) },
        },
        include: QUESTION_INCLUDE,
      }),
      this.prisma.quiz.update({
        where: { id: quizId },
        data: { questionCount: { increment: 1 } },
      }),
    ]);
    return toQuestionOutput(question);
  }

  async update(ownerId: string, questionId: string, dto: QuestionContent) {
    const current = await this.assertQuestionOwned(ownerId, questionId);
    // Remplacement complet des enfants (atomique). OK tant que le quiz n'a pas
    // été joué (les sessions jouées sont figées par snapshot, §2.7).
    const media = await resolveQuestionMedia(this.prisma, ownerId, dto.media, [
      current.visualMediaId,
      current.audioMediaId,
    ]);
    const question = await this.prisma.question.update({
      where: { id: questionId },
      data: {
        ...this.contentData(dto),
        ...media,
        options: { deleteMany: {}, create: this.optionsCreate(dto) },
        acceptedAnswers: { deleteMany: {}, create: this.answersCreate(dto) },
      },
      include: QUESTION_INCLUDE,
    });
    // A replaced or removed media leaves with its file, unless something else holds it.
    await this.media.releaseUnused(
      [current.visualMediaId, current.audioMediaId].filter(
        (id) => id !== media.visualMediaId && id !== media.audioMediaId,
      ),
    );
    return toQuestionOutput(question);
  }

  async remove(ownerId: string, questionId: string): Promise<void> {
    const { quizId, visualMediaId, audioMediaId } = await this.assertQuestionOwned(
      ownerId,
      questionId,
    );
    await this.prisma.$transaction([
      this.prisma.question.delete({ where: { id: questionId } }),
      this.prisma.quiz.update({
        where: { id: quizId },
        data: { questionCount: { decrement: 1 } },
      }),
    ]);
    await this.media.releaseUnused([visualMediaId, audioMediaId]);
  }

  async reorder(ownerId: string, quizId: string, dto: ReorderQuestionsDto) {
    await this.assertQuizOwned(ownerId, quizId);
    const owned = await this.prisma.question.findMany({
      where: { quizId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((q) => q.id));
    const { items } = dto;
    if (items.length !== ownedIds.size) {
      throw new BadRequestException('question.reorder_incomplete');
    }
    const indices = new Set<number>();
    for (const it of items) {
      if (!ownedIds.has(it.questionId)) {
        throw new BadRequestException('question.not_in_quiz');
      }
      indices.add(it.orderIndex);
    }
    const isPermutation =
      indices.size === items.length && [...indices].every((i) => i >= 0 && i < items.length);
    if (!isPermutation) {
      throw new BadRequestException('question.invalid_permutation');
    }
    // Deux phases : on décale d'abord (valeurs uniques hors plage finale) puis on
    // pose les positions finales — évite toute collision d'unicité immédiate.
    await this.prisma.$transaction([
      ...items.map((it) =>
        this.prisma.question.update({
          where: { id: it.questionId },
          data: { orderIndex: it.orderIndex + REORDER_OFFSET },
        }),
      ),
      ...items.map((it) =>
        this.prisma.question.update({
          where: { id: it.questionId },
          data: { orderIndex: it.orderIndex },
        }),
      ),
    ]);
    const questions = await this.prisma.question.findMany({
      where: { quizId },
      orderBy: { orderIndex: 'asc' },
      include: QUESTION_INCLUDE,
    });
    return questions.map(toQuestionOutput);
  }

  private contentData(dto: QuestionContent) {
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
      timerAfterMedia: dto.timerAfterMedia,
      // Un sondage ne rapporte aucun point (technique §4).
      pointsMode: dto.type === 'poll' ? 'none' : dto.pointsMode,
      scoring: dto.scoring,
      numericValue: isNumeric ? dto.numericValue : null,
      numericTolerance: isNumeric ? dto.numericTolerance : null,
    };
  }

  private optionsCreate(dto: QuestionContent) {
    return dto.options.map((o, orderIndex) => ({
      orderIndex,
      text: o.text,
      mediaId: o.mediaId,
      color: o.color,
      shape: o.shape,
      isCorrect: o.isCorrect,
      correctOrderIndex: o.correctOrderIndex,
    }));
  }

  private answersCreate(dto: QuestionContent) {
    return dto.acceptedAnswers.map((a) => ({
      text: a.text,
      normalized: normalizeAnswer(a.text),
    }));
  }

  private async assertQuizOwned(ownerId: string, quizId: string): Promise<void> {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id: quizId, ownerId },
      select: { id: true },
    });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
  }

  /** Isolation des routes /questions/:qid : on remonte au propriétaire via le quiz. */
  private async assertQuestionOwned(ownerId: string, questionId: string) {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, quiz: { ownerId } },
      select: { id: true, quizId: true, visualMediaId: true, audioMediaId: true },
    });
    if (!question) {
      throw new NotFoundException('question.not_found');
    }
    return question;
  }
}
