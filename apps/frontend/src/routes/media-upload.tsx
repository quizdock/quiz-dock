import { Film, FolderOpen, ImagePlus, Music, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConversionNotice } from '@/lib/media-convert';
import { readyForUpload } from '@/lib/media-pipeline';
import { type MediaKind, MediaCheckError } from '@/lib/media-prepare';
import { errorText } from '../api/error-text';
import { apiErrorText } from '../api/http';
import {
  mediaControllerDescribe,
  useMediaControllerReuse,
  useMediaControllerSetAlt,
  useMediaControllerSetCredit,
  useMediaControllerUpload,
} from '../api/generated/media/media';
import type { MediaLibraryItemDto } from '../api/generated/model';
import { getDemo } from '../config';
import { MediaLibraryDialog } from './media-library-dialog';

/**
 * What the picker offers for each kind — a hint only: whatever this browser can
 * read is converted (WebP, MP4 H.264/AAC, M4A), the rest is refused with the way out.
 */
const ACCEPT: Record<MediaKind, string> = {
  image: 'image/*',
  video: 'video/*,.mkv,.mov',
  audio: 'audio/*,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wav',
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
 * is converted in the browser to its kind's format, then checked by its content
 * before it leaves (the server checks it again). A long conversion shows its
 * progress and can be cancelled.
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
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<ConversionNotice[]>([]);
  const abort = useRef<AbortController | null>(null);
  const reuse = useMediaControllerReuse();
  const [libraryOpen, setLibraryOpen] = useState(false);

  /** A media from the author's library: a new use of the same file, alt and credit to start from. */
  const onPick = async (item: MediaLibraryItemDto) => {
    setLibraryOpen(false);
    setError(null);
    setNotices([]);
    try {
      const res = await reuse.mutateAsync({ id: item.id });
      onChange(res.data.mediaId, {
        kind: item.kind,
        durationMs: item.durationMs ?? undefined,
        peaks: item.peaks.length > 0 ? item.peaks : undefined,
      });
    } catch (err) {
      setError(apiErrorText(err, t('media.uploadError')));
    }
  };

  useEffect(() => () => abort.current?.abort(), []);

  const onFile = async (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    setNotices([]);
    setChecking(true);
    abort.current = new AbortController();
    try {
      const ready = await readyForUpload(picked, kind, {
        onProgress: setProgress,
        signal: abort.current.signal,
      });
      // The same original was uploaded before: reused, nothing converted nor sent.
      if ('reuse' in ready) {
        await onPick(ready.reuse);
        return;
      }
      const { file, prepared, notices, sourceSha256 } = ready;
      setProgress(null);
      setNotices(notices);
      const res = await upload.mutateAsync({ data: { file, ...prepared.fields, sourceSha256 } });
      onChange(res.data.mediaId, {
        kind: prepared.kind,
        durationMs: prepared.fields.durationMs,
        peaks: prepared.fields.peaks ? (JSON.parse(prepared.fields.peaks) as number[]) : undefined,
      });
    } catch (err) {
      if (err instanceof MediaCheckError && err.code === 'media.canceled') return;
      setError(
        err instanceof MediaCheckError
          ? errorText(err.code, err.params)
          : apiErrorText(err, t('media.uploadError')),
      );
    } finally {
      abort.current = null;
      setProgress(null);
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
      ) : progress !== null ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <progress value={progress} max={1} className="w-40" aria-label={t('media.converting')} />
          <span>{t('media.convertingPercent', { percent: Math.round(progress * 100) })}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => abort.current?.abort()}>
            <X className="size-4" />
            {t('media.cancelConversion')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
            <Icon className="size-4" />
            {upload.isPending
              ? t('media.uploading')
              : checking
                ? t('media.converting')
                : (label ?? t('media.add'))}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={checking || reuse.isPending}
            onClick={() => setLibraryOpen(true)}
          >
            <FolderOpen className="size-4" />
            {t(`media.library.openKind.${kind}`)}
          </Button>
        </div>
      )}
      {value ? <MediaDetailsFields mediaId={value} withAlt={kind === 'image'} /> : null}
      <MediaLibraryDialog
        open={libraryOpen}
        kind={kind}
        onPick={(item) => void onPick(item)}
        onClose={() => setLibraryOpen(false)}
      />
      {notices.map((notice) => (
        <p key={notice} className="text-sm text-muted-foreground">
          {t(notice)}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * What goes with the attached media, saved on blur on the media itself (so it
 * travels in a bundle): its alternative text for an image (#43) — empty is a
 * legitimate answer for decoration, a wrong description is worse than none —
 * and, for any kind, its credit (#53): who made it, under which licence, from
 * where, shown with the quiz and at the end of a session.
 */
function MediaDetailsFields({ mediaId, withAlt }: { mediaId: string; withAlt: boolean }) {
  const { t } = useTranslation('editor');
  const setAlt = useMediaControllerSetAlt();
  const setCredit = useMediaControllerSetCredit();
  const [alt, setAltValue] = useState('');
  const [credit, setCreditValue] = useState('');
  const saved = useRef({ alt: '', credit: '' });

  useEffect(() => {
    let cancelled = false;
    void mediaControllerDescribe(mediaId)
      .then(({ data }) => {
        if (cancelled) return;
        saved.current = { alt: data.alt ?? '', credit: data.credit ?? '' };
        setAltValue(saved.current.alt);
        setCreditValue(saved.current.credit);
      })
      .catch(() => undefined); // a media we cannot describe simply shows empty fields
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  const saveAlt = () => {
    if (alt === saved.current.alt) return;
    saved.current.alt = alt;
    void setAlt.mutateAsync({ id: mediaId, data: { alt } }).catch(() => {
      saved.current.alt = '';
    });
  };
  const saveCredit = () => {
    if (credit === saved.current.credit) return;
    saved.current.credit = credit;
    void setCredit.mutateAsync({ id: mediaId, data: { credit } }).catch(() => {
      saved.current.credit = '';
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {withAlt ? (
        <Label className="text-muted-foreground text-sm">
          {t('media.altLabel')}
          <Input
            value={alt}
            maxLength={300}
            onChange={(e) => setAltValue(e.target.value)}
            onBlur={saveAlt}
            placeholder={t('media.altPlaceholder')}
          />
          <span className="text-xs">{t('media.altHelp')}</span>
        </Label>
      ) : null}
      <Label className="text-muted-foreground text-sm">
        {t('media.creditLabel')}
        <Input
          value={credit}
          maxLength={300}
          onChange={(e) => setCreditValue(e.target.value)}
          onBlur={saveCredit}
          placeholder={t('media.creditPlaceholder')}
        />
        <span className="text-xs">{t('media.creditHelp')}</span>
      </Label>
    </div>
  );
}
