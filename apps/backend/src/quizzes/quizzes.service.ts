import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Quiz, QuizStatus } from '@prisma/client';
import { isManager, type RoleSet } from '../auth/roles';
import { gameKeys } from '../game/game.keys';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { QUESTION_INCLUDE, toQuestionOutput } from '../questions/questions.service';
import { RedisService } from '../redis/redis.service';
import type { CreateQuizDto } from './dto/create-quiz.dto';
import type { QuizFeedbackQueryDto } from './dto/quiz-feedback.dto';
import type { TransitionQuizDto } from './dto/transition-quiz.dto';
import type { UpdateQuizDto } from './dto/update-quiz.dto';

type QuizFeedbackQuery = Pick<QuizFeedbackQueryDto, 'page' | 'pageSize' | 'rating'>;

/** Transitions de cycle de vie autorisées (RG-02). */
const ALLOWED_TRANSITIONS: Record<QuizStatus, QuizStatus[]> = {
  [QuizStatus.draft]: [QuizStatus.ready, QuizStatus.archived],
  [QuizStatus.ready]: [QuizStatus.draft, QuizStatus.archived],
  [QuizStatus.archived]: [QuizStatus.draft],
};

@Injectable()
export class QuizzesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly media: MediaService,
  ) {}

  /**
   * Banque de l'appelant, les plus récents d'abord — et **toute l'instance** pour
   * un gestionnaire (`admin`), avec le nom du propriétaire de chaque quiz : il
   * voit tout, il ne présente rien (RG-14).
   */
  async list(user: { id: string; roles: RoleSet }): Promise<(Quiz & { ownerName?: string })[]> {
    const manager = isManager(user.roles);
    const rows = await this.prisma.quiz.findMany({
      where: manager ? {} : { ownerId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { displayName: true } } },
    });
    // Le nom du propriétaire n'a de sens que dans la vue d'ensemble : un hôte qui
    // lit sa banque n'a pas besoin qu'on lui rappelle que tout est à lui.
    return rows.map(({ owner, ...quiz }) =>
      manager ? { ...quiz, ownerName: owner.displayName } : quiz,
    );
  }

  /**
   * Portée d'une lecture : la banque de l'appelant, ou l'instance entière pour un
   * gestionnaire. `undefined` laisse Prisma sans filtre de propriétaire.
   */
  private scopeOf(user: { id: string; roles: RoleSet }): string | undefined {
    return isManager(user.roles) ? undefined : user.id;
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
        feedbackEnabled: dto.feedbackEnabled,
        mediaTailS: dto.mediaTailS,
        loudnessTargetLufs: dto.loudnessTargetLufs,
      },
    });
  }

  /** Détail d'un quiz, questions ordonnées incluses (404 hors portée, cf. `scopeOf`). */
  async get(user: { id: string; roles: RoleSet }, id: string) {
    const ownerId = this.scopeOf(user);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      include: {
        questions: { orderBy: { orderIndex: 'asc' }, include: QUESTION_INCLUDE },
        slides: { orderBy: { orderIndex: 'asc' } },
      },
    });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
    return { ...quiz, questions: quiz.questions.map(toQuestionOutput) };
  }

  /**
   * Avis des joueurs sur un quiz (§2.11) — réservé au **propriétaire** (la garde
   * `findFirst({ where:{ id, ownerId } })` renvoie 404 pour un non-owner). Renvoie
   * la moyenne, le nombre et la liste (récente d'abord).
   */
  async feedback(user: { id: string; roles: RoleSet }, id: string, query: QuizFeedbackQuery) {
    const ownerId = this.scopeOf(user);
    const quiz = await this.prisma.quiz.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
    // Summary over every review (not just the page), so the header never changes with the filter.
    const groups = await this.prisma.quizFeedback.groupBy({
      by: ['rating'],
      where: { quizId: id },
      _count: { _all: true },
    });
    const distribution = [0, 0, 0, 0, 0];
    for (const g of groups) distribution[g.rating - 1] = g._count._all;
    const count = distribution.reduce((a, b) => a + b, 0);
    const average = count ? distribution.reduce((sum, n, i) => sum + n * (i + 1), 0) / count : 0;

    const where = { quizId: id, ...(query.rating ? { rating: query.rating } : {}) };
    const [total, items] = await Promise.all([
      this.prisma.quizFeedback.count({ where }),
      this.prisma.quizFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, rating: true, comment: true, nickname: true, createdAt: true },
      }),
    ]);
    return {
      count,
      average,
      distribution,
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /**
   * Historique des parties archivées d'un quiz possédé (§2.7), récentes d'abord.
   * Réservé au propriétaire (la garde `findFirst({ id, ownerId })` → 404 sinon).
   */
  async sessions(user: { id: string; roles: RoleSet }, id: string) {
    const ownerId = this.scopeOf(user);
    const quiz = await this.prisma.quiz.findFirst({ where: { id, ownerId }, select: { id: true } });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
    const rows = await this.prisma.gameSessionLog.findMany({
      where: { quizId: id },
      orderBy: { startedAt: 'desc' },
      select: SESSION_SUMMARY_SELECT,
    });
    return { sessions: rows.map(toSessionSummary) };
  }

  /**
   * Détail d'une session archivée (§2.8/2.9) : résumé + agrégats par question +
   * résultats par participant. L'appartenance passe par le quiz (`quiz: { ownerId }`) —
   * 404 si la session n'existe pas ou n'appartient pas à ce quiz possédé.
   */
  async sessionDetail(user: { id: string; roles: RoleSet }, id: string, sessionId: string) {
    const ownerId = this.scopeOf(user);
    const row = await this.prisma.gameSessionLog.findFirst({
      where: { id: sessionId, quizId: id, quiz: { ownerId } },
      include: {
        questionStats: { orderBy: { orderIndex: 'asc' } },
        playerResults: { orderBy: { finalRank: 'asc' } },
      },
    });
    if (!row) {
      throw new NotFoundException('session.not_found');
    }
    // Énoncés/types lus depuis le snapshot figé (les questions vivantes ont pu changer).
    const snap = (row.quizSnapshot ?? {}) as {
      title?: string;
      questions?: Array<{ orderIndex: number; prompt: string; type: string }>;
    };
    const byIndex = new Map((snap.questions ?? []).map((q) => [q.orderIndex, q]));
    return {
      ...toSessionSummary(row),
      quizTitle: snap.title ?? '',
      language: row.language,
      totalQuestions: row.questionStats.length,
      questions: row.questionStats.map((s) => ({
        orderIndex: s.orderIndex,
        prompt: byIndex.get(s.orderIndex)?.prompt ?? `Question ${s.orderIndex + 1}`,
        type: byIndex.get(s.orderIndex)?.type ?? 'unknown',
        answerCount: s.answerCount,
        correctCount: s.correctCount,
        successRate: Number(s.successRate),
        avgResponseMs: s.avgResponseMs,
      })),
      players: row.playerResults.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        finalRank: p.finalRank,
        finalScore: p.finalScore,
        correctCount: p.correctCount,
        answeredCount: p.answeredCount,
        avgResponseMs: p.avgResponseMs,
        maxStreak: p.maxStreak,
      })),
    };
  }

  /**
   * « Le quiz vu par un participant » (§2.10) : son résultat + ses réponses question
   * par question (capture intégrale uniquement — `answers` vide sinon). Appartenance
   * via le quiz ; 404 si la session ou le participant n'existe pas pour ce propriétaire.
   */
  async sessionPlayerDetail(
    user: { id: string; roles: RoleSet },
    id: string,
    sessionId: string,
    playerResultId: string,
  ) {
    const ownerId = this.scopeOf(user);
    const row = await this.prisma.gameSessionLog.findFirst({
      where: { id: sessionId, quizId: id, quiz: { ownerId } },
      select: {
        fullCapture: true,
        quizSnapshot: true,
        playerResults: { where: { id: playerResultId } },
        answerLogs: {
          where: { playerResultLogId: playerResultId },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });
    if (!row || row.playerResults.length === 0) {
      throw new NotFoundException('participant.not_found');
    }
    const p = row.playerResults[0];
    const snap = (row.quizSnapshot ?? {}) as {
      questions?: Array<{
        orderIndex: number;
        prompt: string;
        type: string;
        options?: Array<{ id: string; text: string | null }>;
      }>;
    };
    const byIndex = new Map((snap.questions ?? []).map((q) => [q.orderIndex, q]));
    return {
      id: p.id,
      nickname: p.nickname,
      finalRank: p.finalRank,
      finalScore: p.finalScore,
      correctCount: p.correctCount,
      answeredCount: p.answeredCount,
      avgResponseMs: p.avgResponseMs,
      maxStreak: p.maxStreak,
      fullCapture: row.fullCapture,
      answers: row.answerLogs.map((a) => {
        const q = byIndex.get(a.orderIndex);
        return {
          orderIndex: a.orderIndex,
          prompt: q?.prompt ?? `Question ${a.orderIndex + 1}`,
          type: q?.type ?? 'unknown',
          answer: renderAnswer(q, a.answerValue),
          isCorrect: a.isCorrect,
          pointsAwarded: a.pointsAwarded,
          responseMs: a.responseMs,
        };
      }),
    };
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
        slides: true,
      },
    });
    if (!src) {
      throw new NotFoundException('quiz.not_found');
    }
    const copy = await this.prisma.quiz.create({
      data: {
        ownerId,
        title: `${src.title} (copie)`,
        description: src.description,
        coverMediaId: src.coverMediaId,
        language: src.language,
        mediaTailS: src.mediaTailS,
        loudnessTargetLufs: src.loudnessTargetLufs,
        questionCount: src.questions.length,
        questions: {
          create: src.questions.map((q) => ({
            orderIndex: q.orderIndex,
            type: q.type,
            prompt: q.prompt,
            visualMediaId: q.visualMediaId,
            audioMediaId: q.audioMediaId,
            answerExplanation: q.answerExplanation,
            backgroundMediaId: q.backgroundMediaId,
            backgroundGradient: q.backgroundGradient ?? Prisma.JsonNull,
            textTone: q.textTone,
            textOutline: q.textOutline,
            timeLimitS: q.timeLimitS,
            pointsMode: q.pointsMode,
            scoring: q.scoring,
            revealDelayS: q.revealDelayS,
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
      include: { questions: { select: { id: true, orderIndex: true } } },
    });
    // Slides (#7) anchor on question ids: re-map them onto the copied questions.
    if (src.slides.length > 0) {
      const srcIndexById = new Map(src.questions.map((q) => [q.id, q.orderIndex]));
      const newIdByIndex = new Map(copy.questions.map((q) => [q.orderIndex, q.id]));
      await this.prisma.slide.createMany({
        data: src.slides.map((s) => ({
          quizId: copy.id,
          beforeQuestionId:
            s.beforeQuestionId === null
              ? null
              : (newIdByIndex.get(srcIndexById.get(s.beforeQuestionId) ?? -1) ?? null),
          orderIndex: s.orderIndex,
          blocks: s.blocks as Prisma.InputJsonValue,
          mediaId: s.mediaId,
          gradient: s.gradient ?? Prisma.JsonNull,
          displayDelayS: s.displayDelayS,
          textTone: s.textTone,
          textOutline: s.textOutline,
        })),
      });
    }
    return copy;
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
        feedbackEnabled: dto.feedbackEnabled,
        mediaTailS: dto.mediaTailS,
        loudnessTargetLufs: dto.loudnessTargetLufs,
      },
    });
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.findOwnedOrThrow(ownerId, id);
    // A quiz being played cannot go: its session would have nothing to archive.
    if (await this.hasLiveSession(ownerId, id)) {
      throw new ConflictException('quiz.in_use');
    }
    const slots = await this.prisma.question.findMany({
      where: { quizId: id },
      select: { visualMediaId: true, audioMediaId: true },
    });
    await this.prisma.quiz.delete({ where: { id } });
    // Its videos and sounds go with it, unless another quiz (a copy) still plays them.
    await this.media.releaseUnused(slots.flatMap((q) => [q.visualMediaId, q.audioMediaId]));
  }

  /** Whether one of the owner's live sessions (Redis index) plays this quiz. */
  private async hasLiveSession(ownerId: string, quizId: string): Promise<boolean> {
    const pins = await this.redis.smembers(gameKeys.hostGames(ownerId));
    for (const pin of pins) {
      const [state, gameQuiz] = await this.redis.hmget(gameKeys.game(pin), 'state', 'quizId');
      if (gameQuiz === quizId && state && state !== 'ENDED') return true;
    }
    return false;
  }

  /** Applique une transition d'état validée (RG-02). */
  async transition(ownerId: string, id: string, dto: TransitionQuizDto): Promise<Quiz> {
    const quiz = await this.findOwnedOrThrow(ownerId, id);
    const target = dto.status as QuizStatus;
    if (quiz.status === target) {
      return quiz;
    }
    if (!ALLOWED_TRANSITIONS[quiz.status].includes(target)) {
      throw new BadRequestException({
        code: 'quiz.transition_forbidden',
        params: { from: quiz.status, target },
      });
    }
    if (target === QuizStatus.ready && quiz.questionCount < 1) {
      throw new BadRequestException('quiz.requires_question');
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

  /** Récupère un quiz en garantissant l'appartenance au animateur (sinon 404). */
  private async findOwnedOrThrow(ownerId: string, id: string): Promise<Quiz> {
    const quiz = await this.prisma.quiz.findFirst({ where: { id, ownerId } });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
    return quiz;
  }
}

/** Colonnes du résumé de session (liste + base du détail). */
const SESSION_SUMMARY_SELECT = {
  id: true,
  pin: true,
  status: true,
  playerCount: true,
  successRate: true,
  personalTracking: true,
  fullCapture: true,
  startedAt: true,
  endedAt: true,
} satisfies Prisma.GameSessionLogSelect;

/**
 * Rend une réponse stockée (`AnswerLog.answerValue`) lisible : texte d'option pour les
 * QCM/ordre, valeur brute pour le libre (texte/numérique). Tombe sur l'id ou la valeur
 * brute si le snapshot ne porte pas l'option (robustesse).
 */
function renderAnswer(
  question: { type?: string; options?: Array<{ id: string; text: string | null }> } | undefined,
  value: unknown,
): string {
  const optText = (id: string) => question?.options?.find((o) => o.id === id)?.text ?? id;
  if (Array.isArray(value)) {
    const sep = question?.type === 'ordering' ? ' → ' : ', ';
    return value.map((v) => (typeof v === 'string' ? optText(v) : String(v))).join(sep);
  }
  if (typeof value === 'string') {
    const opt = question?.options?.find((o) => o.id === value);
    return opt ? (opt.text ?? value) : value; // id d'option connu → texte ; sinon saisie libre
  }
  return String(value);
}

/** Projette une ligne `GameSessionLog` en résumé sérialisable (Decimal→number, Date→ISO). */
function toSessionSummary(row: {
  id: string;
  pin: string;
  status: string;
  playerCount: number;
  successRate: Prisma.Decimal | null;
  personalTracking: boolean;
  fullCapture: boolean;
  startedAt: Date;
  endedAt: Date;
}) {
  return {
    id: row.id,
    pin: row.pin,
    status: row.status,
    playerCount: row.playerCount,
    successRate: row.successRate === null ? null : Number(row.successRate),
    personalTracking: row.personalTracking,
    fullCapture: row.fullCapture,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
  };
}
