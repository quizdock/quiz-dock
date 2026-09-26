import { type GameContext, bootGameApp } from '../../test/game-harness';
import { archiveTests } from '../../test/game/archive';
import { lobbyTests } from '../../test/game/lobby';
import { mediaTests } from '../../test/game/media';
import { questionLoopTests } from '../../test/game/question-loop';
import { resilienceTests } from '../../test/game/resilience';
import { roomTests } from '../../test/game/room';
import { timingTests } from '../../test/game/timing';

/**
 * Test d'INTÉGRATION : vraie connexion socket.io-client → gateway /game.
 * Requiert Postgres + Redis joignables (dev compose / services CI) ; la base est
 * `<db>_test`, créée par le global setup de Jest.
 *
 * One entry file, one app, one domain per module in test/game/. The domains share
 * the host seat and Redis database 1, so they must run serially: a single spec
 * file guarantees it, whatever the number of Jest workers. Run one domain with
 * `npx jest src/game/game.gateway.spec.ts -t lobby`.
 */
describe('GameGateway (intégration socket)', () => {
  const ctx = {} as GameContext;

  beforeAll(async () => {
    ctx.h = await bootGameApp();
    ctx.quizId = (await ctx.h.seedQuiz({ description: 'Quiz de démonstration' })).id;
  }, 30_000);

  afterAll(() => ctx.h?.close());

  describe('lobby', () => lobbyTests(ctx));
  describe('question loop', () => questionLoopTests(ctx));
  describe('timing', () => timingTests(ctx));
  describe('media', () => mediaTests(ctx));
  describe('resilience', () => resilienceTests(ctx));
  describe('archive', () => archiveTests(ctx));
  describe('room', () => roomTests(ctx));
});
