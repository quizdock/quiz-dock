import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameService } from './game.service';
import { answerStats } from './player-stats';
import type { RankedPlayer } from './results';
import { buildRevealCommon } from './reveal';
import type { AnswerRecord, GameMeta, QuizSnapshot } from './game.types';

/**
 * Rétention par défaut d'une session archivée (suivi individuel). Valeur de départ
 * — à ajuster selon la politique RGPD retenue (champ `retainUntil`, purge ultérieure).
 */
const SESSION_RETENTION_DAYS = 365;

/**
 * Archivage d'une partie terminée (§2.7-2.10) : projette l'état live Redis (résumé,
 * classement, agrégats par question, et — en capture intégrale — réponses
 * individuelles) vers les tables durables, en **une transaction**, AVANT la purge
 * Redis. Suivi individuel coupé (RG-16) : seuls le résumé et les agrégats par
 * question sont écrits — la partie elle-même (classement, podium) n'y perd rien.
 * Déclenché à la demande de l'hôte (`host:end` avec `archive`) ou
 * automatiquement sur une fin orpheline (§7.3, marquée `interrupted`).
 *
 * Best-effort : une erreur de persistance est journalisée mais n'empêche pas la fin
 * de partie (l'appelant poursuit la destruction de l'état). No-op si rien n'a été
 * joué (lobby vide / aucune réponse).
 */

/** Answer rows per insert: well under Postgres' 65 535 bound parameters (10 per row). */
const ANSWER_BATCH = 3000;
/** Time an archive may take, and wait for a connection. */
const ARCHIVE_TRANSACTION = { timeout: 60_000, maxWait: 10_000 };

@Injectable()
export class SessionArchiveService {
  private readonly log = new Logger(SessionArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly game: GameService,
  ) {}

  async archive(
    pin: string,
    meta: GameMeta,
    opts: { interrupted?: boolean; bestEffort?: boolean } = {},
  ): Promise<void> {
    try {
      const snapshot = await this.game.getSnapshot(meta.id);
      if (!snapshot) return;

      const ranked = await this.game.rankedPlayers(pin, meta.id);
      const answersByIndex = new Map<number, Map<string, AnswerRecord>>();
      let totalAnswers = 0;
      for (const q of snapshot.questions) {
        const recs = await this.game.answers(meta.id, q.orderIndex);
        answersByIndex.set(q.orderIndex, recs);
        totalAnswers += recs.size;
      }
      // Rien à archiver : partie arrêtée avant toute réponse (lobby vide, etc.).
      if (ranked.length === 0 || totalAnswers === 0) return;

      const now = Date.now();
      const status = opts.interrupted ? SessionStatus.interrupted : SessionStatus.ended;
      const session = this.buildSession(
        pin,
        meta,
        snapshot,
        status,
        ranked.length,
        answersByIndex,
        now,
      );
      const questionStats = this.buildQuestionStats(snapshot, answersByIndex);
      const playerAgg = this.aggregatePlayers(ranked, snapshot, answersByIndex);

      await this.prisma.$transaction(async (tx) => {
        const created = await tx.gameSessionLog.create({ data: session });

        // Résultats par participant : créés un à un pour récupérer les id (rattachement
        // des réponses individuelles en capture intégrale). Suivi individuel coupé
        // (RG-16) : aucune ligne par participant, donc aucune réponse individuelle —
        // seuls les agrégats et ce résumé subsistent.
        const resultIdByPlayer = new Map<string, string>();
        if (meta.personalTracking) {
          for (const agg of playerAgg) {
            const row = await tx.playerResultLog.create({
              data: { sessionLogId: created.id, ...agg.data },
            });
            resultIdByPlayer.set(agg.playerId, row.id);
          }
        }

        if (questionStats.length > 0) {
          await tx.questionResultStat.createMany({
            data: questionStats.map((s) => ({ sessionLogId: created.id, ...s })),
          });
        }

        if (meta.personalTracking && meta.fullCapture) {
          const answerRows = this.buildAnswerLogs(
            created.id,
            resultIdByPlayer,
            snapshot,
            answersByIndex,
          );
          // In batches, one after the other: one large insert is split by Prisma into
          // queries sent at once on the transaction's single connection.
          for (let i = 0; i < answerRows.length; i += ANSWER_BATCH) {
            await tx.answerLog.createMany({ data: answerRows.slice(i, i + ANSWER_BATCH) });
          }
        }
        // A large room with every answer kept takes seconds: past Prisma's default 5 s,
        // the results were lost.
      }, ARCHIVE_TRANSACTION);

      this.log.debug(`Session archivée ${pin} (${status}, ${ranked.length} joueurs)`);
    } catch (err) {
      this.log.error(
        `Échec d'archivage de la session ${pin}: ${err instanceof Error ? err.message : err}`,
      );
      // Fin subie (orpheline) : on avale. Fin explicite : on laisse remonter pour
      // que l'appelant ne détruise pas la partie sur un archivage perdu.
      if (!opts.bestEffort) throw err;
    }
  }

