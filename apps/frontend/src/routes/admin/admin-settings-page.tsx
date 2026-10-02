import { FileDown, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useReadOperation } from './admin-api';
import { SettingEditor } from './setting-editor';
import type { SettingsList } from './settings-model';
import { SettingsPage } from './settings-page';
import { useOperationAction } from './use-operation-action';

/** The settings of the instance, read here; changed here where the scope allows (§3.7). */
export function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <OverridesActions />
      <SettingsPage
        // Keyed by the setting alone: a save reads the row again without remounting
        // its editor, which keeps saying it was saved and when it applies.
        editor={(row, access) => <SettingEditor key={row.key} row={row} access={access} />}
      />
    </div>
  );
}

/** What was changed here, as a `.env` excerpt; and all of it taken back at once. */
function OverridesActions() {
  const { t } = useTranslation('admin');
  const list = useReadOperation<SettingsList>('settings.list');
  const action = useOperationAction();
  const [env, setEnv] = useState<string | null>(null);
  const data = list.data?.data;
  const changed = data?.rows.filter((r) => r.source === 'override').length ?? 0;
  if (!data || changed === 0) return null;
  const writable = data.access.scope === 'write';

  const exportEnv = async () => {
    const result = await action.act('settings.export', {}, { refresh: false });
    if (result) setEnv((result.data as { env: string }).env);
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
          disabled={action.busy}
          onClick={() => void exportEnv()}
        >
          <FileDown aria-hidden className="size-4" />
          {t('overrides.export')}
        </Button>
        {/* Greyed with its reason in read scope: never a missing button. */}
        <Button
          type="button"
          size="sm"
          variant="destructive-outline"
          disabled={!writable || action.busy}
          onClick={() =>
            void action.act(
              'settings.reset',
              { all: true },
              { title: t('overrides.resetAll'), destructive: true },
            )
          }
        >
          <RotateCcw aria-hidden className="size-4" />
          {t('overrides.resetAll')}
        </Button>
      </div>
      {!writable ? (
        <p className="text-muted-foreground text-xs">{t('refusals.scope_read')}</p>
      ) : null}
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
      {action.error ? (
        <p role="alert" className="text-destructive text-sm">
          {action.error}
        </p>
      ) : null}
      {action.confirmDialog}
    </div>
  );
}
