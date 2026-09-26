import { BadRequestException } from '@nestjs/common';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from './args';
import { doctor, type DoctorDeps } from './commands/doctor';
import { migrationStatus } from './commands/migrate-status';
import { type BundleIo, quizExport, quizImport, quizList, quizTransfer } from './commands/quiz';
import { seatRelease, seatStatus } from './commands/seat';
import { sessionsPurge } from './commands/sessions';
import { samplesLoad, userList, userSetRole } from './commands/users';
import { CliError, type Output } from './output';
import type { HostSeatService } from '../users/host-seat.service';

function memOutput() {
  const lines: string[] = [];
  const out: Output = {
    line: (t = '') => void lines.push(t),
    ok: (t) => void lines.push(`OK ${t}`),
    warn: (t) => void lines.push(`WARN ${t}`),
    fail: (t) => void lines.push(`FAIL ${t}`),
    table: (rows) => void lines.push(`TABLE ${JSON.stringify(rows)}`),
  };
  return { out, lines, text: () => lines.join('\n') };
}

describe('parseArgs', () => {
  it('splits command, positionals and --flags', () => {
    expect(parseArgs(['user:set-role', 'alice@ex.io', 'admin', '--dry-run', '--days=30'])).toEqual({
      command: 'user:set-role',
      positional: ['alice@ex.io', 'admin'],
      flags: { 'dry-run': true, days: '30' },
    });
    expect(parseArgs([])).toEqual({ command: null, positional: [], flags: {} });
  });
});

describe('migrationStatus', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const m of ['20260101_init', '20260102_next', '20260103_new']) mkdirSync(join(dir, m));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('classifies shipped migrations as applied, pending or failed', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { migration_name: '20260101_init', finished_at: new Date(), rolled_back_at: null },
        { migration_name: '20260102_next', finished_at: null, rolled_back_at: null },
      ]),
    };
    await expect(migrationStatus(prisma, dir)).resolves.toEqual({
      applied: ['20260101_init'],
      pending: ['20260103_new'],
      failed: ['20260102_next'],
    });
  });
});

