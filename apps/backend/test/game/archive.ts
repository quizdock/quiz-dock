import type { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Socket } from 'socket.io-client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QuizzesService } from '../../src/quizzes/quizzes.service';
import { type GameContext, nextEvent, settle, stateEvent } from '../game-harness';

/** L'appelant d'une lecture de quiz : un hôte ordinaire (RG-14). */
const asHost = (id: string) => ({ id, roles: [UserRole.host] });

/** End of game: the full-capture archive and the players' rating. */
export function archiveTests(ctx: GameContext): void {
  let app: INestApplication;
  let prisma: PrismaService;
  let quizId: string;
  let hostUserId: string;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    app = ctx.h.app;
    prisma = ctx.h.prisma;
    quizId = ctx.quizId;
    hostUserId = ctx.h.hostUserId;
  });

  it('archivage (§2.7) : capture intégrale → host:end{archive} persiste les tables, idempotent', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId, fullCapture: true });
    const player = connect();

    // Consentement : le joueur reçoit l'avis « réponses conservées » au join (§2.10).
    const noticeP = new Promise<{ fullCapture: boolean }>((resolve) =>
      player.on('notice', (n) => resolve(n as never)),
    );
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );
    const revealP = new Promise((resolve) => player.on('question:reveal', resolve));
    await player.emitWithAck('player:join', { pin, nickname: 'Zoe' });
    expect((await noticeP).fullCapture).toBe(true);

    host.emit('host:start', { pin });
    const q = await qStart;
    const parisId = q.options.find((o) => o.text === 'Paris')!.id;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', { pin, questionIndex: 0, answer: parisId });
    await revealP;

    const ended = new Promise((resolve) => player.on('game:ended', resolve));
    host.emit('host:end', { pin, archive: true });
    await ended;

    // Ré-entrée : un second host:end ne doit pas créer un 2ᵉ enregistrement (garde d'état).
    host.emit('host:end', { pin, archive: true });
    await settle(300);

    const sessions = await prisma.gameSessionLog.findMany({
      where: { quizId },
      include: { playerResults: true, questionStats: true, answerLogs: true },
    });
    expect(sessions).toHaveLength(1); // idempotent malgré le double host:end
    const s = sessions[0];
    expect(s.status).toBe('ended');
    expect(s.playerCount).toBe(1);
    expect(s.fullCapture).toBe(true);
    expect(Number(s.successRate)).toBeCloseTo(1);

    expect(s.playerResults).toHaveLength(1);
    expect(s.playerResults[0]).toMatchObject({
      nickname: 'Zoe',
      finalRank: 1,
      correctCount: 1,
      answeredCount: 1,
    });

    expect(s.questionStats).toHaveLength(1);
    expect(s.questionStats[0]).toMatchObject({ orderIndex: 0, correctCount: 1, answerCount: 1 });
    expect((s.questionStats[0].distribution as Record<string, number>)[parisId]).toBe(1);

    // Capture intégrale : la réponse individuelle est conservée.
    expect(s.answerLogs).toHaveLength(1);
    expect(s.answerLogs[0]).toMatchObject({ orderIndex: 0, isCorrect: true, answerValue: parisId });

    // API de consultation (Phase 2) contre la vraie base : liste + détail owner-only.
    const quizzes = app.get(QuizzesService);
    const list = await quizzes.sessions(asHost(hostUserId), quizId);
    expect(list.sessions.find((x) => x.id === s.id)).toMatchObject({
      playerCount: 1,
      successRate: 1,
      status: 'ended',
    });
    const detail = await quizzes.sessionDetail(asHost(hostUserId), quizId, s.id);
    expect(detail.quizTitle).toBe('Quiz live test');
    expect(detail.questions[0]).toMatchObject({
      prompt: 'Capitale de la France ?',
      successRate: 1,
    });
    expect(detail.players[0]).toMatchObject({ nickname: 'Zoe', finalRank: 1 });
    // Drill-down participant (Phase 3) : réponse rendue lisible depuis le snapshot.
    const playerDetail = await quizzes.sessionPlayerDetail(
      asHost(hostUserId),
      quizId,
      s.id,
      detail.players[0].id,
    );
    expect(playerDetail.fullCapture).toBe(true);
    expect(playerDetail.answers[0]).toMatchObject({ answer: 'Paris', isCorrect: true });
    // Isolation : un autre propriétaire ne voit pas la session.
    await expect(quizzes.sessionDetail(asHost('someone-else'), quizId, s.id)).rejects.toThrow();

    // Nettoyage (cascade) pour ne pas bloquer la suppression du quiz en afterAll.
    await prisma.gameSessionLog.deleteMany({ where: { quizId } });
  }, 15_000);

  it('player:rate : avis de fin de partie persisté (note + commentaire), refusé en lobby', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Wendy' });

    // En LOBBY : la partie n'est pas terminée → refus.
    const early = await player.emitWithAck('player:rate', { pin, rating: 5 });
    expect(early.ok).toBe(false);

    // On termine la partie, puis on note.
    const answering = stateEvent(player, 'ANSWERING');
    host.emit('host:start', { pin });
    await answering;
    const ended = nextEvent(player, 'game:ended');
    host.emit('host:end', { pin });
    await ended;

    const ack = await player.emitWithAck('player:rate', {
      pin,
      rating: 4,
      comment: '  Super quiz  ',
    });
    expect(ack.ok).toBe(true);

    const row = await prisma.quizFeedback.findFirst({ where: { pin } });
    expect(row?.rating).toBe(4);
    expect(row?.comment).toBe('Super quiz'); // élagué
    expect(row?.nickname).toBe('Wendy');
  }, 15_000);
}
