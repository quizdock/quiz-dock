import { useState } from 'react';
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
  const upload = useMediaControllerUpload();
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const res = await upload.mutateAsync({ data: { file } });
      onChange(res.data.mediaId);
    } catch (err) {
      setError(apiErrorMessage(err, 'Échec de l’upload.'));
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {value ? (
        <div className="flex items-center gap-3">
          <img
            src={`/api/v1/media/${value}`}
            alt="média de la question"
            className="max-h-20 rounded-md border"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            Retirer le média
          </Button>
        </div>
      ) : (
        <label className="inline-flex w-fit cursor-pointer items-center rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
          {upload.isPending ? 'Envoi…' : 'Ajouter un média (image/audio)'}
          <input
            type="file"
            aria-label="Fichier média"
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
