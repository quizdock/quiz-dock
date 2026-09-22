import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiErrorText } from '../api/http';
import {
  mediaControllerDescribe,
  useMediaControllerSetAlt,
  useMediaControllerUpload,
} from '../api/generated/media/media';
import { getDemo } from '../config';

/** Upload d'un média (image/audio) → renvoie le mediaId au parent. */
export function MediaUpload({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (mediaId: string | null) => void;
}) {
  const { t } = useTranslation('editor');
  const upload = useMediaControllerUpload();
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const res = await upload.mutateAsync({ data: { file } });
      onChange(res.data.mediaId);
    } catch (err) {
      setError(apiErrorText(err, t('media.uploadError')));
    }
  };

  if (getDemo()) {
    return <p className="text-muted-foreground text-sm">{t('media.demoDisabled')}</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {value ? (
        <div className="flex items-center gap-3">
          <img
            src={`/api/v1/media/${value}`}
            alt={t('media.alt')}
            className="max-h-20 rounded-md border"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            <Trash2 className="size-4" />
            {t('media.remove')}
          </Button>
        </div>
      ) : (
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
          <ImagePlus className="size-4" />
          {upload.isPending ? t('media.uploading') : t('media.add')}
          <input
            type="file"
            aria-label={t('media.fileInputLabel')}
            accept="image/*,audio/*"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
      )}
      {value ? <AltField mediaId={value} /> : null}
      {error && <p className="text-sm text-destructive">{error}</p>}
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
