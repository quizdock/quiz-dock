import { type User, UserRole } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SampleQuizzesService } from '../../quizzes/samples/sample-quizzes.service';
import { CliError, type Output } from '../output';

type Db = Pick<PrismaService, 'user' | 'quiz'>;

/** Finds a user by OIDC subject (`local:<slug>` in local mode) or e-mail. */
export async function findUser(prisma: Db, who: string): Promise<User> {
  const user = await prisma.user.findFirst({
    where: { OR: [{ oidcSubject: who }, { email: who }] },
  });
  if (!user) throw new CliError(`No user with subject or e-mail "${who}".`);
  return user;
}

/** `user:list`: every account, newest first. */
export async function userList(out: Output, prisma: Db): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { quizzes: true } } },
  });
  out.table(
    users.map((u) => ({
      name: u.displayName,
      subject: u.oidcSubject,
      email: u.email,
      role: u.role,
      granted: u.assignedRole ?? '',
      quizzes: u._count.quizzes,
      createdAt: u.createdAt,
    })),
  );
}

/**
 * `user:set-role <sub|email> host|admin|player` (RG-14). `host` and `admin` are
 * operator grants that provisioning never lowers (sticky, and they outrank the
 * host seat); `player` revokes the grant — the role is then derived again from
 * the IdP claims (OIDC) or the host seat (local mode) on the user's next request.
 */
export async function userSetRole(
  out: Output,
  prisma: Db,
  who: string,
  role: string,
): Promise<void> {
  if (role !== UserRole.admin && role !== UserRole.host && role !== UserRole.player) {
    throw new CliError(`Role must be "host" or "admin" (grant), or "player" (revoke).`, 2);
  }
  const user = await findUser(prisma, who);
  const granted = role === UserRole.player ? null : role;
  await prisma.user.update({
    where: { id: user.id },
    // The effective role follows the grant right away; a revoke drops to `player`
    // until the next request derives it again from the claims or the seat.
    data: { assignedRole: granted, role: granted ?? UserRole.player },
  });
  out.line(
    granted
      ? `${user.displayName} (${user.oidcSubject}) is now ${granted}.`
      : `${user.displayName} (${user.oidcSubject}) grant revoked; role is derived again on next request.`,
  );
}

/** `samples:load <sub|email>`: adds the built-in sample quizzes to that user's bank. */
export async function samplesLoad(
  out: Output,
  prisma: Db,
  samples: Pick<SampleQuizzesService, 'createFor'>,
  who: string,
): Promise<void> {
  const user = await findUser(prisma, who);
  const created = await samples.createFor(user.id);
  out.line(`Loaded ${created.length} sample quiz(zes) for ${user.displayName}:`);
  for (const q of created) out.ok(`${q.title} (${q.id})`);
}
