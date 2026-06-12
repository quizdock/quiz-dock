import { useState } from 'react';
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
    <div className="media-upload">
      {value ? (
        <div className="media-preview">
          <img src={`/api/v1/media/${value}`} alt="média de la question" />
          <button type="button" onClick={() => onChange(null)}>
            Retirer le média
          </button>
        </div>
      ) : (
        <label className="media-pick">
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
      {error && <p className="error">{error}</p>}
    </div>
  );
}
