import { Client } from 'pg';
import type { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import type { QuestionContent } from './dto/question-content.schema';
import { QuestionsService } from './questions.service';

/**
 * Against the test database: adding a question must not run several queries at
 * once on the one connection a transaction holds. pg deprecates it (a warning
 * today, an error in pg@9), and it showed under load (docs/dev/audit-2026-09.md, G1).
 */
describe('QuestionsService (integration)', () => {
  let prisma: PrismaService;
  let service: QuestionsService;
  let ownerId: string;
  let quizId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
    service = new QuestionsService(prisma, { releaseUnused: jest.fn() } as unknown as MediaService);
    const owner = await prisma.user.create({
      data: { oidcSubject: `local:questions-db-${Date.now()}`, displayName: 'Q', roles: ['host'] },
    });
    ownerId = owner.id;
    quizId = (await prisma.quiz.create({ data: { ownerId, title: 'Q' } })).id;
  });

  afterAll(async () => {
    await prisma.quiz.deleteMany({ where: { ownerId } });
    await prisma.user.delete({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it('adds a question with its answers without overlapping queries in its transaction', async () => {
    // What pg warns about: a query sent while the same client still has one queued.
    let overlapping = 0;
    const query = Client.prototype.query;
    const spy = jest.spyOn(Client.prototype, 'query').mockImplementation(function (
      this: Client & { _queryQueue?: unknown[] },
      ...args: unknown[]
    ) {
      if ((this._queryQueue?.length ?? 0) > 0) overlapping++;
      return (query as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    const question = await service.add(ownerId, quizId, {
      type: 'single_choice',
      prompt: 'Q ?',
      timeLimitS: 20,
      pointsMode: 'standard',
      options: [
        { color: 'red', shape: 'triangle', isCorrect: true },
        { color: 'blue', shape: 'circle', isCorrect: false },
      ],
      acceptedAnswers: [],
    } as unknown as QuestionContent);

    spy.mockRestore();
    expect(question.options).toHaveLength(2);
    expect(overlapping).toBe(0);
    expect((await prisma.quiz.findUniqueOrThrow({ where: { id: quizId } })).questionCount).toBe(1);
  });

  it('deletes a played question, and then its quiz, the archive following', async () => {
    const question = await prisma.question.findFirstOrThrow({ where: { quizId } });
    const now = new Date();
    const session = await prisma.gameSessionLog.create({
      data: {
        quizId,
        hostId: ownerId,
        pin: '123456',
        language: 'en',
        startedAt: now,
        endedAt: now,
        retainUntil: now,
        questionStats: { create: { questionId: question.id, orderIndex: 0 } },
        playerResults: { create: { nickname: 'Ada', finalRank: 1 } },
      },
      include: { playerResults: true },
    });
    await prisma.answerLog.create({
      data: {
        sessionLogId: session.id,
        playerResultLogId: session.playerResults[0].id,
        questionId: question.id,
        orderIndex: 0,
        answerValue: 'x',
        isCorrect: false,
        responseMs: 1000,
        receivedAt: now,
      },
    });

    // The question goes; its results stay, read by their position in the snapshot.
    await service.remove(ownerId, question.id);
    const stat = await prisma.questionResultStat.findFirstOrThrow({
      where: { sessionLogId: session.id },
    });
    expect(stat.questionId).toBeNull();
    const answer = await prisma.answerLog.findFirstOrThrow({ where: { sessionLogId: session.id } });
    expect(answer.questionId).toBeNull();

    // The quiz goes with its archived sessions.
    await prisma.quiz.delete({ where: { id: quizId } });
    expect(await prisma.gameSessionLog.findUnique({ where: { id: session.id } })).toBeNull();
  });
});
