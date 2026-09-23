import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import type { UsersService } from '../users/users.service';
import type { AuthPrincipal, AuthProvider } from './auth-provider';
import { AuthGuard } from './auth.guard';

const fakeUser = { id: 'u1', displayName: 'Marc', roles: ['host'] } as unknown as User;
const playerUser = { id: 'u2', displayName: 'Léa', roles: [] } as unknown as User;
const adminUser = { id: 'u3', displayName: 'Ada', roles: ['admin'] } as unknown as User;
/** Gère ET anime : la vue d'ensemble, plus sa propre banque (RG-14). */
const adminHostUser = {
  id: 'u4',
  displayName: 'Iris',
  roles: ['admin', 'host'],
} as unknown as User;
const principal: AuthPrincipal = {
  sub: 'local:marc',
  displayName: 'Marc',
  email: null,
  roles: ['host'],
};

function makeContext(req: Partial<Request>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  isPublic?: boolean;
  allowAnyRole?: boolean;
  allowManager?: boolean;
  authResult?: AuthPrincipal | null;
  user?: User;
}) {
  const provider: AuthProvider = {
    authenticate: jest.fn().mockResolvedValue(opts.authResult ?? null),
  };
  const users = {
    upsertFromPrincipal: jest.fn().mockResolvedValue(opts.user ?? fakeUser),
  } as unknown as UsersService;
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'isPublic') return opts.isPublic ?? false;
      if (key === 'allowManager') return opts.allowManager ?? false;
      return opts.allowAnyRole ?? false;
    }),
  } as unknown as Reflector;
  return {
    guard: new AuthGuard(provider, users, reflector),
    provider,
    users,
  };
}

describe('AuthGuard', () => {
  it('laisse passer une route @Public sans authentifier', async () => {
    const { guard, provider } = makeGuard({ isPublic: true });
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true);
    expect(provider.authenticate).not.toHaveBeenCalled();
  });

  it('rejette (401) quand le principal est null', async () => {
    const { guard } = makeGuard({ authResult: null });
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('provisionne et attache req.user quand authentifié', async () => {
    const { guard, users } = makeGuard({ authResult: principal });
    const req: Partial<Request> & { user?: User } = { headers: {} };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(users.upsertFromPrincipal).toHaveBeenCalledWith(principal);
    expect(req.user).toBe(fakeUser);
  });

  it('refuse (403) un utilisateur sans rôle hôte sur une route standard', async () => {
    const { guard } = makeGuard({ authResult: principal, user: playerUser });
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('laisse passer un joueur sur une route @AllowAnyRole', async () => {
    const { guard } = makeGuard({ authResult: principal, user: playerUser, allowAnyRole: true });
    const req: Partial<Request> & { user?: User } = { headers: {} };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req.user).toBe(playerUser);
  });

  it('un gestionnaire ne passe pas une route d’hôte, et passe une route de gestion (RG-14)', async () => {
    // `admin` gère l'instance, il ne l'anime pas : créer, éditer, présenter
    // restent à l'hôte, et le refus le dit (`auth.host_only`).
    const hostOnly = makeGuard({ authResult: principal, user: adminUser });
    await expect(hostOnly.guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(
      ForbiddenException,
    );

    const managed = makeGuard({ authResult: principal, user: adminUser, allowManager: true });
    await expect(managed.guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(true);
  });

  it('une route de gestion reste fermée à un participant', async () => {
    const { guard } = makeGuard({ authResult: principal, user: playerUser, allowManager: true });
    await expect(guard.canActivate(makeContext({ headers: {} }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('un compte qui cumule gère ET anime : les deux portes s’ouvrent (RG-14)', async () => {
    const hostOnly = makeGuard({ authResult: principal, user: adminHostUser });
    await expect(hostOnly.guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(true);
    const managed = makeGuard({ authResult: principal, user: adminHostUser, allowManager: true });
    await expect(managed.guard.canActivate(makeContext({ headers: {} }))).resolves.toBe(true);
  });
});
