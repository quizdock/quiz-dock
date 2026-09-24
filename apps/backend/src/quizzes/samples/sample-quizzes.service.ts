import { Injectable } from '@nestjs/common';
import { Prisma, type Quiz, QuizStatus } from '@prisma/client';
import { normalizeAnswer } from '../../questions/dto/question-content.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { SAMPLE_QUIZZES, type SampleQuiz } from './sample-quizzes.data';

/**
 * Ready-to-play sample quizzes, so a fresh install can be tried in seconds.
 * Written straight through Prisma (no ownership checks needed: we create for a
 * known owner) — the data itself is validated against the API schemas in the spec.
 */
@Injectable()
export class SampleQuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates the sample quizzes for `ownerId` (status `ready`), newest last. */
  async createFor(ownerId: string): Promise<Quiz[]> {
    const created: Quiz[] = [];
    for (const sample of SAMPLE_QUIZZES) {
      created.push(await this.createOne(ownerId, sample));
    }
    return created;
  }

  /** Same, but only when the owner's bank is still empty (first-run welcome kit). */
  async createIfEmpty(ownerId: string): Promise<Quiz[]> {
    const count = await this.prisma.quiz.count({ where: { ownerId } });
    return count === 0 ? this.createFor(ownerId) : [];
  }

  private createOne(ownerId: string, sample: SampleQuiz): Promise<Quiz> {
    return this.prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          ownerId,
          title: sample.title,
          description: sample.description,
          language: sample.language,
          status: QuizStatus.ready,
          questionCount: sample.questions.length,
          questions: {
            create: sample.questions.map((dto, orderIndex) => {
              const isNumeric = dto.type === 'numeric';
              return {
                orderIndex,
                type: dto.type,
                prompt: dto.prompt,
                answerExplanation: dto.answerExplanation || null,
                textTone: dto.textTone,
                textOutline: dto.textOutline,
                timeLimitS: dto.timeLimitS,
                revealDelayS: dto.revealDelayS ?? null,
                audioTarget: dto.audioTarget ?? null,
                waveformSize: dto.waveformSize,
                timerAfterMedia: dto.timerAfterMedia,
                pointsMode: dto.type === 'poll' ? 'none' : dto.pointsMode,
                scoring: dto.scoring,
                numericValue: isNumeric ? dto.numericValue : null,
                numericTolerance: isNumeric ? dto.numericTolerance : null,
                options: {
                  create: dto.options.map((o, i) => ({
                    orderIndex: i,
                    text: o.text,
                    color: o.color,
                    shape: o.shape,
                    isCorrect: o.isCorrect,
                    correctOrderIndex: o.correctOrderIndex,
                  })),
                },
                acceptedAnswers: {
                  create: dto.acceptedAnswers.map((a) => ({
                    text: a.text,
                    normalized: normalizeAnswer(a.text),
                  })),
                },
              };
            }),
          },
        },
      });
      const first = await tx.question.findFirst({
        where: { quizId: quiz.id, orderIndex: 0 },
        select: { id: true },
      });
      const intro = sample.intro;
      await tx.slide.create({
        data: {
          quizId: quiz.id,
          beforeQuestionId: first?.id ?? null,
          orderIndex: 0,
          blocks: intro.blocks as Prisma.InputJsonValue,
          mediaId: intro.mediaId || null,
          gradient: intro.gradient ?? Prisma.JsonNull,
          textTone: intro.textTone,
          textOutline: intro.textOutline,
          displayDelayS: intro.displayDelayS ?? null,
        },
      });
      return quiz;
    });
  }
}
