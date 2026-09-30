import { deserializeRoom, roomHash } from './game-hash';

describe('a room as Redis keeps it', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });
  const raw = { roomId: 'r', hostUserId: 'h', gameId: 'g', openedAt: '1' };

  it('keeps whether its screens move between steps', () => {
    expect(deserializeRoom({ ...raw, ...roomHash({ motion: false }) }).motion).toBe(false);
    expect(deserializeRoom({ ...raw, ...roomHash({ motion: true }) }).motion).toBe(true);
  });

  it('a room opened before the setting existed follows the instance (LIVE_MOTION)', () => {
    process.env = { ...env, LIVE_MOTION: 'off' };
    expect(deserializeRoom(raw).motion).toBe(false);
    process.env = { ...env };
    delete process.env.LIVE_MOTION;
    expect(deserializeRoom(raw).motion).toBe(true);
  });
});
