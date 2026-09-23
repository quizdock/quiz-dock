import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { UsersService } from '../users/users.service';
import { ALLOW_ANY_ROLE_KEY } from './allow-any-role.decorator';
import { ALLOW_MANAGER_KEY } from './allow-manager.decorator';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { IS_PUBLIC_KEY } from './public.decorator';
import { isHost, isManager } from './roles';

/**
 * Garde global : authentifie via l'`AuthProvider` actif, provisionne
 * l'utilisateur et l'attache à `req.user`. Les routes `@Public()` passent.
 * Toute autre route exige le rôle `host` (ou `admin`), sauf `@AllowAnyRole()`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(AUTH_PROVIDER) private readonly provider: AuthProvider,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    const principal = await this.provider.authenticate(req);
    if (!principal) {
      throw new UnauthorizedException('auth.required');
    }
    const user = await this.users.upsertFromPrincipal(principal);
    const anyRole = this.reflector.getAllAndOverride<boolean>(ALLOW_ANY_ROLE_KEY, targets);
    // Une route ouverte au gestionnaire (`@AllowManager`) accepte l'`admin` en plus
    // de l'hôte : il voit l'instance, il ne l'anime pas (RG-14).
    const manager = this.reflector.getAllAndOverride<boolean>(ALLOW_MANAGER_KEY, targets);
    const allowed = anyRole || isHost(user.roles) || (manager && isManager(user.roles));
    if (!allowed) {
      // Un gestionnaire qui n'anime pas mérite une explication différente d'un
      // participant : ce n'est pas un rôle manquant, c'est un autre métier.
      throw new ForbiddenException(isManager(user.roles) ? 'auth.host_only' : 'auth.host_required');
    }
    req.user = user;
    return true;
  }
}
