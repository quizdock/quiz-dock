import { PrismaService } from '../prisma/prisma.service';
import { saveUser } from './save-user';

/** Against the test database: the e-mail's unique constraint as the driver reports it. */
describe('saveUser (integration)', () => {
  let prisma: PrismaService;
  const stamp = Date.now();
  const email = `taken-${stamp}@x.org`;

  beforeAll(() => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { oidcSubject: { startsWith: `save-user-${stamp}` } } });
    await prisma.$disconnect();
  });

  it("an account made again at the provider, its address still the old one's, is let in", async () => {
    await saveUser(
      prisma,
      { sub: `save-user-${stamp}-a`, displayName: 'A', email, roles: [] },
      [],
      null,
    );
    const again = await saveUser(
      prisma,
      { sub: `save-user-${stamp}-b`, displayName: 'A', email, roles: [] },
      [],
      null,
    );
    expect(again).toMatchObject({ oidcSubject: `save-user-${stamp}-b`, email: null });
  });
});
