import { UserRole } from '@prisma/client';

/** Roles allowed to create, edit and present quizzes. */
export function isHostRole(role: UserRole): boolean {
  return role === UserRole.host || role === UserRole.admin;
}

/** Ordering of the three scopes: floor, host privileges, instance administration. */
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
