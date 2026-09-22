import { WsException } from '@nestjs/websockets';
import type { User } from '@prisma/client';
import type { AuthProvider } from '../auth/auth-provider';
import type { UsersService } from '../users/users.service';
import type { GameEngine } from './game.engine';
import { GameGateway, type GameSocketData } from './game.gateway';
import type { GameService } from './game.service';

/**
 * RG-15 — `player:join` under `AUTH_MODE=oidc`: the token opens the application,
 * the PIN opens one session. The full socket integration lives in
 * `game.gateway.spec.ts`; here only the barrier is exercised.
 */
describe('GameGateway.playerJoin (AUTH_MODE)', () => {
  const joinResult = {
    pin: '123456',
    playerId: 'p1',
    sessionToken: 'tok',
    nickname: 'Alice',
    avatar: 'Alice',
    playerCount: 1,
  };

  function makeGateway() {
    const game = { joinSession: jest.fn().mockResolvedValue(joinResult) };
    const engine = { sendStateTo: jest.fn().mockResolvedValue(undefined), bindServer: jest.fn() };
    const gateway = new GameGateway(
      {} as AuthProvider,
      {} as UsersService,
      game as unknown as GameService,
      engine as unknown as GameEngine,
    );
    gateway.server = { to: () => ({ emit: jest.fn() }) } as never;
    const socket = { data: {} as GameSocketData, join: jest.fn().mockResolvedValue(undefined) };
    return { gateway, game, socket };
  }

  const payload = { pin: '123456', nickname: 'Alice' };
  const authMode = process.env.AUTH_MODE;
  afterEach(() => {
    if (authMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = authMode;
  });

  it('refuses a socket with no account under oidc', async () => {
    process.env.AUTH_MODE = 'oidc';
    const { gateway, game, socket } = makeGateway();
    await expect(gateway.playerJoin(socket as never, payload)).rejects.toThrow(WsException);
    expect(game.joinSession).not.toHaveBeenCalled();
  });

  it('attaches the account to the player under oidc', async () => {
    process.env.AUTH_MODE = 'oidc';
    const { gateway, game, socket } = makeGateway();
    const user = { id: 'u1', displayName: 'Alice Account' } as User;
    socket.data.user = user;
    await gateway.playerJoin(socket as never, payload);
    expect(game.joinSession).toHaveBeenCalledWith('123456', 'Alice', user, undefined);
  });

  it('keeps the PIN as the only barrier in local mode', async () => {
    process.env.AUTH_MODE = 'none';
    const { gateway, game, socket } = makeGateway();
    await gateway.playerJoin(socket as never, payload);
    expect(game.joinSession).toHaveBeenCalledWith('123456', 'Alice', null, undefined);
  });
});
