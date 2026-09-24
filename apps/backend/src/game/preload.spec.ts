import type { LiveQuestionMedia } from '@quiz-dock/contracts';
import type { QuizSnapshot, SnapshotQuestion } from './game.types';
import { mediaForDevice, preloadFor, snapshotHasMedia } from './preload';

const image = { kind: 'image', url: '/img', alt: null } as const;
const video = { kind: 'video', source: 'upload', url: '/vid', gainDb: 0 } as const;
const audio = { url: '/snd', durationMs: 1000, peaks: [], gainDb: 0 };
const withSound: LiveQuestionMedia = { visual: image, audio };
const withVideo: LiveQuestionMedia = { visual: video, audio: null };

describe('mediaForDevice', () => {
  it('gives a screen everything', () => {
    expect(mediaForDevice(withSound, 'projection', 'screen')).toEqual(withSound);
  });

  it('gives a remote participant the visual, and the sound when it is theirs', () => {
    expect(mediaForDevice(withSound, 'projection_remote', 'remote')).toEqual(withSound);
    expect(mediaForDevice(withSound, 'projection', 'remote')).toEqual({
      visual: image,
      audio: null,
    });
    // A remote phone shows the video, muted when its sound is not for them.
    expect(mediaForDevice(withVideo, 'projection', 'remote')).toEqual(withVideo);
  });

  it('gives a phone in the room the image only, unless the sound is for every device', () => {
    expect(mediaForDevice(withSound, 'projection_remote', 'room')).toEqual({
      visual: image,
      audio: null,
    });
    expect(mediaForDevice(withVideo, 'projection_remote', 'room')).toEqual({
      visual: null,
      audio: null,
    });
    expect(mediaForDevice(withVideo, 'everyone', 'room')).toEqual(withVideo);
  });
});

describe('preloadFor', () => {
  const question = (
    media: LiveQuestionMedia,
    audioTarget: SnapshotQuestion['audioTarget'] = null,
  ) => ({ media, audioTarget }) as SnapshotQuestion;
  const snapshot = {
    audioTarget: 'projection_remote',
    questions: [question(withSound), question({ visual: null, audio: null })],
    slides: [
      {
        beforeQuestionIndex: 0,
        background: { url: '/bg' },
        blocks: [
          {
            type: 'columns',
            id: 'c',
            columns: [
              [
                {
                  type: 'image',
                  id: 'i',
                  mediaId: 'm',
                  url: '/slide-img',
                  size: 'small',
                  align: 'left',
                },
              ],
            ],
          },
        ],
      },
    ],
  } as unknown as QuizSnapshot;

  it('names the question, its target and the images of the slides before it — nothing else', () => {
    expect(preloadFor(snapshot, 0, 'projection_remote', 'remote')).toEqual({
      questionIndex: 0,
      media: withSound,
      audioTarget: 'projection_remote',
      images: ['/bg', '/slide-img'],
    });
  });

  it('has nothing to say when there is nothing to fetch', () => {
    expect(preloadFor(snapshot, 1, 'projection_remote', 'room')).toBeNull();
    expect(preloadFor(snapshot, 2, 'projection_remote', 'screen')).toBeNull();
  });

  it('tells whether the quiz has anything to fetch at all', () => {
    expect(snapshotHasMedia(snapshot)).toBe(true);
    expect(snapshotHasMedia({ ...snapshot, questions: [], slides: [] })).toBe(false);
  });
});
