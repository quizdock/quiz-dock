import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEDIA_LIBRARY_KINDS, type MediaLibraryLink } from '@quiz-dock/contracts';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { apiErrorText } from '../../api/http';
import { type Answer, useRunOperation, useRefreshAdmin } from './admin-api';
import {
  type SettingRow,
  type SettingsAccess,
  controlOf,
  definitionOf,
  draftOf,
  problemOf,
  rawOf,
} from './settings-model';

type Confirm = Extract<Answer, { kind: 'confirm' }> & { run: (token: string) => Promise<void> };

/**
 * The control of a row the web may change (§3.7): by type, checked as it is
 * typed, saved explicitly — never on each keystroke —, with the way back to
 * `.env` when it was changed here. A level C2 change is confirmed.
 */
export function SettingEditor({ row }: { row: SettingRow; access: SettingsAccess }) {
  const { t } = useTranslation('admin');
  const def = definitionOf(row.key);
  const refresh = useRefreshAdmin();
  const runOperation = useRunOperation();
  const [draft, setDraft] = useState<unknown>(() => (def ? draftOf(def, row.value) : row.value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  if (!def) return null;
  const control = controlOf(def);
  const raw = rawOf(def, draft);
  const problem = problemOf(def, raw);
  const current = rawOf(def, draftOf(def, row.value));
  const changed = raw !== current;

  const call = async (id: string, params: Record<string, unknown>, confirmation?: string) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const answer = await runOperation(id, params, { confirmation });
      if (answer.kind === 'confirm') {
        setConfirm({ ...answer, run: (token) => call(id, params, token) });
      } else {
        setSaved(true);
        await refresh();
      }
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const id = `setting-${row.key}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {t(`labels.${row.key}`, { defaultValue: row.key })}
      </label>
      {control.kind === 'flag' ? (
        <Segmented
          label={t(`labels.${row.key}`, { defaultValue: row.key })}
          value={String(draft) === 'true' ? 'true' : 'false'}
          onChange={setDraft}
          options={[
            { value: 'true', label: t('value.on') },
            { value: 'false', label: t('value.off') },
          ]}
          className="w-fit"
        />
      ) : control.kind === 'choice' ? (
        <Select
          id={id}
          value={String(draft ?? '')}
          onChange={(e) => setDraft(e.target.value)}
          className="max-w-xs"
        >
          {control.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : control.kind === 'number' ? (
        <div className="flex flex-wrap items-center gap-3">
          {control.min !== undefined && control.max !== undefined ? (
            <input
              type="range"
              aria-hidden
              tabIndex={-1}
              min={control.min}
              max={control.max}
              step={control.step}
              value={Number(draft)}
              onChange={(e) => setDraft(Number(e.target.value))}
              className="accent-primary w-40"
            />
          ) : null}
          <span className="flex items-center gap-1">
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={control.min}
              max={control.max}
              step={control.step}
              value={String(draft ?? '')}
              onChange={(e) => setDraft(e.target.value === '' ? '' : Number(e.target.value))}
              aria-invalid={!!problem}
              className="w-28"
            />
            {control.unit ? (
              <span className="text-muted-foreground text-sm">{t(`units.${control.unit}`)}</span>
            ) : null}
          </span>
        </div>
      ) : control.kind === 'list' ? (
        <ListEditor id={id} items={(draft as string[]) ?? []} onChange={setDraft} />
      ) : control.kind === 'links' ? (
        <LinksEditor links={(draft as MediaLibraryLink[]) ?? []} onChange={setDraft} />
      ) : (
        <Input
          id={id}
          value={String(draft ?? '')}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={!!problem}
        />
      )}
      {problem && changed ? (
        <p className="text-destructive text-xs">
          {t('edit.accepts', { accepts: problem.replace(/`/g, '') })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !changed || !!problem}
          onClick={() => void call('settings.set', { key: row.key, value: raw })}
        >
          <Save aria-hidden className="size-4" />
          {t('edit.save')}
        </Button>
        {row.source === 'override' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void call('settings.reset', { key: row.key })}
          >
            <RotateCcw aria-hidden className="size-4" />
            {t('edit.back')}
          </Button>
        ) : null}
        {changed ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setDraft(draftOf(def, row.value))}
          >
            {t('edit.cancel')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : saved ? (
        <p role="status" className="text-success text-sm">
          {t(`edit.saved.${row.applies}`)}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={t(`labels.${row.key}`, { defaultValue: row.key })}
        description={confirm?.summary}
        confirmLabel={t('run.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm;
          setConfirm(null);
          if (pending) void pending.run(pending.token);
        }}
      />
    </div>
  );
}

function ListEditor({
  id,
  items,
  onChange,
}: {
  id: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input
            id={i === 0 ? id : undefined}
            value={item}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t('edit.remove')}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 aria-hidden className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() => onChange([...items, ''])}
      >
        <Plus aria-hidden className="size-4" />
        {t('edit.add')}
      </Button>
    </div>
  );
}

function LinksEditor({
  links,
  onChange,
}: {
  links: MediaLibraryLink[];
  onChange: (links: MediaLibraryLink[]) => void;
}) {
  const { t } = useTranslation('admin');
  const update = (i: number, patch: Partial<MediaLibraryLink>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-2">
      {links.map((link, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-md border p-2">
          <div className="flex gap-2">
            <Input
              aria-label={t('edit.linkName')}
              value={link.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t('edit.remove')}
              onClick={() => onChange(links.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
          <Input
            aria-label={t('edit.linkUrl')}
            value={link.url}
            onChange={(e) => update(i, { url: e.target.value })}
          />
          <div className="flex flex-wrap gap-3 text-sm">
            {MEDIA_LIBRARY_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={link.kinds.includes(kind)}
                  onChange={(e) =>
                    update(i, {
                      kinds: e.target.checked
                        ? [...link.kinds, kind]
                        : link.kinds.filter((k) => k !== kind),
                    })
                  }
                />
                {t(`edit.kinds.${kind}`)}
              </label>
            ))}
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        onClick={() =>
          onChange([...links, { name: '', url: 'https://', kinds: [...MEDIA_LIBRARY_KINDS] }])
        }
      >
        <Plus aria-hidden className="size-4" />
        {t('edit.add')}
      </Button>
      {links.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('edit.noLinks')}</p>
      ) : null}
    </div>
  );
}
