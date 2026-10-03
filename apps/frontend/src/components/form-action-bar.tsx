import { AlertCircle, AlertTriangle, Check } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Popover } from '@/components/ui/popover';
import type { FieldIssue } from '@/lib/question-issues';
import { cn } from '@/lib/utils';

/**
 * The top of an editor form, kept in view (a long form would push saving out of
 * reach): what is being edited, a refusal next to the button that caused it,
 * what the form still says under its fields (a count that opens their list, each
 * leading to its field), Cancel and Save. Cancel asks first when there are changes,
 * then `onCancel`. "Saved" stands after a save, until the next change.
 */
export function FormActionBar({
  title,
  error,
  dirty,
  saved,
  busy,
  submitLabel,
  issues = [],
  onIssue,
  onCancel,
}: {
  title: string;
  /** Shown in the bar when given (a form that says its errors elsewhere leaves it out). */
  error?: string | null;
  dirty: boolean;
  /** Just saved, nothing changed since. */
  saved?: boolean;
  busy: boolean;
  submitLabel: string;
  /** What the fields say: errors block the save, the rest is left to finish. */
  issues?: FieldIssue[];
  onIssue?: (field: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('editor');
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <div className="bg-background/95 sticky top-0 z-20 -mx-1 flex items-center gap-2 px-1 py-2 backdrop-blur">
        {/* Out of a drawer the form has no title: the bar says what is being edited. */}
        <span
          className={
            error === undefined
              ? 'mr-auto min-w-0 truncate text-base font-semibold'
              : 'min-w-0 truncate text-base font-semibold'
          }
        >
          {title}
        </span>
        {error !== undefined ? (
          <p className="text-destructive mr-auto min-w-0 flex-1 truncate text-xs">{error}</p>
        ) : null}
        {issues.length > 0 ? <IssueSummary issues={issues} onIssue={onIssue} /> : null}
        <span role="status" className="text-muted-foreground flex items-center gap-1 text-xs">
          {saved ? (
            <>
              <Check aria-hidden className="size-3.5" />
              {t('formSaved')}
            </>
          ) : null}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => (dirty ? setConfirm(true) : onCancel())}
        >
          {t('common:cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!dirty || busy}>
          {submitLabel}
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        destructive
        title={t('discardConfirm.title')}
        description={t('discardConfirm.description')}
        confirmLabel={t('discardConfirm.confirmLabel')}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          onCancel();
        }}
      />
    </>
  );
}

/** "2 errors" or "3 to finish", opening the list: each line leads to its field. */
function IssueSummary({
  issues,
  onIssue,
}: {
  issues: FieldIssue[];
  onIssue?: (field: string) => void;
}) {
  const { t } = useTranslation('editor');
  const errors = issues.filter((i) => i.tone === 'error');
  const shown = errors.length > 0 ? errors : issues;
  // One line per distinct text, at its first field.
  const lines = [...new Map(shown.map((i) => [i.text, i])).values()];
  const Icon = errors.length > 0 ? AlertCircle : AlertTriangle;
  return (
    <Popover
      align="end"
      className="w-72"
      trigger={({ open, toggle }) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={toggle}
          className={errors.length > 0 ? 'text-destructive' : 'text-warning-text'}
        >
          <Icon className="size-4" />
          {errors.length > 0
            ? t('formIssues.errors', { count: errors.length })
            : t('formIssues.toFinish', { count: lines.length })}
        </Button>
      )}
    >
      {(close) => (
        <ul className="flex flex-col gap-1">
          {lines.map((i) => (
            <li key={i.text}>
              <button
                type="button"
                className={cn(
                  'hover:bg-accent w-full rounded-md px-2 py-1 text-left text-sm',
                  i.tone === 'error' ? 'text-destructive' : 'text-foreground',
                )}
                onClick={() => {
                  close();
                  onIssue?.(i.field);
                }}
              >
                {i.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
