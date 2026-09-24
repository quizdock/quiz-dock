/**
 * `DEMO_MODE=true` — a public, unattended instance. Independent of `AUTH_MODE`:
 * local mode says who may host, demo mode says the instance is open to all and
 * adds guards on top — one shared host account, a read-only template catalogue,
 * no media uploads, a periodic reset to a blank state. Read lazily so tests can
 * flip the variable.
 */
export const isDemoMode = (): boolean => process.env.DEMO_MODE === 'true';

/**
 * The one host account every visitor shares. Whatever name a request carries, a
 * demo instance serves this one — visitors see and change the same bank, and
 * nobody ever waits for a seat.
 */
export const DEMO_USER = 'demo_user';

/** The reset runs this often… */
export const DEMO_RESET_INTERVAL_MS = 60 * 60_000;

/** …but waits for live sessions to end, at most this long past the last reset. */
export const DEMO_RESET_MAX_DEFER_MS = 3 * 60 * 60_000;
