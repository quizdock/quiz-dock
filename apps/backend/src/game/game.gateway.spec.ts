import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type Socket, io } from 'socket.io-client';
import { AppModule } from '../app.module';

/**
 * Test d'INTÉGRATION : vraie connexion socket.io-client → gateway /game.
 * Requiert Postgres + Redis joignables (dev compose / services CI).
 */
describe('GameGateway (intégration socket)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= 'postgresql://roux:roux@localhost:45432/rouxquizz?schema=public';
    process.env.REDIS_URL ??= 'redis://localhost:46379';
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    url = `http://localhost:${port}/game`;
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('répond `pong` à un `ping` (RTT)', async () => {
    const socket: Socket = io(url, { transports: ['websocket'] });
    const pong = await new Promise<{ t0: number; t1: number }>((resolve, reject) => {
      socket.on('pong', resolve);
      socket.on('connect_error', reject);
      socket.emit('ping', { t0: 42 });
    });
    expect(pong.t0).toBe(42);
    expect(typeof pong.t1).toBe('number');
    socket.disconnect();
  }, 15_000);
});
