import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseArgs } from './cli/args';
import { CliModule } from './cli/cli.module';
import { defaultPingRedis, defaultProbeWritable, doctor } from './cli/commands/doctor';
import { migrationStatus } from './cli/commands/migrate-status';
import { diskIo, quizExport, quizImport, quizList, quizTransfer } from './cli/commands/quiz';
import { seatRelease, seatStatus } from './cli/commands/seat';
import { sessionsPurge } from './cli/commands/sessions';
import { samplesLoad, userList, userSetRole } from './cli/commands/users';
import { CliError, ConsoleOutput } from './cli/output';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { QuizPortableService } from './quizzes/portable/quiz-portable.service';
import { SampleQuizzesService } from './quizzes/samples/sample-quizzes.service';
import { HostSeatService } from './users/host-seat.service';

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
  quiz:transfer <quiz-id> <sub|email>
                    Hand a quiz over to another account (media and history follow)
  sessions:purge [--dry-run]
                    Delete archived sessions past their retention date
  help              This message

Exit code 0 on success, 1 on failure.`;

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
  // A bundle streamed to stdout must be the only thing written there.
  const toStdout = args.command === 'quiz:export' && args.positional[1] === '-';
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: toStdout ? ['error'] : ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    switch (args.command) {
      case 'doctor': {
        const ok = await doctor(out, {
          prisma,
          env: process.env,
          fetch,
          pingRedis: defaultPingRedis,
          probeWritable: defaultProbeWritable,
        });
        return ok ? 0 : 1;
      }
      case 'migrate:status': {
        const s = await migrationStatus(prisma);
        out.line(`Applied (${s.applied.length}):`);
        for (const m of s.applied) out.ok(m);
        out.line(`Pending (${s.pending.length}):`);
        for (const m of s.pending) out.warn(m);
        if (s.failed.length) {
          out.line(`Failed (${s.failed.length}):`);
          for (const m of s.failed) out.fail(m);
        }
        return s.pending.length || s.failed.length ? 1 : 0;
      }
      case 'seat:status':
        await seatStatus(out, app.get(HostSeatService));
        return 0;
      case 'seat:release':
        await seatRelease(out, app.get(HostSeatService));
        return 0;
      case 'user:list':
        await userList(out, prisma);
        return 0;
      case 'user:set-role':
        await userSetRole(
          out,
          prisma,
          need(args.positional[0], '<sub|email>'),
          need(args.positional[1], 'host|admin|host,admin|player'),
        );
        return 0;
      case 'samples:load':
        await samplesLoad(
          out,
          prisma,
          app.get(SampleQuizzesService),
          need(args.positional[0], '<sub|email>'),
        );
        return 0;
      case 'quiz:transfer':
        await quizTransfer(
          out,
          prisma,
          app.get(RedisService),
          need(args.positional[0], '<quiz-id>'),
          need(args.positional[1], '<sub|email>'),
        );
        return 0;
      case 'quiz:list':
        await quizList(out, prisma, args.positional[0]);
        return 0;
      case 'quiz:export':
        await quizExport(
          out,
          app.get(QuizPortableService),
          need(args.positional[0], '<id>'),
          need(args.positional[1], '<file.zip|->'),
          diskIo,
        );
        return 0;
      case 'quiz:import':
        await quizImport(
          out,
          prisma,
          app.get(QuizPortableService),
          need(args.positional[0], '<file|->'),
          need(args.positional[1], '<sub|email>'),
          diskIo,
        );
        return 0;
      case 'sessions:purge':
        await sessionsPurge(out, prisma, args.flags['dry-run'] === true);
        return 0;
      default:
        throw new CliError(`Unknown command "${args.command}".\n\n${USAGE}`, 2);
    }
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
