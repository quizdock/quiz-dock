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
  /** Démo publique : le compte hôte que tous les visiteurs partagent. */
  demo: z.object({ user: z.string() }).nullable(),
  /** Image tout-en-un (`:standalone`) : base et cache dans le même conteneur. */
  standalone: z.boolean(),
  /** Hosts may open a game to participants without an account (#57, OIDC only). */
  anonymousParticipants: z.boolean(),
  oidc: z
    .object({
      authority: z.string(),
      clientId: z.string(),
      /**
       * Where the browser keeps the session (`OIDC_SESSION_SCOPE`): `browser`, shared
       * by the tabs (default), or `tab`, each tab signing in on its own.
       */
      sessionScope: z.enum(['browser', 'tab']),
    })
    .nullable(),
});

export class AuthConfigDto extends createZodDto(authConfigSchema) {}
