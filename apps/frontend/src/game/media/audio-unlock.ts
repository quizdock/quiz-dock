import { useSyncExternalStore } from 'react';

/**
 * Sound in the projection window. A browser plays sound only after the person
 * has interacted with *that* page; a click in the console is another window and
 * does not count. So the projection asks once, at the lobby, and this module
 * keeps the answer — plus the one AudioContext every sound's gain goes through.
 */
let context: AudioContext | null = null;
let unlocked = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/** Whether the page already had a user gesture (sticky activation), which lets media play. */
function hasBeenActive(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  return activation?.hasBeenActive ?? false;
}

/** The page's AudioContext, created on first need (it starts suspended without a gesture). */
export function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context = new Ctor();
  return context;
}

/** Whether sound may play here without being refused. */
export function isAudioUnlocked(): boolean {
  return unlocked || hasBeenActive();
}

/**
 * Unlocks sound from inside a click: resumes the context and plays a blip of
 * silence through it. Must run in the gesture's own call stack.
 */
export async function unlockAudio(): Promise<boolean> {
  const ctx = audioContext();
  try {
    if (ctx) {
      const silence = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = silence;
      source.connect(ctx.destination);
      source.start();
      await ctx.resume();
    }
    unlocked = true;
  } catch {
    unlocked = hasBeenActive();
  }
  notify();
  return unlocked;
}

/** React view of {@link isAudioUnlocked}. */
export function useAudioUnlocked(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isAudioUnlocked,
    () => false,
  );
}

/**
 * Routes a media element through a gain (the loudness correction) when the
 * context runs; otherwise leaves it alone — a suspended context would silence
 * it. An element can be routed once in its life, which is all it needs.
 */
const routed = new WeakMap<HTMLMediaElement, GainNode>();

export async function applyGain(el: HTMLMediaElement, gainDb: number): Promise<void> {
  const existing = routed.get(el);
  const linear = 10 ** (gainDb / 20);
  if (existing) {
    existing.gain.value = linear;
    return;
  }
  const ctx = gainDb === 0 ? null : audioContext();
  if (!ctx) return;
  // Another click in this window (the fullscreen button) unlocked sound too: wake the context.
  if (ctx.state === 'suspended' && isAudioUnlocked()) await ctx.resume().catch(() => undefined);
  if (ctx.state !== 'running') return;
  try {
    const gain = ctx.createGain();
    gain.gain.value = linear;
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    routed.set(el, gain);
  } catch {
    // Already routed elsewhere, or not allowed: it plays at its own level.
  }
}