describe('doctor', () => {
  let migrationsDir: string;
  beforeAll(() => {
    migrationsDir = mkdtempSync(join(tmpdir(), 'mig-'));
    mkdirSync(join(migrationsDir, '20260101_init'));
  });
  afterAll(() => rmSync(migrationsDir, { recursive: true, force: true }));

  function deps(over: Partial<DoctorDeps> = {}, env: NodeJS.ProcessEnv = {}): DoctorDeps {
    return {
      prisma: {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ '?column?': 1 }])
          .mockResolvedValue([
            { migration_name: '20260101_init', finished_at: new Date(), rolled_back_at: null },
          ]),
      },
      env: {
        AUTH_MODE: 'none',
        DATABASE_URL: 'postgres://x',
        REDIS_URL: 'redis://x',
        MEDIA_DIR: '/tmp',
        STORE_DIR: '/srv/store',
        ...env,
      },
      fetch: jest.fn() as unknown as typeof fetch,
      pingRedis: jest.fn().mockResolvedValue(undefined),
      probeWritable: jest.fn(),
      migrationsDir,
      ...over,
    };
  }

  it('passes in local mode when everything is reachable', async () => {
    const { out, text } = memOutput();
    const healthy = await doctor(out, deps());
    expect(text()).toContain('OK 1 migration(s) applied');
    expect(text()).toContain('All checks passed');
    expect(healthy).toBe(true);
  });

  it('reports failures: missing REDIS_URL, unwritable media dir, DB down', async () => {
    const { out, text } = memOutput();
    const d = deps(
      {
        prisma: { $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
        probeWritable: jest.fn(() => {
          throw new Error('EROFS');
        }),
      },
      { REDIS_URL: undefined },
    );
    const healthy = await doctor(out, d);
    expect(healthy).toBe(false);
    expect(text()).toContain('FAIL PostgreSQL: ECONNREFUSED');
    expect(text()).toContain('FAIL REDIS_URL is not set');
    expect(text()).toContain('FAIL /tmp: EROFS');
  });

  it('checks the templates folder too (a fresh volume owned by root)', async () => {
    const { out, text } = memOutput();
    const d = deps({
      probeWritable: jest.fn((dir: string) => {
        if (dir === '/srv/store') throw new Error('EACCES');
      }),
    });
    expect(await doctor(out, d)).toBe(false);
    expect(text()).toContain('OK /tmp is writable');
    expect(text()).toContain('FAIL /srv/store: EACCES');
  });

  it('in oidc mode runs discovery, then checks the JWKS', async () => {
    const { out, text } = memOutput();
    const fetchMock = jest.fn(async (url: string) => {
      if (url.endsWith('/.well-known/openid-configuration'))
        return {
          ok: true,
          json: async () => ({
            issuer: 'https://idp/x',
            authorization_endpoint: 'https://idp/x/auth',
            token_endpoint: 'https://idp/x/token',
            jwks_uri: 'https://idp/x/jwks',
          }),
        };
      if (url === 'https://idp/x/jwks') return { ok: true, json: async () => ({ keys: [{}, {}] }) };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const healthy = await doctor(
      out,
      deps(
        { fetch: fetchMock as unknown as typeof fetch },
        { AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://idp/x/' },
      ),
    );
    expect(text()).toContain('client_id quiz-dock-frontend (public, PKCE)');
    expect(text()).toContain('discovery ok → token endpoint https://idp/x/token');
    expect(text()).toContain('JWKS reachable (2 key(s))');
    expect(fetchMock).toHaveBeenCalledWith('https://idp/x/.well-known/openid-configuration');
    // OIDC_ISSUER has a slash the provider's issuer lacks: tokens would be refused (#99).
    expect(text()).toMatch(
      /WARN discovery issuer "https:\/\/idp\/x" differs .* by a trailing slash only/,
    );
    expect(healthy).toBe(true);
  });

  it('in oidc mode a failed discovery points at OIDC_INTERNAL_URL', async () => {
    const { out, text } = memOutput();
    const fetchMock = jest.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const healthy = await doctor(
      out,
      deps(
        { fetch: fetchMock as unknown as typeof fetch },
        { AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://idp/x' },
      ),
    );
    expect(healthy).toBe(false);
    expect(text()).toMatch(/FAIL discovery .*HTTP 502.*set OIDC_INTERNAL_URL/);
  });
});

describe('seat commands', () => {
  it('seat:status prints free / held / expired', async () => {
    const free = memOutput();
    await seatStatus(free.out, { details: async () => null } as unknown as HostSeatService);
    expect(free.text()).toBe('Host seat: free');

    const held = memOutput();
    await seatStatus(held.out, {
      details: async () => ({
        id: 1,
        userId: 'u1',
        claimedAt: new Date('2026-09-18T10:00:00Z'),
        expiresAt: null,
        user: { displayName: 'Bob', oidcSubject: 'local:bob' },
      }),
    } as unknown as HostSeatService);
    expect(held.text()).toContain('Host seat: held');
    expect(held.text()).toContain('"holder":"Bob"');
    expect(held.text()).toContain('"expiresAt":"never"');

    const expired = memOutput();
    await seatStatus(expired.out, {
      details: async () => ({
        id: 1,
        userId: 'u1',
        claimedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        user: { displayName: 'Bob', oidcSubject: 'local:bob' },
      }),
    } as unknown as HostSeatService);
    expect(expired.text()).toContain('Host seat: expired');
  });

  it('seat:release reports whether something was freed', async () => {
    const a = memOutput();
    await seatRelease(a.out, { forceRelease: async () => true } as unknown as HostSeatService);
    expect(a.text()).toBe('Host seat released.');
    const b = memOutput();
    await seatRelease(b.out, { forceRelease: async () => false } as unknown as HostSeatService);
    expect(b.text()).toBe('Host seat was already free.');
  });
});

describe('user commands', () => {
  const alice = {
    id: 'u1',
    displayName: 'Alice',
    oidcSubject: 'oidc-1',
    email: 'alice@ex.io',
    roles: [],
    assignedRoles: [],
  };
  function db(found: unknown = alice) {
    return {
      user: {
        findFirst: jest.fn().mockResolvedValue(found),
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...alice, createdAt: new Date(0), _count: { quizzes: 2 } }]),
        update: jest.fn().mockResolvedValue(undefined),
      },
      quiz: {},
    } as unknown as Parameters<typeof userList>[1];
  }

  it('user:list tabulates accounts with their quiz count', async () => {
    const { out, text } = memOutput();
    await userList(out, db());
    expect(text()).toContain('"name":"Alice"');
    expect(text()).toContain('"quizzes":2');
  });

  it('user:set-role grants host or admin, and revokes with player', async () => {
    const { out, text } = memOutput();
    const prisma = db();
    await userSetRole(out, prisma, 'alice@ex.io', 'admin');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { assignedRoles: ['admin'], roles: ['admin'] },
    });
    expect(text()).toContain('is now admin');
    await userSetRole(out, prisma, 'alice@ex.io', 'host');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { assignedRoles: ['host'], roles: ['host'] },
    });
    await userSetRole(out, prisma, 'alice@ex.io', 'player');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { assignedRoles: [], roles: [] },
    });
    expect(text()).toContain('grant revoked');
    // Et le cumul, qui est le point de l'ensemble (RG-14).
    await userSetRole(out, prisma, 'alice@ex.io', 'host,admin');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { assignedRoles: ['admin', 'host'], roles: ['admin', 'host'] },
    });
    await expect(userSetRole(out, prisma, 'alice@ex.io', 'root')).rejects.toThrow(CliError);
    await expect(userSetRole(out, db(null), 'nobody', 'admin')).rejects.toThrow('No user');
  });

  it('samples:load creates the samples for the resolved user', async () => {
    const { out, text } = memOutput();
    const samples = {
      createFor: jest.fn().mockResolvedValue([{ id: 'q1', title: 'Discover France' }]),
    };
    await samplesLoad(out, db(), samples, 'oidc-1');
    expect(samples.createFor).toHaveBeenCalledWith('u1');
    expect(text()).toContain('Discover France');
  });
});

