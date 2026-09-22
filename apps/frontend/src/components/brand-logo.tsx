import { useState } from 'react';
import { LOGO_CANDIDATES } from '@/config';

// First candidate still worth trying, shared across mounts: a URL that failed once
// keeps failing for the whole page life, so later headers skip straight past it.
let firstCandidate = 0;

/**
 * The header logo. Operators drop a `logo.<ext>` in the mounted branding folder in
 * whatever web format they have (see `LOGO_CANDIDATES`); the `<img>` walks the
 * candidate URLs and keeps the first one that decodes, ending on the bundled default.
 * `<picture>` cannot do this:
 * it picks a `<source>` by MIME support, never by whether the file exists, so it
 * would commit to `logo.svg` and show a broken image when only `logo.png` is there.
 * The `error` event is the only reliable probe here: the SPA fallback answers a
 * missing file with `index.html` (200), which fails to decode as an image.
 */
export function BrandLogo({ className }: { className?: string }) {
  const [index, setIndex] = useState(firstCandidate);
  const src = LOGO_CANDIDATES[index];
  if (src === undefined) return null; // nothing loads → no logo rather than a broken icon
  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={() => {
        firstCandidate = Math.max(firstCandidate, index + 1);
        setIndex(index + 1);
      }}
    />
  );
}
