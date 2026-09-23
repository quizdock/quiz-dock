import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/** Pages d'une liste qui dépasse un écran (banque de quiz, sessions en cours). */
export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation('dashboard');
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-3" aria-label={t('pagination')}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft className="size-4" />
        {t('previous')}
      </Button>
      <span className="text-muted-foreground text-sm tabular-nums">
        {t('pageOf', { page, pages })}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        {t('next')}
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
