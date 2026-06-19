import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { gameKeys } from './game.keys';
import { buildRevealCommon } from './reveal';
import type { AnswerRecord, GameMeta, PlayerRecord, QuizSnapshot } from './game.types';

/**
 * Rétention par défaut d'une session archivée (suivi de formation). Valeur de départ
 * — à ajuster selon la politique RGPD retenue (champ `retainUntil`, purge ultérieure).
 */
const SESSION_RETENTION_DAYS = 365;

type RankedPlayer = PlayerRecord & { id: string };

/**
 * Archivage d'une partie terminée (§2.7-2.10) : projette l'état live Redis (résumé,
 * classement, agrégats par question, et — en capture intégrale — réponses
 * individuelles) vers les tables durables, en **une transaction**, AVANT la purge
 * Redis. Déclenché à la demande de l'hôte (`host:end` avec `archive`) ou
 * automatiquement sur une fin orpheline (§7.3, marquée `interrupted`).
 *
 * Best-effort : une erreur de persistance est journalisée mais n'empêche pas la fin
 * de partie (l'appelant poursuit la destruction de l'état). No-op si rien n'a été
 * joué (lobby vide / aucune réponse).
 */
@Injectable()
export class SessionArchiveService {
  private readonly log = new Logger(SessionArchiveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async archive(
    pin: string,
    meta: GameMeta,
    opts: { interrupted?: boolean; bestEffort?: boolean } = {},
  ): Promise<void> {
    try {
      const snapshot = await this.readSnapshot(pin);
      if (!snapshot) return;

      const players = await this.readPlayers(pin);
      const answersByIndex = new Map<number, Map<string, AnswerRecord>>();
      let totalAnswers = 0;
      for (const q of snapshot.questions) {
        const recs = await this.readAnswers(pin, q.orderIndex);
        answersByIndex.set(q.orderIndex, recs);
        totalAnswers += recs.size;
      }
      // Rien à archiver : partie arrêtée avant toute réponse (lobby vide, etc.).
      if (players.size === 0 || totalAnswers === 0) return;

      const ranked = [...players.entries()]
        .map(([id, p]): RankedPlayer => ({ id, ...p }))
        .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);

      const now = Date.now();
      const status = opts.interrupted ? SessionStatus.interrupted : SessionStatus.ended;
      const session = this.buildSession(
        pin,
        meta,
        snapshot,
        status,
        players.size,
        answersByIndex,
        now,
      );
      const questionStats = this.buildQuestionStats(snapshot, answersByIndex);
      const playerAgg = this.aggregatePlayers(ranked, snapshot, answersByIndex);

      await this.prisma.$transaction(async (tx) => {
        const created = await tx.gameSessionLog.create({ data: session });

        // Résultats par apprenant : créés un à un pour récupérer les id (rattachement
        // des réponses individuelles en capture intégrale).
        const resultIdByPlayer = new Map<string, string>();
        for (const agg of playerAgg) {
          const row = await tx.playerResultLog.create({
            data: { sessionLogId: created.id, ...agg.data },
          });
          resultIdByPlayer.set(agg.playerId, row.id);
        }

        if (questionStats.length > 0) {
          await tx.questionResultStat.createMany({
            data: questionStats.map((s) => ({ sessionLogId: created.id, ...s })),
          });
        }

        if (meta.fullCapture) {
          const answerRows = this.buildAnswerLogs(
            created.id,
            resultIdByPlayer,
            snapshot,
            answersByIndex,
          );
          if (answerRows.length > 0) {
            await tx.answerLog.createMany({ data: answerRows });
          }
        }
      });

      this.log.debug(`Session archivée ${pin} (${status}, ${players.size} joueurs)`);
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
      status,
      language: meta.language,
      playerCount,
      successRate: answered > 0 ? new Prisma.Decimal(correct / answered) : null,
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

  /** Résultats par apprenant : score/rang final + compteurs et streak max (ordre des questions). */
  private aggregatePlayers(
    ranked: RankedPlayer[],
    snapshot: QuizSnapshot,
    answersByIndex: Map<number, Map<string, AnswerRecord>>,
  ): {
    playerId: string;
    data: Omit<Prisma.PlayerResultLogUncheckedCreateInput, 'sessionLogId'>;
  }[] {
    const orderedIndexes = snapshot.questions.map((q) => q.orderIndex);
    return ranked.map((p, i) => {
      let answered = 0;
      let correct = 0;
      let totalMs = 0;
      let streak = 0;
      let maxStreak = 0;
      for (const idx of orderedIndexes) {
        const rec = answersByIndex.get(idx)?.get(p.id);
        if (!rec) {
          streak = 0;
          continue;
        }
        answered += 1;
        totalMs += rec.tMs;
        if (rec.isCorrect) {
          correct += 1;
          streak += 1;
          if (streak > maxStreak) maxStreak = streak;
        } else {
          streak = 0;
        }
      }
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

  /** Réponses individuelles (capture intégrale) rattachées au résultat de l'apprenant. */
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

  private async readSnapshot(pin: string): Promise<QuizSnapshot | null> {
    const raw = await this.redis.get(gameKeys.snapshot(pin));
    return raw ? (JSON.parse(raw) as QuizSnapshot) : null;
  }

  private async readPlayers(pin: string): Promise<Map<string, PlayerRecord>> {
    const raw = await this.redis.hgetall(gameKeys.players(pin));
    return new Map(Object.entries(raw).map(([id, json]) => [id, JSON.parse(json) as PlayerRecord]));
  }

  private async readAnswers(pin: string, index: number): Promise<Map<string, AnswerRecord>> {
    const raw = await this.redis.hgetall(gameKeys.answers(pin, index));
    return new Map(Object.entries(raw).map(([id, json]) => [id, JSON.parse(json) as AnswerRecord]));
  }
}
