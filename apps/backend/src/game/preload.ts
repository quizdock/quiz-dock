import {
  type AudioTarget,
  type LiveQuestionMedia,
  type MediaPreloadPayload,
  type PlayerPresence,
  type SlideBlock,
  liveMediaUrls,
  playsSound,
} from '@quiz-dock/contracts';
import type { QuizSnapshot, SnapshotSlide } from './game.types';
import { questionAudioTarget, questionHasSound } from './snapshot';

/** Who fetches: a screen (projection, console) or a participant, by presence. */
export type PreloadDevice = 'screen' | PlayerPresence;

/**
 * The part of a question's media a device will show or play — all it should
 * fetch ahead. A screen shows everything. A remote participant sees the visual
 * (a video, muted when the sound is not theirs) and gets the sound when meant
 * for them. A phone in the room shows the image, and plays only when the
 * sound is meant for every device. Mobile data goes to nothing else.
 */
export function mediaForDevice(
  media: LiveQuestionMedia,
  target: AudioTarget | undefined,
  device: PreloadDevice,
): LiveQuestionMedia {
  if (device === 'screen') return media;
  const hears = !!target && playsSound(target, device);
  const visual = media.visual;
  const keepVisual =
    visual?.kind === 'image' || (visual?.kind === 'video' && (device === 'remote' || hears));
  return { visual: keepVisual ? visual : null, audio: hears ? media.audio : null };
}

function blockImages(block: SlideBlock): string[] {
  if (block.type === 'columns') return block.columns.flat().flatMap(blockImages);
  return block.type === 'image' && block.url ? [block.url] : [];
}

/** The images a slide shows: its background and its image blocks. */
function slideImages(slide: SnapshotSlide): string[] {
  const background = slide.background && 'url' in slide.background ? [slide.background.url] : [];
  return [...background, ...slide.blocks.flatMap(blockImages)];
}

/**
 * What a device fetches ahead of question `index` (`questions.length` for the
 * closing slides): the slides shown before it and its media, one step ahead
 * and no more. Null when there is nothing to fetch.
 */
export function preloadFor(
  snapshot: QuizSnapshot,
  index: number,
  gameTarget: AudioTarget,
  device: PreloadDevice,
): MediaPreloadPayload | null {
  const question = snapshot.questions[index];
  const images = [
    ...new Set(snapshot.slides.filter((s) => s.beforeQuestionIndex === index).flatMap(slideImages)),
  ];
  const target =
    question && questionHasSound(question) ? questionAudioTarget(question, gameTarget) : undefined;
  const media = question
    ? mediaForDevice(question.media, target, device)
    : { visual: null, audio: null };
  if (liveMediaUrls(media).length === 0 && images.length === 0) return null;
  return {
    questionIndex: index,
    media,
    ...(target ? { audioTarget: target } : {}),
    ...(images.length ? { images } : {}),
  };
}

/** Whether media hold a sound or a video — what a device is waited for (an image is not). */
export function hasSoundOrVideo(media: LiveQuestionMedia): boolean {
  return !!media.audio || media.visual?.kind === 'video';
}

/** Whether anything in the quiz is fetched ahead: a question's media or a slide's image. */
export function snapshotHasMedia(snapshot: QuizSnapshot): boolean {
  return (
    snapshot.questions.some((q) => liveMediaUrls(q.media).length > 0) ||
    snapshot.slides.some((s) => slideImages(s).length > 0)
  );
}
