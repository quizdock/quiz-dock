import { userInfo } from 'node:os';
import type { OperationDescriptor, OperationOutcome, OperationResult } from '@quiz-dock/contracts';
import type { OperationCall } from '../admin/runner/operation-runner';
import type { ParsedArgs } from './args';
import type { BundleIo } from './commands/quiz';
import { CliError, type Output, type OutputEntry, replay } from './output';

/** The flags of the adapter itself, never an operation's parameter. */
const RESERVED = new Set(['json', 'yes', 'dry-run', 'as', 'help']);

/** The port the adapter drives (§3.4): the runner, or a fake in tests. */
export interface CliPort {
  run(call: OperationCall): Promise<OperationOutcome>;
  catalogue(actor: OperationCall['actor']): OperationDescriptor[];
}

/** What the adapter needs from the terminal. */
export interface CliTerminal {
  out: Output;
  /** Writes raw bytes or JSON to stdout. */
  write(text: string): void;
  /** Asks a yes/no question; `null` when there is nobody to ask (not a terminal). */
  ask(question: string): Promise<boolean | null>;
  io: BundleIo;
}

/** A command of `qd` before the runner, kept as an alias: its operation and how positionals map. */
interface Alias {
  id: string;
  positional: string[];
  /** Reads a file into the parameters before the call. */
  read?: (raw: Record<string, unknown>, io: BundleIo) => Promise<void>;
  /** Writes the result somewhere (an export), instead of printing it. */
  write?: (data: unknown, raw: Record<string, unknown>, terminal: CliTerminal) => Promise<void>;
}

export const ALIASES: Record<string, Alias> = {
  doctor: { id: 'health.doctor', positional: [] },
  'migrate:status': { id: 'migrations.status', positional: [] },
  'seat:status': { id: 'seat.status', positional: [] },
  'seat:release': { id: 'seat.release', positional: [] },
  'user:list': { id: 'users.list', positional: [] },
  'user:set-role': { id: 'users.set-role', positional: ['user', 'roles'] },
  'samples:load': { id: 'samples.load', positional: ['user'] },
  'quiz:list': { id: 'quizzes.list', positional: ['owner'] },
  'quiz:transfer': { id: 'quizzes.transfer', positional: ['quiz', 'to'] },
  'quiz:export': {
    id: 'quizzes.export',
    positional: ['quiz', 'target'],
    write: async (data, raw, terminal) => {
      const { filename, base64, size } = data as { filename: string; base64: string; size: number };
      const target = String(raw.target ?? '-');
      await terminal.io.write(target, Buffer.from(base64, 'base64'));
      if (target !== '-') terminal.out.line(`Exported ${filename} (${size} bytes) to ${target}.`);
    },
  },
  'quiz:import': {
    id: 'quizzes.import',
    positional: ['source', 'owner'],
    read: async (raw, io) => {
      const source = String(raw.source ?? '-');
      raw.bundle = (await io.read(source)).toString('base64');
      if (source !== '-') raw.filename = source;
    },
  },
  'sessions:purge': { id: 'sessions.purge', positional: [] },
};

/** Parameters read once, then dropped: the alias's, not the operation's. */
const ALIAS_ONLY = new Set(['target', 'source']);

/**
 * Turns `--flag=value` into the operation's parameters, typed by its JSON
 * Schema: numbers, booleans and lists are read as such (§3.4 `FlagBinder`).
 */
export function bindFlags(
  flags: ParsedArgs['flags'],
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string | string[] }>;
  const params: Record<string, unknown> = {};
  for (const [flag, value] of Object.entries(flags)) {
    if (RESERVED.has(flag)) continue;
    const key = flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const types = [props[key]?.type ?? 'string'].flat();
    if (value === true) params[key] = true;
    else if (types.includes('number') || types.includes('integer')) params[key] = Number(value);
    else if (types.includes('boolean')) params[key] = value === 'true';
    else if (types.includes('array')) params[key] = value.split(',').map((v) => v.trim());
    else params[key] = value;
  }
  return params;
}

