import { ImagePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiErrorMessage } from '../api/http';
import { useMediaControllerUpload } from '../api/generated/media/media';

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
      setError(apiErrorMessage(err, t('media.uploadError')));
    }
  };

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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
