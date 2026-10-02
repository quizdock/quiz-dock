import type { Prisma, UserRole } from '@prisma/client';

/**
 * An account that holds a role, as a query sees it: derived (`roles`, the
 * provider's claims or the seat) or granted from the administration
 * (`assignedRoles`), the one or the other.
 */
export const holdsRole = (role: UserRole): Prisma.UserWhereInput => ({
  OR: [{ roles: { has: role } }, { assignedRoles: { has: role } }],
});
