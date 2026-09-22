import { BadRequestException } from '@nestjs/common';
import { readFile, writeFile } from 'node:fs/promises';
import type { PrismaService } from '../../prisma/prisma.service';
import { gameKeys } from '../../game/game.keys';
import {
  collectMediaIds,
  EXPORT_INCLUDE,
  type ExportableQuiz,
} from '../../quizzes/portable/quiz-bundle';
import type { QuizPortableService } from '../../quizzes/portable/quiz-portable.service';
import { CliError, type Output } from '../output';
import { findUser } from './users';

type Db = Pick<PrismaService, 'user' | 'quiz'>;
/** What `quiz:transfer` needs on top: the media rows follow, in one transaction. */
type TransferDb = Db & Pick<PrismaService, 'mediaAsset' | '$transaction'>;
/** The live-games index of a host (`host:{id}:games`) and the games it points at. */
type LiveIndex = {
  smembers(key: string): Promise<string[]>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
};
type Portable = Pick<QuizPortableService, 'exportZip' | 'importBundle'>;

/** Where a bundle comes from / goes to; `-` is stdin / stdout so the host script can relay. */
export interface BundleIo {
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer): Promise<void>;
}

export const diskIo: BundleIo = {
  async read(path) {
    if (path !== '-') return readFile(path);
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  },
  async write(path, data) {
    if (path !== '-') return writeFile(path, data);
    // Wait for the pipe to drain: `process.exit` right after would truncate a large zip.
    await new Promise<void>((resolve, reject) =>
      process.stdout.write(data, (err) => (err ? reject(err) : resolve())),
    );
  },
};

/** `quiz:list [<sub|email>]`: every quiz (or one user's), newest first — where to find an id to export. */
export async function quizList(out: Output, prisma: Db, who?: string): Promise<void> {
  const owner = who ? await findUser(prisma, who) : null;
  const quizzes = await prisma.quiz.findMany({
    where: owner ? { ownerId: owner.id } : undefined,
    orderBy: { updatedAt: 'desc' },
    include: { owner: { select: { oidcSubject: true } } },
  });
  out.table(
    quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      owner: q.owner.oidcSubject,
      status: q.status,
      questions: q.questionCount,
      slug: q.slug,
      revision: q.revision,
      updatedAt: q.updatedAt,
    })),
  );
}

/** `quiz:export <id> <file.zip|->`: the same bundle as the API export, whoever owns the quiz. */
export async function quizExport(
  out: Output,
  portable: Portable,
  id: string,
  target: string,
  io: BundleIo,
): Promise<void> {
  const { filename, zip } = await portable.exportZip(id);
  await io.write(target, zip);
  if (target !== '-') out.line(`Exported ${filename} (${zip.length} bytes) to ${target}.`);
}

/** `quiz:import <file|-> <sub|email>`: a new draft in that user's bank, as the API import does. */
export async function quizImport(
  out: Output,
  prisma: Db,
  portable: Portable,
  source: string,
  who: string,
  io: BundleIo,
): Promise<void> {
  const user = await findUser(prisma, who);
  const buffer = await io.read(source);
  let quiz;
  try {
    quiz = await portable.importBundle(user.id, { buffer, mimetype: 'application/octet-stream' });
  } catch (err) {
    if (err instanceof BadRequestException) throw new CliError(`Import refused: ${reason(err)}`);
    throw err;
  }
  out.line(`Imported "${quiz.title}" (${quiz.id}) as a draft of ${user.displayName}.`);
}

/** The API error as one line: its code, then the parameters naming the culprit. */
function reason(err: BadRequestException): string {
  const body = err.getResponse();
  if (typeof body === 'string') return body;
  const { code, params, message } = body as {
    code?: string;
    params?: Record<string, unknown>;
    message?: string;
  };
  const detail = Object.entries(params ?? {})
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  return `${code ?? message ?? 'invalid bundle'}${detail ? ` (${detail})` : ''}`;
}

/**
 * `quiz:transfer <quiz-id> <sub|email>`: hands a quiz over to another account —
 * an account that left, a colleague taking over (#40). Not how hosts share their
 * work: that is by copy, through the template catalogue (RG-17).
 *
 * The media that **only** this quiz uses follow it, so the new owner can clean up
 * what is theirs; an image shared with another of the previous owner's quizzes
 * stays where it is, since taking it would leave that quiz depending on media its
 * owner no longer controls. Nothing else is needed: reading and exporting a media
 * never check ownership — only deleting one does.
 *
 * The archived sessions follow the quiz, because the history is read through it.
 */
export async function quizTransfer(
  out: Output,
  prisma: TransferDb,
  redis: LiveIndex,
  quizId: string,
  who: string,
): Promise<void> {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: EXPORT_INCLUDE });
  if (!quiz) throw new CliError(`No quiz with id "${quizId}".`);
  const target = await findUser(prisma, who);
  if (quiz.ownerId === target.id) {
    out.line(`"${quiz.title}" already belongs to ${target.displayName}.`);
    return;
  }
  await refuseWhilePlayed(redis, quiz.ownerId, quiz.id);

  // Shared with another of this owner's quizzes? Then it is not this quiz's to take.
  const others = await prisma.quiz.findMany({
    where: { ownerId: quiz.ownerId, id: { not: quiz.id } },
    include: EXPORT_INCLUDE,
  });
  const elsewhere = new Set<string>();
  for (const other of others as ExportableQuiz[]) {
    for (const id of collectMediaIds(other)) elsewhere.add(id);
  }
  const used = [...collectMediaIds(quiz as ExportableQuiz)];
  const moving = used.filter((id) => !elsewhere.has(id));

  await prisma.$transaction([
    prisma.quiz.update({ where: { id: quiz.id }, data: { ownerId: target.id } }),
    prisma.mediaAsset.updateMany({
      where: { id: { in: moving }, ownerId: quiz.ownerId },
      data: { ownerId: target.id },
    }),
  ]);

  out.ok(`"${quiz.title}" now belongs to ${target.displayName} (${target.oidcSubject}).`);
  out.line(
    `Media: ${moving.length} moved, ${used.length - moving.length} left behind (shared with another of the previous owner's quizzes).`,
  );
  out.line('Its archived sessions follow it: their results are now readable by the new owner.');
}

/** A quiz being played cannot change hands: the running session would lose its owner. */
async function refuseWhilePlayed(redis: LiveIndex, ownerId: string, quizId: string): Promise<void> {
  const pins = await redis.smembers(gameKeys.hostGames(ownerId));
  for (const pin of pins) {
    const [state, playing] = await redis.hmget(gameKeys.game(pin), 'state', 'quizId');
    if (playing === quizId && state && state !== 'ENDED') {
      throw new CliError(
        `"${quizId}" is being played right now (PIN ${pin}): end the session first.`,
      );
    }
  }
}
