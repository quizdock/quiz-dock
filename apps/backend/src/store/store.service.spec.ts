import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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

  function makeService(
    found: unknown = quiz,
    revision = 1,
    manifest: unknown = { title: 'Ports' },
  ) {
    const zip = Buffer.from(
      zipSync({
        'quiz.json': new Uint8Array(Buffer.from(JSON.stringify(manifest))),
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
    // Le bundle de test ne porte qu'un manifeste minimal : l'aperçu ne s'effondre
    // pas, il dit quel élément une copie refuserait.
    expect(preview).toMatchObject({ questions: [], slides: [], invalid: { item: null } });
  });

  it('la carte reçoit la première diapositive entière, médias servis par le catalogue', async () => {
    const { service } = makeService(quiz, 1, {
      items: [
        {
          kind: 'slide',
          backgroundImage: 'media/bg.webp',
          textTone: 'dark',
          blocks: [
            { type: 'heading', id: 'h', text: 'Ports', level: 1 },
            {
              type: 'columns',
              id: 'c',
              columns: [
                [{ type: 'image', id: 'i', media: 'media/pic.jpg', size: 'full', align: 'center' }],
                [{ type: 'text', id: 't', md: 'See ![map](media/map.webp)' }],
              ],
            },
          ],
        },
      ],
    });
    const entry = await service.share(alice, 'q1');
    const [listed] = await service.list();
    const base = `/api/v1/store/${entry.id}/media`;

    expect(listed.first).toMatchObject({ kind: 'slide', text: 'Ports', media: `${base}/bg.webp` });
    expect(listed.first?.slide).toEqual({
      blocks: [
        { type: 'heading', id: 'h', text: 'Ports', level: 1 },
        {
          type: 'columns',
          id: 'c',
          columns: [
            [
              {
                type: 'image',
                id: 'i',
                mediaId: '',
                url: `${base}/pic.jpg`,
                size: 'full',
                align: 'center',
              },
            ],
            [{ type: 'text', id: 't', md: `See ![map](${base}/map.webp)` }],
          ],
        },
      ],
      background: { url: `${base}/bg.webp` },
      textTone: 'dark',
      textOutline: true,
    });
  });

  it('the template page gets what a copy would create, in the shape of a quiz', async () => {
    const { service } = makeService(quiz, 1, {
      format: 'quizdock/quiz',
      quiz: { title: 'Ports' },
      items: [
        {
          kind: 'slide',
          backgroundImage: 'media/bg.webp',
          textTone: 'dark',
          blocks: [
            { type: 'heading', id: 'h', text: 'Ports', level: 1 },
            { type: 'image', id: 'i', media: 'media/pic.jpg', size: 'full', align: 'center' },
          ],
        },
        {
          kind: 'question',
          type: 'single_choice',
          prompt: 'Biggest port?',
          backgroundGradient: { angle: 90, colors: ['#112233', '#445566'] },
          options: [
            { text: 'Shanghai', color: 'red', shape: 'triangle', isCorrect: true },
            { text: 'Rotterdam', color: 'blue', shape: 'diamond' },
          ],
        },
      ],
    });
    const entry = await service.share(alice, 'q1');
    const base = `/api/v1/store/${entry.id}/media`;
    const preview = await service.preview(entry.id);

    expect(preview.invalid).toBeNull();
    expect(preview.questions).toHaveLength(1);
    const [question] = preview.questions;
    expect(question).toMatchObject({
      type: 'single_choice',
      prompt: 'Biggest port?',
      backgroundGradient: { angle: 90, colors: ['#112233', '#445566'] },
      options: [
        { text: 'Shanghai', isCorrect: true, orderIndex: 0 },
        { text: 'Rotterdam', isCorrect: false, orderIndex: 1 },
      ],
    });
    // The slide comes before the question, its media under stand-in ids the catalogue serves.
    const [slide] = preview.slides;
    expect(slide.beforeQuestionId).toBe(question.id);
    expect(slide.textTone).toBe('dark');
    expect(preview.media[slide.mediaId as string]).toBe(`${base}/bg.webp`);
    const image = slide.blocks[1] as { mediaId: string };
    expect(preview.media[image.mediaId]).toBe(`${base}/pic.jpg`);
  });

  it('an image choice previews with its pictures and their alt', async () => {
    const { service } = makeService(quiz, 1, {
      format: 'quizdock/quiz',
      quiz: { title: 'Pets' },
      items: [
        {
          kind: 'question',
          type: 'image_choice',
          prompt: 'Which one is a cat?',
          options: [
            {
              media: 'media/cat.webp',
              alt: 'A cat',
              color: 'red',
              shape: 'triangle',
              isCorrect: true,
            },
            { media: 'media/dog.webp', alt: 'A dog', color: 'blue', shape: 'diamond' },
          ],
        },
      ],
    });
    const entry = await service.share(alice, 'q1');
    const base = `/api/v1/store/${entry.id}/media`;
    const preview = await service.preview(entry.id);
    const options = preview.questions[0].options;
    expect(options.map((o) => [o.alt, preview.media[o.mediaId as string]])).toEqual([
      ['A cat', `${base}/cat.webp`],
      ['A dog', `${base}/dog.webp`],
    ]);
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
    // Their cards draw the intro slide itself: title, subtitle, its picture, outline.
    for (const entry of seeded) {
      expect(entry.first?.slide?.blocks).toHaveLength(2);
      expect(entry.first?.slide).toMatchObject({
        background: { url: expect.stringMatching(new RegExp(`^/api/v1/store/${entry.id}/media/`)) },
        textTone: 'light',
        textOutline: true,
      });
    }

    for (const entry of seeded) {
      const manifest = JSON.parse(
        readFileSync(join(dir, entry.id, 'quiz.json'), 'utf8'),
      ) as unknown;
      expect(quizBundleSchema.safeParse(manifest).success).toBe(true);
    }
  });

  describe('the samples a release ships', () => {
    const titles = async (service: StoreService) =>
      (await service.list()).map((e) => e.title).sort();

    it('a new catalogue gets every sample, its media with it', async () => {
      const { service } = makeService();
      await service.onModuleInit();
      const seeded = await service.list();
      expect(seeded.map((e) => e.language)).toEqual(['en', 'en', 'en']);
      for (const entry of seeded) {
        expect(existsSync(join(dir, entry.id, 'media'))).toBe(true);
        const istanbul = await service.readMedia(entry.id, 'istanbul.webp').catch(() => null);
        expect(istanbul !== null).toBe(entry.title === 'Discover Türkiye');
      }
    });

    it('a catalogue of an earlier release: the samples updated in place, the new one added, a withdrawn one left out', async () => {
      const old = {
        id: '01M37GF1YBSEJAYWM6YWN0EX1K',
        title: 'Discover France',
        description: null,
        language: 'en',
        tags: [],
        questionCount: 10,
        license: 'CC-BY-4.0',
        author: { name: 'fchaussin', subject: 'system:samples' },
        revision: 1,
        sharedAt: '2026-09-23T16:09:32.368Z',
        cover: null,
        first: null,
      };
      // Discover Taiwan is not there: the operator withdrew it.
      writeFileSync(join(dir, 'index.json'), JSON.stringify({ entries: [old] }));
      const { service } = makeService();
      await service.onModuleInit();
      const entries = await service.list();
      const france = entries.find((e) => e.title === 'Discover France');
      expect(france).toMatchObject({ id: old.id, revision: 2, sharedAt: old.sharedAt });
      expect(france?.questionCount).toBeGreaterThan(10);
      expect(existsSync(join(dir, old.id, 'media', 'mont-saint-michel.webp'))).toBe(true);
      expect(await titles(service)).toEqual(['Discover France', 'Discover Türkiye']);
    });

    it('a sample withdrawn by the operator does not come back at the next start', async () => {
      const { service } = makeService();
      await service.onModuleInit();
      const turkiye = (await service.list()).find((e) => e.title === 'Discover Türkiye');
      await service.withdraw({ ...alice, roles: [UserRole.admin] }, turkiye!.id);
      await makeService().service.onModuleInit();
      expect(await titles(makeService().service)).toEqual(['Discover France', 'Discover Taiwan']);
    });
  });

  it('a demo catalogue is read-only: seeded and listed, never shared to nor withdrawn from', async () => {
    process.env.DEMO_MODE = 'true';
    const { service } = makeService();
    await service.onModuleInit();
    const seeded = await service.list();
    expect(seeded.length).toBeGreaterThan(0);
    await expect(service.share(alice, 'q1')).rejects.toThrow(ForbiddenException);
    await expect(
      service.withdraw({ ...alice, roles: [UserRole.admin] }, seeded[0].id),
    ).rejects.toThrow(ForbiddenException);
  });

  describe('a catalogue that holds up (audit B6)', () => {
    it('starts with an unreadable index, and leaves it for the operator to repair', async () => {
      writeFileSync(join(dir, 'index.json'), '{"entries": [{"id": "trunc');
      const { service } = makeService();
      await expect(service.onModuleInit()).resolves.toBeUndefined();
      // Not overwritten by the samples: the entries it held are still in the file.
      expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe('{"entries": [{"id": "trunc');
    });

    it('keeps both of two templates shared at the same time', async () => {
      const { service, prisma } = makeService();
      (prisma.quiz.findFirst as jest.Mock).mockImplementation(
        async ({ where }: { where: { id: string } }) => ({ ...quiz, id: where.id }),
      );
      await Promise.all([service.share(alice, 'q1'), service.share(alice, 'q2')]);
      const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
        entries: unknown[];
      };
      expect(index.entries).toHaveLength(2);
    });

    it('previews a template whose manifest was broken by hand, with what it has', async () => {
      const { service } = makeService();
      const entry = await service.share(alice, 'q1');
      writeFileSync(join(dir, entry.id, 'quiz.json'), '{ not json');
      await expect(service.preview(entry.id)).resolves.toMatchObject({
        questions: [],
        slides: [],
        invalid: { item: null },
      });
    });
  });
});
