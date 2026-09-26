import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { type Socket, io } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Harness of the live game integration tests: a real Nest app on a free port,
 * real Socket.IO clients, the test database and Redis database 1.
 *
 * It lives outside `src/` so the production build never ships it.
 * See docs/dev/game-gateway-tests-refactor.md.
 */

/** The local user who holds the host seat during the tests. */
export const HOST_NAME = 'Animateur';

export type SeededQuiz = Prisma.QuizGetPayload<{ include: { questions: true } }>;

export interface GameHarness {
  app: INestApplication;
  prisma: PrismaService;
  /** The `/game` namespace URL. */
  url: string;
  hostUserId: string;
  /** A new client, disconnected on close. */
  connect(auth?: Record<string, string>): Socket;
  /** A client signed in as the seat holder. */
  connectHost(): Socket;
  /** Creates a game of `quizId` from `host` and returns its PIN. */
  createGame(host: Socket, quizId: string): Promise<string>;
  /** A new player client joined to `pin` as `nickname`. */
  join(
    pin: string,
    nickname: string,
  ): Promise<{ socket: Socket; playerId: string; sessionToken: string }>;
  /**
   * A quiz owned by the host, deleted on close. Defaults to one single-choice
   * question (Paris / Lyon, 5 s); `overrides` replace top-level fields.
   */
  seedQuiz(overrides?: Partial<Prisma.QuizUncheckedCreateInput>): Promise<SeededQuiz>;
  close(): Promise<void>;
}

/** The test settings of the engine: short windows so a game runs in milliseconds. */
const GAME_TEST_ENV: Record<string, string> = {
  GAME_READ_DELAY_MS: '150', // reading window before the timer
  GAME_HOST_GRACE_MS: '200', // host grace (§7.1)
  GAME_HOST_WINDOW_MS: '800', // host reconnection window (§7.3)
  GAME_AUTO_ADVANCE_MS: '300', // automatic pacing (§8)
  GAME_MEDIA_WAIT_S: '1', // a short wait for media, capped fast
};

const DEFAULT_QUESTIONS: Prisma.QuizUncheckedCreateInput['questions'] = {
  create: {
    orderIndex: 0,
    type: 'single_choice',
    prompt: 'Capitale de la France ?',
    answerExplanation: 'Paris est la **capitale**.',
    timeLimitS: 5, // the smallest limit the API accepts (5..120)
    options: {
      create: [
        { orderIndex: 0, text: 'Paris', color: 'red', shape: 'triangle', isCorrect: true },
        { orderIndex: 1, text: 'Lyon', color: 'blue', shape: 'diamond', isCorrect: false },
      ],
    },
  },
};

export async function bootGameApp(): Promise<GameHarness> {
  // Set by the Jest global setup: a test database and Redis database 1, never the dev ones.
  if (!process.env.DATABASE_URL?.includes('_test')) {
    throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
  }
  Object.assign(process.env, GAME_TEST_ENV);
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const prisma = app.get(PrismaService);

  // In local mode the role comes from the host seat: give it to the test host
  // ('local:animateur' is the local slug of HOST_NAME).
  const host = await prisma.user.upsert({
    where: { oidcSubject: 'local:animateur' },
    create: { oidcSubject: 'local:animateur', displayName: HOST_NAME, roles: ['host'] },
    update: { roles: ['host'] },
  });
  // The seat is shared state of the target database: remember whose it was, give it back on close.
  const previousSeat = await prisma.hostSeat.findUnique({ where: { id: 1 } });
  await prisma.hostSeat.upsert({
    where: { id: 1 },
    create: { id: 1, userId: host.id, expiresAt: null },
    update: { userId: host.id, expiresAt: null },
  });

  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const url = `http://localhost:${port}/game`;
  const sockets: Socket[] = [];
  const quizIds: string[] = [];

  const connect = (auth?: Record<string, string>): Socket => {
    const socket = io(url, { transports: ['websocket'], auth, forceNew: true });
    sockets.push(socket);
    return socket;
  };

  return {
    app,
    prisma,
    url,
    hostUserId: host.id,
    connect,
    connectHost: () => connect({ localUser: HOST_NAME }),
    async createGame(hostSocket, quizId) {
      const { pin } = await hostSocket.emitWithAck('host:create', { quizId });
      return pin as string;
    },
    async join(pin, nickname) {
      const socket = connect();
      const ack = await socket.emitWithAck('player:join', { pin, nickname });
      return { socket, playerId: ack.playerId, sessionToken: ack.sessionToken };
    },
    async seedQuiz(overrides = {}) {
      const quiz = await prisma.quiz.create({
        data: {
          ownerId: host.id,
          title: 'Quiz live test',
          status: 'ready',
          questionCount: 1,
          questions: DEFAULT_QUESTIONS,
          ...overrides,
        },
        include: { questions: { orderBy: { orderIndex: 'asc' } } },
      });
      quizIds.push(quiz.id);
      return quiz;
    },
    async close() {
      for (const s of sockets) s.disconnect();
      // The server handles those departures asynchronously (roster, readiness): let it
      // finish while Redis is still open, or a late read fails the suite after the tests.
      await settle(500);
      await prisma.quiz.deleteMany({ where: { id: { in: quizIds } } }).catch(() => undefined);
      if (previousSeat) {
        await prisma.hostSeat
          .update({
            where: { id: 1 },
            data: { userId: previousSeat.userId, expiresAt: previousSeat.expiresAt },
          })
          .catch(() => undefined);
      }
      await app.close();
    },
  };
}

/**
 * The first `name` event on `socket` that matches `where`. Rejects with the event
 * name on timeout, so a failure says what never came.
 */
export function nextEvent<T = unknown>(
  socket: Socket,
  name: string,
  { where, timeoutMs = 5_000 }: { where?: (payload: T) => boolean; timeoutMs?: number } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener);
      reject(new Error(`no '${name}' event within ${timeoutMs} ms`));
    }, timeoutMs);
    const listener = (payload: T) => {
      if (where && !where(payload)) return;
      clearTimeout(timer);
      socket.off(name, listener);
      resolve(payload);
    };
    socket.on(name, listener);
  });
}

/** The only allowed fixed wait: to prove that something did **not** happen. */
export function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
