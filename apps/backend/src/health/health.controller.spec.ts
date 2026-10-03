import { Test } from '@nestjs/testing';
import { CONTRACTS_VERSION } from '@quiz-dock/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const prisma = { $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) };
  const redis = { ping: jest.fn(async () => 'PONG') };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('renvoie un statut ok', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('quiz-dock-backend');
  });

  it('expose la version du contrat partagé', () => {
    expect(controller.check().contracts).toBe(CONTRACTS_VERSION);
  });

  it('reports the release the image was built as, without its v', () => {
    const before = process.env.APP_VERSION;
    process.env.APP_VERSION = 'v0.13.1';
    try {
      expect(controller.check().version).toBe('0.13.1');
      delete process.env.APP_VERSION;
      expect(controller.check().version).toBe('dev');
    } finally {
      if (before === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = before;
    }
  });

  it("reflète AUTH_MODE par défaut 'none'", () => {
    delete process.env.AUTH_MODE;
    expect(controller.check().authMode).toBe('none');
  });

  describe('ready', () => {
    const response = () => ({ status: jest.fn() }) as unknown as import('express').Response;

    it('ok when the database and Redis answer', async () => {
      const res = response();
      expect(await controller.ready(res)).toEqual({ status: 'ok', database: 'ok', redis: 'ok' });
      expect(res.status).not.toHaveBeenCalled();
    });

    it('503, naming what is down', async () => {
      redis.ping.mockRejectedValueOnce(new Error('Connection is closed.'));
      const res = response();
      expect(await controller.ready(res)).toEqual({
        status: 'unavailable',
        database: 'ok',
        redis: 'down',
      });
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });
});
