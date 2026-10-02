import { SETTINGS } from '@quiz-dock/contracts';
import { settings } from '../admin/settings/settings.service';

/**
 * Whether a new room's screens move between steps (UI system §1.8): `LIVE_MOTION`,
 * `on` unless set to `off` — an instance with old projectors may start its rooms
 * still. The host switches it for their room at any time.
 */
export function liveMotionDefault(): boolean {
  return settings.get(SETTINGS.LIVE_MOTION) === 'on';
}
