import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Config d'auth exposée à la SPA (publique) : elle en déduit le mode et, en OIDC,
 * les paramètres du fournisseur ; `demo` porte ce que la SPA doit montrer d'une
 * instance `DEMO_MODE` (le serveur impose le reste). Source de vérité = variables
 * d'env du backend.
 */
export const authConfigSchema = z.object({
  mode: z.enum(['none', 'oidc']),
  demo: z.object({ seatMinutes: z.number().int() }).nullable(),
  /** Image tout-en-un (`:standalone`) : base et cache dans le même conteneur. */
  standalone: z.boolean(),
  oidc: z
    .object({
      authority: z.string(),
      clientId: z.string(),
    })
    .nullable(),
});

export class AuthConfigDto extends createZodDto(authConfigSchema) {}
