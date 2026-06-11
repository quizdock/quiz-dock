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

  /** Détail d'un quiz possédé (404 sinon — on ne divulgue pas l'existence). */
  get(ownerId: string, id: string): Promise<Quiz> {
    return this.findOwnedOrThrow(ownerId, id);
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
