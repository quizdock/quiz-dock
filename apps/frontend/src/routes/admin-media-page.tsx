import {
  AlertTriangle,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Library,
  List as ListIcon,
  Music,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
  ImagePlus,
  Search,
  SearchX,
  MousePointerClick,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Segmented } from '@/components/ui/segmented';
import { FilterField } from '@/components/ui/filter-field';
import { Select } from '@/components/ui/select';
import { WaveformPlayer } from '@/components/waveform-player';
import { formatDimensions } from '@/lib/dimensions';
import { formatAgo, formatBytes } from '@/lib/format';
import { readyForUpload } from '@/lib/media-pipeline';
import { useStoredView } from '@/lib/use-stored-view';
import { type MediaKind, MediaCheckError } from '@/lib/media-prepare';
import { errorText } from '../api/error-text';
import { apiErrorText } from '../api/http';
import {
  getMediaAdminControllerUsagesQueryOptions,
  mediaAdminControllerAddFile,
  mediaAdminControllerAddUpload,
  mediaAdminControllerDeleteFile,
  mediaAdminControllerRemove,
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
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { Drawer } from '@/components/ui/drawer';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { getDemo } from '../config';
import { useSessionState } from '@/lib/use-session-state';

/**
 * A page's length, typed by the administrator within what the server serves (100).
 * 24 by default: a multiple of 2, 3 and 4, so a grid's last line is never left short.
 */
const PAGE_SIZE = { min: 1, max: 100, default: 24 };
const validPageSize = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= PAGE_SIZE.min && (v as number) <= PAGE_SIZE.max;
/** The owner key of the instance's own media (#62). */
const GLOBAL = 'global';
/** The files filter's "every owner but global". */
const HOSTS = 'hosts';

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
  // Inside the administration's layout: its title, its width, its admin-only check.
  return (
    <div className="flex flex-col gap-6">
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

  if (overview.isError && !data) return <LoadFailed error={overview.error} />;
  if (!data) return <Spinner label={t('mediaAdmin.loading')} showLabel className="text-sm" />;
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
          <p className="text-warning-text flex items-start gap-1.5 text-sm">
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
  const [view, setView] = useStoredView('quizdock.adminMedia.view');
  const [kind, setKind] = useState('');
  const [ownerId, setOwnerId] = useState('');
  // One menu for the files to look at closely: those nothing uses, or in an older format.
  const [show, setShow] = useState<'' | 'unused' | 'legacy'>('');
  const [sort, setSort] = useState<'size' | 'usage' | 'recent'>('size');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useSessionState(
    'quizdock.adminMedia.pageSize',
    PAGE_SIZE.default,
    validPageSize,
  );
  // What is being typed; the page follows once it is a length the server serves.
  const [pageSizeText, setPageSizeText] = useState(String(pageSize));
  // The files ticked for an action on all of them at once, on the page shown.
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [bulk, setBulk] = useState<'delete' | 'withdraw' | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // A public demo: the files are shown, nothing is added, ticked or deleted here.
  const readOnly = !!getDemo();
  const [toDelete, setToDelete] = useState<MediaFilesPageDtoItemsItem | null>(null);
  const [toWithdraw, setToWithdraw] = useState<MediaFilesPageDtoItemsItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isWide = useMediaQuery('(min-width: 1024px)');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshAll = useRefreshAll();
  const withdraw = useMediaAdminControllerRemove();

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [scope, kind, ownerId, show, sort, q, pageSize]);
  useEffect(() => setChecked(new Set()), [scope, kind, ownerId, show, sort, q, page, pageSize]);

  const params: MediaAdminControllerFilesParams = {
    sort,
    offset: (page - 1) * pageSize,
    limit: pageSize,
    ...(kind ? { kind: kind as MediaAdminControllerFilesParams['kind'] } : {}),
    ...(scope === 'global' ? { ownerId: GLOBAL } : ownerId ? { ownerId } : {}),
    ...(show === 'legacy' ? { legacy: 'true' as const } : {}),
    ...(show === 'unused' ? { unused: 'true' as const } : {}),
    ...(q ? { q } : {}),
  };
  const files = useMediaAdminControllerFiles(params);
  const list = files.data?.data;
  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / pageSize));
  const chosen = (list?.items ?? []).filter((f) => checked.has(f.id));
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = !!list?.items.length && chosen.length === list.items.length;

  // One action on every file ticked, one after the other (each its own audit line);
  // those that fail are named after, the others done.
  const runBulk = async (
    targets: MediaFilesPageDtoItemsItem[],
    act: (file: MediaFilesPageDtoItemsItem) => Promise<unknown>,
    failedText: string,
  ) => {
    if (!targets.length) return;
    setError(null);
    setBusy(true);
    const failed: string[] = [];
    try {
      for (const [i, file] of targets.entries()) {
        setProgress({ done: i, total: targets.length });
        try {
          await act(file);
        } catch (err) {
          failed.push(`${file.name ?? file.mime} — ${apiErrorText(err, failedText)}`);
        }
      }
      setChecked(new Set());
      await refreshAll();
    } finally {
      setProgress(null);
      setBusy(false);
      if (failed.length) setError(failed.join('\n'));
    }
  };

  // Several files at once (dropped or chosen), one after the other: each its kind from its
  // type, converted in the browser like any; the list refreshed once, at the end.
  const uploadAll = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    setBusy(true);
    const failed: string[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setProgress({ done: i, total: files.length });
        const uploadKind = kindOfFile(file);
        try {
          if (!uploadKind) throw new Error(t('mediaAdmin.instance.unsupported'));
          const ready = await readyForUpload(file, uploadKind);
          // An original already among the admin's or the global media is added, not uploaded again.
          if ('reuse' in ready) await mediaAdminControllerAddFile(ready.reuse.id);
          else
            await mediaAdminControllerAddUpload({
              file: ready.file,
              ...ready.prepared.fields,
              sourceSha256: ready.sourceSha256,
            });
        } catch (err) {
          const why =
            err instanceof MediaCheckError
              ? errorText(err.code, err.params)
              : err instanceof Error && !uploadKind
                ? err.message
                : apiErrorText(err, t('mediaAdmin.instance.addFailed'));
          failed.push(`${file.name} — ${why}`);
        }
      }
      await refreshAll();
    } finally {
      setProgress(null);
      setBusy(false);
      if (failed.length) setError(failed.join('\n'));
    }
  };

  const selected = list?.items.find((f) => f.id === selectedId) ?? null;
  const detail = selected ? (
    <FileDetail
      file={selected}
      onDelete={() => setToDelete(selected)}
      onWithdraw={() => setToWithdraw(selected)}
      onChanged={() => void refreshAll()}
      onError={setError}
      // The sheet has its own title and close button.
      onClose={isWide ? () => setSelectedId(null) : undefined}
    />
  ) : null;
  const isSelected = (file: MediaFilesPageDtoItemsItem) => file.id === selectedId;

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
        <>
          <p className="text-muted-foreground text-sm">{t('mediaAdmin.instance.help')}</p>
          {readOnly ? null : (
            <DropZone disabled={busy} progress={progress} onFiles={(f) => void uploadAll(f)} />
          )}
        </>
      ) : null}

      {/* The filters and the actions stay in reach while the files scroll. */}
      <div className="bg-background sticky top-0 z-20 flex flex-col gap-2 border-b py-2">
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label={t('mediaAdmin.files.kind')}>
            <Select
              className="w-full sm:w-36"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">{t('mediaAdmin.files.allKinds')}</option>
              {(['image', 'video', 'audio'] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`mediaAdmin.kind.${k}`)}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label={t('mediaAdmin.files.show')}>
            <Select
              className="w-full sm:w-40"
              value={show}
              onChange={(e) => setShow(e.target.value as typeof show)}
            >
              <option value="">{t('mediaAdmin.files.showAll')}</option>
              <option value="unused">{t('mediaAdmin.files.showUnused')}</option>
              <option value="legacy">{t('mediaAdmin.files.legacyOnly')}</option>
            </Select>
          </FilterField>
          {scope === 'all' ? (
            <FilterField label={t('mediaAdmin.files.owner')}>
              <Select
                className="w-full sm:w-44"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">{t('mediaAdmin.files.allOwners')}</option>
                {/* The hosts' files only: those the instance alone provides left out. */}
                <option value={HOSTS}>{t('mediaAdmin.files.allHosts')}</option>
                {owners.map((o) => (
                  <option key={o.ownerId} value={o.ownerId}>
                    {o.displayName}
                  </option>
                ))}
              </Select>
            </FilterField>
          ) : null}
          <FilterField label={t('mediaAdmin.files.sort')}>
            <Select
              className="w-full sm:w-44"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="size">{t('mediaAdmin.files.bySize')}</option>
              <option value="usage">{t('mediaAdmin.files.byUsage')}</option>
              <option value="recent">{t('mediaAdmin.files.byDate')}</option>
            </Select>
          </FilterField>
          {/* A search field, as on the other administration lists: its icon, its clear button. */}
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">{t('mediaAdmin.files.search')}</span>
            <Search
              aria-hidden
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('mediaAdmin.files.search')}
            />
          </label>
          <FilterField label={t('mediaAdmin.files.perPage')}>
            <Input
              type="number"
              inputMode="numeric"
              className="w-full sm:w-20"
              min={PAGE_SIZE.min}
              max={PAGE_SIZE.max}
              value={pageSizeText}
              onChange={(e) => {
                setPageSizeText(e.target.value);
                const n = Number(e.target.value);
                if (validPageSize(n)) setPageSize(n);
              }}
              // Out of bounds or empty: back to the length in use.
              onBlur={() => setPageSizeText(String(pageSize))}
            />
          </FilterField>
        </div>
        {readOnly ? null : (
          <div className="flex min-h-8 flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && !allChecked;
                }}
                disabled={!list?.items.length || busy}
                onChange={() =>
                  setChecked(allChecked ? new Set() : new Set(list?.items.map((f) => f.id)))
                }
              />
              {chosen.length
                ? t('mediaAdmin.bulk.selected', { count: chosen.length })
                : t('mediaAdmin.bulk.selectPage')}
            </label>
            {chosen.length && scope === 'all' ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || chosen.every((f) => f.inCatalog)}
                  onClick={() =>
                    void runBulk(
                      chosen.filter((f) => !f.inCatalog),
                      (f) => mediaAdminControllerAddFile(f.id),
                      t('mediaAdmin.bulk.promoteFailed'),
                    )
                  }
                >
                  <Library className="size-4" />
                  {t('mediaAdmin.bulk.promote')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive-outline"
                  disabled={busy}
                  onClick={() => setBulk('delete')}
                >
                  <Trash2 className="size-4" />
                  {t('mediaAdmin.bulk.delete')}
                </Button>
              </>
            ) : null}
            {chosen.length && scope === 'global' ? (
              <Button
                type="button"
                size="sm"
                variant="destructive-outline"
                disabled={busy}
                onClick={() => setBulk('withdraw')}
              >
                <X className="size-4" />
                {t('mediaAdmin.bulk.withdraw')}
              </Button>
            ) : null}
            {progress && scope === 'all' ? (
              <span aria-live="polite" className="text-muted-foreground">
                {t('mediaAdmin.bulk.progress', { done: progress.done + 1, total: progress.total })}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm whitespace-pre-line">
          {error}
        </p>
      ) : null}
      {files.isError && !list ? (
        <LoadFailed error={files.error} />
      ) : !list ? (
        <Spinner label={t('mediaAdmin.loading')} showLabel className="text-sm" />
      ) : list.items.length === 0 ? (
        scope === 'global' && !q ? (
          <EmptyState icon={ImagePlus}>{t('mediaAdmin.instance.empty')}</EmptyState>
        ) : (
          <EmptyState icon={SearchX}>{t('mediaAdmin.files.none')}</EmptyState>
        )
      ) : (
        // The list, and beside it the file chosen: what it is, where it is used,
        // what can be done to it (a bottom sheet on a narrow screen).
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {view === 'list' ? (
            <ul className="divide-y rounded-lg border">
              {list.items.map((file) => (
                <li key={file.id} className="flex items-center pl-2">
                  {readOnly ? null : (
                    <TickBox file={file} checked={checked.has(file.id)} onToggle={toggle} />
                  )}
                  <FileRow selected={isSelected(file)} onSelect={() => setSelectedId(file.id)}>
                    <Thumb file={file} className="size-14" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <FileTitle file={file} locale={i18n.language} />
                      <FileMeta file={file} locale={i18n.language} />
                    </div>
                    <FileUsage file={file} />
                  </FileRow>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {list.items.map((file) => (
                <li key={file.id} className="relative">
                  {readOnly ? null : (
                    <TickBox
                      file={file}
                      checked={checked.has(file.id)}
                      onToggle={toggle}
                      className="bg-background/90 absolute top-2 left-2 z-10 rounded p-1"
                    />
                  )}
                  <FileRow
                    selected={isSelected(file)}
                    onSelect={() => setSelectedId(file.id)}
                    className="flex-col items-stretch rounded-lg border"
                  >
                    <Thumb file={file} className="aspect-video w-full" />
                    <FileTitle file={file} locale={i18n.language} />
                    <FileMeta file={file} locale={i18n.language} />
                    <FileUsage file={file} />
                  </FileRow>
                </li>
              ))}
            </ul>
          )}
          {isWide ? (
            <aside aria-label={selected ? (selected.name ?? selected.mime) : undefined}>
              {detail ? (
                <div className="sticky top-4 rounded-lg border p-4">{detail}</div>
              ) : (
                <EmptyState icon={MousePointerClick} className="sticky top-4">
                  {t('mediaAdmin.detail.empty')}
                </EmptyState>
              )}
            </aside>
          ) : (
            <Drawer
              open={!!selected}
              onClose={() => setSelectedId(null)}
              title={selected?.name ?? undefined}
            >
              {detail}
            </Drawer>
          )}
        </div>
      )}
      <Pagination page={page} pages={pages} onChange={setPage} />
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
      {bulk === 'delete' ? (
        <BulkDeleteDialog
          files={chosen}
          onClose={() => setBulk(null)}
          onConfirm={(deletable) => {
            setBulk(null);
            void runBulk(
              deletable,
              (f) => mediaAdminControllerDeleteFile(f.id),
              t('mediaAdmin.delete.failed'),
            );
          }}
        />
      ) : null}
      <ConfirmDialog
        open={bulk === 'withdraw'}
        destructive
        title={t('mediaAdmin.bulk.withdrawTitle', { count: chosen.length })}
        description={t('mediaAdmin.instance.removeDescription')}
        confirmLabel={t('mediaAdmin.instance.remove')}
        onCancel={() => setBulk(null)}
        onConfirm={() => {
          setBulk(null);
          void runBulk(
            chosen.filter((f) => f.instanceId),
            (f) => mediaAdminControllerRemove(f.instanceId as string),
            t('mediaAdmin.instance.removeFailed'),
          );
        }}
      />
    </section>
  );
}

/** A file ticked for an action on several at once; named after it. */
function TickBox({
  file,
  checked,
  onToggle,
  className,
}: {
  file: MediaFilesPageDtoItemsItem;
  checked: boolean;
  onToggle: (id: string) => void;
  className?: string;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <label className={cn('flex shrink-0 cursor-pointer items-center', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(file.id)}
        aria-label={t('mediaAdmin.bulk.tick', { name: file.name ?? file.mime })}
      />
    </label>
  );
}

/**
 * Deleting the files ticked: what it breaks, all of them together, before doing it.
 * A file a room is playing is left out, said so; the others go.
 */
function BulkDeleteDialog({
  files,
  onClose,
  onConfirm,
}: {
  files: MediaFilesPageDtoItemsItem[];
  onClose: () => void;
  onConfirm: (deletable: MediaFilesPageDtoItemsItem[]) => void;
}) {
  const { t, i18n } = useTranslation('dashboard');
  const usages = useQueries({
    queries: files.map((f) => getMediaAdminControllerUsagesQueryOptions(f.id)),
  });
  const ready = usages.every((u) => u.data);
  const infos = usages.map((u) => u.data?.data);
  const playing = files.filter((_, i) => infos[i]?.playing);
  const deletable = files.filter((_, i) => infos[i] && !infos[i].playing);
  const quizzes = new Map<string, { title: string; owner: string }>();
  let sessions = 0;
  infos.forEach((info) => {
    info?.quizzes.forEach((q) => quizzes.set(q.id, { title: q.title, owner: q.owner }));
    sessions += info?.archivedSessions ?? 0;
  });
  const bytes = deletable.reduce((sum, f) => sum + f.sizeBytes, 0);
  return (
    <ConfirmDialog
      open
      destructive
      title={t('mediaAdmin.bulk.deleteTitle', { count: deletable.length })}
      description={formatBytes(bytes, i18n.language)}
      confirmLabel={t('mediaAdmin.delete.confirm')}
      onCancel={onClose}
      confirmDisabled={!ready || deletable.length === 0}
      onConfirm={() => onConfirm(deletable)}
    >
      {!ready ? (
        <Spinner label={t('mediaAdmin.loading')} showLabel className="text-sm" />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {playing.length ? (
            <p className="text-destructive">
              {t('mediaAdmin.bulk.playing', {
                count: playing.length,
                names: playing.map((f) => f.name ?? f.mime).join(', '),
              })}
            </p>
          ) : null}
          {deletable.some((f) => f.inCatalog) ? (
            <p className="text-warning-text">{t('mediaAdmin.delete.inCatalog')}</p>
          ) : null}
          {quizzes.size > 0 || sessions > 0 ? (
            <>
              <p>{t('mediaAdmin.delete.usedBy')}</p>
              <ul className="text-muted-foreground max-h-40 list-disc overflow-y-auto pl-5">
                {[...quizzes.entries()].map(([id, quiz]) => (
                  <li key={id}>{t('mediaAdmin.delete.quiz', quiz)}</li>
                ))}
                {sessions > 0 ? (
                  <li>{t('mediaAdmin.delete.sessions', { count: sessions })}</li>
                ) : null}
              </ul>
              <p className="text-muted-foreground">
                {[
                  quizzes.size > 0 ? t('mediaAdmin.delete.quizzesLose') : null,
                  sessions > 0 ? t('mediaAdmin.delete.resultsLose') : null,
                  t('mediaAdmin.delete.everyCopy'),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{t('mediaAdmin.bulk.unused')}</p>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}

/** A file's thumbnail. */
function Thumb({ file, className }: { file: MediaFilesPageDtoItemsItem; className: string }) {
  const Icon = KIND_ICON[file.kind];
  return (
    <span
      className={`bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded ${className}`}
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
    </span>
  );
}

/**
 * A file in the list: chosen with a click, shown beside it. Named by what it
 * shows — its name, kind, size, owners, usage —, not by a label hiding them.
 */
function FileRow({
  selected,
  onSelect,
  className,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 p-2 text-left',
        selected ? 'bg-accent' : 'hover:bg-accent/50',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Where a file is used, at a glance; an older format said so. */
function FileUsage({ file }: { file: MediaFilesPageDtoItemsItem }) {
  const { t } = useTranslation('dashboard');
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
      {file.legacy ? <Badge variant="muted">{t('mediaAdmin.files.legacy')}</Badge> : null}
      <span className="text-muted-foreground">
        {file.quizCount > 0
          ? t('mediaAdmin.files.usedIn', { count: file.quizCount })
          : file.inHistory
            ? t('mediaAdmin.files.inHistory')
            : t('mediaAdmin.files.unused')}
      </span>
    </span>
  );
}

const duration = (ms: number | null) => {
  if (!ms) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The file chosen: seen in full (the image, the video or the sound playing),
 * what it is, every quiz that uses it, its credit when it is one of the global
 * media, and all that can be done to it.
 */
function FileDetail({
  file,
  onDelete,
  onWithdraw,
  onChanged,
  onError,
  onClose,
}: {
  file: MediaFilesPageDtoItemsItem;
  onDelete: () => void;
  onWithdraw: () => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
  onClose?: () => void;
}) {
  const { t, i18n } = useTranslation('dashboard');
  const locale = i18n.language;
  const usages = useMediaAdminControllerUsages(file.id);
  const info = usages.data?.data;
  const add = useMediaAdminControllerAddFile();
  const owners = [...(file.inCatalog ? [t('mediaAdmin.global')] : []), ...file.owners];
  const facts: Array<[string, string | null]> = [
    [t('mediaAdmin.preview.format'), `${formatName(file.mime)} (${file.mime})`],
    [t('mediaAdmin.preview.dimensions'), formatDimensions(file.width, file.height)],
    [t('mediaAdmin.preview.duration'), duration(file.durationMs)],
    [t('mediaAdmin.preview.size'), formatBytes(file.sizeBytes, locale)],
    [t('mediaAdmin.preview.owners'), owners.join(', ')],
    [t('mediaAdmin.preview.added'), new Date(file.createdAt).toLocaleString(locale)],
  ];

  return (
    <div className="flex flex-col gap-3">
      {onClose ? (
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold break-all">
            {file.name ?? new Date(file.createdAt).toLocaleDateString(locale)}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X className="size-4" />
            <span className="sr-only">{t('mediaAdmin.preview.close')}</span>
          </Button>
        </div>
      ) : null}
      <div className="bg-muted flex min-h-32 items-center justify-center overflow-hidden rounded-md">
        {file.kind === 'image' ? (
          <img
            key={file.id}
            src={file.url}
            alt={file.name ?? ''}
            className="max-h-72 max-w-full object-contain"
          />
        ) : file.kind === 'video' ? (
          <video key={file.id} src={file.url} controls className="max-h-72 max-w-full" />
        ) : (
          <div className="flex w-full flex-col items-center gap-4 p-4">
            <WaveformPlayer
              key={file.id}
              src={file.url}
              peaks={file.peaks}
              durationMs={file.durationMs}
            />
          </div>
        )}
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

      <section className="flex flex-col gap-1 border-t pt-3 text-sm">
        <h3 className="font-medium">{t('mediaAdmin.preview.usages')}</h3>
        {!info ? (
          <Spinner className="text-sm" />
        ) : info.quizzes.length === 0 && info.archivedSessions === 0 ? (
          <p className="text-muted-foreground">{t('mediaAdmin.delete.unused')}</p>
        ) : (
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
        )}
        {info?.playing ? (
          <p className="text-warning-text">{t('mediaAdmin.delete.playing')}</p>
        ) : null}
      </section>

      {file.instanceId ? (
        <section className="flex flex-col gap-1 border-t pt-3">
          <label htmlFor={`credit-${file.instanceId}`} className="text-sm font-medium">
            {t('mediaAdmin.preview.credit')}
          </label>
          {/* Keyed by file: another file's credit never shows in this one's field. */}
          <CreditInput
            key={file.instanceId}
            id={file.instanceId}
            initial={file.instanceCredit ?? ''}
            onError={onError}
          />
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t pt-3">
        {file.inCatalog && file.instanceId ? (
          <Button type="button" size="sm" variant="outline" onClick={onWithdraw}>
            {t('mediaAdmin.instance.remove')}
          </Button>
        ) : !file.inCatalog ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={add.isPending}
            aria-label={t('mediaAdmin.files.addToCatalogNamed', { name: file.name ?? file.mime })}
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
            {t('mediaAdmin.files.addToCatalog')}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          aria-label={t('mediaAdmin.files.delete', { name: file.name ?? file.mime })}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
          {t('mediaAdmin.delete.confirm')}
        </Button>
      </div>
    </div>
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
      id={`credit-${id}`}
      className="w-full min-w-0"
      value={credit}
      maxLength={300}
      placeholder={t('mediaAdmin.instance.credit')}
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
      // Greyed while a room plays the file, with the reason said below (never a dead click).
      confirmDisabled={!info || info.playing || remove.isPending}
      onConfirm={() => void confirm()}
    >
      {!info ? (
        <Spinner label={t('mediaAdmin.loading')} showLabel className="text-sm" />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {info.playing ? (
            <p className="text-destructive">{t('mediaAdmin.delete.playing')}</p>
          ) : null}
          {file.inCatalog ? (
            <p className="text-warning-text">{t('mediaAdmin.delete.inCatalog')}</p>
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

/** What a file is, from its type (or a video container the browser may not name). */
function kindOfFile(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/') || /\.(mkv|mov)$/i.test(file.name)) return 'video';
  return null;
}

/**
 * Where the global media come in: files dropped on it, or chosen with a click (several
 * at once, images, videos and sounds mixed). While they go, how far they are.
 */
function DropZone({
  disabled,
  progress,
  onFiles,
}: {
  disabled: boolean;
  progress: { done: number; total: number } | null;
  onFiles: (files: File[]) => void;
}) {
  const { t } = useTranslation('dashboard');
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles([...e.dataTransfer.files]);
      }}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm',
        over ? 'border-primary bg-primary/5' : 'border-border',
      )}
    >
      <Upload className="text-muted-foreground size-6" aria-hidden />
      {progress ? (
        <p aria-live="polite">
          {t('mediaAdmin.instance.sending', { done: progress.done + 1, total: progress.total })}
        </p>
      ) : (
        <>
          <p>{t('mediaAdmin.instance.drop')}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <Plus className="size-4" />
            {t('mediaAdmin.instance.choose')}
          </Button>
        </>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/*,video/*,.mkv,.mov,audio/*"
        aria-label={t('mediaAdmin.instance.choose')}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
