import { Prisma, type User } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { saveUser } from './save-user';

describe('saveUser', () => {
  const principal = { sub: 'oidc|1', displayName: 'Ana', email: 'ana@x.org', roles: [] };
  const row = {
    id: 'u1',
    oidcSubject: 'oidc|1',
    displayName: 'Ana',
    email: 'ana@x.org',
    roles: ['host', 'admin'],
  } as unknown as User;
  const prisma = () =>
    ({ user: { upsert: jest.fn(async () => row) } }) as unknown as PrismaService & {
      user: { upsert: jest.Mock };
    };

  it('writes nothing when the user is as the request says (audit B13)', async () => {
    const db = prisma();
    await expect(saveUser(db, principal, ['admin', 'host'], row)).resolves.toBe(row);
    expect(db.user.upsert).not.toHaveBeenCalled();
  });

  it('writes a new user, a new name, a new email or new roles', async () => {
    for (const [p, roles, existing] of [
      [principal, ['host'], null],
      [{ ...principal, displayName: 'Ana B.' }, ['host', 'admin'], row],
      [{ ...principal, email: null }, ['host', 'admin'], row],
      [principal, ['host'], row],
    ] as const) {
      const db = prisma();
      await saveUser(db, p, [...roles], existing);
      expect(db.user.upsert).toHaveBeenCalledTimes(1);
    }
  });

  it("an address that is another account's: saved without it, not refused", async () => {
    const db = prisma();
    db.user.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      }),
    );
    await expect(saveUser(db, principal, ['host'], null)).resolves.toBe(row);
    expect(db.user.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ email: null }) }),
    );
  });
});
