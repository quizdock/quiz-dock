import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { AuthGuard } from '../../auth/auth.guard';
import { AUTH_PROVIDER, type AuthProvider } from '../../auth/auth-provider';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import type { RedisService } from '../../redis/redis.service';
import { UsersService } from '../../users/users.service';
import { MemoryAuditRepository } from '../audit/audit.repository';
import { defineOperation, done } from '../operations/operation';
import { MemoryConfirmationStore } from '../runner/confirmations';
import { OperationRunner } from '../runner/operation-runner';
import type { OverridesService } from '../settings/overrides.service';
import { settingsFrom } from '../settings/settings.service';
import { SetupService } from '../setup/setup.service';
import { fakeRedis, memoryFlags } from '../testing/fake-redis';
import { SetupController } from './setup.controller';

const ops = [
  {
    ...defineOperation({
      id: 'setup.status',
      domain: 'instance',
      category: 'setup',
      effect: 'read',
      summary: 'S.',
      params: z.object({}),
      run: () => Promise.resolve(done({ ok: 1 })),
    }),
    wizard: true,
  },
  defineOperation({
    id: 'users.list',
    domain: 'instance',
    category: 'users',
    effect: 'read',
    summary: 'U.',
    params: z.object({}),
    run: () => Promise.resolve(done()),
  }),
];

describe('the setup wizard API (§3.8)', () => {
  let nest: INestApplication;
  let setup: SetupService;
  const users = {
    upsertFromPrincipal: (p: { sub: string; roles: string[] }) =>
      Promise.resolve({ id: `u-${p.sub}`, displayName: p.sub, roles: p.roles }),
  };
  const auth: AuthProvider = {
    authenticate: (req) =>
      Promise.resolve(
        req.headers['x-test-user']
          ? { sub: 'ada', displayName: 'Ada', email: null, roles: [] }
          : null,
      ),
  };

  beforeAll(async () => {
    setup = new SetupService(
      memoryFlags() as unknown as OverridesService,
      fakeRedis() as unknown as RedisService,
      { user: { count: () => Promise.resolve(0) } } as never,
    );
    const runner = new OperationRunner(
      ops,
      settingsFrom({ ADMIN_WEB_SCOPE: 'read' }),
      new MemoryAuditRepository(),
      new MemoryConfirmationStore(),
    );
    const module = await Test.createTestingModule({
      controllers: [SetupController],
      providers: [
        { provide: SetupService, useValue: setup },
        { provide: OperationRunner, useValue: runner },
        { provide: AUTH_PROVIDER, useValue: auth },
        { provide: UsersService, useValue: users },
      ],
    }).compile();
    nest = module.createNestApplication();
    nest.useGlobalGuards(new AuthGuard(auth, users as unknown as UsersService, new Reflector()));
    nest.useGlobalPipes(new ZodValidationPipe());
    nest.useGlobalFilters(new HttpExceptionFilter());
    await nest.init();
  });
  afterAll(() => nest.close());

  it('says whether the setup is open, to anyone', async () => {
    const res = await request(nest.getHttpServer()).get('/setup/status').expect(200);
    expect(res.body).toEqual({ open: true, authMode: 'none', signedIn: true });
  });

  it('the token opens a session; the session runs the wizard operations only', async () => {
    const token = await setup.newToken({ name: 't' });
    await request(nest.getHttpServer()).post('/setup/session').send({ token: 'wrong' }).expect(403);
    const { body } = await request(nest.getHttpServer())
      .post('/setup/session')
      .send({ token })
      .expect(200);
    const run = (id: string, session?: string) => {
      const r = request(nest.getHttpServer()).post(`/setup/operations/${id}`).send({});
      return session ? r.set('X-Setup-Session', session) : r;
    };
    expect((await run('setup.status').expect(403)).body.code).toBe('setup.session_invalid');
    expect((await run('setup.status', body.session).expect(200)).body.result.data).toEqual({
      ok: 1,
    });
    expect((await run('users.list', body.session).expect(403)).body.code).toBe('admin.forbidden');
  });

  it('the phone test page answers a phone with a page of its own', async () => {
    const { id } = await setup.startPhoneTest('http://192.168.1.10:18080');
    const res = await request(nest.getHttpServer())
      .get(`/setup/phone/${id}`)
      .set('User-Agent', 'Phone')
      .expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('✓');
    expect(await setup.testedAddresses()).toEqual(['http://192.168.1.10:18080']);
  });
});
