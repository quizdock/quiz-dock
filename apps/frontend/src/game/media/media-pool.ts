import type { LiveQuestionMedia } from '@quiz-dock/contracts';

/**
 * Media elements fetched ahead. While the leaderboard of question N is up, the
 * projection creates the elements of question N+1 and lets them buffer; when
 * N+1 starts, the player adopts them instead of starting from nothing. One
 * element per URL, handed over once.
 */
const pool = new Map<string, HTMLMediaElement>();
const images = new Map<string, HTMLImageElement>();

function create(tag: 'video' | 'audio', url: string): HTMLMediaElement {
  const el = document.createElement(tag);
  el.preload = 'auto';
  if (el instanceof HTMLVideoElement) el.playsInline = true;
  el.src = url;
  el.load();
  return el;
}

/** Starts fetching an image (a question's, a slide's). */
function preloadImage(url: string): void {
  if (images.has(url)) return;
  const img = new Image();
  img.src = url;
  images.set(url, img);
}

/**
 * Starts fetching the media of an upcoming question, and the images of the
 * slides before it. On a phone the sound and the video load into its own
 * elements (free between questions): an element made now could not play
 * sound later on iOS.
 */
export function preloadMedia(media: LiveQuestionMedia, slideImages: string[] = []): void {
  const { visual, audio } = media;
  slideImages.forEach(preloadImage);
  if (visual?.kind === 'image') preloadImage(visual.url);
  if (visual?.kind === 'video' && 'url' in visual && !pool.has(visual.url)) {
    if (!loadInto('video', visual.url)) pool.set(visual.url, create('video', visual.url));
  }
  if (audio && !pool.has(audio.url) && !loadInto('audio', audio.url)) {
    pool.set(audio.url, create('audio', audio.url));
  }
}

/**
 * A participant's phone: one audio and one video element, made inside the Join
 * click and reused for the whole session. iOS lets an element play sound only
 * once a gesture has started it, and there is no gesture when a question
 * arrives — so the elements the gesture blessed are the ones that play.
 */
const dedicated: Partial<Record<'video' | 'audio', HTMLMediaElement>> = {};
const inUse = new WeakSet<HTMLMediaElement>();

/** A tenth of a second of silence (8 kHz, 8-bit mono WAV): something real to start in the gesture. */
function silence(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence sits in the middle
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** Makes the phone's two elements and starts them on silence. Call it inside the click. */
export function claimMediaElements(): void {
  const src = silence();
  for (const tag of ['audio', 'video'] as const) {
    if (dedicated[tag]) continue;
    const el = document.createElement(tag);
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.src = src;
    void el
      .play()
      .then(() => el.pause())
      .catch(() => undefined);
    dedicated[tag] = el;
  }
}

const absolute = (url: string) => new URL(url, window.location.href).href;

/** Points the phone's free element at `url` (a no-op when it already is); false without one. */
function loadInto(tag: 'video' | 'audio', url: string): boolean {
  const own = dedicated[tag];
  if (!own || inUse.has(own)) return false;
  if (own.src !== absolute(url)) {
    own.preload = 'auto';
    own.src = url;
    own.load();
  }
  return true;
}

/** The element for `url`: the one fetched ahead, else the phone's own, else a fresh one. */
export function takeMedia(tag: 'video' | 'audio', url: string): HTMLMediaElement {
  const ready = pool.get(url);
  pool.delete(url);
  images.delete(url);
  if (ready && ready.tagName.toLowerCase() === tag) return ready;
  const own = dedicated[tag];
  if (own && loadInto(tag, url)) {
    // Loaded ahead already when the preload named it: it starts from its buffer.
    inUse.add(own);
    own.muted = false;
    return own;
  }
  return create(tag, url);
}

/** Stops an element for good: no sound can outlive the screen that played it. */
export function releaseMedia(el: HTMLMediaElement): void {
  el.pause();
  el.remove();
  if (inUse.has(el)) {
    // The phone's own element waits for the next question, its buffer kept: taken
    // back for the same media (a remount), it starts over without fetching again.
    inUse.delete(el);
    el.currentTime = 0;
    return;
  }
  el.removeAttribute('src');
  el.load();
}
