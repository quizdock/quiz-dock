import { SLUG_MAX_LENGTH, toSlug } from '@quiz-dock/contracts';
import { AlertTriangle, Check, PackageCheck, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { downloadFile } from '../api/download';
import { useQuizzesControllerPublicationReport } from '../api/generated/quizzes/quizzes';
import type { PublicationReportDto } from '../api/generated/model';
import { apiErrorText } from '../api/http';
import { languageName, licenseName } from '@/lib/quiz-terms';

/**
 * "Export for publication" (#21): next to the ordinary export, which stays a
 * neutral backup. The dialog checks the quiz against what a community store
 * accepts, has the author confirm the short name the store knows it by, then
 * downloads `<slug>.quizdock.zip`. Refusals happen here, in words, rather than
 * as a robot's red cross after the upload.
 */
export function PublicationExport({ quizId }: { quizId: string }) {
  const { t } = useTranslation('editor');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <PackageCheck className="size-4" />
        {t('publication.open')}
      </Button>
      {open ? <PublicationDialog quizId={quizId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PublicationDialog({ quizId, onClose }: { quizId: string; onClose: () => void }) {
  const { t } = useTranslation('editor');
  // Read fresh every time the dialog opens: the settings may have just changed.
  const { data, isError } = useQuizzesControllerPublicationReport(quizId, {
    query: { staleTime: 0, gcTime: 0 },
  });
  const report = data?.data;
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (report) setSlug(report.slug);
  }, [report]);

  const blocked = !report || report.issues.some((issue) => issue.level === 'block');
  const slugValid = slug !== '' && slug === toSlug(slug, SLUG_MAX_LENGTH);

  const onDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(`/api/v1/quizzes/${quizId}/publication/export`, `${slug}.quizdock.zip`, {
        slug,
      });
      onClose();
    } catch (e) {
      setError(apiErrorText(e, t('publication.failed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title={t('publication.title')}
      description={t('publication.description')}
      confirmLabel={t('publication.download')}
      confirmDisabled={blocked || !slugValid || busy}
      onCancel={onClose}
      onConfirm={() => void onDownload()}
    >
      {isError ? (
        <p className="text-destructive text-sm" role="alert">
          {t('publication.failed')}
        </p>
      ) : !report ? (
        <p className="text-muted-foreground text-sm">{t('publication.checking')}</p>
      ) : (
        <>
          <Checklist report={report} />
          <SlugField report={report} value={slug} onChange={setSlug} valid={slugValid} />
          {error ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </ConfirmDialog>
  );
}

/** A size in MB, the unit `PUBLICATION_MAX_MB` is set in. */
function megabytes(bytes: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / (1024 * 1024));
}

function Checklist({ report }: { report: PublicationReportDto }) {
  const { t, i18n } = useTranslation('editor');
  const has = (code: string) => report.issues.some((issue) => issue.code === code);
  const uncredited = report.issues.find((issue) => issue.code === 'credit_missing');
  const mediaName = (m: PublicationReportDto['heaviest'][number]) =>
    m.name ?? t(`publication.kind.${m.kind}`);
  return (
    <ul className="flex flex-col gap-2 text-sm">
      <Row
        ok={!has('not_ready')}
        label={has('not_ready') ? t('publication.check.notReady') : t('publication.check.ready')}
      >
        {has('not_ready') ? t('publication.fix.ready') : null}
      </Row>
      <Row
        ok={!has('language')}
        label={t('publication.check.language', {
          language: languageName(report.language, i18n.language),
        })}
      />
      <Row
        ok={!has('license')}
        label={
          has('license')
            ? t('publication.check.noLicense')
            : t('publication.check.license', { license: licenseName(report.license ?? '') })
        }
      >
        {has('license') ? t('publication.fix.settings') : null}
      </Row>
      <Row
        ok={!has('tags')}
        label={
          has('tags')
            ? t('publication.check.noTags')
            : t('publication.check.tags', { tags: report.tags.join(', ') })
        }
      >
        {has('tags') ? t('publication.fix.settings') : null}
      </Row>
      <Row
        ok={!has('too_large')}
        label={t('publication.check.size', {
          size: megabytes(report.estimatedBytes, i18n.language),
          max: megabytes(report.maxBytes, i18n.language),
        })}
      >
        {has('too_large') ? (
          <>
            {t('publication.fix.size')}
            <ul className="mt-1 list-disc pl-5">
              {report.heaviest.map((m) => (
                <li key={m.id}>
                  {mediaName(m)} — {megabytes(m.sizeBytes, i18n.language)}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Row>
      {uncredited ? (
        <Row warn label={t('publication.check.uncredited', { count: uncredited.count ?? 0 })}>
          {t('publication.fix.credit')}
          <ul className="mt-1 list-disc pl-5">
            {report.uncredited.map((m) => (
              <li key={m.id}>{mediaName(m)}</li>
            ))}
          </ul>
        </Row>
      ) : (
        <Row ok label={t('publication.check.credited')} />
      )}
    </ul>
  );
}

function Row({
  ok = false,
  warn = false,
  label,
  children,
}: {
  ok?: boolean;
  warn?: boolean;
  label: string;
  children?: ReactNode;
}) {
  const Icon = warn ? AlertTriangle : ok ? Check : X;
  const tone = warn ? 'text-amber-600' : ok ? 'text-green-600' : 'text-destructive';
  return (
    <li className="flex gap-2">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0">
        <span className={ok ? undefined : 'font-medium'}>{label}</span>
        {children ? <div className="text-muted-foreground text-xs">{children}</div> : null}
      </div>
    </li>
  );
}

function SlugField({
  report,
  value,
  valid,
  onChange,
}: {
  report: PublicationReportDto;
  value: string;
  valid: boolean;
  onChange: (slug: string) => void;
}) {
  const { t } = useTranslation('editor');
  const changed = report.slugSet && value !== report.slug;
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {t('publication.slugLabel')}
      </label>
      <Input
        id={id}
        value={value}
        spellCheck={false}
        maxLength={SLUG_MAX_LENGTH}
        aria-invalid={!valid}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(toSlug(value, SLUG_MAX_LENGTH))}
      />
      <span id={`${id}-help`} className="text-muted-foreground text-xs">
        {t('publication.slugHelp', { file: `${value || '…'}.quizdock.zip` })}
      </span>
      {changed ? (
        <span className="text-xs text-amber-700" role="status">
          {t('publication.slugChanged', { previous: report.slug })}
        </span>
      ) : null}
    </div>
  );
}
