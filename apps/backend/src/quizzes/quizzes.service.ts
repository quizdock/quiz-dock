import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Quiz, QuizStatus } from '@prisma/client';
import { isManager, type RoleSet } from '../auth/roles';
import { livePinOf } from '../game/game.keys';
import { MediaService } from '../media/media.service';
import { assertAssets, expectImage } from '../media/assert-assets';
import { PrismaService } from '../prisma/prisma.service';
import { questionMediaHeld, storedQuestionIssues } from '../questions/question-data';
import { slideIssues } from '../slides/dto/slide-content.schema';
import { QUESTION_INCLUDE, toQuestionOutput } from '../questions/questions.service';
import { RedisService } from '../redis/redis.service';
import { slideMediaIds } from '../slides/slide-media';
import type { CreateQuizDto } from './dto/create-quiz.dto';
import type { QuizFeedbackQueryDto } from './dto/quiz-feedback.dto';
import type { TransitionQuizDto } from './dto/transition-quiz.dto';
import type { UpdateQuizDto } from './dto/update-quiz.dto';
import { roomStandings } from './room-standings';
import { instanceLanguage } from '../common/instance-language';
import { readableBy, requireQuiz } from './quiz-access';

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
   * Banque de l'appelant, les plus récents d'abord, avec les quiz que les autres
   * hôtes partagent avec l'instance — en lecture seule, à copier — et **toute
   * l'instance** pour un gestionnaire (`admin`), avec le nom du propriétaire de
   * chaque quiz : il voit tout, il ne présente rien (RG-14).
   */
  async list(user: {
    id: string;
    roles: RoleSet;
  }): Promise<(Quiz & { ownerName?: string; editable: boolean })[]> {
    const manager = isManager(user.roles);
    const rows = await this.prisma.quiz.findMany({
      where: manager ? {} : readableBy(user.id),
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { displayName: true } } },
    });
    // Le nom du propriétaire n'a de sens que pour le quiz d'un autre : un hôte qui
    // lit sa banque n'a pas besoin qu'on lui rappelle que tout est à lui.
    return rows.map(({ owner, ...quiz }) => {
      const editable = quiz.ownerId === user.id;
      return manager || !editable
        ? { ...quiz, editable, ownerName: owner.displayName }
        : { ...quiz, editable };
    });
  }

  /**
   * Portée d'une lecture : la banque de l'appelant, ou l'instance entière pour un
   * gestionnaire. `undefined` laisse Prisma sans filtre de propriétaire.
   */
  private scopeOf(user: { id: string; roles: RoleSet }): string | undefined {
    return isManager(user.roles) ? undefined : user.id;
  }

  /** Crée un quiz appartenant à `ownerId` (statut `draft` par défaut). */
  async create(ownerId: string, dto: CreateQuizDto): Promise<Quiz> {
    await assertAssets(this.prisma, ownerId, expectImage(dto.coverMediaId));
    return this.prisma.quiz.create({
      data: {
        ownerId,
        title: dto.title,
        description: dto.description,
        language: dto.language ?? instanceLanguage(),
        coverMediaId: dto.coverMediaId,
        feedbackEnabled: dto.feedbackEnabled,
        mediaTailS: dto.mediaTailS,
        loudnessTargetLufs: dto.loudnessTargetLufs,
        audioTarget: dto.audioTarget,
      },
    });
  }

  /**
   * Détail d'un quiz, questions ordonnées incluses (404 hors portée, cf. `scopeOf`).
   * `editable` dit si l'appelant peut le modifier : son propriétaire seulement. Un
   * gestionnaire lit le quiz d'un autre sans le modifier (RG-14, #82), et voit
   * alors à qui il est.
   */
  async get(user: { id: string; roles: RoleSet }, id: string) {
    const quiz = await this.prisma.quiz.findFirst({
      // A quiz another host shares is read too, never edited.
      where: isManager(user.roles) ? { id } : { id, ...readableBy(user.id) },
      include: {
        questions: { orderBy: { orderIndex: 'asc' }, include: QUESTION_INCLUDE },
        slides: { orderBy: { orderIndex: 'asc' } },
        owner: { select: { displayName: true } },
      },
    });
    if (!quiz) {
      throw new NotFoundException('quiz.not_found');
    }
    const { owner, ...rest } = quiz;
    const editable = quiz.ownerId === user.id;
    return {
      ...rest,
      questions: quiz.questions.map(toQuestionOutput),
      editable,
      ...(editable ? {} : { ownerName: owner.displayName }),
    };
  }

  /**
   * Avis des joueurs sur un quiz (§2.11) — son propriétaire, ou un gestionnaire
   * (`scopeOf`) ; 404 pour tout autre. Renvoie la moyenne, le nombre et la liste
   * (récente d'abord).
   */
  async feedback(user: { id: string; roles: RoleSet }, id: string, query: QuizFeedbackQuery) {
    await requireQuiz(this.prisma, id, this.scopeOf(user));
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
   * Historique des parties archivées d'un quiz (§2.7), récentes d'abord : son
   * propriétaire, ou un gestionnaire (`scopeOf`) ; 404 pour tout autre.
   */
  async sessions(user: { id: string; roles: RoleSet }, id: string) {
    const ownerId = this.scopeOf(user);
    await requireQuiz(this.prisma, id, ownerId);
    const rows = await this.prisma.gameSessionLog.findMany({
      where: { quizId: id },
      orderBy: { startedAt: 'desc' },
      select: SESSION_SUMMARY_SELECT,
    });
    // How many archived sessions each room kept (#89): a room of one reads as a plain session.
    const roomIds = [...new Set(rows.flatMap((r) => (r.roomId ? [r.roomId] : [])))];
    const inRooms = roomIds.length
      ? await this.prisma.gameSessionLog.findMany({
          where: { roomId: { in: roomIds }, quiz: { ownerId } },
          select: { roomId: true },
        })
      : [];
    const sizes = new Map<string, number>();
    for (const { roomId } of inRooms) if (roomId) sizes.set(roomId, (sizes.get(roomId) ?? 0) + 1);
    return {
      sessions: rows.map((r) => {
        const size = r.roomId ? (sizes.get(r.roomId) ?? 1) : 1;
        return toSessionSummary(r, size > 1 ? size : null);
      }),
    };
  }

  /**
   * The room a session was played in, from its archived sessions (#89): the
   * quizzes kept, in order, and the standings summed over them — only when
   * every one of them tracked its participants (RG-16). Null for a session
   * played alone, or whose room kept only it.
   */
  private async roomOf(roomId: string | null, ownerId: string | undefined, current: string) {
    if (!roomId) return null;
    const sessions = await this.prisma.gameSessionLog.findMany({
      where: { roomId, quiz: { ownerId } },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        quizId: true,
        startedAt: true,
        personalTracking: true,
        quizSnapshot: true,
        roomName: true,
        host: { select: { displayName: true } },
        playerResults: {
          select: {
            nickname: true,
            finalScore: true,
            correctCount: true,
            answeredCount: true,
            avgResponseMs: true,
            maxStreak: true,
          },
        },
      },
    });
    if (sessions.length < 2) return null;
    return {
      // The name it had last (the host may rename the room between two quizzes).
      name: sessions[sessions.length - 1].roomName,
      hostName: sessions[0].host.displayName,
      sessions: sessions.map((s) => ({
        id: s.id,
        quizId: s.quizId,
        quizTitle: ((s.quizSnapshot ?? {}) as { title?: string }).title ?? '',
        startedAt: s.startedAt.toISOString(),
        current: s.id === current,
      })),
      standings: sessions.every((s) => s.personalTracking)
        ? roomStandings(sessions.map((s) => s.playerResults))
        : null,
    };
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
    const room = await this.roomOf(row.roomId, ownerId, row.id);
    return {
      ...toSessionSummary(row, room?.sessions.length ?? null),
      room,
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
        options?: SnapshotOptionLabel[];
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

  /**
   * Duplique un quiz possédé (copie profonde questions/options/réponses) en `draft` —
   * ou un quiz qu'un autre hôte partage (« Créer à partir de ce quiz ») : la copie
   * est à l'appelant, privée, sans lien avec l'original.
   */
  async duplicate(ownerId: string, id: string): Promise<Quiz> {
    const src = await this.prisma.quiz.findFirst({
      where: { id, ...readableBy(ownerId) },
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
    // The quiz and its slides in one step: a copy is whole, or not made.
    return this.prisma.$transaction(async (tx) => {
      const copy = await tx.quiz.create({
        data: {
          ownerId,
          title: `${src.title} ${copySuffix(src.language)}`,
          description: src.description,
          coverMediaId: src.coverMediaId,
          language: src.language,
          mediaTailS: src.mediaTailS,
          loudnessTargetLufs: src.loudnessTargetLufs,
          audioTarget: src.audioTarget,
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
              audioTarget: q.audioTarget,
              waveformSize: q.waveformSize,
              mediaPosition: q.mediaPosition,
              timerAfterMedia: q.timerAfterMedia,
              numericValue: q.numericValue,
              numericTolerance: q.numericTolerance,
              multiSelect: q.multiSelect,
              options: {
                create: q.options.map((o) => ({
                  orderIndex: o.orderIndex,
                  text: o.text,
                  mediaId: o.mediaId,
                  alt: o.alt,
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
        await tx.slide.createMany({
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
            videoMediaId: s.videoMediaId,
            videoLoop: s.videoLoop,
            videoSound: s.videoSound,
            audioMediaId: s.audioMediaId,
            waveformSize: s.waveformSize,
            audioTarget: s.audioTarget,
            displayDelayS: s.displayDelayS,
            textTone: s.textTone,
            textOutline: s.textOutline,
          })),
        });
      }
      return copy;
    });
  }

  async update(ownerId: string, id: string, dto: UpdateQuizDto): Promise<Quiz> {
    const current = await this.findOwnedOrThrow(ownerId, id);
    await assertAssets(this.prisma, ownerId, expectImage(dto.coverMediaId), [current.coverMediaId]);
    const quiz = await this.prisma.quiz.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        language: dto.language,
        coverMediaId: dto.coverMediaId,
        feedbackEnabled: dto.feedbackEnabled,
        mediaTailS: dto.mediaTailS,
        loudnessTargetLufs: dto.loudnessTargetLufs,
        audioTarget: dto.audioTarget,
        license: dto.license,
        tags: dto.tags,
        shared: dto.shared,
      },
    });
    // A replaced or dropped cover leaves with its file, unless something else holds it.
    await this.media.releaseUnused([current.coverMediaId], [quiz.coverMediaId]);
    return quiz;
  }

  async remove(ownerId: string, id: string): Promise<void> {
    const quiz = await this.findOwnedOrThrow(ownerId, id);
    // A quiz being played cannot go: its session would have nothing to archive.
    if (await this.hasLiveSession(ownerId, id)) {
      throw new ConflictException('quiz.in_use');
    }
    const [questions, slides] = await Promise.all([
      this.prisma.question.findMany({
        where: { quizId: id },
        select: {
          visualMediaId: true,
          audioMediaId: true,
          backgroundMediaId: true,
          options: { select: { mediaId: true } },
        },
      }),
      this.prisma.slide.findMany({
        where: { quizId: id },
        select: { blocks: true, mediaId: true, videoMediaId: true, audioMediaId: true },
      }),
    ]);
    await this.prisma.quiz.delete({ where: { id } });
    // Its media go with it, unless another quiz (a copy) still uses them.
    await this.media.releaseUnused([
      quiz.coverMediaId,
      ...questions.flatMap(questionMediaHeld),
      ...slides.flatMap(slideMediaIds),
    ]);
  }

  /** Whether one of the owner's live sessions (Redis index) plays this quiz. */
  private async hasLiveSession(ownerId: string, quizId: string): Promise<boolean> {
    return (await livePinOf(this.redis, ownerId, quizId)) !== null;
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
    // Every question complete (UI system §1.5, level 3): the editor lists what is missing.
    if (target === QuizStatus.ready) {
      const incomplete = await this.incompleteQuestions(id);
      if (incomplete > 0) {
        throw new BadRequestException({ code: 'quiz.incomplete', params: { count: incomplete } });
      }
    }
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

  /** How many of the quiz's steps (questions and slides) miss something to be played. */
  private async incompleteQuestions(quizId: string): Promise<number> {
    const questions = await this.prisma.question.findMany({
      where: { quizId },
      include: {
        options: { select: { text: true, mediaId: true, alt: true, isCorrect: true } },
        acceptedAnswers: { select: { text: true } },
      },
    });
    const slides = await this.prisma.slide.findMany({
      where: { quizId },
      select: { blocks: true, mediaId: true, gradient: true, videoMediaId: true },
    });
    return (
      questions.filter((q) => storedQuestionIssues(q).length > 0).length +
      slides.filter((s) => slideIssues({ ...s, blocks: s.blocks as unknown[] }).length > 0).length
    );
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
  roomId: true,
} satisfies Prisma.GameSessionLogSelect;

/** What the frozen snapshot keeps of an option to name it. */
type SnapshotOptionLabel = {
  id: string;
  text: string | null;
  media?: { alt?: string | null } | null;
};

/**
 * Rend une réponse stockée (`AnswerLog.answerValue`) lisible : texte d'option pour les
 * QCM/ordre, valeur brute pour le libre (texte/numérique). Tombe sur l'id ou la valeur
 * brute si le snapshot ne porte pas l'option (robustesse).
 *
 * A picture answer is named by its alt; a known option is never shown by its id.
 */
function renderAnswer(
  question: { type?: string; options?: SnapshotOptionLabel[] } | undefined,
  value: unknown,
): string {
  const options = question?.options ?? [];
  const label = (i: number) => {
    const o = options[i];
    return o.text || o.media?.alt || `#${i + 1}`;
  };
  const optText = (id: string) => {
    const i = options.findIndex((o) => o.id === id);
    return i >= 0 ? label(i) : id;
  };
  if (Array.isArray(value)) {
    const sep = question?.type === 'ordering' ? ' → ' : ', ';
    return value.map((v) => (typeof v === 'string' ? optText(v) : String(v))).join(sep);
  }
  if (typeof value === 'string') {
    return optText(value); // id d'option connu → son libellé ; sinon saisie libre
  }
  return String(value);
}

/** Projette une ligne `GameSessionLog` en résumé sérialisable (Decimal→number, Date→ISO). */
function toSessionSummary(
  row: {
    id: string;
    pin: string;
    status: string;
    playerCount: number;
    successRate: Prisma.Decimal | null;
    personalTracking: boolean;
    fullCapture: boolean;
    startedAt: Date;
    endedAt: Date;
  },
  roomSize: number | null,
) {
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
    roomSize,
  };
}

/** A copy's title mark, in the quiz's language (the interface's five; English otherwise). */
function copySuffix(language: string): string {
  const base = language.split('-')[0];
  if (language === 'zh-TW' || base === 'zh') return '（副本）';
  return { fr: '(copie)', es: '(copia)' }[base] ?? '(copy)';
}