/** The call a command line stands for. */
export async function toCall(
  args: ParsedArgs,
  catalogue: OperationDescriptor[],
  io: BundleIo,
): Promise<{ call: OperationCall; alias?: Alias; raw: Record<string, unknown> }> {
  const alias = args.command ? ALIASES[args.command] : undefined;
  const id = alias?.id ?? args.command ?? '';
  const descriptor = catalogue.find((d) => d.id === id);
  const raw = bindFlags(args.flags, descriptor?.params);
  alias?.positional.forEach((name, i) => {
    if (args.positional[i] !== undefined) raw[name] = args.positional[i];
  });
  await alias?.read?.(raw, io);
  const params = Object.fromEntries(Object.entries(raw).filter(([k]) => !ALIAS_ONLY.has(k)));
  const name = typeof args.flags.as === 'string' ? args.flags.as : safeUser();
  return {
    alias,
    raw,
    call: { id, raw: params, actor: { via: 'cli', name }, dryRun: args.flags['dry-run'] === true },
  };
}

function safeUser(): string {
  try {
    return userInfo().username || 'cli';
  } catch {
    return 'cli';
  }
}

/** Exit code of an outcome: 0 done, 1 partial or refused, 2 bad usage. */
export function exitCode(outcome: OperationOutcome): number {
  if (outcome.kind === 'refused')
    return ['invalid_params', 'unknown_operation', 'confirmation_invalid'].includes(outcome.code)
      ? 2
      : 1;
  if (outcome.kind === 'confirm') return 1;
  return outcome.result.outcome === 'partial' ? 1 : 0;
}

/** Prints a result: what the operation printed, its rows, its notes. */
export function render(result: OperationResult, out: Output): void {
  const data = result.data as
    | { output?: OutputEntry[]; rows?: unknown[]; entries?: unknown[] }
    | undefined;
  if (data?.output) replay(data.output, out);
  else if (Array.isArray(data?.rows)) out.table(data.rows as Record<string, unknown>[]);
  else if (Array.isArray(data?.entries)) out.table(data.entries as Record<string, unknown>[]);
  else if (data !== undefined) out.line(JSON.stringify(data, null, 2));
  for (const note of result.notes) (note.level === 'warn' ? out.warn : out.ok).call(out, note.text);
}

/**
 * `qd <operation|alias> [--param=value…] [--json] [--yes] [--dry-run] [--as=name]`:
 * one call through the runner, asked to confirm when it must be.
 */
export async function runCommand(
  args: ParsedArgs,
  port: CliPort,
  terminal: CliTerminal,
): Promise<number> {
  const actor = { via: 'cli' as const, name: 'cli' };
  const { call, alias, raw } = await toCall(args, port.catalogue(actor), terminal.io);
  let outcome = await port.run(call);
  if (outcome.kind === 'confirm') {
    // A command of old never asked: kept as it was, for the scripts and crons that run it.
    const yes =
      args.flags.yes === true || !!alias || (await terminal.ask(`${outcome.summary} Continue?`));
    if (yes === null) {
      throw new CliError(`${outcome.summary}\nAdd --yes to confirm.`, 2);
    }
    if (!yes) {
      terminal.out.line('Nothing done.');
      return 1;
    }
    outcome = await port.run({ ...call, confirmation: outcome.token });
  }
  if (args.flags.json === true) {
    terminal.write(`${JSON.stringify(outcome, null, 2)}\n`);
    return exitCode(outcome);
  }
  if (outcome.kind === 'refused') throw new CliError(outcome.message, exitCode(outcome));
  if (outcome.kind === 'result') {
    if (alias?.write && outcome.result.data) await alias.write(outcome.result.data, raw, terminal);
    else render(outcome.result, terminal.out);
  }
  return exitCode(outcome);
}

/** The operations, for `qd help`: id, effect, parameters. */
export function operationsHelp(catalogue: OperationDescriptor[]): string {
  const lines = catalogue.map((d) => {
    const props = Object.keys((d.params.properties ?? {}) as object);
    const required = new Set((d.params.required ?? []) as string[]);
    const flags = props.map((p) => (required.has(p) ? `--${p}=…` : `[--${p}=…]`)).join(' ');
    const marks = [d.effect !== 'read' ? d.effect : '', d.dryRun ? 'dry-run' : ''].filter(Boolean);
    return `  ${d.id}${flags ? ` ${flags}` : ''}${marks.length ? `   (${marks.join(', ')})` : ''}\n      ${d.summary}`;
  });
  return `Operations (qd <operation> [--param=value…] [--json] [--yes] [--dry-run] [--as=name]):\n\n${lines.join('\n')}`;
}
