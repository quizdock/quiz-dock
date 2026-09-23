import { type User, UserRole } from '@prisma/client';
import { parseRoles } from '../../auth/roles';
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
      roles: u.roles.join('+') || 'player',
      granted: u.assignedRoles.join('+'),
      quizzes: u._count.quizzes,
      createdAt: u.createdAt,
    })),
  );
}

/**
 * `user:set-role <sub|email> host|admin|host,admin|player` (RG-14). Les rôles sont
 * un **ensemble** : `host,admin` gère l'instance *et* anime sa propre banque.
 * `player` révoque tout — les rôles sont alors de nouveau dérivés des claims
 * (OIDC) ou du siège d'hôte (mode local) à la prochaine requête.
 */
export async function userSetRole(
  out: Output,
  prisma: Db,
  who: string,
  roles: string,
): Promise<void> {
  const wanted = roles
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  const revoke = wanted.length === 1 && wanted[0] === UserRole.player;
  const granted = revoke ? [] : parseRoles(wanted);
  if (!revoke && granted.length !== wanted.length) {
    throw new CliError(
      `Roles must be "host", "admin", "host,admin" (grant) or "player" (revoke).`,
      2,
    );
  }
  const user = await findUser(prisma, who);
  await prisma.user.update({
    where: { id: user.id },
    // Les rôles effectifs suivent l'octroi tout de suite ; une révocation les
    // laisse vides jusqu'à ce que la prochaine requête les redérive.
    data: { assignedRoles: granted, roles: granted },
  });
  out.line(
    granted.length
      ? `${user.displayName} (${user.oidcSubject}) is now ${granted.join(' + ')}.`
      : `${user.displayName} (${user.oidcSubject}) grant revoked; roles are derived again on next request.`,
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
