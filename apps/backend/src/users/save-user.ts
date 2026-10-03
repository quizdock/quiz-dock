import { Prisma, type User, type UserRole } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth-provider';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * The user row of `principal` with `roles`, written only when something changed:
 * the auth guard reads the user on every request, and would otherwise write it
 * back each time (every media fetched, every editor save).
 */
export async function saveUser(
  prisma: PrismaService,
  principal: AuthPrincipal,
  roles: UserRole[],
  existing: User | null,
): Promise<User> {
  if (
    existing &&
    existing.displayName === principal.displayName &&
    existing.email === principal.email &&
    sameRoles(existing.roles, roles)
  ) {
    return existing;
  }
  const upsert = (email: string | null) =>
    prisma.user.upsert({
      where: { oidcSubject: principal.sub },
      create: { oidcSubject: principal.sub, displayName: principal.displayName, email, roles },
      update: { displayName: principal.displayName, email, roles },
    });
  try {
    return await upsert(principal.email);
  } catch (err) {
    // The address is another account's (an account deleted and made again at the
    // provider, an address handed on): this one goes without it, rather than be
    // refused on every request.
    if (principal.email && isEmailTaken(err)) return upsert(null);
    throw err;
  }
}

function isEmailTaken(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  // Where the field is named depends on the driver (`target`, or the adapter's cause).
  return JSON.stringify(err.meta ?? {}).includes('email');
}

function sameRoles(a: UserRole[], b: UserRole[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}
