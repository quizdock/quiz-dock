import { Film, ImagePlus, Music, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type MediaKind, MediaCheckError, prepareMediaUpload } from '@/lib/media-prepare';
import { errorText } from '../api/error-text';
import { apiErrorText } from '../api/http';
import {
  mediaControllerDescribe,
  useMediaControllerSetAlt,
  useMediaControllerUpload,
} from '../api/generated/media/media';
import { getDemo } from '../config';

/** What the picker takes for each kind — a hint only, the content is checked anyway. */
const ACCEPT: Record<MediaKind, string> = {
  image: 'image/png,image/jpeg,image/gif,image/webp,image/avif',
  video: 'video/mp4',
  audio: 'audio/mpeg,.mp3',
};

const ADD_ICON: Record<MediaKind, typeof ImagePlus> = {
  image: ImagePlus,
  video: Film,
  audio: Music,
};

/** A media just sent, with what the editor measured on it (a sound's waveform and length). */
export interface UploadedMedia {
  kind: MediaKind;
  durationMs?: number;
  peaks?: number[];
}

/**
 * Upload of one media of a given kind → its id goes back to the parent. The file
 * is checked by its content before it leaves the browser (the server checks it
 * again): an iPhone film in HEVC is turned away at once, with the way out.
 */
export function MediaUpload({
  value,
  onChange,
  kind = 'image',
  label,
}: {
  value: string | null;
  onChange: (mediaId: string | null, uploaded?: UploadedMedia) => void;
  kind?: MediaKind;
  /** Wording of the add button; the image one by default. */
  label?: string;
}) {
  const { t } = useTranslation('editor');
  const upload = useMediaControllerUpload();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setChecking(true);
    try {
      const prepared = await prepareMediaUpload(file, kind);
      const res = await upload.mutateAsync({ data: { file, ...prepared.fields } });
      onChange(res.data.mediaId, {
        kind: prepared.kind,
        durationMs: prepared.fields.durationMs,
        peaks: prepared.fields.peaks ? (JSON.parse(prepared.fields.peaks) as number[]) : undefined,
      });
    } catch (err) {
      setError(
        err instanceof MediaCheckError
          ? errorText(err.code, err.params)
          : apiErrorText(err, t('media.uploadError')),
      );
    } finally {
      setChecking(false);
    }
  };

  if (getDemo()) {
    return <p className="text-muted-foreground text-sm">{t('media.demoDisabled')}</p>;
  }
  const Icon = ADD_ICON[kind];
  const src = value ? `/api/v1/media/${value}` : null;
  return (
    <div className="flex flex-col gap-1.5">
      {src ? (
        <div className="flex flex-wrap items-center gap-3">
          {kind === 'image' ? (
            <img src={src} alt={t('media.alt')} className="max-h-20 rounded-md border" />
          ) : kind === 'video' ? (
            <video src={src} controls preload="metadata" className="max-h-32 rounded-md border" />
          ) : (
            <audio src={src} controls preload="metadata" className="max-w-full" />
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            <Trash2 className="size-4" />
            {t('media.remove')}
          </Button>
        </div>
      ) : (
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
          <Icon className="size-4" />
          {checking || upload.isPending ? t('media.uploading') : (label ?? t('media.add'))}
          <input
            type="file"
            aria-label={t('media.fileInputLabel')}
            accept={ACCEPT[kind]}
            hidden
            disabled={checking}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = ''; // the same file can be picked again after an error
            }}
          />
        </label>
      )}
      {value && kind === 'image' ? <AltField mediaId={value} /> : null}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The alternative text of the attached media (#43). Saved on blur, on the media
 * itself, so it follows the image everywhere it is used and travels in a bundle.
 * Leaving it empty is a legitimate answer for decoration — the help says so,
 * because a wrong description is worse than none.
 */
function AltField({ mediaId }: { mediaId: string }) {
  const { t } = useTranslation('editor');
  const setAlt = useMediaControllerSetAlt();
  const [alt, setAltValue] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let cancelled = false;
    void mediaControllerDescribe(mediaId)
      .then(({ data }) => {
        if (cancelled) return;
        setAltValue(data.alt ?? '');
        setSaved(data.alt ?? '');
      })
      .catch(() => undefined); // a media we cannot describe simply shows an empty field
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const save = () => {
    if (alt === saved) return;
    setSaved(alt);
    void setAlt.mutateAsync({ id: mediaId, data: { alt } }).catch(() => setSaved(''));
  };

  return (
    <Label className="text-muted-foreground text-sm">
      {t('media.altLabel')}
      <Input
        value={alt}
        maxLength={300}
        onChange={(e) => setAltValue(e.target.value)}
        onBlur={save}
        placeholder={t('media.altPlaceholder')}
      />
      <span className="text-xs">{t('media.altHelp')}</span>
    </Label>
  );
}
