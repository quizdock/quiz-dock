import type { OperationDescriptor, OperationOutcome } from '@quiz-dock/contracts';
import type { OperationCall } from '../admin/runner/operation-runner';
import {
  type CliPort,
  type CliTerminal,
  bindFlags,
  exitCode,
  operationsHelp,
  runCommand,
  toCall,
} from './adapter';
import { parseArgs } from './args';
import { CliError, RecordingOutput } from './output';

const catalogue: OperationDescriptor[] = [
  {
    id: 'thing.set',
    domain: 'instance',
    category: 'settings',
    effect: 'write',
    summary: 'Sets a thing.',
    params: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        size: { type: 'number' },
        on: { type: 'boolean' },
        tags: { type: 'array' },
      },
      required: ['key'],
    },
    dryRun: true,
    reachable: true,
  },
];

const io = {
  read: jest.fn().mockResolvedValue(Buffer.from('zip!')),
  write: jest.fn().mockResolvedValue(undefined),
};

function terminal(
  answer: boolean | null = null,
): CliTerminal & { out: RecordingOutput; written: string[] } {
  const written: string[] = [];
  return {
    out: new RecordingOutput(),
    written,
    write: (t) => written.push(t),
    ask: () => Promise.resolve(answer),
    io,
  };
}

function port(...outcomes: OperationOutcome[]): CliPort & { calls: OperationCall[] } {
  const calls: OperationCall[] = [];
  return {
    calls,
    catalogue: () => catalogue,
    run: (call) => {
      calls.push(call);
      return Promise.resolve(outcomes.shift()!);
    },
  };
}

const ok = (data?: unknown): OperationOutcome => ({
  kind: 'result',
  result: { outcome: 'done', notes: [], data },
});

describe('the qd adapter', () => {
  it('reads flags as the parameters, typed by the schema', () => {
    expect(
      bindFlags(
        { key: 'APP_NAME', size: '12', on: 'true', tags: 'a, b', yes: true, json: true },
        catalogue[0].params,
      ),
    ).toEqual({ key: 'APP_NAME', size: 12, on: true, tags: ['a', 'b'] });
  });

  it('a command of old is an alias: its positionals become parameters', async () => {
    const { call } = await toCall(
      parseArgs(['user:set-role', 'ada@example.org', 'admin']),
      catalogue,
      io,
    );
    expect(call).toMatchObject({
      id: 'users.set-role',
      raw: { user: 'ada@example.org', roles: 'admin' },
      actor: { via: 'cli' },
    });
    expect(
      (await toCall(parseArgs(['sessions:purge', '--dry-run']), catalogue, io)).call,
    ).toMatchObject({
      id: 'sessions.purge',
      dryRun: true,
    });
    expect(
      (await toCall(parseArgs(['thing.set', '--key=A', '--as=ops']), catalogue, io)).call,
    ).toMatchObject({
      id: 'thing.set',
      raw: { key: 'A' },
      actor: { name: 'ops' },
    });
  });

  it('quiz:import reads the bundle, quiz:export writes it where asked', async () => {
    const { call } = await toCall(parseArgs(['quiz:import', 'quiz.zip', 'ada']), catalogue, io);
    expect(call.raw).toEqual({
      owner: 'ada',
      bundle: Buffer.from('zip!').toString('base64'),
      filename: 'quiz.zip',
    });

    const t = terminal();
    const p = port(
      ok({ filename: 'q.zip', size: 4, base64: Buffer.from('zip!').toString('base64') }),
    );
    expect(await runCommand(parseArgs(['quiz:export', 'q1', 'out.zip']), p, t)).toBe(0);
    expect(p.calls[0].raw).toEqual({ quiz: 'q1' });
    expect(io.write).toHaveBeenCalledWith('out.zip', Buffer.from('zip!'));
    expect(t.out.entries).toEqual([
      { level: 'line', text: 'Exported q.zip (4 bytes) to out.zip.' },
    ]);
  });

  it('prints what the operation printed, then its notes', async () => {
    const t = terminal();
    await runCommand(
      parseArgs(['doctor']),
      port({
        kind: 'result',
        result: {
          outcome: 'partial',
          notes: [{ level: 'warn', code: 'x', text: 'Mind it.' }],
          data: { output: [{ level: 'fail', text: 'Redis down' }] },
        },
      }),
      t,
    );
    expect(t.out.entries).toEqual([
      { level: 'fail', text: 'Redis down' },
      { level: 'warn', text: 'Mind it.' },
    ]);
  });

  describe('confirmation', () => {
    const ask: OperationOutcome = {
      kind: 'confirm',
      token: 't0k3n-t0k3n-t0k3n-t0k3n',
      summary: 'Delete it.',
    };

    it('--yes confirms: the same call again, with the token', async () => {
      const p = port(ask, ok());
      expect(await runCommand(parseArgs(['thing.set', '--key=A', '--yes']), p, terminal())).toBe(0);
      expect(p.calls[1]).toMatchObject({
        id: 'thing.set',
        raw: { key: 'A' },
        confirmation: ask.token,
      });
    });

    it('a command of old is confirmed as it always was: it never asked', async () => {
      const p = port(ask, ok());
      expect(await runCommand(parseArgs(['sessions:purge']), p, terminal(null))).toBe(0);
      expect(p.calls[1]).toMatchObject({ id: 'sessions.purge', confirmation: ask.token });
    });

    it('on a terminal, it asks; no means nothing done', async () => {
      const p = port(ask);
      const t = terminal(false);
      expect(await runCommand(parseArgs(['thing.set', '--key=A']), p, t)).toBe(1);
      expect(p.calls).toHaveLength(1);
      expect(t.out.entries).toEqual([{ level: 'line', text: 'Nothing done.' }]);
    });

    it('with nobody to ask, it wants --yes', async () => {
      await expect(
        runCommand(parseArgs(['thing.set', '--key=A']), port(ask), terminal(null)),
      ).rejects.toEqual(new CliError('Delete it.\nAdd --yes to confirm.', 2));
    });
  });

  it('a refusal is an error with its exit code; --json prints the outcome instead', async () => {
    const no: OperationOutcome = {
      kind: 'refused',
      code: 'invalid_params',
      message: 'key: Required',
    };
    await expect(runCommand(parseArgs(['thing.set']), port(no), terminal())).rejects.toEqual(
      new CliError('key: Required', 2),
    );
    const t = terminal();
    expect(await runCommand(parseArgs(['thing.set', '--json']), port(no), t)).toBe(2);
    expect(JSON.parse(t.written[0])).toEqual(no);
  });

  it('exit codes: 0 done, 1 partial or refused, 2 bad usage', () => {
    expect(exitCode(ok())).toBe(0);
    expect(exitCode({ kind: 'result', result: { outcome: 'partial', notes: [] } })).toBe(1);
    expect(exitCode({ kind: 'refused', code: 'not_found', message: '' })).toBe(1);
    expect(exitCode({ kind: 'refused', code: 'unknown_operation', message: '' })).toBe(2);
  });

  it('help lists each operation with its flags', () => {
    expect(operationsHelp(catalogue)).toContain(
      'thing.set --key=… [--size=…] [--on=…] [--tags=…]   (write, dry-run)',
    );
  });
});
