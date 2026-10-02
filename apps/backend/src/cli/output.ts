/** Minimal, dependency-free console output for the admin CLI (English only). */
export interface Output {
  line(text?: string): void;
  ok(text: string): void;
  warn(text: string): void;
  fail(text: string): void;
  table(rows: Record<string, unknown>[]): void;
}

export class ConsoleOutput implements Output {
  line(text = ''): void {
    process.stdout.write(`${text}\n`);
  }
  ok(text: string): void {
    this.line(`  ✓ ${text}`);
  }
  warn(text: string): void {
    this.line(`  ! ${text}`);
  }
  fail(text: string): void {
    this.line(`  ✗ ${text}`);
  }
  table(rows: Record<string, unknown>[]): void {
    if (rows.length === 0) {
      this.line('  (none)');
      return;
    }
    const cols = Object.keys(rows[0]);
    const cell = (v: unknown) =>
      v == null ? '-' : v instanceof Date ? v.toISOString() : String(v);
    const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
    const fmt = (vals: string[]) => `  ${vals.map((v, i) => v.padEnd(width[i])).join('  ')}`;
    this.line(fmt(cols));
    this.line(fmt(width.map((w) => '-'.repeat(w))));
    for (const r of rows) this.line(fmt(cols.map((c) => cell(r[c]))));
  }
}

/** Thrown by a command to end with a message and a non-zero exit code. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** A line of output, as data: what a command printed, for any access to render. */
export type OutputEntry =
  | { level: 'line' | 'ok' | 'warn' | 'fail'; text: string }
  | { level: 'table'; rows: Record<string, unknown>[] };

/** Keeps what a command prints, in order, instead of printing it. */
export class RecordingOutput implements Output {
  readonly entries: OutputEntry[] = [];

  line(text = ''): void {
    this.entries.push({ level: 'line', text });
  }
  ok(text: string): void {
    this.entries.push({ level: 'ok', text });
  }
  warn(text: string): void {
    this.entries.push({ level: 'warn', text });
  }
  fail(text: string): void {
    this.entries.push({ level: 'fail', text });
  }
  table(rows: Record<string, unknown>[]): void {
    this.entries.push({ level: 'table', rows });
  }
}

/** Prints recorded output again. */
export function replay(entries: OutputEntry[], out: Output): void {
  for (const entry of entries) {
    if (entry.level === 'table') out.table(entry.rows);
    else out[entry.level](entry.text);
  }
}
