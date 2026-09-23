import type { LiveAudio, LiveQuestionMedia } from '@quiz-dock/contracts';
import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { applyGain, unlockAudio, useAudioUnlocked } from './audio-unlock';
import { releaseMedia, takeMedia } from './media-pool';
import { clearPosition, readPosition, resumeAt, writePosition } from './media-position';
import { Waveform } from './waveform';

/**
 * - `play`: the projection plays the media as the question appears;
 * - `pause`: the host paused the game — the media holds its position;
 * - `still`: shown without sound nor playback (the console, its screen tab).
 */
export type StageMode = 'play' | 'pause' | 'still';

/** Where the projection was in a sound when it last said so, on this screen's clock. */
export interface FollowedPosition {
  questionIndex: number;
  t: number;
  playing: boolean;
  /** `performance.now()` at reception. */
  receivedAt: number;
}

/** How often the projection says where it is while a sound plays (ms). */
const POSITION_EVERY_MS = 1000;

/** How long a media may take to start before the screen says it is late. */
const SLOW_MS = 4000;

type Blocked = null | 'video' | 'audio';

/**
 * Plays an element per `mode`, and says what went wrong: a sound the browser
 * refused (a video then plays muted, both offer to turn the sound on) or a
 * media that has not loaded in time.
 */
function usePlayback(
  el: HTMLMediaElement | null,
  mode: StageMode,
  gainDb: number,
  restartSignal: number,
  positionKey: string | null,
  /** Plays without sound: the device is not targeted, or its owner muted it. */
  silent = false,
) {
  const [blocked, setBlocked] = useState<Blocked>(null);
  const [slow, setSlow] = useState(false);
  // Sound unlocked meanwhile (the projection's overlay): what was refused plays now.
  const unlocked = useAudioUnlocked();

  // The host takes the media back to the top (the element keeps playing or paused as it was).
  const firstSignal = useRef(restartSignal);
  useEffect(() => {
    if (!el || restartSignal === firstSignal.current) return;
    firstSignal.current = restartSignal;
    if (positionKey) clearPosition(positionKey);
    el.currentTime = 0;
    if (mode === 'play') void el.play().catch(() => undefined);
  }, [el, restartSignal, mode, positionKey]);

  useEffect(() => {
    if (!el) return;
    if (mode !== 'play') {
      el.pause();
      return;
    }
    // Played to its end before an interruption: it does not start again on its own.
    if (positionKey && readPosition(positionKey)?.ended) return;
    let cancelled = false;
    const start = async () => {
      if (silent) el.muted = true;
      else if (unlocked && el.muted) el.muted = false; // the video that went on muted gets its sound
      await applyGain(el, gainDb);
      if (!cancelled) await el.play();
      if (!cancelled) setBlocked(null);
    };
    start().catch((err: DOMException) => {
      if (cancelled || err.name !== 'NotAllowedError') return;
      if (el instanceof HTMLVideoElement) {
        // Picture without sound beats nothing: the room still sees the question.
        el.muted = true;
        void el.play().catch(() => undefined);
        setBlocked('video');
      } else {
        setBlocked('audio');
      }
    });
    const timer = window.setTimeout(() => {
      if (!cancelled && el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) setSlow(true);
    }, SLOW_MS);
    const onPlaying = () => setSlow(false);
    el.addEventListener('playing', onPlaying);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      el.removeEventListener('playing', onPlaying);
    };
  }, [el, mode, gainDb, positionKey, unlocked, silent]);

  const enableSound = async () => {
    if (!el) return;
    await unlockAudio();
    el.muted = false;
    await applyGain(el, gainDb);
    try {
      await el.play();
      setBlocked(null);
    } catch {
      // Still refused: the indicator stays, the host can try again.
    }
  };

  return { blocked, slow, enableSound };
}

