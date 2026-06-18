import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type Quiz, QuizStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateQuizDto } from './dto/create-quiz.dto';
import type { TransitionQuizDto } from './dto/transition-quiz.dto';
import type { UpdateQuizDto } from './dto/update-quiz.dto';

/** Transitions de cycle de vie autorisées (RG-02). */
const ALLOWED_TRANSITIONS: Record<QuizStatus, QuizStatus[]> = {
  [QuizStatus.draft]: [QuizStatus.ready, QuizStatus.archived],
  [QuizStatus.ready]: [QuizStatus.draft, QuizStatus.archived],
  [QuizStatus.archived]: [QuizStatus.draft],
};

@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Quiz du formateur (banque privée), les plus récents d'abord. */
  list(ownerId: string): Promise<Quiz[]> {
    return this.prisma.quiz.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Crée un quiz appartenant à `ownerId` (statut `draft` par défaut). */
  create(ownerId: string, dto: CreateQuizDto): Promise<Quiz> {
    return this.prisma.quiz.create({
      data: {
        ownerId,
        title: dto.title,
        description: dto.description,
        language: dto.language,
        coverMediaId: dto.coverMediaId,
      },
    });
  }

  /** Détail d'un quiz possédé, questions ordonnées incluses (404 sinon). */
  async get(ownerId: string, id: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            options: { orderBy: { orderIndex: 'asc' } },
            acceptedAnswers: true,
          },
        },
      },
    });
    if (!quiz) {
      throw new NotFoundException('Quiz introuvable.');
    }
    return quiz;
  }

  /**
   * Avis des joueurs sur un quiz (§2.11) — réservé au **propriétaire** (la garde
   * `findFirst({ where:{ id, ownerId } })` renvoie 404 pour un non-owner). Renvoie
   * la moyenne, le nombre et la liste (récente d'abord).
   */
  async feedback(ownerId: string, id: string) {
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!quiz) {
      throw new NotFoundException('Quiz introuvable.');
    }
    const items = await this.prisma.quizFeedback.findMany({
      where: { quizId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, rating: true, comment: true, nickname: true, createdAt: true },
    });
    const count = items.length;
    const average = count ? items.reduce((sum, f) => sum + f.rating, 0) / count : 0;
    return { count, average, items };
  }

  /** Duplique un quiz possédé (copie profonde questions/options/réponses) en `draft`. */
  async duplicate(ownerId: string, id: string): Promise<Quiz> {
    const src = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: {
            options: { orderBy: { orderIndex: 'asc' } },
            acceptedAnswers: true,
          },
        },
      },
    });
    if (!src) {
      throw new NotFoundException('Quiz introuvable.');
    }
    return this.prisma.quiz.create({
      data: {
        ownerId,
        title: `${src.title} (copie)`,
        description: src.description,
        coverMediaId: src.coverMediaId,
        language: src.language,
        questionCount: src.questions.length,
        questions: {
          create: src.questions.map((q) => ({
            orderIndex: q.orderIndex,
            type: q.type,
            prompt: q.prompt,
            mediaId: q.mediaId,
            timeLimitS: q.timeLimitS,
            pointsMode: q.pointsMode,
            numericValue: q.numericValue,
            numericTolerance: q.numericTolerance,
            options: {
              create: q.options.map((o) => ({
                orderIndex: o.orderIndex,
                text: o.text,
                mediaId: o.mediaId,
                color: o.color,
                shape: o.shape,
                isCorrect: o.isCorrect,
                correctOrderIndex: o.correctOrderIndex,
              })),
            },
            acceptedAnswers: {
              create: q.acceptedAnswers.map((a) => ({
                text: a.text,
                normalized: a.normalized,
              })),
            },
          })),
        },
      },
    });
  }

  async update(ownerId: string, id: string, dto: UpdateQuizDto): Promise<Quiz> {
    await this.findOwnedOrThrow(ownerId, id);
    return this.prisma.quiz.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        language: dto.language,
        coverMediaId: dto.coverMediaId,
      },
    });
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwnedOrThrow(ownerId, id);
    await this.prisma.quiz.delete({ where: { id } });
  }

  /** Applique une transition d'état validée (RG-02). */
  async transition(ownerId: string, id: string, dto: TransitionQuizDto): Promise<Quiz> {
    const quiz = await this.findOwnedOrThrow(ownerId, id);
    const target = dto.status as QuizStatus;
    if (quiz.status === target) {
      return quiz;
    }
    if (!ALLOWED_TRANSITIONS[quiz.status].includes(target)) {
      throw new BadRequestException(`Transition d'état interdite : ${quiz.status} → ${target}.`);
    }
    if (target === QuizStatus.ready && quiz.questionCount < 1) {
      throw new BadRequestException(
        'Un quiz doit comporter au moins une question pour passer à "ready" (RG-02).',
      );
    }
    // TODO (P2-BACK-3) : refuser aussi le passage à "ready" si une question est
    // invalide selon son type (nb d'options, réponse correcte, etc.).
    return this.prisma.quiz.update({
      where: { id },
      data: {
        status: target,
        archivedAt:
          target === QuizStatus.archived
            ? new Date()
            : quiz.status === QuizStatus.archived
              ? null
              : undefined,
      },
    });
  }

  /** Récupère un quiz en garantissant l'appartenance au formateur (sinon 404). */
  private async findOwnedOrThrow(ownerId: string, id: string): Promise<Quiz> {
    const quiz = await this.prisma.quiz.findFirst({ where: { id, ownerId } });
    if (!quiz) {
      throw new NotFoundException('Quiz introuvable.');
    }
    return quiz;
  }
}
