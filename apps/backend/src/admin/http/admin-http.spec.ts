import { ConflictException, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { z } from 'zod';
import { AuthGuard } from '../../auth/auth.guard';
import type { AuthProvider } from '../../auth/auth-provider';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { MediaAdminController } from '../../media/media-admin.controller';
import { MediaAdminService } from '../../media/media-admin.service';
import { RedisService } from '../../redis/redis.service';
import type { UsersService } from '../../users/users.service';
import { AUDIT_REPOSITORY } from '../admin.tokens';
import { MemoryAuditRepository } from '../audit/audit.repository';
import { defineOperation, done } from '../operations/operation';
import { MemoryConfirmationStore } from '../runner/confirmations';
import { OperationRunner } from '../runner/operation-runner';
import { settingsFrom } from '../settings/settings.service';
import { AdminOperationsController } from './admin-operations.controller';
import { REFUSALS_AUDITED } from './refusal-audit.filter';
import { OperationFileInterceptor } from './operation-file.interceptor';
import {
  ADMIN_TOKEN_FAILURES_GLOBAL_MAX,
  ADMIN_TOKEN_FAILURES_MAX,
  AdminRateLimit,
} from './admin-rate-limit';

const TOKEN = 't'.repeat(40);
const ran: string[] = [];

const ops = [
  defineOperation({
    id: 'thing.read',
    domain: 'instance',
    category: 'health',
    effect: 'read',
    summary: 'Reads.',
    params: z.object({}),
    run: () => Promise.resolve(done({ secret: false })),
  }),
  defineOperation({
    id: 'thing.drop',
    domain: 'instance',
    category: 'settings',
    effect: 'destructive',
    summary: 'Drops.',
    params: z.object({ what: z.string() }),
    run: (_c, { what }) => {
      ran.push(what);
      return Promise.resolve(done());
    },
  }),
  defineOperation({
    id: 'thing.busy',
    domain: 'instance',
    category: 'health',
    effect: 'read',
    summary: 'Busy.',
    params: z.object({}),
    run: () => Promise.reject(new ConflictException({ code: 'media.playing' })),
  }),
  defineOperation({
    id: 'thing.crash',
    domain: 'instance',
    category: 'health',
    effect: 'read',
    summary: 'Crashes.',
    params: z.object({}),
    run: () =>
      Promise.reject(new Error('Invalid `prisma.quiz.delete()` invocation in /app/dist/x.js')),
  }),
  defineOperation({
    id: 'thing.upload',
    domain: 'instance',
    category: 'quizzes',
    effect: 'read',
    summary: 'Takes a file.',
    params: z.object({ note: z.string().optional() }),
    upload: { param: 'bundle', maxBytes: () => 10, tooLarge: 'import.file_too_large' },
    run: (ctx, { note }) => {
      const file = ctx.attachments.file as { buffer: Buffer; name: string };
      return Promise.resolve(done({ size: file.buffer.length, name: file.name, note }));
    },
  }),
  defineOperation({
    id: 'media.remove',
    domain: 'media',
    category: 'media',
    effect: 'write',
    summary: 'Removes.',
    params: z.object({ media: z.string() }),
    run: (_c, { media }) => {
      ran.push(`media:${media}`);
      return Promise.resolve(done());
    },
  }),
];

/** A Redis just good enough for the rate limits. */
function fakeRedis() {
  const values = new Map<string, number>();
  const multi = () => {
    const steps: (() => [null, unknown])[] = [];
    const chain = {
      set: (key: string, value: string, _ex: string, _s: number, nx: string) => {
        steps.push(() => {
          if (nx !== 'NX' || !values.has(key)) values.set(key, Number(value));
          return [null, 'OK'];
        });
        return chain;
      },
      incr: (key: string) => {
        steps.push(() => {
          values.set(key, (values.get(key) ?? 0) + 1);
          return [null, values.get(key)];
        });
        return chain;
      },
      exec: () => Promise.resolve(steps.map((s) => s())),
    };
    return chain;
  };
  return {
    multi,
    get: (key: string) => Promise.resolve(values.has(key) ? String(values.get(key)) : null),
  };
}

async function app(
  env: Record<string, string>,
): Promise<{ app: INestApplication; audit: MemoryAuditRepository }> {
  const audit = new MemoryAuditRepository();
  const runner = new OperationRunner(ops, settingsFrom(env), audit, new MemoryConfirmationStore());
  const module = await Test.createTestingModule({
    controllers: [AdminOperationsController, MediaAdminController],
    providers: [
      { provide: OperationRunner, useValue: runner },
      { provide: AdminRateLimit, useValue: new AdminRateLimit(fakeRedis() as never) },
      { provide: MediaAdminService, useValue: {} },
      { provide: AUDIT_REPOSITORY, useValue: audit },
      { provide: RedisService, useValue: fakeRedis() },
      OperationFileInterceptor,
    ],
  }).compile();
  const nest = module.createNestApplication();
  const provider: AuthProvider = {
    authenticate: (req) => {
      const role = req.headers['x-test-role'];
      return Promise.resolve(
        typeof role === 'string'
          ? { sub: role, displayName: role, email: null, roles: [role] }
          : null,
      );
    },
  };
  const users = {
    upsertFromPrincipal: (p: { sub: string; roles: string[] }) =>
      Promise.resolve({ id: `user-${p.sub}`, displayName: p.sub, roles: p.roles }),
  };
  nest.useGlobalGuards(new AuthGuard(provider, users as unknown as UsersService, new Reflector()));
  nest.useGlobalPipes(new ZodValidationPipe());
  nest.useGlobalFilters(new HttpExceptionFilter());
  await nest.init();
  return { app: nest, audit };
}

const OIDC_WRITE = {
  AUTH_MODE: 'oidc',
  OIDC_ISSUER: 'https://id.example.org',
  ADMIN_WEB_SCOPE: 'write',
};

describe('the admin API', () => {
  let nest: INestApplication;
  let audit: MemoryAuditRepository;
  beforeAll(async () => ({ app: nest, audit } = await app(OIDC_WRITE)));
  afterAll(() => nest.close());
  beforeEach(() => (ran.length = 0));

  const call = (role: string | null, method: 'get' | 'post' | 'put' | 'delete', path: string) => {
    const r = request(nest.getHttpServer())[method](path);
    return role ? r.set('X-Test-Role', role) : r;
  };

  it.each([
    ['get', '/admin/operations'],
    ['post', '/admin/operations/thing.read'],
    ['delete', '/admin/media/instance/m1'],
    ['post', '/admin/media/sweep'],
  ] as const)('%s %s: 401 signed out, 403 for a host or a player', async (method, path) => {
    await call(null, method, path).expect(401);
    await call('host', method, path).expect(403);
    await call('player', method, path).expect(403);
    expect(ran).toEqual([]);
    // A refusal of rights at the guard is audited too (§3.10).
    expect(audit.entries.at(-1)).toMatchObject({
      actor: 'player',
      outcome: 'refused',
      code: 'forbidden',
    });
  });

  it('keeps a few refusals per account and window, not one row per request', async () => {
    const { app: fresh, audit: kept } = await app(OIDC_WRITE);
    try {
      for (let i = 0; i < REFUSALS_AUDITED + 5; i++) {
        await request(fresh.getHttpServer())
          .get('/admin/operations')
          .set('X-Test-Role', 'player')
          .expect(403);
      }
      await new Promise((r) => setTimeout(r, 20)); // the audit is written after the answer
      expect(kept.entries.filter((e) => e.actor === 'player')).toHaveLength(REFUSALS_AUDITED);
    } finally {
      await fresh.close();
    }
  });

  it('lists the catalogue, with each operation reachable or not', async () => {
    const res = await call('admin', 'get', '/admin/operations').expect(200);
    expect(res.body.operations.map((o: { id: string }) => o.id)).toEqual([
      'thing.read',
      'thing.drop',
      'thing.busy',
      'thing.crash',
      'thing.upload',
      'media.remove',
    ]);
  });

  it('runs an operation, asks for a confirmation when it must', async () => {
    const read = await call('admin', 'post', '/admin/operations/thing.read').send({}).expect(200);
    expect(read.body).toEqual({
      kind: 'result',
      result: { outcome: 'done', notes: [], data: { secret: false } },
    });
    const ask = await call('admin', 'post', '/admin/operations/thing.drop')
      .send({ params: { what: 'x' } })
      .expect(200);
    expect(ask.body).toMatchObject({ kind: 'confirm', summary: 'Drops. This cannot be undone.' });
    expect(ran).toEqual([]);
    await call('admin', 'post', '/admin/operations/thing.drop')
      .send({ params: { what: 'x' }, confirmation: ask.body.token })
      .expect(200);
    expect(ran).toEqual(['x']);
    // Forged or replayed: refused.
    const replay = await call('admin', 'post', '/admin/operations/thing.drop')
      .send({ params: { what: 'x' }, confirmation: ask.body.token })
      .expect(409);
    expect(replay.body.code).toBe('admin.confirmation_invalid');
  });

  it('answers a refusal with its code', async () => {
    expect(
      (await call('admin', 'post', '/admin/operations/nope').send({}).expect(404)).body.code,
    ).toBe('admin.unknown_operation');
    const bad = await call('admin', 'post', '/admin/operations/thing.drop')
      .send({ params: { what: 3 } })
      .expect(400);
    expect(bad.body).toMatchObject({ code: 'admin.invalid_params', params: { path: 'what' } });
  });

  it("keeps a domain's own error code and status (the media page's messages)", async () => {
    const busy = await call('admin', 'post', '/admin/operations/thing.busy').send({}).expect(409);
    expect(busy.body.code).toBe('media.playing');
  });

  it('takes a file as a file (multipart), bounded by its operation', async () => {
    const send = (bytes: number) =>
      call('admin', 'post', '/admin/operations/thing.upload/file')
        .field('params', JSON.stringify({ note: 'n' }))
        .attach('file', Buffer.alloc(bytes), 'quiz.zip');
    expect((await send(5).expect(200)).body.result.data).toEqual({
      size: 5,
      name: 'quiz.zip',
      note: 'n',
    });
    const big = await send(20).expect(413);
    expect(big.body).toMatchObject({ code: 'import.file_too_large', params: { max: 10 } });
    // An operation that takes no file accepts none.
    await call('admin', 'post', '/admin/operations/thing.read/file')
      .attach('file', Buffer.alloc(1), 'x')
      .expect(413);
  });

  it('answers an unexpected error in general terms: nothing of the internals', async () => {
    const res = await call('admin', 'post', '/admin/operations/thing.crash').send({}).expect(500);
    expect(res.body.code).toBe('admin.failed');
    expect(JSON.stringify(res.body)).not.toContain('/app/dist');
  });

  it('the media page still works, now audited, without asking again', async () => {
    await call('admin', 'delete', '/admin/media/instance/m1').expect(204);
    expect(ran).toEqual(['media:m1']);
    expect(audit.entries.at(-1)).toMatchObject({
      operation: 'media.remove',
      actor: 'admin',
      params: { media: 'm1' },
    });
  });
});

describe('the admin API in local mode', () => {
  it('changes nothing without the token, and stops guessing it', async () => {
    const { app: nest } = await app({ ADMIN_WEB_SCOPE: 'write', ADMIN_TOKEN: TOKEN });
    const post = (token?: string) => {
      const r = request(nest.getHttpServer())
        .post('/admin/operations/thing.drop')
        .set('X-Test-Role', 'admin')
        .send({ params: { what: 'y' } });
      return token ? r.set('X-Admin-Token', token) : r;
    };
    expect((await post().expect(403)).body.code).toBe('admin.local_mode_token');
    expect((await post(TOKEN).expect(200)).body.kind).toBe('confirm');
    for (let i = 0; i < ADMIN_TOKEN_FAILURES_MAX; i++) await post('wrong').expect(403);
    expect((await post(TOKEN).expect(429)).body.code).toBe('admin.too_many_requests');
    await nest.close();
  });

  it('the catalogue never tells a right token from a wrong one', async () => {
    const { app: nest } = await app({ ADMIN_WEB_SCOPE: 'write', ADMIN_TOKEN: TOKEN });
    const catalogue = async (token: string) =>
      (
        await request(nest.getHttpServer())
          .get('/admin/operations')
          .set('X-Test-Role', 'admin')
          .set('X-Admin-Token', token)
          .expect(200)
      ).body;
    expect(await catalogue('wrong')).toEqual(await catalogue(TOKEN));
    await nest.close();
  });

  it('a token shorter than 32 characters is ignored: the web changes nothing', async () => {
    const { app: nest } = await app({ ADMIN_WEB_SCOPE: 'write', ADMIN_TOKEN: 'short' });
    const res = await request(nest.getHttpServer())
      .post('/admin/operations/thing.drop')
      .set('X-Test-Role', 'admin')
      .set('X-Admin-Token', 'short')
      .send({ params: { what: 'z' } })
      .expect(403);
    expect(res.body.code).toBe('admin.local_mode_token');
    await nest.close();
  });

  it('wrong tokens from many addresses, together, stop the guessing for all', async () => {
    const limits = new AdminRateLimit(fakeRedis() as never);
    for (let i = 0; i < ADMIN_TOKEN_FAILURES_GLOBAL_MAX; i++)
      await limits.tokenFailed(`10.0.${i}.1`);
    await expect(limits.tokenAllowed('10.9.9.9')).rejects.toMatchObject({ status: 429 });
  });
});
