import { useReducedMotion } from 'motion/react';
import { createContext, type ReactNode, useContext } from 'react';
import { appConfig } from '../../config';

/**
 * How much the live screens move (UI system §1.8): `full`, `fade` (the system asks
 * to reduce motion: fades, no movement) or `none` (the room's host, or the
 * instance, turned transitions off).
 */
export type MotionLevel = 'full' | 'fade' | 'none';

/** Whether the room's screens move; outside a room, the instance's default. */
const RoomMotion = createContext<boolean>(appConfig.liveMotion !== false);

/** Around a live screen: the room's setting, once the room has told it. */
export function LiveMotion({ on, children }: { on: boolean | null; children: ReactNode }) {
  const fallback = useContext(RoomMotion);
  return <RoomMotion.Provider value={on ?? fallback}>{children}</RoomMotion.Provider>;
}

export function useMotionLevel(): MotionLevel {
  const room = useContext(RoomMotion);
  const reduced = useReducedMotion();
  if (!room) return 'none';
  return reduced ? 'fade' : 'full';
}
