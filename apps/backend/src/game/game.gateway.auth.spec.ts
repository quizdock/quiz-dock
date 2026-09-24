import { HttpException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthProvider } from '../auth/auth-provider';
import type { UsersService } from '../users/users.service';
import type { GameEngine } from './game.engine';
import { GameGateway, type GameSocketData } from './game.gateway';
import type { GameService } from './game.service';
import type { PinAttempts } from './pin-attempts';

/**
 * `player:join` at the gateway: the socket's account goes to the service, which
 * decides from the game whether one is needed (RG-15, #57), and the attempt goes
 * through the wrong-PIN limiter. The full socket integration lives in
 * `game.gateway.spec.ts`.
 */
describe('GameGateway.playerJoin', () => {
  const joinResult = {
    pin: '123456',
    playerId: 'p1',
    sessionToken: 'tok',
    nickname: 'Alice',
    avatar: 'Alice',
    playerCount: 1,
  };

  function makeGateway(pins: Partial<PinAttempts> = {}) {
    const game = { joinSession: jest.fn().mockResolvedValue(joinResult) };
    const engine = {
      sendStateTo: jest.fn().mockResolvedValue(undefined),
      broadcastReadiness: jest.fn().mockResolvedValue(undefined),
      bindServer: jest.fn(),
    };
    const limiter = {
      guard: jest.fn((_ip: string, attempt: () => Promise<unknown>) => attempt()),
      ...pins,
    };
    const gateway = new GameGateway(
      {} as AuthProvider,
      {} as UsersService,
      game as unknown as GameService,
      engine as unknown as GameEngine,
      limiter as unknown as PinAttempts,
    );
    gateway.server = { to: () => ({ emit: jest.fn() }) } as never;
    const socket = {
      data: {} as GameSocketData,
      join: jest.fn().mockResolvedValue(undefined),
      handshake: { address: '203.0.113.7', headers: {} },
    };
    return { gateway, game, limiter, socket };
  }

  const payload = { pin: '123456', nickname: 'Alice' };

  it('hands the account to the service, and the ack carries the name kept', async () => {
    const { gateway, game, socket } = makeGateway();
    const user = { id: 'u1', displayName: 'Alice Account' } as User;
    socket.data.user = user;
    const ack = await gateway.playerJoin(socket as never, payload);
    expect(game.joinSession).toHaveBeenCalledWith('123456', 'Alice', user, undefined, undefined);
    // L'accusé porte le pseudo **retenu** : l'écran du participant doit montrer
    // le même nom que la salle (nom du compte, ou homonyme suffixé).
    expect(ack.nickname).toBe('Alice');
  });

  it('hands no account for a guest socket', async () => {
    const { gateway, game, socket } = makeGateway();
    await gateway.playerJoin(socket as never, payload);
    expect(game.joinSession).toHaveBeenCalledWith('123456', 'Alice', null, undefined, undefined);
  });

  it('goes through the limiter, keyed by the address', async () => {
    const { gateway, limiter, socket } = makeGateway();
    await gateway.playerJoin(socket as never, payload);
    expect(limiter.guard).toHaveBeenCalledWith('203.0.113.7', expect.any(Function));
  });

  it('does not reach the game once the address tried too many PINs', async () => {
    const { gateway, game, socket } = makeGateway({
      guard: jest.fn().mockRejectedValue(new HttpException('pin.too_many_attempts', 429)),
    });
    await expect(gateway.playerJoin(socket as never, payload)).rejects.toThrow(
      'pin.too_many_attempts',
    );
    expect(game.joinSession).not.toHaveBeenCalled();
  });
});
