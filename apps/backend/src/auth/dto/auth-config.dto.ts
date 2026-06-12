import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Config d'auth exposée à la SPA (publique) : elle en déduit le mode et, en OIDC,
 * les paramètres du fournisseur. Source de vérité = variables d'env du backend.
 */
export const authConfigSchema = z.object({
  mode: z.enum(['none', 'oidc']),
  oidc: z
    .object({
      authority: z.string(),
      clientId: z.string(),
    })
    .nullable(),
});

export class AuthConfigDto extends createZodDto(authConfigSchema) {}
