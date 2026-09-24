import type { Audio, QuestionMedia } from '@quiz-dock/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { mediaControllerDescribe } from '../api/generated/media/media';
import { MediaUpload, type UploadedMedia } from './media-upload';

/**
 * The two media slots of a question. The visual holds an image or a video; the
 * audio holds an MP3. A video brings its own sound, so while one is there the
 * audio slot is closed, and while a sound is there no video can be chosen —
 * each side says why, so the author is never left guessing.
 */
export function QuestionMediaField({
  value,
  onChange,
  children,
}: {
  value: QuestionMedia;
  onChange: (media: QuestionMedia) => void;
  /** The sound's own settings (listen first, playback), closing the sound group. */
  children?: ReactNode;
}) {
  const { t } = useTranslation('editor');
  const { visual, audio } = value;
  const hasVideo = visual?.kind === 'video';

  const setImage = (id: string | null) =>
    onChange({
      visual: id ? { kind: 'image', assetId: id } : null,
      audio: hasVideo ? null : audio,
    });
  const setVideo = (id: string | null) =>
    onChange(
      id
        ? { visual: { kind: 'video', source: 'upload', assetId: id }, audio: null }
        : NO_VISUAL(audio),
    );
  const setAudio = (id: string | null, uploaded?: UploadedMedia) => {
    const track: Audio | null =
      id && uploaded?.durationMs && uploaded.peaks
        ? { assetId: id, origin: 'upload', durationMs: uploaded.durationMs, peaks: uploaded.peaks }
        : null;
    onChange({ visual: hasVideo ? null : visual, audio: track } as QuestionMedia);
  };

  return (
    // One fold for all of it, open when the question has media; inside, the
    // visual and the sound each read as their own group.
    <Disclosure
      title={t('media.slotsLegend')}
      defaultOpen={!!visual || !!audio}
      value={
        [
          visual?.kind === 'image' ? t('media.kindImage') : null,
          hasVideo ? t('media.kindVideo') : null,
          audio ? t('media.audioLabel') : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('media.none')
      }
    >
      <div className={GROUP}>
        <span className="text-sm font-medium">{t('media.visualLabel')}</span>
        {visual?.kind === 'image' ? (
          <MediaUpload value={visual.assetId} onChange={setImage} kind="image" />
        ) : visual?.kind === 'video' && visual.source === 'upload' ? (
          <MediaUpload value={visual.assetId} onChange={setVideo} kind="video" />
        ) : visual?.kind === 'video' ? (
          // An embedded video (YouTube / Vimeo) comes with its own phase; it can only be removed here.
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setVideo(null)}
          >
            {t('media.remove')}
          </Button>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <MediaUpload
              value={null}
              onChange={setImage}
              kind="image"
              label={t('media.addImage')}
            />
            {audio ? (
              <p className="text-muted-foreground max-w-[22rem] text-sm">
                {t('media.audioExcludesVideo')}
              </p>
            ) : (
              <MediaUpload
                value={null}
                onChange={setVideo}
                kind="video"
                label={t('media.addVideo')}
              />
            )}
          </div>
        )}
      </div>

      <div className={GROUP}>
        <span className="text-sm font-medium">{t('media.audioLabel')}</span>
        {hasVideo ? (
          <p className="text-muted-foreground text-sm">{t('media.videoExcludesAudio')}</p>
        ) : (
          <MediaUpload
            value={audio?.assetId ?? null}
            onChange={setAudio}
            kind="audio"
            label={t('media.addAudio')}
          />
        )}
        {children}
      </div>
    </Disclosure>
  );
}

/** A group of the media section, drawn by a rule down its left side. */
const GROUP = 'flex flex-col gap-1.5 border-l-2 pl-3';

/** The visual slot emptied, the sound kept. */
const NO_VISUAL = (audio: Audio | null): QuestionMedia => ({ visual: null, audio });

/**
 * How long the question's media plays (ms), for the timing hint: a sound says
 * it itself; an uploaded video is asked of the server once per video.
 */
export function useMediaDurationMs(media: QuestionMedia): number | null {
  const videoId =
    media.visual?.kind === 'video' && media.visual.source === 'upload'
      ? media.visual.assetId
      : null;
  const [video, setVideo] = useState<{ id: string; ms: number | null } | null>(null);
  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;
    void mediaControllerDescribe(videoId)
      .then(({ data }) => !cancelled && setVideo({ id: videoId, ms: data.durationMs ?? null }))
      .catch(() => undefined); // no hint rather than a wrong one
    return () => {
      cancelled = true;
    };
  }, [videoId]);
  if (media.audio) return media.audio.durationMs;
  return videoId && video?.id === videoId ? video.ms : null;
}
