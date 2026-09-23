import { useMeControllerMe } from '../api/generated/me/me';

export type Role = 'player' | 'host' | 'admin';

/**
 * Rôles du compte courant, tels que le backend les calcule (siège, claims,
 * octroi). Ce sont un **ensemble** : un compte peut gérer l'instance *et* animer
 * sa propre banque (RG-14). Sert à ne pas proposer ce que le serveur refusera.
 */
export function useRole(): { roles: Role[]; isManager: boolean; isHost: boolean } {
  const { data } = useMeControllerMe({ query: { staleTime: 60_000, retry: false } });
  const roles = ((data?.data.roles ?? []) as Role[]) ?? [];
  return { roles, isManager: roles.includes('admin'), isHost: roles.includes('host') };
}
