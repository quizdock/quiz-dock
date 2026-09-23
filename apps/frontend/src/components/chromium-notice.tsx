import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Whether this is a Chromium browser (Chrome, Edge, Brave, Opera…). The brand
 * list says it where it exists; the user agent otherwise, where every Chromium
 * says `Chrome/` and Firefox and Safari do not.
 */
export function isChromium(nav: Navigator = navigator): boolean {
  const brands = (nav as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
    .userAgentData?.brands;
  if (brands?.length) return brands.some((b) => b.brand === 'Chromium');
  return /\bChrom(e|ium)\//.test(nav.userAgent) && !/\bFirefox\//.test(nav.userAgent);
}

/**
 * The host's screens (editor, console, projection) are made for Chromium: media
 * are checked, decoded and played there the way they were tested. Elsewhere
 * the page still works, and says what may not.
 */
export function ChromiumNotice() {
  const { t } = useTranslation();
  if (isChromium()) return null;
  return (
    <p
      role="note"
      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      {t('chromiumOnly')}
    </p>
  );
}
