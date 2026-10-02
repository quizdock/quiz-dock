import { Injectable } from '@nestjs/common';
import { THEME_TOKENS, checkTheme } from '@quiz-dock/contracts';
import { z } from 'zod';
import { ThemeService } from '../theme/theme.service';
import { type AdminOperation, OperationError, defineOperation, done } from './operation';

const tokens = z.object(
  Object.fromEntries(THEME_TOKENS.map((t) => [t, z.string().max(64).optional()])) as Record<
    (typeof THEME_TOKENS)[number],
    z.ZodOptional<z.ZodString>
  >,
);
const theme = z.object({ light: tokens.optional(), dark: tokens.optional() });

/** The instance's palette (lot 5): read, changed — every colour readable — or taken back. */
@Injectable()
export class ThemeOperations {
  constructor(private readonly theme: ThemeService) {}

  list(): AdminOperation[] {
    return [
      defineOperation({
        id: 'theme.get',
        domain: 'instance',
        category: 'theme',
        effect: 'read',
        summary:
          "The instance's palette: the colours changed from the administration, light and dark.",
        params: z.object({}),
        run: async () => done({ theme: await this.theme.get() }),
      }),
      defineOperation({
        id: 'theme.set',
        domain: 'instance',
        category: 'theme',
        effect: 'write',
        summary:
          "Changes the instance's palette; a colour that makes a text or a control unreadable is refused.",
        params: theme,
        validate: (t) => {
          const problems = checkTheme(t);
          if (problems.length) {
            throw new OperationError(
              'invalid_params',
              problems
                .map((p) =>
                  p.kind === 'unreadable'
                    ? `${p.mode} ${p.token}: not a colour (#rrggbb or oklch(L C H))`
                    : `${p.mode}: ${p.fg} on ${p.bg} reaches ${p.ratio}:1, ${p.min}:1 needed`,
                )
                .join('; '),
              { problems },
            );
          }
        },
        run: async (ctx, t) => {
          const previous = await this.theme.get();
          await this.theme.set(t, ctx.actor);
          return { ...done({ theme: t }), memento: { theme: previous } };
        },
      }),
      defineOperation({
        id: 'theme.reset',
        domain: 'instance',
        category: 'theme',
        effect: 'write',
        summary: "Back to the application's own palette.",
        params: z.object({}),
        run: async (ctx) => {
          const previous = await this.theme.get();
          await this.theme.set(null, ctx.actor);
          return { ...done(), memento: { theme: previous } };
        },
      }),
    ];
  }
}
