import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { zipSync } from 'fflate';
import { quizBundleSchema } from '../quizzes/portable/quiz-bundle.schema';
import type { PrismaService } from '../prisma/prisma.service';
import type { QuizPortableService } from '../quizzes/portable/quiz-portable.service';
import { StoreService } from './store.service';

/**
 * The catalogue is a folder, and the folder is the only truth (#39, RG-17):
 * these tests run against a real temporary directory rather than a mock, since
 * that is exactly what an operator restores from a backup.
 */
describe('StoreService', () => {
  const alice = {
    id: 'u1',
    displayName: 'Alice',
    oidcSubject: 'local:alice',
    roles: [UserRole.host],
  };
  const bob = { id: 'u2', displayName: 'Bob', oidcSubject: 'local:bob', roles: [UserRole.host] };
  const quiz = {
    id: 'q1',
    title: 'Ports',
    description: 'Harbours of the world',
    language: 'fr',
    tags: ['geo'],
    license: 'CC-BY-4.0',
    status: 'ready',
    questionCount: 3,
    publicationId: null as string | null,
  };

  let dir: string;
  const env = process.env;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'quizdock-store-'));
    process.env = { ...env, STORE_DIR: dir, DEMO_MODE: 'false' };
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    process.env = env;
  });

  function makeService(found: unknown = quiz, revision = 1) {
    const zip = Buffer.from(
      zipSync({
        'quiz.json': new Uint8Array(Buffer.from(JSON.stringify({ title: 'Ports' }))),
        'media/pic.jpg': new Uint8Array([1, 2, 3]),
      }),
    );
    const prisma = {
      quiz: {
        findFirst: jest.fn().mockResolvedValue(found),
        update: jest.fn().mockResolvedValue({ revision }),
      },
    } as unknown as PrismaService;
    const portable = {
      exportZip: jest.fn().mockResolvedValue({ filename: 'ports.zip', zip }),
      importBundle: jest.fn().mockResolvedValue({ id: 'copy-1', title: 'Ports' }),
    } as unknown as QuizPortableService;
    return { service: new StoreService(prisma, portable), prisma, portable };
  }

  it('shares a quiz: bundle on disk under the template ULID, entry in the index', async () => {
    const { service, prisma } = makeService();
    const entry = await service.share(alice, 'q1');

    expect(entry.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(entry).toMatchObject({
      title: 'Ports',
      revision: 1,
      author: { name: 'Alice', subject: 'local:alice' },
      license: 'CC-BY-4.0',
    });
    // The folder is named by the template id, never by the slug.
    expect(existsSync(join(dir, entry.id, 'quiz.json'))).toBe(true);
    expect(existsSync(join(dir, entry.id, 'media', 'pic.jpg'))).toBe(true);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { entries: [] };
    expect(index.entries).toHaveLength(1);
    // The publication id is kept on the quiz, and the counter moves.
    expect(prisma.quiz.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { publicationId: entry.id, revision: { increment: 1 } } }),
    );
    await expect(service.list()).resolves.toHaveLength(1);
  });

  it('keeps the same template id when shared again, and does not pile up entries', async () => {
    const { service } = makeService();
    const first = await service.share(alice, 'q1');

    const again = makeService({ ...quiz, publicationId: first.id }, 2);
    const second = await again.service.share(alice, 'q1');

    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    await expect(again.service.list()).resolves.toHaveLength(1);
  });

  it('refuses a draft and a quiz with no licence', async () => {
    const draft = makeService({ ...quiz, status: 'draft' });
    await expect(draft.service.share(alice, 'q1')).rejects.toThrow(BadRequestException);
    const noLicence = makeService({ ...quiz, license: null });
    await expect(noLicence.service.share(alice, 'q1')).rejects.toThrow(BadRequestException);
    const missing = makeService(null);
    await expect(missing.service.share(alice, 'q1')).rejects.toThrow(NotFoundException);
  });

  it('taking a copy hands the bundle to the importer, for the taker', async () => {
    const { service, portable } = makeService();
    const entry = await service.share(alice, 'q1');
    const copy = await service.take(bob.id, entry.id);

    expect(copy).toMatchObject({ id: 'copy-1' });
    const [ownerId, file] = (portable.importBundle as jest.Mock).mock.calls[0];
    expect(ownerId).toBe('u2');
    expect(file.buffer.length).toBeGreaterThan(0);
  });

  it('withdrawing: the author or an admin, and the copies are never touched', async () => {
    const { service } = makeService();
    const entry = await service.share(alice, 'q1');

    await expect(service.withdraw(bob, entry.id)).rejects.toThrow(ForbiddenException);
    await service.withdraw({ ...bob, roles: [UserRole.admin] }, entry.id);
    expect(existsSync(join(dir, entry.id))).toBe(false);
    await expect(service.list()).resolves.toHaveLength(0);
    // The entry is gone; nothing else was removed.
    await expect(service.take(bob.id, entry.id)).rejects.toThrow(NotFoundException);
  });

  it('l’aperçu dit ce que le modèle contient, médias servis par le catalogue', async () => {
    const { service } = makeService();
    const entry = await service.share(alice, 'q1');
    const preview = await service.preview(entry.id);

    expect(preview).toMatchObject({ id: entry.id, title: 'Ports', questionCount: 3 });
    // Le bundle de test ne porte qu'un manifeste minimal : l'aperçu ne doit pas
    // s'effondrer pour autant, il montre ce qu'il a.
    expect(Array.isArray(preview.items)).toBe(true);
  });

  it('un média du catalogue ne se lit que par un nom sans traversée', async () => {
    const { service } = makeService();
    const entry = await service.share(alice, 'q1');
    await expect(service.readMedia(entry.id, '../../index.json')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.readMedia(entry.id, 'pic.jpg')).resolves.toBeInstanceOf(Buffer);
  });

  it('an id that is not a ULID never reaches the filesystem', async () => {
    const { service } = makeService();
    await expect(service.take(bob.id, '../../etc')).rejects.toThrow(BadRequestException);
  });

  it('les modèles d’usine sont importables tels quels', async () => {
    // Le bundle amorcé doit passer la validation de l'importeur : sans ce garde,
    // une divergence de mapping ne se voit qu'au moment où quelqu'un s'en sert.
    const { service } = makeService();
    await service.onModuleInit();
    const seeded = await service.list();
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((e) => e.author.name === 'fchaussin')).toBe(true);

    for (const entry of seeded) {
      const manifest = JSON.parse(
        readFileSync(join(dir, entry.id, 'quiz.json'), 'utf8'),
      ) as unknown;
      expect(quizBundleSchema.safeParse(manifest).success).toBe(true);
    }
  });

  it('a demo instance has no catalogue at all', async () => {
    process.env.DEMO_MODE = 'true';
    const { service } = makeService();
    await expect(service.list()).resolves.toEqual([]);
    await expect(service.share(alice, 'q1')).rejects.toThrow(ForbiddenException);
    await expect(service.take(bob.id, '01ARZ3NDEKTSV4RRFFQ69G5FAV')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
