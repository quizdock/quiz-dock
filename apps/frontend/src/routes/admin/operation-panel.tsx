import {
  CircleAlert,
  CircleCheck,
  Download,
  Eye,
  Info,
  Play,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadFailed, Spinner } from '@/components/ui/loading';
import { Select } from '@/components/ui/select';
import { apiErrorText } from '../../api/http';
import {
  type Answer,
  type OperationDescriptor,
  type OperationResult,
  type OutputEntry,
  useRunOperation,
  useReadOperation,
  useRefreshAdmin,
  runOperationWithFile,
} from './admin-api';

interface PropertySchema {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
}

/** The fields of an operation, from its JSON Schema. */
export function fieldsOf(descriptor: Pick<OperationDescriptor, 'params'>) {
  const props = (descriptor.params.properties ?? {}) as Record<string, PropertySchema>;
  const required = new Set((descriptor.params.required ?? []) as string[]);
  return Object.entries(props).map(([name, schema]) => ({
    name,
    schema,
    required: required.has(name),
  }));
}

/** A form value as the operation takes it: numbers as numbers, empty left out. */
export function paramsFrom(
  fields: ReturnType<typeof fieldsOf>,
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const { name, schema } of fields) {
    const value = values[name];
    if (value === undefined || value === '') continue;
    const types = [schema.type ?? 'string'].flat();
    if (typeof value === 'boolean') params[name] = value;
    else if (types.includes('number') || types.includes('integer')) params[name] = Number(value);
    else params[name] = value;
  }
  return params;
}

const readBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsDataURL(file);
  });

/**
 * One operation, from the catalogue: its form (generated from its schema), its
 * preview when it has one, its confirmation when it needs one, its result.
 */
