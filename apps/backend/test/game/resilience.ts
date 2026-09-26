import type { INestApplication } from '@nestjs/common';
import type { Socket } from 'socket.io-client';
import { GameService } from '../../src/game/game.service';
import { type GameContext, nextEvent, settle, stateEvent } from '../game-harness';

/** Late joins, spectators, reconnections, the host leaving and coming back, convergence on departures, the index of live games. */
export function resilienceTests(ctx: GameContext): void {
  let app: INestApplication;
  let quizId: string;
  let hostUserId: string;
  const connect = (auth?: Record<string, string>): Socket => ctx.h.connect(auth);
  beforeAll(() => {
    app = ctx.h.app;
    quizId = ctx.quizId;
    hostUserId = ctx.h.hostUserId;
  });

  it('late join (§5) : un joueur arrivé après le départ reçoit l’état ANSWERING + question:start', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const answering = stateEvent(host, 'ANSWERING');
    host.emit('host:start', { pin });
    await answering;

    const latecomer = connect();
    const stateP = new Promise<{ state: string }>((resolve) =>
      latecomer.on('game:state', (s) => resolve(s as never)),
    );
    const qStartP = new Promise<{ questionIndex: number }>((resolve) =>
      latecomer.on('question:start', (q) => resolve(q as never)),
    );

    const ack = await latecomer.emitWithAck('player:join', { pin, nickname: 'Late' });
    expect(ack.playerId).toBeTruthy();
    expect((await stateP).state).toBe('ANSWERING');
    expect((await qStartP).questionIndex).toBe(0);
  }, 15_000);

  it('spectator:join (§3) : reçoit l’état mais n’est pas compté (answer:count.total)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Frank' });

    const spectator = connect();
    // Le projeté qui s'attache après les arrivées reçoit l'instantané du lobby (§6).
    const rosterP = new Promise<{ players: Array<{ nickname: string }> }>((resolve) =>
      spectator.on('game:roster', (r) => resolve(r as never)),
    );
    const specOk = await spectator.emitWithAck('spectator:join', { pin });
    expect(specOk.ok).toBe(true);
    expect((await rosterP).players.map((p) => p.nickname)).toContain('Frank');

    const countP = new Promise<{ answered: number; total: number }>((resolve) =>
      player.on('answer:count', (c) => resolve(c as never)),
    );
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => player.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));
    player.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });

    // total = connectés joueurs (1), le spectateur n'est pas compté.
    const count = await countP;
    expect(count.total).toBe(1);
    expect(count.answered).toBe(1);
  }, 15_000);

  it('host:attach (§4.2) : le propriétaire se rebinde et reçoit l’état ; non authentifié rejeté', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    // 2ᵉ fenêtre de contrôle (même hôte) : attach OK + état courant.
    const control2 = connect({ localUser: 'Animateur' });
    const stateP = new Promise<{ state: string }>((resolve) =>
      control2.on('game:state', (s) => resolve(s as never)),
    );
    const attachAck = await control2.emitWithAck('host:attach', { pin });
    expect(attachAck.ok).toBe(true);
    expect((await stateP).state).toBe('LOBBY');

    // Socket non authentifié : refus (event error typé).
    const anon = connect();
    const err = await Promise.race([
      new Promise<{ code: string }>((resolve) => anon.on('error', resolve)),
      anon.emitWithAck('host:attach', { pin }).then(() => ({ code: 'accepted' as const })),
    ]);
    expect(err.code).not.toBe('accepted');
  }, 15_000);

  it('player:reconnect (§6.1) : restaure la place via le jeton et renvoie l’état', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const player = connect();
    const { sessionToken } = await player.emitWithAck('player:join', { pin, nickname: 'Gina' });
    player.disconnect();
    await new Promise((r) => setTimeout(r, 100));

    const back = connect();
    const stateP = new Promise<{ state: string }>((resolve) =>
      back.on('game:state', (s) => resolve(s as never)),
    );
    const ack = await back.emitWithAck('player:reconnect', { sessionToken });
    expect(ack.ok).toBe(true);
    expect((await stateP).state).toBe('LOBBY');
  }, 15_000);

  it('convergence sur les connectés (§8) : le départ du dernier non-répondant déclenche REVEAL', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const p1 = connect();
    await p1.emitWithAck('player:join', { pin, nickname: 'Hugo' });
    const p2 = connect();
    await p2.emitWithAck('player:join', { pin, nickname: 'Ines' });

    let revealed = false;
    p1.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealed = true;
    });
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => p1.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));

    // p1 répond (1/2). Pas encore de REVEAL : p2 connecté n'a pas répondu.
    p1.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });
    await settle();
    expect(revealed).toBe(false);

    // p2 quitte → connectés=1, répondu=1 ⇒ convergence ⇒ REVEAL (sans attendre le timer 5 s).
    const reveal = stateEvent(p1, 'REVEAL', 1_000); // well before the 5 s timer
    p2.disconnect();
    await reveal;
    expect(revealed).toBe(true);
  }, 15_000);

  it('hôte déconnecté (§7) : grâce → HOST_DISCONNECTED → host:attach reprend ANSWERING', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Iris' });

    const states: string[] = [];
    player.on('game:state', (s: { state: string }) => states.push(s.state));
    const qStarts: Array<{ startedAt: number; endsAt: number }> = [];
    player.on('question:start', (q) => qStarts.push(q as never));

    host.emit('host:start', { pin });
    await new Promise<void>((resolve) => {
      const id = setInterval(() => qStarts.length >= 1 && (clearInterval(id), resolve()), 20);
    }); // ANSWERING ouvert

    // L'hôte se déconnecte : après la grâce (200 ms), passage en HOST_DISCONNECTED.
    const pausedP = new Promise<void>((resolve) => {
      const onState = (s: { state: string }) => {
        if (s.state === 'HOST_DISCONNECTED') {
          player.off('game:state', onState);
          resolve();
        }
      };
      player.on('game:state', onState);
    });
    host.disconnect();
    await pausedP;
    expect(states).toContain('HOST_DISCONNECTED');

    // L'hôte revient (nouvelle fenêtre de contrôle) → reprise en ANSWERING.
    const resumedP = new Promise<void>((resolve) => {
      const onState = (s: { state: string }) => {
        if (s.state === 'ANSWERING') {
          player.off('game:state', onState);
          resolve();
        }
      };
      player.on('game:state', onState);
    });
    const control2 = connect({ localUser: 'Animateur' });
    const attachAck = await control2.emitWithAck('host:attach', { pin });
    expect(attachAck.ok).toBe(true);
    await resumedP;

    // La reprise recalcule les timings sur le temps restant (§7.3) : la fenêtre
    // garde exactement la durée de la question (timeLimitS=5), que le gel ait
    // attrapé la réponse en cours ou le délai de lecture (`chrono.ts`), et elle
    // se termine dans le futur.
    const resumed = qStarts[qStarts.length - 1];
    expect(resumed.endsAt - resumed.startedAt).toBe(5_000);
    expect(resumed.endsAt).toBeGreaterThan(Date.now());
  }, 15_000);

  it('convergence (§8) : le départ de l’unique répondant ne révèle pas tant qu’un connecté attend', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const p1 = connect();
    await p1.emitWithAck('player:join', { pin, nickname: 'Kim' });
    const p2 = connect();
    await p2.emitWithAck('player:join', { pin, nickname: 'Léo' });

    let revealed = false;
    p2.on('game:state', (s: { state: string }) => {
      if (s.state === 'REVEAL') revealed = true;
    });
    const qStart = new Promise<{ startedAt: number; options: Array<{ id: string; text: string }> }>(
      (resolve) => p1.on('question:start', (q) => resolve(q as never)),
    );

    host.emit('host:start', { pin });
    const q = await qStart;
    await new Promise((r) => setTimeout(r, Math.max(0, q.startedAt - Date.now()) + 50));

    // p1 (le seul répondant) répond puis quitte. p2 reste connecté SANS avoir répondu :
    // sa réponse manquante doit empêcher le REVEAL (le bug naïf hlen≥connectés révélerait).
    const acked = nextEvent(p1, 'answer:ack');
    p1.emit('player:submit', {
      pin,
      questionIndex: 0,
      answer: q.options.find((o) => o.text === 'Paris')!.id,
    });
    await acked;
    p1.disconnect();
    await settle(400);
    expect(revealed).toBe(false);
  }, 15_000);

  it('index parties en cours (§6.2) : présent après host:create, purgé après host:end', async () => {
    const games = app.get(GameService);
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });

    const active = await games.listActiveHostGames(hostUserId);
    expect(active.some((g) => g.pin === pin)).toBe(true);

    const ended = nextEvent(host, 'game:ended'); // sent once the index is purged
    host.emit('host:end', { pin });
    await ended;
    const after = await games.listActiveHostGames(hostUserId);
    expect(after.some((g) => g.pin === pin)).toBe(false);
  }, 15_000);

  it('hôte non revenu (§7.3) : la fenêtre expire → la partie se termine (game:ended)', async () => {
    const host = connect({ localUser: 'Animateur' });
    const { pin } = await host.emitWithAck('host:create', { quizId });
    const player = connect();
    await player.emitWithAck('player:join', { pin, nickname: 'Jude' });

    const endedP = new Promise<void>((resolve) => player.on('game:ended', () => resolve()));
    host.disconnect(); // jamais de host:attach → grâce + fenêtre expirent

    await endedP; // doit survenir avant le timeout (grâce 200 ms + fenêtre 800 ms)
  }, 15_000);
}
