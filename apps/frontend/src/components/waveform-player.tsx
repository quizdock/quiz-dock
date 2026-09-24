import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Waveform } from '../game/media/waveform';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * A sound played over its waveform, as the screens draw it: play / pause, the
 * part played filled in, and a click on the waveform to go there. The peaks
 * were measured at upload; a sound without them falls back to the browser's
 * own controls.
 */
export function WaveformPlayer({
  src,
  peaks,
  durationMs,
}: {
  src: string;
  peaks: number[];
  durationMs?: number | null;
}) {
  const { t } = useTranslation('common');
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState((durationMs ?? 0) / 1000);

  // Follows the sound at the screen's pace rather than `timeupdate`'s four beats a second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audio.current) setTime(audio.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  if (peaks.length === 0) {
    return <audio src={src} controls className="w-full max-w-md" />;
  }

  const seek = (to: number) => {
    const el = audio.current;
    if (!el || !duration) return;
    el.currentTime = Math.min(Math.max(to, 0), duration);
    setTime(el.currentTime);
  };

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return (
    <div className="flex w-full max-w-xl items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={toggle}
        aria-label={playing ? t('pause') : t('play')}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <div
        role="slider"
        tabIndex={0}
        aria-label={t('position')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${clock(time)} / ${clock(duration)}`}
        className="text-primary focus-visible:ring-primary min-w-0 flex-1 cursor-pointer rounded focus-visible:ring-2 focus-visible:outline-none"
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          seek(((e.clientX - box.left) / box.width) * duration);
        }}
        onKeyDown={(e) => {
          // The arrows move in the sound here, not to the next file of a preview around it.
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            seek(time + (e.key === 'ArrowRight' ? 5 : -5));
          }
        }}
      >
        <Waveform peaks={peaks} progress={duration ? time / duration : 0} size="L" />
      </div>
      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs tabular-nums">
        {clock(time)} / {clock(duration)}
      </span>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        hidden
      />
    </div>
  );
}