/** Adopts (or creates) the element for `url` and releases it when the screen changes. */
function useMediaElement(
  tag: 'video' | 'audio',
  url: string | null,
  still: boolean,
  positionKey: string | null,
) {
  const [el, setEl] = useState<HTMLMediaElement | null>(null);
  useEffect(() => {
    if (!url) return;
    const media = takeMedia(tag, url);
    if (still) {
      media.muted = true;
      media.preload = 'metadata';
    }
    // Back after an interruption: a second before where it was, not from the top.
    const track = !still && positionKey;
    const start = track ? resumeAt(readPosition(positionKey)) : null;
    if (start !== null) media.currentTime = start;
    const save = () =>
      track && writePosition(positionKey, { t: media.currentTime, ended: media.ended });
    media.addEventListener('timeupdate', save);
    media.addEventListener('ended', save);
    setEl(media);
    return () => {
      media.removeEventListener('timeupdate', save);
      media.removeEventListener('ended', save);
      releaseMedia(media);
      setEl(null);
    };
  }, [tag, url, still, positionKey]);
  return el;
}

function SoundNotice({ onEnable, kind }: { onEnable: () => void; kind: 'video' | 'audio' }) {
  const { t } = useTranslation('live');
  return (
    <div
      role="alert"
      className="flex items-center gap-[0.5em] rounded-full bg-amber-500/15 px-[0.8em] py-[0.3em] text-[0.8em]"
    >
      <VolumeX className="size-[1.1em] shrink-0" />
      <span>{kind === 'video' ? t('media.videoMuted') : t('media.soundBlocked')}</span>
      <Button type="button" size="sm" variant="outline" onClick={onEnable}>
        <Volume2 className="size-4" />
        {t('media.enableSound')}
      </Button>
    </div>
  );
}

function SlowNotice() {
  const { t } = useTranslation('live');
  return (
    <p role="status" className="text-muted-foreground text-[0.8em]">
      {t('media.slow')}
    </p>
  );
}

