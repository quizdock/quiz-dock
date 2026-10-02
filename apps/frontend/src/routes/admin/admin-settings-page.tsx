import { FileDown, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorText } from '../../api/http';
import { type Answer, runOperation, useReadOperation, useRefreshAdmin } from './admin-api';
import { PresetsPanel } from './presets-panel';
import { SettingEditor } from './setting-editor';
import type { SettingsList } from './settings-model';
import { SettingsPage } from './settings-page';

/** The settings of the instance, read here; changed here where the scope allows (§3.7). */
export function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <OverridesActions />
      <SettingsPage
        above={(access) => <PresetsPanel access={access} />}
        editor={(row, access) => (
          <SettingEditor
            key={`${row.key}:${JSON.stringify(row.value)}`}
            row={row}
            access={access}
          />
        )}
      />
    </div>
  );
}

/** What was changed here, as a `.env` excerpt; and all of it taken back at once. */
function OverridesActions() {
  const { t } = useTranslation('admin');
  const refresh = useRefreshAdmin();
  const list = useReadOperation<SettingsList>('settings.list');
  const [env, setEnv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Extract<Answer, { kind: 'confirm' }> | null>(null);
  const data = list.data?.data;
  const changed = data?.rows.filter((r) => r.source === 'override').length ?? 0;
  if (!data || changed === 0) return null;

  const exportEnv = async () => {
    setError(null);
    try {
      const answer = await runOperation('settings.export');
      if (answer.kind === 'result') setEnv((answer.result.data as { env: string }).env);
    } catch (err) {
      setError(apiErrorText(err));
    }
  };
  const resetAll = async (confirmation?: string) => {
    setError(null);
    try {
      const answer = await runOperation('settings.reset', { all: true }, { confirmation });
      if (answer.kind === 'confirm') setConfirm(answer);
      else await refresh();
    } catch (err) {
      setError(apiErrorText(err));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">{t('overrides.count', { count: changed })}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={() => void exportEnv()}
        >
          <FileDown aria-hidden className="size-4" />
          {t('overrides.export')}
        </Button>
        {data.access.scope === 'write' ? (
          <Button
            type="button"
            size="sm"
            variant="destructive-outline"
            onClick={() => void resetAll()}
          >
            <RotateCcw aria-hidden className="size-4" />
            {t('overrides.resetAll')}
          </Button>
        ) : null}
      </div>
      {env !== null ? (
        <label className="flex flex-col gap-1 text-sm">
          {t('overrides.exportHelp')}
          <Textarea
            readOnly
            value={env}
            rows={Math.min(12, env.split('\n').length + 1)}
            className="font-mono text-xs"
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={t('overrides.resetAll')}
        description={confirm?.summary}
        destructive
        confirmLabel={t('run.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const token = confirm?.token;
          setConfirm(null);
          void resetAll(token);
        }}
      />
    </div>
  );
}
