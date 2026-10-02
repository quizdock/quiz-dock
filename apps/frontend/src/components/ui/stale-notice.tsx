import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Notice } from '@/components/ui/notice';

/**
 * Said above what a page shows when reading it again failed: the last reading
 * stays on screen — with what was typed in it —, not replaced by an error.
 */
export function StaleNotice({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation('common');
  return (
    <Notice>
      <span className="flex flex-wrap items-center gap-2">
        {t('stale')}
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 underline"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {t('retry')}
          </button>
        ) : null}
      </span>
    </Notice>
  );
}
