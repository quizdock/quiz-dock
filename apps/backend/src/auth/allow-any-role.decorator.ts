import { SetMetadata } from '@nestjs/common';

export const ALLOW_ANY_ROLE_KEY = 'allowAnyRole';

/**
 * Lets any authenticated user through, whatever their role. By default the global
 * guard requires the `host` role on every non-public route (an administrator without
 * it only where `@AllowManager()` says).
 */
export const AllowAnyRole = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_ANY_ROLE_KEY, true);
