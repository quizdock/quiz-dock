import { updatePreferencesSchema } from '../me/preferences.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PreferencesService } from './preferences.service';

/** What an account remembers, on the test database: merge, reset, stale values. */
describe('PreferencesService (integration)', () => {
  let prisma: PrismaService;
  let preferences: PreferencesService;
  let userId: string;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('DATABASE_URL must point at a test database (see test/jest.global-setup.ts)');
    }
    prisma = new PrismaService();
    await prisma.$connect();
    preferences = new PreferencesService(prisma);
    const user = await prisma.user.upsert({
      where: { oidcSubject: 'local:preferences' },
      create: { oidcSubject: 'local:preferences', displayName: 'Preferences' },
      update: {},
    });
    userId = user.id;
  });

  beforeEach(async () => {
    await prisma.user.update({ where: { id: userId }, data: { preferences: {} } });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('starts empty: every choice is the default', async () => {
    await expect(preferences.get(userId)).resolves.toEqual({});
  });

  it('remembers a choice and returns what is stored', async () => {
    await expect(preferences.update(userId, { participantAccess: 'open' })).resolves.toEqual({
      participantAccess: 'open',
    });
    await expect(preferences.get(userId)).resolves.toEqual({ participantAccess: 'open' });
  });

  it('keeps the keys a change leaves out and drops the ones set to null', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences: { participantAccess: 'open', other: 'kept' } },
    });
    await preferences.update(userId, {});
    await expect(preferences.get(userId)).resolves.toEqual({ participantAccess: 'open' });

    await preferences.update(userId, { participantAccess: null });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    // Only the reset key goes: one this version does not know is left alone.
    expect(row.preferences).toEqual({ other: 'kept' });
  });

  it('reads a value that no longer validates as the default', async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { preferences: { participantAccess: 'optional' } },
    });
    await expect(preferences.get(userId)).resolves.toEqual({});
  });
});

describe('updatePreferencesSchema', () => {
  it('accepts a choice, or null to go back to the default', () => {
    expect(updatePreferencesSchema.parse({ participantAccess: 'account' })).toEqual({
      participantAccess: 'account',
    });
    expect(updatePreferencesSchema.parse({ participantAccess: null })).toEqual({
      participantAccess: null,
    });
  });

  it('refuses an unknown key or value rather than storing it unread', () => {
    expect(updatePreferencesSchema.safeParse({ sidebar: 'rail' }).success).toBe(false);
    expect(updatePreferencesSchema.safeParse({ participantAccess: 'optional' }).success).toBe(
      false,
    );
  });
});
