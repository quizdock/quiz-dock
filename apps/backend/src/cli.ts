import 'reflect-metadata';
import { runQuizMcp } from './mcp/quiz-mcp';
import { validateTextQuiz } from './quizzes/portable/text-quiz-validation';
import { isHost } from './auth/roles';
import { findUser } from './cli/commands/users';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from './cli/args';
import { CliModule } from './cli/cli.module';
import { CliError, ConsoleOutput } from './cli/output';
import { diskIo } from './cli/commands/quiz';
import { operationsHelp, runCommand } from './cli/adapter';
import { OperationRunner } from './admin/runner/operation-runner';
import { createInterface } from 'node:readline/promises';
import { PrismaService } from './prisma/prisma.service';
import { QuizPortableService } from './quizzes/portable/quiz-portable.service';

const USAGE = `QuizDock admin CLI — runs inside the app container.

Usage: qd <command> [options]      (in the container; = node dist/cli.js)

  doctor            Check env, database, migrations, Redis, media dir, OIDC discovery
  migrate:status    List applied / pending migrations
  seat:status       Show who holds the local-mode host seat
  seat:release      Free the host seat, whoever holds it
  user:list         List accounts (name, subject, e-mail, role, quizzes)
  user:set-role <sub|email> host|admin|host,admin|player
                    Grant (sticky) host, admin, or both at once; player revokes
  samples:load <sub|email>
                    Add the built-in sample quizzes to that user's bank
  quiz:list [<sub|email>]
                    List quizzes (id, title, owner, status…), optionally one user's
  quiz:export <id> <file.zip|->
                    Write the quiz as a bundle (quiz.json + media/), "-" = stdout
  quiz:import <file|-> <sub|email>
                    Create a draft from a bundle (zip or quiz.json), "-" = stdin
  quiz:validate <file|->
                    Validate text-only quiz.json without writing anything
  mcp [--user=<sub|email>]
                    Serve MCP on stdin/stdout (experimental); optional host account enables imports
  quiz:transfer <quiz-id> <sub|email>
                    Hand a quiz over to another account (media and history follow)
  sessions:purge [--dry-run]
                    Delete archived sessions past their retention date
  operations        Every operation, with its parameters (qd <operation> --param=value…)
  help              This message

Options: --json (the outcome as JSON), --yes (confirm), --dry-run (say what
would be done), --as=<name> (who the audit records).
Exit code 0 on success, 1 on failure, 2 on bad usage.`;

/** Asks on the terminal; nobody to ask when stdin is not one. */
async function askOnTerminal(question: string): Promise<boolean | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new CliError(`Missing argument ${what}.\n\n${USAGE}`, 2);
  return value;
}

/**
 * Entry point of the operator CLI shipped in the image:
 *   docker compose exec quizdock node dist/cli.js <command>
 */
async function main(argv: string[]): Promise<number> {
  const out = new ConsoleOutput();
  const args = parseArgs(argv);
  if (!args.command || args.command === 'help' || args.flags.help) {
    out.line(USAGE);
    return 0;
  }
  if (args.command === 'quiz:validate') {
    const source = need(args.positional[0], '<file|->');
    const result = validateTextQuiz((await diskIo.read(source)).toString('utf8'));
    out.line(JSON.stringify(result));
    return result.valid ? 0 : 1;
  }
  if (args.command === 'mcp' && args.flags.user === undefined) {
    await runQuizMcp();
    return 0;
  }
  if (args.command === 'mcp' && (typeof args.flags.user !== 'string' || !args.flags.user))
    throw new CliError('Use --user=<sub|email> to enable imports.', 2);
  // A bundle streamed to stdout must be the only thing written there.
  const toStdout = args.command === 'quiz:export' && args.positional[1] === '-';
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: args.command === 'mcp' ? false : toStdout ? ['error'] : ['error', 'warn'],
  });
  try {
    if (args.command === 'mcp') {
      const prisma = app.get(PrismaService);
      const who = args.flags.user;
      if (typeof who !== 'string')
        throw new CliError('Use --user=<sub|email> to enable imports.', 2);
      const user = await findUser(prisma, who);
      if (!isHost(user.roles))
        throw new CliError('The configured MCP account must have the host role.');
      await runQuizMcp({
        ownerId: user.id,
        portable: app.get(QuizPortableService),
        authorized: async () => {
          const current = await prisma.user.findUnique({
            where: { id: user.id },
            select: { roles: true },
          });
          return !!current && isHost(current.roles);
        },
      });
      return 0;
    }
    const runner = app.get(OperationRunner);
    if (args.command === 'operations') {
      out.line(operationsHelp(runner.catalogue({ via: 'cli', name: 'cli' })));
      return 0;
    }
    return await runCommand(args, runner, {
      out,
      io: diskIo,
      write: (text) => process.stdout.write(text),
      ask: askOnTerminal,
    });
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const e = err as Partial<CliError>;
    process.stderr.write(`${e.message ?? String(err)}\n`);
    process.exit(e.exitCode ?? 1);
  });
