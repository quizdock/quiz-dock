import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import type { UsersService } from '../users/users.service';
import type { AuthPrincipal, AuthProvider } from './auth-provider';
import { AuthGuard } from './auth.guard';

const fakeUser = { id: 'u1', displayName: 'Marc' } as User;
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

function makeGuard(opts: { isPublic?: boolean; authResult?: AuthPrincipal | null }) {
  const provider: AuthProvider = {
    authenticate: jest.fn().mockResolvedValue(opts.authResult ?? null),
  };
  const users = {
    upsertFromPrincipal: jest.fn().mockResolvedValue(fakeUser),
  } as unknown as UsersService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.isPublic ?? false),
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
});
