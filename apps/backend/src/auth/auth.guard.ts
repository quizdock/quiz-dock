import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Garde global : authentifie via l'`AuthProvider` actif, provisionne
 * l'utilisateur et l'attache à `req.user`. Les routes `@Public()` passent.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    const principal = await this.provider.authenticate(req);
    if (!principal) {
      throw new UnauthorizedException('Authentification requise.');
    }
    req.user = await this.users.upsertFromPrincipal(principal);
    return true;
  }
}
