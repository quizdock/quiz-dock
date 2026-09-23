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

/** Starts fetching the media of an upcoming question. */
export function preloadMedia(media: LiveQuestionMedia): void {
  const { visual, audio } = media;
  if (visual?.kind === 'image' && !images.has(visual.url)) {
    const img = new Image();
    img.src = visual.url;
    images.set(visual.url, img);
  }
  if (visual?.kind === 'video' && 'url' in visual && !pool.has(visual.url)) {
    pool.set(visual.url, create('video', visual.url));
  }
  if (audio && !pool.has(audio.url)) pool.set(audio.url, create('audio', audio.url));
}

/** The element for `url`: the one fetched ahead when there is one, else a fresh one. */
export function takeMedia(tag: 'video' | 'audio', url: string): HTMLMediaElement {
  const ready = pool.get(url);
  pool.delete(url);
  images.delete(url);
  return ready && ready.tagName.toLowerCase() === tag ? ready : create(tag, url);
}

/** Stops an element for good: no sound can outlive the screen that played it. */
export function releaseMedia(el: HTMLMediaElement): void {
  el.pause();
  el.removeAttribute('src');
  el.load();
  el.remove();
}
