import { ExternalLink, Search, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import type { MediaKind } from '@/lib/media-prepare';
import { apiErrorText } from '../api/http';
import {
  useMediaControllerLinks,
  useMediaControllerInstance,
  useMediaControllerList,
  useMediaControllerRemove,
} from '../api/generated/media/media';
import type { MediaLibraryItemDto } from '../api/generated/model';
import { formatDimensions } from '@/lib/dimensions';
import { Waveform } from '../game/media/waveform';

const SEARCH_DELAY_MS = 250;

/** How an entry is named: its file name, else (a media from before names were kept) its date. */
const labelOf = (item: MediaLibraryItemDto) =>
  item.name ?? new Date(item.createdAt).toLocaleDateString();

const duration = (ms: number | null) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The author's media of one kind, to put one to a new use (#53): one entry per
 * file, what it is used by, and the unused ones can go. Below, the free
 * libraries to look in when nothing here fits. A native `<dialog>`, like the
 * confirmations (`m-auto`: Tailwind's reset would pin it to a corner).
 */
export function MediaLibraryDialog({
  open,
  kind,
  onPick,
  onClose,
}: {
  open: boolean;
  kind: MediaKind;
  onPick: (item: MediaLibraryItemDto) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('editor');
  const ref = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [toDelete, setToDelete] = useState<MediaLibraryItemDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      try {
        if (!d.open) d.showModal();
      } catch {
        d.setAttribute('open', ''); // jsdom: showModal is not implemented
      }
    } else if (d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  // The author's own media, or the instance's (#62), provided by its administrators.
  const [source, setSource] = useState<'mine' | 'instance'>('mine');
  const filter = { kind, ...(q ? { q } : {}) };
  const mine = useMediaControllerList(filter, { query: { enabled: open && source === 'mine' } });
  const shared = useMediaControllerInstance(filter, {
    query: { enabled: open && source === 'instance' },
  });
  const list = source === 'mine' ? mine : shared;
  const links = useMediaControllerLinks({ query: { enabled: open, staleTime: Infinity } });
  const remove = useMediaControllerRemove();
  const items = list.data?.data ?? [];
  const elsewhere = (links.data?.data ?? []).filter((l) => l.kinds.includes(kind));

  const confirmDelete = async () => {
    if (!toDelete) return;
    const item = toDelete;
    setToDelete(null);
    setError(null);
    try {
      await remove.mutateAsync({ id: item.id });
      await mine.refetch();
    } catch (err) {
      setError(apiErrorText(err, t('media.library.deleteError')));
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="media-library-title"
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="bg-background text-foreground m-auto w-[94vw] max-w-3xl rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
    >
      <div className="flex max-h-[85dvh] flex-col gap-4 p-5">
        <header className="flex items-center justify-between gap-2">
          <h2 id="media-library-title" className="text-lg font-semibold">
            {t(`media.library.title.${kind}`)}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
            <span className="sr-only">{t('media.library.close')}</span>
          </Button>
        </header>

        <div role="tablist" className="bg-muted flex w-fit gap-1 rounded-md p-1 text-sm">
          {(['mine', 'instance'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={source === tab}
              onClick={() => setSource(tab)}
              className={
                source === tab
                  ? 'bg-background rounded px-3 py-1 font-medium shadow-sm'
                  : 'text-muted-foreground rounded px-3 py-1'
              }
            >
              {t(`media.library.tab.${tab}`)}
            </button>
          ))}
        </div>

        <label className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('media.library.search')}
            aria-label={t('media.library.search')}
            className="pl-8"
          />
        </label>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="min-h-24 overflow-y-auto">
          {list.isLoading ? (
            <p className="text-muted-foreground text-sm">{t('media.library.loading')}</p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {q
                ? t('media.library.noMatch')
                : source === 'instance'
                  ? t('media.library.instanceEmpty')
                  : t('media.library.empty')}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => onPick(item)}
                    className="hover:ring-primary focus-visible:ring-primary bg-muted flex aspect-video items-center justify-center overflow-hidden rounded-md border hover:ring-2 focus-visible:ring-2 focus-visible:outline-none"
                    aria-label={t('media.library.pick', { name: labelOf(item) })}
                  >
                    <Thumbnail item={item} />
                  </button>
                  <span className="truncate text-sm" title={item.name ?? undefined}>
                    {labelOf(item)}
                  </span>
                  {formatDimensions(item.width, item.height) ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatDimensions(item.width, item.height)}
                    </span>
                  ) : null}
                  {source === 'instance' ? (
                    item.credit ? (
                      <span className="text-muted-foreground truncate text-xs" title={item.credit}>
                        {item.credit}
                      </span>
                    ) : null
                  ) : (
                    <span className="text-muted-foreground flex items-center justify-between gap-1 text-xs">
                      {item.usedIn > 0
                        ? t('media.library.usedIn', { count: item.usedIn })
                        : item.inHistory
                          ? t('media.library.inHistory')
                          : t('media.library.unused')}
                      {item.usedIn === 0 && !item.inHistory ? (
                        <button
                          type="button"
                          onClick={() => setToDelete(item)}
                          className="hover:text-destructive"
                          aria-label={t('media.library.delete', { name: labelOf(item) })}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      ) : null}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {elsewhere.length > 0 ? (
          <footer className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-sm">
            <span>{t('media.library.findElsewhere')}</span>
            {elsewhere.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
              >
                {link.name}
                <ExternalLink className="size-3" />
              </a>
            ))}
            <span className="basis-full text-xs">{t('media.library.creditReminder')}</span>
          </footer>
        ) : null}
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title={t('media.library.deleteTitle')}
        description={t('media.library.deleteDescription')}
        confirmLabel={t('media.library.deleteConfirm')}
        destructive
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </dialog>
  );
}

function Thumbnail({ item }: { item: MediaLibraryItemDto }) {
  if (item.kind === 'image') {
    return (
      <img src={item.url} alt={item.alt ?? ''} loading="lazy" className="size-full object-cover" />
    );
  }
  if (item.kind === 'video') {
    return (
      <span className="relative size-full">
        {/* The first frame, fetched with the metadata only. */}
        <video
          src={`${item.url}#t=0.1`}
          preload="metadata"
          muted
          className="size-full object-cover"
        />
        <DurationBadge ms={item.durationMs} />
      </span>
    );
  }
  return (
    <span className="relative flex size-full items-center px-2">
      <Waveform peaks={item.peaks} progress={0} size="M" className="w-full" />
      <DurationBadge ms={item.durationMs} />
    </span>
  );
}

function DurationBadge({ ms }: { ms: number | null }) {
  const text = duration(ms);
  if (!text) return null;
  return (
    <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
      {text}
    </span>
  );
}
