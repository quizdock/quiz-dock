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
export function preloadMedia(media: LiveQuestionMedia, slideImages: string[] = []): Promise<void> {
  const { visual, audio } = media;
  slideImages.forEach(preloadImage);
  if (visual?.kind === 'image') preloadImage(visual.url);
  const loading: HTMLMediaElement[] = [];
  if (visual?.kind === 'video' && 'url' in visual) loading.push(fetchAhead('video', visual.url));
  if (audio) loading.push(fetchAhead('audio', audio.url));
  // Ready once each can play to its end without stalling; an image is not waited for.
  return Promise.all(loading.map(playable)).then(() => undefined);
}

/** Whether media hold a sound or a video — what the room waits for (an image is not). */
export function waitedFor(media: LiveQuestionMedia): boolean {
  return !!media.audio || media.visual?.kind === 'video';
}

/** The element fetching `url` ahead: the phone's own when free, else one of the pool. */
function fetchAhead(tag: 'video' | 'audio', url: string): HTMLMediaElement {
  if (loadInto(tag, url)) return dedicated[tag]!;
  let el = pool.get(url);
  if (!el) {
    el = create(tag, url);
    pool.set(url, el);
  }
  return el;
}

/** Resolves when the element has enough to play through (at once when it already has). */
function playable(el: HTMLMediaElement): Promise<void> {
  if (el.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) return Promise.resolve();
  return new Promise((resolve) =>
    el.addEventListener('canplaythrough', () => resolve(), { once: true }),
  );
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

/**
 * Whether the phone's elements were made inside a gesture. Not the page's sticky
 * activation: tapping an answer does not claim them, and without them a later
 * quiz's sound would not play on a phone (iOS).
 */
export function mediaElementsClaimed(): boolean {
  return !!dedicated.audio && !!dedicated.video;
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
