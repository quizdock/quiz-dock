import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Config d'auth exposée à la SPA (publique) : elle en déduit le mode (en OIDC, le
 * backend porte toute la connexion — la SPA n'a rien à savoir du fournisseur) ; `demo` porte ce que la SPA doit montrer d'une
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
});

export class AuthConfigDto extends createZodDto(authConfigSchema) {}