describe('quiz commands', () => {
  const alice = { id: 'u1', displayName: 'Alice', oidcSubject: 'oidc-1', email: 'alice@ex.io' };
  const row = {
    id: 'q1',
    title: 'Ports',
    status: 'ready',
    questionCount: 3,
    slug: 'ports',
    revision: 2,
    updatedAt: new Date(0),
    owner: { oidcSubject: 'oidc-1' },
  };
  function db(found: unknown = alice) {
    return {
      user: { findFirst: jest.fn().mockResolvedValue(found) },
      quiz: { findMany: jest.fn().mockResolvedValue([row]) },
    } as unknown as Parameters<typeof quizList>[1];
  }
  function memIo(input = Buffer.from('{}')) {
    const written: Record<string, Buffer> = {};
    const io: BundleIo = {
      read: jest.fn(async () => input),
      write: jest.fn(async (path, data) => void (written[path] = data)),
    };
    return { io, written };
  }

  describe('quiz:transfer', () => {
    const bob = { id: 'u2', displayName: 'Bob', oidcSubject: 'oidc-2', email: 'bob@ex.io' };
    /** A quiz whose media are: `mShared` (also used by another quiz), `mOwn` (not). */
    const quiz = {
      id: 'q1',
      title: 'Ports',
      ownerId: 'u1',
      coverMediaId: 'mOwn',
      description: null,
      questions: [
        {
          visualMediaId: 'mShared',
          audioMediaId: null,
          backgroundMediaId: null,
          prompt: 'Where?',
          answerExplanation: null,
          options: [],
        },
      ],
      slides: [],
    };
    const otherQuiz = {
      id: 'q2',
      coverMediaId: 'mShared',
      description: null,
      questions: [],
      slides: [],
    };

    function transferDb(live = false) {
      const prisma = {
        user: { findFirst: jest.fn().mockResolvedValue(bob) },
        quiz: {
          findUnique: jest.fn().mockResolvedValue(quiz),
          findMany: jest.fn().mockResolvedValue([otherQuiz]),
          update: jest.fn((args: unknown) => args),
        },
        mediaAsset: { updateMany: jest.fn((args: unknown) => args) },
        $transaction: jest.fn(async (ops: unknown[]) => ops),
      } as unknown as Parameters<typeof quizTransfer>[1];
      const redis = {
        smembers: jest.fn().mockResolvedValue(live ? ['123456'] : []),
        hmget: jest.fn().mockResolvedValue(live ? ['ANSWERING', 'q1'] : [null, null]),
      };
      return { prisma, redis };
    }

    it('hands the quiz over and moves only the media nothing else uses', async () => {
      const { out, text } = memOutput();
      const { prisma, redis } = transferDb();
      await quizTransfer(out, prisma, redis, 'q1', 'bob@ex.io');

      expect(prisma.quiz.update).toHaveBeenCalledWith({
        where: { id: 'q1' },
        data: { ownerId: 'u2' },
      });
      // `mShared` serves another of Alice's quizzes: taking it would leave that
      // quiz depending on media its owner no longer controls.
      expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['mOwn'] }, ownerId: 'u1' },
        data: { ownerId: 'u2' },
      });
      expect(text()).toContain('now belongs to Bob');
      expect(text()).toContain('1 moved, 1 left behind');
      expect(text()).toContain('archived sessions follow');
    });

    it('refuses while the quiz is being played', async () => {
      const { out } = memOutput();
      const { prisma, redis } = transferDb(true);
      await expect(quizTransfer(out, prisma, redis, 'q1', 'bob@ex.io')).rejects.toThrow(
        /being played/,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is a no-op when the target already owns it', async () => {
      const { out, text } = memOutput();
      const { prisma, redis } = transferDb();
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({ ...bob, id: 'u1' });
      await quizTransfer(out, prisma, redis, 'q1', 'alice@ex.io');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(text()).toContain('already belongs to');
    });

    it('fails on an unknown quiz id', async () => {
      const { out } = memOutput();
      const { prisma, redis } = transferDb();
      (prisma.quiz.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(quizTransfer(out, prisma, redis, 'nope', 'bob@ex.io')).rejects.toThrow(CliError);
    });
  });

  it('quiz:list tabulates every quiz, or one user’s', async () => {
    const { out, text } = memOutput();
    const prisma = db();
    await quizList(out, prisma);
    expect(prisma.quiz.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
    expect(text()).toContain('"id":"q1"');
    expect(text()).toContain('"owner":"oidc-1"');
    await quizList(out, prisma, 'alice@ex.io');
    expect(prisma.quiz.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { ownerId: 'u1' } }),
    );
    await expect(quizList(out, db(null), 'nobody')).rejects.toThrow('No user');
  });

  it('quiz:export writes the bundle where asked, silently on stdout', async () => {
    const zip = Buffer.from('PK..');
    const portable = {
      exportZip: jest.fn().mockResolvedValue({ filename: 'ports.quizdock.zip', zip }),
      importBundle: jest.fn(),
    };
    const { out, text } = memOutput();
    const { io, written } = memIo();
    await quizExport(out, portable, 'q1', '/tmp/out.zip', io);
    expect(portable.exportZip).toHaveBeenCalledWith('q1'); // no owner: any quiz
    expect(written['/tmp/out.zip']).toBe(zip);
    expect(text()).toContain('Exported ports.quizdock.zip (4 bytes) to /tmp/out.zip.');

    const quiet = memOutput();
    await quizExport(quiet.out, portable, 'q1', '-', io);
    expect(written['-']).toBe(zip);
    expect(quiet.lines).toEqual([]);
  });

  it('quiz:import creates a draft for the resolved user, and explains a refusal', async () => {
    const input = Buffer.from('{"format":"quizdock/quiz"}');
    const portable = {
      exportZip: jest.fn(),
      importBundle: jest.fn().mockResolvedValue({ id: 'new', title: 'Ports' }),
    };
    const { out, text } = memOutput();
    const { io } = memIo(input);
    await quizImport(out, db(), portable, 'ports.zip', 'oidc-1', io);
    expect(io.read).toHaveBeenCalledWith('ports.zip');
    expect(portable.importBundle).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ buffer: input }),
    );
    expect(text()).toContain('Imported "Ports" (new) as a draft of Alice.');

    portable.importBundle.mockRejectedValue(
      new BadRequestException({ code: 'import.media_missing', params: { path: 'media/a.png' } }),
    );
    await expect(quizImport(out, db(), portable, '-', 'oidc-1', io)).rejects.toThrow(
      'Import refused: import.media_missing (path=media/a.png)',
    );
    await expect(quizImport(out, db(null), portable, '-', 'nobody', io)).rejects.toThrow('No user');
  });
});

describe('sessions:purge', () => {
  it('counts on dry run, deletes otherwise, only past retention', async () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const prisma = {
      gameSessionLog: {
        count: jest.fn().mockResolvedValue(3),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    } as unknown as Parameters<typeof sessionsPurge>[1];
    const dry = memOutput();
    await expect(sessionsPurge(dry.out, prisma, true, now)).resolves.toBe(3);
    const del = prisma.gameSessionLog.deleteMany as jest.Mock;
    expect(del).not.toHaveBeenCalled();
    expect(dry.text()).toContain('would be deleted (dry run)');

    const real = memOutput();
    await expect(sessionsPurge(real.out, prisma, false, now)).resolves.toBe(3);
    expect(del).toHaveBeenCalledWith({ where: { retainUntil: { lt: now } } });
    expect(real.text()).toContain('Deleted 3 session(s)');
  });
});