function VideoBox({
  url,
  mode,
  gainDb,
  boxClassName,
  resumeKey,
  restartSignal,
  silent,
}: {
  url: string;
  mode: StageMode;
  gainDb: number;
  boxClassName?: string;
  resumeKey: string | null;
  restartSignal: number;
  silent: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const key = resumeKey && `${resumeKey}:${url}`;
  const el = useMediaElement('video', url, mode === 'still', key);
  const { blocked, slow, enableSound } = usePlayback(el, mode, gainDb, restartSignal, key, silent);

  useEffect(() => {
    if (!el || !box.current) return;
    el.className = 'absolute inset-0 h-full w-full object-contain';
    box.current.appendChild(el);
  }, [el]);

  return (
    <>
      <div ref={box} className={cn('relative aspect-video max-w-full', boxClassName)} />
      {blocked ? <SoundNotice kind="video" onEnable={() => void enableSound()} /> : null}
      {slow ? <SlowNotice /> : null}
    </>
  );
}

function AudioTrack({
  audio,
  mode,
  resumeKey,
  restartSignal,
  silent,
  onPosition,
}: {
  audio: LiveAudio;
  mode: StageMode;
  resumeKey: string | null;
  restartSignal: number;
  silent: boolean;
  onPosition?: (t: number, playing: boolean) => void;
}) {
  const { t } = useTranslation('live');
  const key = resumeKey && `${resumeKey}:${audio.url}`;
  const el = useMediaElement('audio', audio.url, mode === 'still', key);
  const { blocked, slow, enableSound } = usePlayback(
    el,
    mode,
    audio.gainDb,
    restartSignal,
    key,
    silent,
  );
  const [progress, setProgress] = useState(0);

  // The filled part follows the sound, frame by frame, only while it plays.
  useEffect(() => {
    if (!el) return;
    let frame = 0;
    const tick = () => {
      const duration = el.duration || audio.durationMs / 1000;
      setProgress(duration > 0 ? Math.min(1, el.currentTime / duration) : 0);
      if (!el.paused && !el.ended) frame = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    el.addEventListener('play', start);
    el.addEventListener('seeked', start);
    el.addEventListener('ended', tick);
    if (!el.paused) start();
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('play', start);
      el.removeEventListener('seeked', start);
      el.removeEventListener('ended', tick);
    };
  }, [el, audio.durationMs]);

  // The projection tells the room where it is: at each play, pause or jump, and
  // every second while it plays, so the other screens' playheads keep up.
  useEffect(() => {
    if (!el || !onPosition) return;
    const say = () => onPosition(el.currentTime, !el.paused && !el.ended);
    const events = ['play', 'pause', 'seeked', 'ended'] as const;
    events.forEach((e) => el.addEventListener(e, say));
    const timer = window.setInterval(() => {
      if (!el.paused && !el.ended) say();
    }, POSITION_EVERY_MS);
    return () => {
      events.forEach((e) => el.removeEventListener(e, say));
      window.clearInterval(timer);
    };
  }, [el, onPosition]);

  return (
    <div className="flex w-full flex-col items-center gap-[0.5em]">
      <Waveform
        peaks={audio.peaks}
        progress={progress}
        size={audio.size}
        label={t('media.waveform')}
      />
      {blocked ? <SoundNotice kind="audio" onEnable={() => void enableSound()} /> : null}
      {slow ? <SlowNotice /> : null}
    </div>
  );
}

/**
 * A sound this screen does not play, drawn where the projection is in it: the
 * last position it gave, moved on by the time since while it plays.
 */
export function FollowedWaveform({
  audio,
  follow,
}: {
  audio: LiveAudio;
  follow: FollowedPosition | null;
}) {
  const { t } = useTranslation('live');
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const duration = audio.durationMs / 1000;
    const at = () => {
      if (!follow || duration <= 0) return 0;
      const moved = follow.playing ? (performance.now() - follow.receivedAt) / 1000 : 0;
      return Math.min(1, (follow.t + moved) / duration);
    };
    setProgress(at());
    if (!follow?.playing) return;
    let frame = 0;
    const tick = () => {
      setProgress(at());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [follow, audio.durationMs]);
  return (
    <div className="w-full max-w-[40em]">
      <Waveform
        peaks={audio.peaks}
        progress={progress}
        size={audio.size}
        label={t('media.waveform')}
      />
    </div>
  );
}

/**
 * The media of a question on the projected screen: one box for the visual —
 * image or video, same ratio, `object-fit: contain` — and the sound as its
 * waveform. It plays as the question appears, holds while the host pauses,
 * and stops for good when the screen moves on (the elements are released on
 * unmount), so no sound runs into the reveal or the next question.
 */
export function QuestionMediaStage({
  media,
  mode,
  boxClassName,
  className,
  resumeKey = null,
  restartSignal = 0,
  audible = true,
  muted = false,
  follow,
  onPosition,
}: {
  media: LiveQuestionMedia | null | undefined;
  mode: StageMode;
  /** False on a device the sound is not meant for: the video plays muted, the sound is left out. */
  audible?: boolean;
  /** The device's owner turned the sound off: everything plays on, silently. */
  muted?: boolean;
  /**
   * Given (even null) on a screen that shows the sound without playing it: its
   * waveform follows the projection's position instead of an element of its own.
   */
  follow?: FollowedPosition | null;
  /** The projection only: says where it is in the sound, for the other screens. */
  onPosition?: (t: number, playing: boolean) => void;
  /** Session + question: where the position is kept across an interruption (projection only). */
  resumeKey?: string | null;
  /** Changes when the host restarts the media from the top. */
  restartSignal?: number;
  /** Size of the visual box (its height, mostly). */
  boxClassName?: string;
  className?: string;
}) {
  const { t } = useTranslation('live');
  const visual = media?.visual ?? null;
  // A sound not meant for this device is left out — or drawn following the projection.
  const audio = audible || follow !== undefined ? (media?.audio ?? null) : null;
  if (!visual && !audio) return null;
  return (
    <div className={cn('flex w-full flex-col items-center gap-[0.75em]', className)}>
      {visual?.kind === 'image' ? (
        <div className={cn('relative aspect-video max-w-full', boxClassName)}>
          <img
            src={visual.url}
            alt={visual.alt?.trim() || t('question.mediaAlt')}
            className="absolute inset-0 h-full w-full rounded-lg object-contain"
          />
        </div>
      ) : visual?.source === 'upload' ? (
        <VideoBox
          url={visual.url}
          mode={mode}
          gainDb={visual.gainDb}
          boxClassName={boxClassName}
          resumeKey={resumeKey}
          restartSignal={restartSignal}
          silent={muted || !audible}
        />
      ) : null}
      {audio && (mode === 'still' || !audible) && follow !== undefined ? (
        <FollowedWaveform audio={audio} follow={follow} />
      ) : audio ? (
        <div className="w-full max-w-[40em]">
          <AudioTrack
            audio={audio}
            mode={mode}
            resumeKey={resumeKey}
            restartSignal={restartSignal}
            silent={muted}
            onPosition={onPosition}
          />
        </div>
      ) : null}
    </div>
  );
}
