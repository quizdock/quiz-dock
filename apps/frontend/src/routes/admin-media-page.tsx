import { AlertTriangle, Film, Image as ImageIcon, Music, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { formatAgo, formatBytes } from '@/lib/format';
import { apiErrorText } from '../api/http';
import {
  useMediaAdminControllerDeleteFile,
  useMediaAdminControllerFiles,
  useMediaAdminControllerOverview,
  useMediaAdminControllerSweep,
  useMediaAdminControllerUsages,
} from '../api/generated/admin/admin';
import type {
  MediaAdminControllerFilesParams,
  MediaFilesPageDtoItemsItem,
} from '../api/generated/model';
import { useRole } from '../auth/use-role';

const PAGE_SIZE = 25;

/** A format as people know it: `audio/mpeg` is an MP3. */
const formatName = (mime: string) =>
  ({ 'audio/mpeg': 'MP3', 'image/jpeg': 'JPEG', 'image/svg+xml': 'SVG' })[mime] ??
  (mime.split('/')[1] ?? mime).toUpperCase();
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
      await overview.refetch();
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
            {data.byOwner.map((o) => `${o.displayName} ${bytes(o.bytes)}`).join(' · ')}
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

function Files() {
  const { t, i18n } = useTranslation('dashboard');
  const overview = useMediaAdminControllerOverview();
  const owners = overview.data?.data.byOwner ?? [];
  const [kind, setKind] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [sort, setSort] = useState<'size' | 'usage' | 'recent'>('size');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<MediaFilesPageDtoItemsItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [kind, ownerId, legacy, sort, q]);

  const params: MediaAdminControllerFilesParams = {
    sort,
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    ...(kind ? { kind: kind as MediaAdminControllerFilesParams['kind'] } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(legacy ? { legacy: 'true' as const } : {}),
    ...(q ? { q } : {}),
  };
  const files = useMediaAdminControllerFiles(params);
  const list = files.data?.data;
  const pages = Math.max(1, Math.ceil((list?.total ?? 0) / PAGE_SIZE));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('mediaAdmin.files.title')}</h2>
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

      {!list ? (
        <p className="text-muted-foreground text-sm">{t('mediaAdmin.loading')}</p>
      ) : list.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('mediaAdmin.files.none')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.items.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              locale={i18n.language}
              onDelete={() => setToDelete(file)}
            />
          ))}
        </ul>
      )}
      <Pagination page={page} pages={pages} onChange={setPage} />

      {toDelete ? (
        <DeleteFileDialog
          file={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={async () => {
            setToDelete(null);
            await Promise.all([files.refetch(), overview.refetch()]);
          }}
        />
      ) : null}
    </section>
  );
}

function FileRow({
  file,
  locale,
  onDelete,
}: {
  file: MediaFilesPageDtoItemsItem;
  locale: string;
  onDelete: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const Icon = KIND_ICON[file.kind];
  return (
    <li className="flex items-center gap-3 p-2">
      <span className="bg-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded">
        {file.kind === 'image' ? (
          <img src={file.url} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Icon className="text-muted-foreground size-5" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {file.name ?? new Date(file.createdAt).toLocaleDateString(locale)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {file.mime} · {formatBytes(file.sizeBytes, locale)} · {file.owners.join(', ')}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 text-xs">
        {file.legacy ? <Badge variant="muted">{t('mediaAdmin.files.legacy')}</Badge> : null}
        <span className="text-muted-foreground">
          {file.quizCount > 0
            ? t('mediaAdmin.files.usedIn', { count: file.quizCount })
            : file.inHistory
              ? t('mediaAdmin.files.inHistory')
              : t('mediaAdmin.files.unused')}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={t('mediaAdmin.files.delete', { name: file.name ?? file.mime })}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
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
