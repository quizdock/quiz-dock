import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Library,
  List as ListIcon,
  Music,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { WaveformPlayer } from '@/components/waveform-player';
import { formatDimensions } from '@/lib/dimensions';
import { formatAgo, formatBytes } from '@/lib/format';
import { readyForUpload } from '@/lib/media-pipeline';
import { type MediaKind, MediaCheckError } from '@/lib/media-prepare';
import { errorText } from '../api/error-text';
import { apiErrorText } from '../api/http';
import {
  mediaAdminControllerAddUpload,
  useMediaAdminControllerAddFile,
  useMediaAdminControllerDeleteFile,
  useMediaAdminControllerFiles,
  useMediaAdminControllerOverview,
  useMediaAdminControllerRemove,
  useMediaAdminControllerSetCredit,
  useMediaAdminControllerSweep,
  useMediaAdminControllerUsages,
} from '../api/generated/admin/admin';
import type {
  MediaAdminControllerFilesParams,
  MediaFilesPageDtoItemsItem,
} from '../api/generated/model';
import { useRole } from '../auth/use-role';

const PAGE_SIZE = 25;
/** The owner key of the instance's own media (#62). */
const GLOBAL = 'global';

/**
 * After anything that changes the volume (a clean-up pass, the catalogue): every
 * block of the page reads it again — the figures, the files, the instance's media.
 */
function useRefreshAll() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        /\/media\/(instance|limits)|\/admin\/media/.test(String(query.queryKey[0])),
    });
}

/** A format as people know it: `audio/mpeg` is an MP3. */
const formatName = (mime: string) =>
  ({ 'audio/mpeg': 'MP3', 'audio/mp4': 'M4A', 'image/jpeg': 'JPEG', 'image/svg+xml': 'SVG' })[
    mime
  ] ?? (mime.split('/')[1] ?? mime).toUpperCase();
const KIND_ICON = { image: ImageIcon, video: Film, audio: Music } as const;

/**
 * The instance's media, for administrators (#54): what the volume holds and
 * who fills it, what the clean-up has to do (and running it now), and every
 * file — with its owners and usages — which may be deleted even when used
 * (moderation), once the page has said what that breaks.
 */
export function AdminMediaPage() {
  const { t } = useTranslation('dashboard');
  const { isManager, roles } = useRole();
  if (roles.length > 0 && !isManager) {
    return <p className="text-muted-foreground">{t('mediaAdmin.adminOnly')}</p>;
  }
  return (
    <div className="content-lg flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('mediaAdmin.title')}</h1>
      <Overview />
      <Files />
    </div>
  );
}

