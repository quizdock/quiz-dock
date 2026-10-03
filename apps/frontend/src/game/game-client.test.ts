import { afterEach, describe, expect, it, vi } from 'vitest';

/** Sockets as socket.io-client would make them: an emitter that knows if it is connected. */
const { made } = vi.hoisted(() => ({ made: [] as FakeSocket[] }));
type Handler = (...args: unknown[]) => void;
class FakeSocket {
  connected = true;
  handlers = new Map<string, Handler[]>();
  emit = vi.fn();
  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
    return this;
  }
  disconnect() {
    this.connected = false;
    for (const h of this.handlers.get('disconnect') ?? []) h('io client disconnect');
    return this;
  }
}
vi.mock('socket.io-client', () => ({
  io: () => {
    const s = new FakeSocket();
    made.push(s);
    return s;
  },
}));

import { connectHost, connectPlayer, disconnectGame, ensureGameSocket } from './game-client';

describe('game client connections (audit F2)', () => {
  afterEach(() => {
    disconnectGame();
    made.length = 0;
    vi.useRealTimers();
  });

  it('closes the previous connection when a new one opens', async () => {
    await connectHost();
    await connectHost(); // the host opens another game from the dashboard
    connectPlayer();
    expect(made.map((s) => s.connected)).toEqual([false, false, true]);
  });

  it('stops pinging the server once a connection is closed on purpose', () => {
    vi.useFakeTimers();
    connectPlayer();
    const [socket] = made;
    disconnectGame();
    socket.emit.mockClear();
    socket.connected = true; // were it still pinging, the ping would go out
    vi.advanceTimersByTime(120_000);
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe('one socket, one room', () => {
  afterEach(() => {
    disconnectGame();
    made.length = 0;
  });

  it("another room's page gets a socket of its own; the same room keeps it", async () => {
    const a = await ensureGameSocket('guest', '111111');
    expect(await ensureGameSocket('guest', '111111')).toBe(a);
    expect(await ensureGameSocket('guest')).toBe(a); // a peek binds nothing
    const b = await ensureGameSocket('guest', '222222');
    expect(b).not.toBe(a);
    expect(made.map((s) => s.connected)).toEqual([false, true]);
  });

  it('a socket opened before its PIN is known takes the first room that asks', async () => {
    const created = await connectHost(); // host:create answers the PIN afterwards
    expect(await ensureGameSocket('host', '333333')).toBe(created);
    expect(await ensureGameSocket('host', '444444')).not.toBe(created);
  });
});