  /** Résumé de session : statut, taux de réussite global, snapshot figé, rétention. */
  private buildSession(
    pin: string,
    meta: GameMeta,
    snapshot: QuizSnapshot,
    status: SessionStatus,
    playerCount: number,
    answersByIndex: Map<number, Map<string, AnswerRecord>>,
    now: number,
  ): Prisma.GameSessionLogUncheckedCreateInput {
    let answered = 0;
    let correct = 0;
    for (const recs of answersByIndex.values()) {
      for (const r of recs.values()) {
        answered += 1;
        if (r.isCorrect) correct += 1;
      }
    }
    return {
      quizId: meta.quizId,
      hostId: meta.hostUserId,
      pin,
      roomId: meta.roomId,
      // A copy per session: there is no room table to hold it (SPECIFICATIONS-ROOM §5).
      roomName: meta.roomName || null,
      status,
      language: meta.language,
      playerCount,
      successRate: answered > 0 ? new Prisma.Decimal(correct / answered) : null,
      personalTracking: meta.personalTracking,
      fullCapture: meta.fullCapture,
      quizSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      startedAt: new Date(meta.createdAt),
      endedAt: new Date(now),
      retainUntil: new Date(now + SESSION_RETENTION_DAYS * 86_400_000),
    };
  }

  /** Agrégat par question : réussite, distribution (réutilise `buildRevealCommon`). */
  private buildQuestionStats(
    snapshot: QuizSnapshot,
    answersByIndex: Map<number, Map<string, AnswerRecord>>,
  ): Omit<Prisma.QuestionResultStatUncheckedCreateInput, 'sessionLogId'>[] {
    return snapshot.questions.map((q) => {
      const recs = [...(answersByIndex.get(q.orderIndex)?.values() ?? [])];
      const correct = recs.filter((r) => r.isCorrect).length;
      const totalMs = recs.reduce((sum, r) => sum + r.tMs, 0);
      const { distribution } = buildRevealCommon(q, recs);
      return {
        questionId: q.id,
        orderIndex: q.orderIndex,
        correctCount: correct,
        answerCount: recs.length,
        successRate: new Prisma.Decimal(recs.length > 0 ? correct / recs.length : 0),
        avgResponseMs: recs.length > 0 ? Math.round(totalMs / recs.length) : null,
        distribution: distribution as Prisma.InputJsonValue,
      };
    });
  }

  /** Résultats par participant : score/rang final + compteurs et streak max (ordre des questions). */
  private aggregatePlayers(
    ranked: RankedPlayer[],
    snapshot: QuizSnapshot,
    answersByIndex: Map<number, Map<string, AnswerRecord>>,
  ): {
    playerId: string;
    data: Omit<Prisma.PlayerResultLogUncheckedCreateInput, 'sessionLogId'>;
  }[] {
    return ranked.map((p, i) => {
      const { answered, correct, totalMs, maxStreak } = answerStats(snapshot, answersByIndex, p.id);
      return {
        playerId: p.id,
        data: {
          userId: p.userId,
          nickname: p.nickname,
          finalScore: p.score,
          finalRank: i + 1,
          correctCount: correct,
          answeredCount: answered,
          avgResponseMs: answered > 0 ? Math.round(totalMs / answered) : null,
          maxStreak,
        },
      };
    });
  }

  /** Réponses individuelles (capture intégrale) rattachées au résultat de l'participant. */
  private buildAnswerLogs(
    sessionLogId: string,
    resultIdByPlayer: Map<string, string>,
    snapshot: QuizSnapshot,
    answersByIndex: Map<number, Map<string, AnswerRecord>>,
  ): Prisma.AnswerLogUncheckedCreateInput[] {
    const rows: Prisma.AnswerLogUncheckedCreateInput[] = [];
    for (const q of snapshot.questions) {
      const recs = answersByIndex.get(q.orderIndex);
      if (!recs) continue;
      for (const [playerId, rec] of recs.entries()) {
        const playerResultLogId = resultIdByPlayer.get(playerId);
        if (!playerResultLogId) continue; // réponse d'un joueur sans résultat (improbable)
        rows.push({
          sessionLogId,
          playerResultLogId,
          questionId: q.id,
          orderIndex: q.orderIndex,
          answerValue: rec.answer as Prisma.InputJsonValue,
          isCorrect: rec.isCorrect,
          pointsAwarded: rec.pointsAwarded,
          responseMs: rec.tMs,
          receivedAt: new Date(rec.receivedAt),
        });
      }
    }
    return rows;
  }
}