export function OperationPanel({
  descriptor,
  intro,
}: {
  descriptor: OperationDescriptor;
  intro?: ReactNode;
}) {
  const { t } = useTranslation('admin');
  const refresh = useRefreshAdmin();
  const runOperation = useRunOperation();
  const fields = fieldsOf(descriptor);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  // The file of an operation that takes one as such (`upload`): sent as a file.
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ result: OperationResult; preview: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Extract<Answer, { kind: 'confirm' }> | null>(null);
  const params = () => paramsFrom(fields, values);

  const call = async (options: { dryRun?: boolean; confirmation?: string } = {}) => {
    setBusy(true);
    setError(null);
    try {
      const answer =
        descriptor.upload && file
          ? await runOperationWithFile(descriptor.id, params(), file, options)
          : await runOperation(descriptor.id, params(), options);
      if (answer.kind === 'confirm') setConfirm(answer);
      else {
        setResult({ result: answer.result, preview: !!options.dryRun });
        if (!options.dryRun && descriptor.effect !== 'read') await refresh();
      }
    } catch (err) {
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void call();
  };
  const title = t(`operations.${descriptor.id}`, { defaultValue: descriptor.id });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {descriptor.effect !== 'read' ? (
          <Badge variant={descriptor.effect === 'destructive' ? 'destructive' : 'warning'}>
            {t(`effects.${descriptor.effect}`)}
          </Badge>
        ) : null}
        <code className="text-muted-foreground ml-auto text-xs">{descriptor.id}</code>
      </div>
      <p className="text-muted-foreground text-sm">{intro ?? descriptor.summary}</p>
      {!descriptor.reachable ? (
        <p className="text-muted-foreground text-sm">
          {t(`refusals.${descriptor.refusal ?? 'forbidden'}`)}
        </p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {fields.map(({ name, schema, required }) => (
            <Field
              key={name}
              operation={descriptor.id}
              name={name}
              schema={schema}
              required={required}
              value={values[name]}
              onChange={(v) => setValues((prev) => ({ ...prev, [name]: v }))}
              onFile={async (chosen) => {
                if (descriptor.upload === name) {
                  setFile(chosen);
                  setValues((prev) => ({ ...prev, filename: chosen.name }));
                  return;
                }
                const base64 = await readBase64(chosen);
                setValues((prev) => ({ ...prev, [name]: base64, filename: chosen.name }));
              }}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              variant={descriptor.effect === 'destructive' ? 'destructive' : 'default'}
            >
              {busy ? <Spinner className="size-4" /> : <Play aria-hidden className="size-4" />}
              {t(descriptor.effect === 'read' ? 'run.read' : 'run.write')}
            </Button>
            {descriptor.dryRun ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void call({ dryRun: true })}
              >
                <Eye aria-hidden className="size-4" />
                {t('run.preview')}
              </Button>
            ) : null}
          </div>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {result ? <ResultView result={result.result} preview={result.preview} /> : null}
      <ConfirmDialog
        open={confirm !== null}
        title={title}
        description={confirm?.summary}
        destructive={descriptor.effect === 'destructive'}
        confirmLabel={t('run.confirm')}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const token = confirm?.token;
          setConfirm(null);
          void call({ confirmation: token });
        }}
      />
    </Card>
  );
}

function Field({
  operation,
  name,
  schema,
  required,
  value,
  onChange,
  onFile,
}: {
  operation: string;
  name: string;
  schema: PropertySchema;
  required: boolean;
  value: string | boolean | undefined;
  onChange: (value: string | boolean) => void;
  onFile: (file: File) => Promise<void>;
}) {
  const { t } = useTranslation('admin');
  const id = `${operation}-${name}`;
  const label = t(`params.${name}`, { defaultValue: name });
  const types = [schema.type ?? 'string'].flat();
  const hint = schema.description;
  let control: ReactNode;
  if (name === 'bundle') {
    control = (
      <Input
        id={id}
        type="file"
        accept=".zip,.json,.xlsx"
        required={required}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
    );
  } else if (schema.enum) {
    control = (
      <Select
        id={id}
        required={required}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('form.choose')}</option>
        {schema.enum.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </Select>
    );
  } else if (types.includes('boolean')) {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4"
      />
    );
  } else {
    control = (
      <Input
        id={id}
        type={types.includes('number') || types.includes('integer') ? 'number' : 'text'}
        required={required}
        value={String(value ?? '')}
        placeholder={schema.default !== undefined ? String(schema.default) : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (name === 'filename') return null;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </Label>
      {control}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

const LEVEL_ICON = { ok: CircleCheck, warn: TriangleAlert, fail: CircleAlert } as const;
const LEVEL_TONE = {
  ok: 'text-success',
  warn: 'text-warning-text',
  fail: 'text-destructive',
} as const;

/** What an operation printed, as the page shows it: lines with their mark, tables. */
export function OutputView({ entries }: { entries: OutputEntry[] }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      {entries.map((entry, i) =>
        entry.level === 'table' ? (
          <RowsTable key={i} rows={entry.rows} />
        ) : entry.level === 'line' ? (
          entry.text ? (
            <p key={i} className="mt-1 font-medium first:mt-0">
              {entry.text}
            </p>
          ) : null
        ) : (
          <p key={i} className="flex items-start gap-2">
            {(() => {
              const Icon = LEVEL_ICON[entry.level];
              return (
                <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${LEVEL_TONE[entry.level]}`} />
              );
            })()}
            <span className="break-words">{entry.text}</span>
          </p>
        ),
      )}
    </div>
  );
}

const cell = (v: unknown) =>
  v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const { t } = useTranslation('admin');
  if (!rows.length) return <p className="text-muted-foreground">{t('result.none')}</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {t(`columns.${c}`, { defaultValue: c })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t align-top">
              {columns.map((c) => (
                <td key={c} className="px-3 py-1.5 break-words">
                  {cell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** An operation's result: its outcome, notes, what it printed, a file to save. */
export function ResultView({
  result,
  preview = false,
}: {
  result: OperationResult;
  preview?: boolean;
}) {
  const { t } = useTranslation('admin');
  const data = result.data as
    | {
        output?: OutputEntry[];
        base64?: string;
        filename?: string;
        rows?: Record<string, unknown>[];
      }
    | undefined;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        {result.outcome === 'partial' ? (
          <TriangleAlert aria-hidden className="text-warning-text size-4" />
        ) : result.outcome === 'nothing-to-do' ? (
          <Info aria-hidden className="text-muted-foreground size-4" />
        ) : (
          <CircleCheck aria-hidden className="text-success size-4" />
        )}
        {preview ? t('result.preview') : t(`result.${result.outcome}`)}
      </p>
      {result.notes.map((n) => (
        <p key={n.code + n.text} className="text-muted-foreground text-sm">
          {n.text}
        </p>
      ))}
      {data?.output ? <OutputView entries={data.output} /> : null}
      {data?.rows ? <RowsTable rows={data.rows} /> : null}
      {data?.base64 && data.filename ? (
        <a
          href={`data:application/zip;base64,${data.base64}`}
          download={data.filename}
          className="inline-flex items-center gap-1 text-sm underline"
        >
          <Download aria-hidden className="size-4" />
          {t('result.download', { name: data.filename })}
        </a>
      ) : null}
    </div>
  );
}

/** A reading operation shown as soon as the page opens, refreshed on demand. */
export function ReadPanel({
  id,
  title,
  params,
}: {
  id: string;
  title: string;
  params?: Record<string, unknown>;
}) {
  const { t } = useTranslation('admin');
  const read = useReadOperation(id, params);
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => void read.refetch()}
          disabled={read.isFetching}
          aria-label={t('run.again')}
          title={t('run.again')}
        >
          <RefreshCw aria-hidden className={read.isFetching ? 'size-4 animate-spin' : 'size-4'} />
        </Button>
      </div>
      {read.isError ? (
        <LoadFailed error={read.error} />
      ) : !read.data ? (
        <Spinner label={t('loading')} showLabel className="text-sm" />
      ) : (
        <ResultView result={read.data} />
      )}
    </Card>
  );
}
