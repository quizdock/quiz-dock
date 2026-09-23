import { SetMetadata } from '@nestjs/common';

export const ALLOW_MANAGER_KEY = 'allowManager';

/**
 * Lets an `admin` through as well as a host. Marks what a **manager** may reach:
 * reading, moderating and administering — never creating, editing or presenting,
 * which stay the host's (RG-14). Read routes carry it; write routes do not.
 */
export const AllowManager = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MANAGER_KEY, true);
