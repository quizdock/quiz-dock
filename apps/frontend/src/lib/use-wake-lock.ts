import { useEffect } from 'react';

/**
 * Keeps the screen on while `active`: a phone left on the table between two
 * questions, a laptop driving the projector, must not go to sleep mid-game.
 * Taken again when the page comes back to the front (the browser lets it go
 * whenever the page is hidden). Where the browser refuses — no support, or a
 * plain `http://` address other than localhost — nothing happens: the screen
 * simply follows its own settings.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const take = () => {
      if (stopped || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (stopped) void sentinel.release();
          else lock = sentinel;
        })
        .catch(() => {
          // refused (insecure address, battery saver): the screen keeps its own timeout
        });
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
