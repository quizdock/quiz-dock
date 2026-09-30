/**
 * How the live screens move (UI system §1.8), in seconds: the one place to tune
 * the pace. Short on purpose — nothing in the game waits for an animation.
 */
export const MOTION = {
  /** The previous step's background fading out over the new one. */
  fade: 0.5,
  /** Each top-level element of a step coming in… */
  enter: 0.35,
  /** …after the background has started to change… */
  enterDelay: 0.2,
  /** …one after the other. */
  stagger: 0.08,
  /** A row sliding to its new place, a bar filling. */
  move: 0.7,
  /** A score counting up to its new value. */
  count: 0.9,
  /** A count that changes, a mark that appears. */
  pop: 0.3,
} as const;

/** Fast out, soft landing: what comes in settles instead of stopping. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
