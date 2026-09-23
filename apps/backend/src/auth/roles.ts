import { UserRole } from '@prisma/client';

/**
 * Who may create, edit and present quizzes: the **host**, and only them.
 *
 * `admin` is deliberately **not** a host (RG-14): it is a manager role — it sees
 * the instance, it does not animate it. An account that needs to present is
 * granted `host`; the two never cumulate, so "who can do what" stays readable.
 */
export function isHostRole(role: UserRole): boolean {
  return role === UserRole.host;
}

/** Who has the instance-wide view: the manager, and nobody else (RG-14). */
export function isManagerRole(role: UserRole): boolean {
  return role === UserRole.admin;
}

/** Ordering of the three scopes: the floor, hosting, managing the instance. */
const RANK: Record<UserRole, number> = {
  [UserRole.player]: 0,
  [UserRole.host]: 1,
  [UserRole.admin]: 2,
};

/**
 * Effective role (RG-14): the highest of what an operator (or the IdP) **assigned**
 * and what the context **derives** — the token claims under OIDC, the host seat in
 * local mode. An assignment therefore survives an expired seat or claims that no
 * longer carry the role, and never blocks a promotion coming from the context.
 */
export function effectiveRole(assigned: UserRole | null, derived: UserRole): UserRole {
  return assigned && RANK[assigned] > RANK[derived] ? assigned : derived;
}
