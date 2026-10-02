import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { apiErrorText } from '../../api/http';
import {
  type Answer,
  type OperationResult,
  runOperationWithFile,
  useRefreshAdmin,
  useRunOperation,
} from './admin-api';

export interface ActOptions {
  dryRun?: boolean;
  /** The file of an operation that takes one (`upload`): sent as a file. */
  file?: File;
  /** Read the administration again after it (default: unless a preview). */
  refresh?: boolean;
  /** How the confirmation reads, when the runner asks for one. */
  title?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface Pending {
  id: string;
  params: Record<string, unknown>;
  options: ActOptions;
  answer: Extract<Answer, { kind: 'confirm' }>;
  resolve: (result: OperationResult | null) => void;
}

/**
 * Runs an operation from a page, the one way every page does it: busy while it
 * runs, its error kept for the caller to show where the person looks (inside a
 * dialog, say), the confirmation asked when the runner wants one — and the
 * result handed back once confirmed, or `null` when refused or cancelled. A
 * change reads the administration again.
 */
export function useOperationAction(): {
  act: (
    id: string,
    params?: Record<string, unknown>,
    options?: ActOptions,
  ) => Promise<OperationResult | null>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
  /** Mount it where the page is: it shows only while a confirmation is asked. */
  confirmDialog: ReactNode;
} {
  const { t } = useTranslation('admin');
  const run = useRunOperation();
  const refresh = useRefreshAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // The latest act, for the dialog's handlers (no stale closure).
  const actRef = useRef<typeof act>(null as never);

  const act = async (
    id: string,
    params: Record<string, unknown> = {},
    options: ActOptions = {},
    confirmation?: string,
  ): Promise<OperationResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const call = { dryRun: options.dryRun, confirmation };
      const answer = options.file
        ? await runOperationWithFile(id, params, options.file, call)
        : await run(id, params, call);
      if (answer.kind === 'confirm') {
        return await new Promise((resolve) => setPending({ id, params, options, answer, resolve }));
      }
      if (options.refresh ?? !options.dryRun) await refresh();
      return answer.result;
    } catch (err) {
      setError(apiErrorText(err));
      return null;
    } finally {
      setBusy(false);
    }
  };
  actRef.current = act;

  const confirmDialog = pending ? (
    <ConfirmDialog
      open
      title={pending.options.title ?? t('run.confirmTitle')}
      description={pending.answer.summary}
      destructive={pending.options.destructive}
      confirmLabel={pending.options.confirmLabel ?? t('run.confirm')}
      onCancel={() => {
        setPending(null);
        pending.resolve(null);
      }}
      onConfirm={() => {
        const { id, params, options, answer, resolve } = pending;
        setPending(null);
        void actRef.current(id, params, options, answer.token).then(resolve);
      }}
    />
  ) : null;

  return {
    act: (id, params, options) => act(id, params, options),
    busy,
    error,
    clearError: () => setError(null),
    confirmDialog,
  };
}
