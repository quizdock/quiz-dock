import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { MediaAdminService } from '../../media/media-admin.service';
import { MediaService } from '../../media/media.service';
import { type AdminOperation, OperationError, defineOperation, done } from './operation';

const id = z.string().trim().min(1).max(64);

/**
 * The instance's media (§0, the Media domain): what the media page does, as
 * operations — the same services, now through the runner and its audit. Not
 * gated by `ADMIN_WEB_SCOPE`.
 */
@Injectable()
export class MediaOperations {
  constructor(
    private readonly media: MediaService,
    private readonly admin: MediaAdminService,
  ) {}

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'media.upload',
        domain: 'media',
        category: 'media',
        effect: 'write',
        summary: "Uploads a file straight into the instance's media.",
        params: z.object({
          name: z.string().max(255).optional(),
          size: z.number().int().optional(),
        }),
        run: async (ctx) => {
          const { file, fields } = ctx.attachments as {
            file?: Parameters<MediaService['upload']>[1];
            fields?: Record<string, unknown>;
          };
          const userId = ctx.actor.userId;
          if (!userId) throw new OperationError('forbidden', 'An account uploads, not a shell.');
          return done(await this.media.upload(userId, file, fields ?? {}, { instance: true }));
        },
      }),
      defineOperation({
        id: 'media.promote',
        domain: 'media',
        category: 'media',
        effect: 'write',
        summary: "Puts an existing file among the instance's media; its author keeps their own.",
        params: z.object({ file: id }),
        run: async (ctx, { file }) => {
          if (!ctx.actor.userId)
            throw new OperationError('forbidden', 'An account promotes, not a shell.');
          return done(await this.media.addToInstance(ctx.actor.userId, file));
        },
      }),
      defineOperation({
        id: 'media.credit',
        domain: 'media',
        category: 'media',
        effect: 'write',
        summary: 'Sets the credit of a media of the instance.',
        params: z.object({ media: id, credit: z.string().max(500) }),
        run: async (_ctx, { media, credit }) =>
          done(await this.media.setInstanceCredit(media, credit)),
      }),
      defineOperation({
        id: 'media.remove',
        domain: 'media',
        category: 'media',
        effect: 'write',
        summary: "Takes a media out of the instance's; the hosts' copies stay theirs.",
        params: z.object({ media: id }),
        run: async (_ctx, { media }) => {
          await this.media.removeFromInstance(media);
          return done();
        },
      }),
      defineOperation({
        id: 'media.delete-file',
        domain: 'media',
        category: 'media',
        effect: 'destructive',
        summary: 'Deletes a file and every media on it, used or not.',
        describe: ({ file }) =>
          `Delete the file ${file} and every media on it, wherever it is used.`,
        params: z.object({ file: id }),
        run: async (_ctx, { file }) => {
          await this.admin.deleteFile(file);
          return done();
        },
      }),
      defineOperation({
        id: 'media.sweep',
        domain: 'media',
        category: 'media',
        effect: 'write',
        summary: 'Runs the clean-up of unused media now, instead of waiting for the hourly pass.',
        params: z.object({}),
        timeoutMs: 10 * 60_000,
        run: async () => {
          const result = await this.admin.sweepNow();
          return {
            outcome: result ? 'done' : 'nothing-to-do',
            notes: [],
            data: { ran: result !== null, result },
          };
        },
      }),
    ];
  }
}
