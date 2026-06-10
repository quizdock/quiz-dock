import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';

/** Injecte l'utilisateur provisionné par AuthGuard (`req.user`). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
  const req = ctx.switchToHttp().getRequest<Request & { user: User }>();
  return req.user;
});
