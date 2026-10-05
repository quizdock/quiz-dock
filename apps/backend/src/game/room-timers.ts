import type { Logger } from '@nestjs/common';

/**
 * What a room waits for, one timer of each kind at most per room:
 * - `reveal` — the end of the question (or everyone answered) → REVEAL;
 * - `hostGrace` — the grace before the host is declared gone (§7.1);
 * - `hostWindow` — the host's reconnection window before the game ends (§7.3);
 * - `autoNext` — the next step in auto mode (§8);
 * - `mediaWait` — the cap of a wait for media, after which the step starts anyway;
 * - `answerCount` — the end of a window in which answers came in, their count then sent;
 * - `lobbyStart` — the next quiz's lobby starting on its own (#198).
 */
export type RoomTimerKind =
  | 'reveal'
  | 'hostGrace'
  | 'hostWindow'
  | 'autoNext'
  | 'mediaWait'
  | 'answerCount'
  | 'lobbyStart';

const KINDS: RoomTimerKind[] = [
  'reveal',
  'hostGrace',
  'hostWindow',
  'autoNext',
  'mediaWait',
  'answerCount',
  'lobbyStart',
];

/**
 * The live engine's timers, in this process. A timer only **triggers** a
 * transition: the task re-checks the game's state (and takes its lock) before
 * doing anything, so a timer that fires late does nothing wrong. Timers never
 * keep the process alive, and a failed task is logged, never thrown.
 */
export class RoomTimers {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly log: Logger) {}

  /** Arms `task` in `delayMs` (now if negative), replacing the room's timer of that kind. */
  arm(kind: RoomTimerKind, pin: string, delayMs: number, task: () => Promise<void>): void {
    this.cancel(kind, pin);
    const key = `${kind}:${pin}`;
    const timer = setTimeout(
      () => {
        this.timers.delete(key);
        task().catch((err: Error) => this.log.error(`${kind} timer ${pin}: ${err.message}`));
      },
      Math.max(0, delayMs),
    );
    timer.unref?.();
    this.timers.set(key, timer);
  }

  cancel(kind: RoomTimerKind, pin: string): void {
    const key = `${kind}:${pin}`;
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /** Every timer of the room: its game is over or replaced. */
  cancelAll(pin: string): void {
    for (const kind of KINDS) this.cancel(kind, pin);
  }
}
