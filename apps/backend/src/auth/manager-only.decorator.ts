import { SetMetadata } from '@nestjs/common';

export const MANAGER_ONLY_KEY = 'managerOnly';

/**
 * Reserves a route to the `admin` role: administering the instance itself (its
 * media, its disk), which a host — even one who is also a manager elsewhere —
 * reaches only through the manager role.
 */
export const ManagerOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(MANAGER_ONLY_KEY, true);