function Overview() {
  const { t, i18n } = useTranslation('dashboard');
  const overview = useMediaAdminControllerOverview();
  const sweep = useMediaAdminControllerSweep();
  const refreshAll = useRefreshAll();
  const [notice, setNotice] = useState<string | null>(null);
  const data = overview.data?.data;
  const bytes = (n: number) => formatBytes(n, i18n.language);

  const runNow = async () => {
    setNotice(null);
    try {
      const { data: res } = await sweep.mutateAsync();
      setNotice(
        res.ran && res.result
          ? t('mediaAdmin.cleanup.done', res.result)
          : t('mediaAdmin.cleanup.busy'),
      );
      await refreshAll();
    } catch (err) {
      setNotice(apiErrorText(err, t('mediaAdmin.cleanup.failed')));
    }
  };

  if (!data) return <p className="text-muted-foreground text-sm">{t('mediaAdmin.loading')}</p>;
  const { cleanup } = data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-semibold">{t('mediaAdmin.disk.title')}</h2>
        <p className="text-2xl font-bold tabular-nums">
          {bytes(data.bytes)}{' '}
          <span className="text-muted-foreground text-base font-normal">
            {t('mediaAdmin.disk.files', { count: data.files })}
          </span>
        </p>
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 text-sm">
          {data.byKind.map((k) => {
            const Icon = KIND_ICON[k.kind];
            return (
              <li key={k.kind} className="flex items-center gap-1">
                <Icon className="size-3.5" />
                {t(`mediaAdmin.kind.${k.kind}`)} {bytes(k.bytes)}
              </li>
            );
          })}
        </ul>
        {data.byOwner.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('mediaAdmin.disk.byOwner')}{' '}
            {data.byOwner
              .map(
                (o) =>
                  `${o.ownerId === GLOBAL ? t('mediaAdmin.global') : o.displayName} ${bytes(o.bytes)}`,
              )
              .join(' · ')}
          </p>
        ) : null}
        {data.legacy.files > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t('mediaAdmin.disk.legacy', {
              count: data.legacy.files,
              size: bytes(data.legacy.bytes),
              mimes: data.legacy.mimes.map(formatName).join(', '),
            })}
          </p>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="font-semibold">{t('mediaAdmin.cleanup.title')}</h2>
        <p className="text-sm">
          {t('mediaAdmin.cleanup.orphans', {
            count: cleanup.orphans.count,
            size: bytes(cleanup.orphans.bytes),
          })}
          {cleanup.orphans.waiting > 0
            ? ` ${t('mediaAdmin.cleanup.waiting', { count: cleanup.orphans.waiting })}`
            : ''}
        </p>
        <p className="text-sm">
          {t('mediaAdmin.cleanup.stray', {
            count: cleanup.strayFiles.count,
            size: bytes(cleanup.strayFiles.bytes),
          })}
        </p>
        {cleanup.guard ? (
          <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t(`mediaAdmin.cleanup.guard.${cleanup.guard}`)}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-sm">
            {cleanup.lastRun
              ? t('mediaAdmin.cleanup.lastRun', {
                  ago: formatAgo(cleanup.lastRun.at, i18n.language),
                })
              : t('mediaAdmin.cleanup.neverRun')}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={sweep.isPending}
            onClick={() => void runNow()}
          >
            <RefreshCw className={sweep.isPending ? 'size-4 animate-spin' : 'size-4'} />
            {t('mediaAdmin.cleanup.runNow')}
          </Button>
        </div>
        {notice ? (
          <p role="status" className="text-muted-foreground text-sm">
            {notice}
          </p>
        ) : null}
      </Card>
    </div>
  );
}

type Scope = 'all' | 'global';
type View = 'list' | 'grid';
const VIEW_KEY = 'quizdock.adminMedia.view';

/** The view last chosen, kept in this browser only (a convenience, never required). */
function useStoredView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  const choose = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // private window, storage blocked: the choice lasts this visit
    }
  };
  return [view, choose];
}

/**
 * Every file of the instance, one list: *All*, or *Global* — the media the
 * instance provides to every host (#62), owned by "Global", added here or from
 * any file, their credit edited here (no alt text: the host writes it for their
 * quiz), withdrawn without breaking a quiz. As a list or as a grid.
 */
function Files() {
  const { t, i18n } = useTranslation('dashboard');
  const overview = useMediaAdminControllerOverview();
  const owners = (overview.data?.data.byOwner ?? []).filter((o) => o.ownerId !== GLOBAL);
  const [scope, setScope] = useState<Scope>('all');
  const [view, setView] = useStoredView();
  const [kind, setKind] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [sort, setSort] = useState<'size' | 'usage' | 'recent'>('size');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<MediaFilesPageDtoItemsItem | null>(null);
  const [toWithdraw, setToWithdraw] = useState<MediaFilesPageDtoItemsItem | null>(null);
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshAll = useRefreshAll();
  const withdraw = useMediaAdminControllerRemove();

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [scope, kind, ownerId, legacy, sort, q]);

  const params: MediaAdminControllerFilesParams = {
    sort,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    ...(kind ? { kind: kind as MediaAdminControllerFilesParams['kind'] } : {}),
    ...(scope === 'global' ? { ownerId: GLOBAL } : ownerId ? { ownerId } : {}),
    ...(legacy ? { legacy: 'true' as const } : {}),
    ...(q ? { q } : {}),
  };
  const files = useMediaAdminControllerFiles(params);
  const list = files.data?.data;
  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE_SIZE));

  const upload = async (uploadKind: MediaKind, file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const ready = await readyForUpload(file, uploadKind);
      await mediaAdminControllerAddUpload({ file: ready.file, ...ready.prepared.fields });
      await refreshAll();
    } catch (err) {
      setError(
        err instanceof MediaCheckError
          ? errorText(err.code, err.params)
          : apiErrorText(err, t('mediaAdmin.instance.addFailed')),
      );
    } finally {
      setBusy(false);
    }
  };

  const actions = (file: MediaFilesPageDtoItemsItem) => (
    <FileActions
      file={file}
      scope={scope}
      onDelete={() => setToDelete(file)}
      onWithdraw={() => setToWithdraw(file)}
      onChanged={() => void refreshAll()}
      onError={setError}
    />
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{t('mediaAdmin.files.title')}</h2>
          <Segmented
            label={t('mediaAdmin.files.scope')}
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: t('mediaAdmin.files.scopeAll') },
              { value: 'global', label: t('mediaAdmin.global') },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {scope === 'global'
            ? (['image', 'video', 'audio'] as const).map((k) => (
                <AddButton key={k} kind={k} disabled={busy} onFile={(f) => void upload(k, f)} />
              ))
            : null}
          <Segmented
            label={t('mediaAdmin.files.view')}
            value={view}
            onChange={setView}
            options={[
              { value: 'list', label: t('mediaAdmin.files.viewList'), icon: ListIcon },
              { value: 'grid', label: t('mediaAdmin.files.viewGrid'), icon: LayoutGrid },
            ]}
          />
        </div>
      </div>
      {scope === 'global' ? (
        <p className="text-muted-foreground text-sm">{t('mediaAdmin.instance.help')}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-36"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label={t('mediaAdmin.files.kind')}
        >
          <option value="">{t('mediaAdmin.files.allKinds')}</option>
          {(['image', 'video', 'audio'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`mediaAdmin.kind.${k}`)}
            </option>
          ))}
        </Select>
        {scope === 'all' ? (
          <Select
            className="w-44"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            aria-label={t('mediaAdmin.files.owner')}
          >
            <option value="">{t('mediaAdmin.files.allOwners')}</option>
            {owners.map((o) => (
              <option key={o.ownerId} value={o.ownerId}>
                {o.displayName}
              </option>
            ))}
          </Select>
        ) : null}
        <Select
          className="w-44"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          aria-label={t('mediaAdmin.files.sort')}
        >
          <option value="size">{t('mediaAdmin.files.bySize')}</option>
          <option value="usage">{t('mediaAdmin.files.byUsage')}</option>
          <option value="recent">{t('mediaAdmin.files.byDate')}</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} />
          {t('mediaAdmin.files.legacyOnly')}
        </label>
        <Input
          className="w-56"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('mediaAdmin.files.search')}
          aria-label={t('mediaAdmin.files.search')}
        />
      </div>

      {busy ? (
        <p className="text-muted-foreground text-sm">{t('mediaAdmin.instance.adding')}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {!list ? (
        <p className="text-muted-foreground text-sm">{t('mediaAdmin.loading')}</p>
      ) : list.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {scope === 'global' && !q ? t('mediaAdmin.instance.empty') : t('mediaAdmin.files.none')}
        </p>
      ) : view === 'list' ? (
        <ul className="divide-y rounded-lg border">
          {list.items.map((file, i) => (
            <li key={file.id} className="flex items-center gap-3 p-2">
              <Thumb file={file} className="size-14" onOpen={() => setPreviewAt(i)} />
              <div className="flex min-w-0 flex-1 flex-col">
                <FileTitle file={file} locale={i18n.language} />
                <FileMeta file={file} locale={i18n.language} />
              </div>
              {actions(file)}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.items.map((file, i) => (
            <li key={file.id} className="flex flex-col gap-1.5 rounded-lg border p-2">
              <Thumb file={file} className="aspect-video w-full" onOpen={() => setPreviewAt(i)} />
              <FileTitle file={file} locale={i18n.language} />
              <FileMeta file={file} locale={i18n.language} />
              {actions(file)}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} pages={pages} onChange={setPage} />
      {list && previewAt !== null && list.items[previewAt] ? (
        <PreviewDialog
          files={list.items}
          index={previewAt}
          onIndex={setPreviewAt}
          onClose={() => setPreviewAt(null)}
        />
      ) : null}

      {toDelete ? (
        <DeleteFileDialog
          file={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={async () => {
            setToDelete(null);
            await refreshAll();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={toWithdraw !== null}
        destructive
        title={t('mediaAdmin.instance.removeTitle')}
        description={t('mediaAdmin.instance.removeDescription')}
        confirmLabel={t('mediaAdmin.instance.remove')}
        onCancel={() => setToWithdraw(null)}
        onConfirm={() => {
          const file = toWithdraw;
          setToWithdraw(null);
          if (!file?.instanceId) return;
          setError(null);
          withdraw
            .mutateAsync({ id: file.instanceId })
            .then(refreshAll)
            .catch((err: unknown) =>
              setError(apiErrorText(err, t('mediaAdmin.instance.removeFailed'))),
            );
        }}
      />
    </section>
  );
}

/** A two- or three-way switch, as a row of pressed buttons. */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof ListIcon }>;
}) {
  return (
    <div role="group" aria-label={label} className="bg-muted flex gap-1 rounded-md p-1 text-sm">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            title={Icon ? o.label : undefined}
            className={
              value === o.value
                ? 'bg-background flex items-center gap-1 rounded px-2.5 py-1 font-medium shadow-sm'
                : 'text-muted-foreground flex items-center gap-1 rounded px-2.5 py-1'
            }
          >
            {Icon ? (
              <>
                <Icon className="size-4" />
                <span className="sr-only">{o.label}</span>
              </>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </div>
  );
}

/** A file's thumbnail; a click opens its preview. */
function Thumb({
  file,
  className,
  onOpen,
}: {
  file: MediaFilesPageDtoItemsItem;
  className: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const Icon = KIND_ICON[file.kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('mediaAdmin.preview.open', { name: file.name ?? file.mime })}
      className={`bg-muted hover:ring-primary focus-visible:ring-primary flex shrink-0 cursor-zoom-in items-center justify-center overflow-hidden rounded hover:ring-2 focus-visible:ring-2 focus-visible:outline-none ${className}`}
    >
      {file.kind === 'image' ? (
        <img src={file.url} alt="" loading="lazy" className="size-full object-cover" />
      ) : file.kind === 'video' ? (
        // The first frame, fetched with the metadata only.
        <video
          src={`${file.url}#t=0.1`}
          preload="metadata"
          muted
          className="size-full object-cover"
        />
      ) : (
        <Icon className="text-muted-foreground size-5" />
      )}
    </button>
  );
}

const duration = (ms: number | null) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A file seen in full: the image, or the video or sound playing, with what the
 * list says of it. Previous / next (and the arrow keys) walk the page shown.
 * A native `<dialog>` (`m-auto`: Tailwind's reset would pin it to a corner).
 */
function PreviewDialog({
  files,
  index,
  onIndex,
  onClose,
}: {
  files: MediaFilesPageDtoItemsItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('dashboard');
  const ref = useRef<HTMLDialogElement>(null);
  const file = files[index];
  const locale = i18n.language;

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    try {
      d.showModal();
    } catch {
      d.setAttribute('open', ''); // jsdom: showModal is not implemented
    }
  }, []);

  const go = (step: number) => {
    const next = index + step;
    if (next >= 0 && next < files.length) onIndex(next);
  };
  const owners = [...(file.inCatalog ? [t('mediaAdmin.global')] : []), ...file.owners];
  const facts: Array<[string, string | null]> = [
    [t('mediaAdmin.preview.format'), `${formatName(file.mime)} (${file.mime})`],
    [t('mediaAdmin.preview.dimensions'), formatDimensions(file.width, file.height)],
    [t('mediaAdmin.preview.duration'), duration(file.durationMs)],
    [t('mediaAdmin.preview.size'), formatBytes(file.sizeBytes, locale)],
    [t('mediaAdmin.preview.owners'), owners.join(', ')],
    [
      t('mediaAdmin.preview.usages'),
      file.quizCount > 0
        ? t('mediaAdmin.files.usedIn', { count: file.quizCount })
        : file.inHistory
          ? t('mediaAdmin.files.inHistory')
          : t('mediaAdmin.files.unused'),
    ],
    [t('mediaAdmin.preview.credit'), file.instanceCredit],
    [t('mediaAdmin.preview.added'), new Date(file.createdAt).toLocaleString(locale)],
  ];

  return (
    <dialog
      ref={ref}
      aria-label={file.name ?? file.mime}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1);
        if (e.key === 'ArrowRight') go(1);
      }}
      className="bg-background text-foreground m-auto w-[96vw] max-w-5xl rounded-lg border p-0 shadow-lg backdrop:bg-black/70"
    >
      <div className="flex max-h-[90dvh] flex-col gap-3 p-4 md:flex-row">
        <div className="bg-muted flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-md">
          {file.kind === 'image' ? (
            <img
              key={file.id}
              src={file.url}
              alt={file.name ?? ''}
              className="max-h-[75dvh] max-w-full object-contain"
            />
          ) : file.kind === 'video' ? (
            <video key={file.id} src={file.url} controls className="max-h-[75dvh] max-w-full" />
          ) : (
            <div className="flex w-full flex-col items-center gap-4 p-6">
              <WaveformPlayer
                key={file.id}
                src={file.url}
                peaks={file.peaks}
                durationMs={file.durationMs}
              />
            </div>
          )}
        </div>
        <aside className="flex w-full shrink-0 flex-col gap-3 md:w-72">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold break-all">
              {file.name ?? new Date(file.createdAt).toLocaleDateString(locale)}
            </h2>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              <X className="size-4" />
              <span className="sr-only">{t('mediaAdmin.preview.close')}</span>
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {facts
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
          </dl>
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline-offset-2 hover:underline"
          >
            {t('mediaAdmin.preview.openFile')}
          </a>
          <div className="mt-auto flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index === 0}
              onClick={() => go(-1)}
            >
              <ChevronLeft className="size-4" />
              {t('mediaAdmin.preview.previous')}
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              {index + 1} / {files.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={index >= files.length - 1}
              onClick={() => go(1)}
            >
              {t('mediaAdmin.preview.next')}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </aside>
      </div>
    </dialog>
  );
}

function FileTitle({ file, locale }: { file: MediaFilesPageDtoItemsItem; locale: string }) {
  return (
    <span className="truncate text-sm font-medium" title={file.name ?? undefined}>
      {file.name ?? new Date(file.createdAt).toLocaleDateString(locale)}
    </span>
  );
}

/** Kind, size in pixels and bytes, and who owns it — "Global" for the instance's. */
function FileMeta({ file, locale }: { file: MediaFilesPageDtoItemsItem; locale: string }) {
  const { t } = useTranslation('dashboard');
  const owners = [...(file.inCatalog ? [t('mediaAdmin.global')] : []), ...file.owners];
  return (
    <span className="text-muted-foreground truncate text-xs">
      {[
        formatName(file.mime),
        formatDimensions(file.width, file.height),
        formatBytes(file.sizeBytes, locale),
        owners.join(', '),
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

/**
 * What can be done to a file. *All*: its usages, putting it among the global
 * media, deleting it. *Global*: its credit, withdrawing it (the hosts' copies stay).
 */
function FileActions({
  file,
  scope,
  onDelete,
  onWithdraw,
  onChanged,
  onError,
}: {
  file: MediaFilesPageDtoItemsItem;
  scope: Scope;
  onDelete: () => void;
  onWithdraw: () => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation('dashboard');
  const add = useMediaAdminControllerAddFile();
  const name = file.name ?? file.mime;
  if (scope === 'global') {
    return (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {file.instanceId ? (
          <CreditInput id={file.instanceId} initial={file.instanceCredit ?? ''} onError={onError} />
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onWithdraw}>
          {t('mediaAdmin.instance.remove')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
      {file.legacy ? <Badge variant="muted">{t('mediaAdmin.files.legacy')}</Badge> : null}
      <span className="text-muted-foreground">
        {file.quizCount > 0
          ? t('mediaAdmin.files.usedIn', { count: file.quizCount })
          : file.inHistory
            ? t('mediaAdmin.files.inHistory')
            : t('mediaAdmin.files.unused')}
      </span>
      {file.inCatalog ? null : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={add.isPending}
          title={t('mediaAdmin.files.addToCatalog')}
          aria-label={t('mediaAdmin.files.addToCatalogNamed', { name })}
          onClick={() => {
            onError(null);
            add
              .mutateAsync({ id: file.id })
              .then(onChanged)
              .catch((err: unknown) =>
                onError(apiErrorText(err, t('mediaAdmin.instance.addFailed'))),
              );
          }}
        >
          <Library className="size-4" />
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        aria-label={t('mediaAdmin.files.delete', { name })}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

/** A global media's credit, saved on blur — recorded as saved once the server has it. */
function CreditInput({
  id,
  initial,
  onError,
}: {
  id: string;
  initial: string;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation('dashboard');
  const setCredit = useMediaAdminControllerSetCredit();
  const [credit, setValue] = useState(initial);
  const saved = useRef(initial);
  return (
    <Input
      className="h-7 w-64 max-w-full min-w-0 text-xs"
      value={credit}
      maxLength={300}
      placeholder={t('mediaAdmin.instance.credit')}
      aria-label={t('mediaAdmin.instance.credit')}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (credit === saved.current) return;
        onError(null);
        setCredit
          .mutateAsync({ id, data: { credit } })
          .then(() => {
            saved.current = credit;
          })
          .catch((err: unknown) => onError(apiErrorText(err, t('mediaAdmin.instance.saveFailed'))));
      }}
    />
  );
}

/** Says what deleting a file breaks — quizzes of any owner, past results — before doing it. */
function DeleteFileDialog({
  file,
  onClose,
  onDeleted,
}: {
  file: MediaFilesPageDtoItemsItem;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation('dashboard');
  const usages = useMediaAdminControllerUsages(file.id);
  const remove = useMediaAdminControllerDeleteFile();
  const [error, setError] = useState<string | null>(null);
  const info = usages.data?.data;

  const confirm = async () => {
    setError(null);
    try {
      await remove.mutateAsync({ id: file.id });
      await onDeleted();
    } catch (err) {
      setError(apiErrorText(err, t('mediaAdmin.delete.failed')));
    }
  };

  return (
    <ConfirmDialog
      open
      destructive
      title={t('mediaAdmin.delete.title')}
      description={`${file.name ?? file.mime} · ${formatBytes(file.sizeBytes, i18n.language)}`}
      confirmLabel={t('mediaAdmin.delete.confirm')}
      onCancel={onClose}
      onConfirm={() => void (info?.playing ? undefined : confirm())}
    >
      {!info ? (
        <p className="text-muted-foreground text-sm">{t('mediaAdmin.loading')}</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {info.playing ? (
            <p className="text-destructive">{t('mediaAdmin.delete.playing')}</p>
          ) : null}
          {file.inCatalog ? (
            <p className="text-amber-700 dark:text-amber-400">{t('mediaAdmin.delete.inCatalog')}</p>
          ) : null}
          {info.quizzes.length > 0 || info.archivedSessions > 0 ? (
            <>
              <p>{t('mediaAdmin.delete.usedBy')}</p>
              <ul className="text-muted-foreground list-disc pl-5">
                {info.quizzes.map((quiz) => (
                  <li key={quiz.id}>
                    {t('mediaAdmin.delete.quiz', { title: quiz.title, owner: quiz.owner })}
                  </li>
                ))}
                {info.archivedSessions > 0 ? (
                  <li>{t('mediaAdmin.delete.sessions', { count: info.archivedSessions })}</li>
                ) : null}
              </ul>
              <p className="text-muted-foreground">
                {[
                  info.quizzes.length > 0 ? t('mediaAdmin.delete.quizzesLose') : null,
                  info.archivedSessions > 0 ? t('mediaAdmin.delete.resultsLose') : null,
                  t('mediaAdmin.delete.everyCopy'),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{t('mediaAdmin.delete.unused')}</p>
          )}
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </ConfirmDialog>
  );
}

function AddButton({
  kind,
  disabled,
  onFile,
}: {
  kind: MediaKind;
  disabled: boolean;
  onFile: (file: File | undefined) => void;
}) {
  const { t } = useTranslation('dashboard');
  const input = useRef<HTMLInputElement>(null);
  const ACCEPT = { image: 'image/*', video: 'video/*,.mkv,.mov', audio: 'audio/*' };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Plus className="size-4" />
        {t(`mediaAdmin.instance.add.${kind}`)}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT[kind]}
        aria-label={t(`mediaAdmin.instance.add.${kind}`)}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );
}
