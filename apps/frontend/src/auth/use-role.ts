import { useMeControllerMe } from '../api/generated/me/me';

export type Role = 'player' | 'host' | 'admin';

/**
 * Rôle du compte courant, tel que le backend le calcule (siège, claims, octroi).
 * Sert à ne pas proposer ce que le serveur refusera : un **gestionnaire**
 * (`admin`) lit toute l'instance mais ne crée, n'édite ni ne présente rien
 * (RG-14). `null` tant qu'on ne sait pas — on n'affiche alors rien de réservé.
 */
export function useRole(): { role: Role | null; isManager: boolean; isHost: boolean } {
  const { data } = useMeControllerMe({ query: { staleTime: 60_000, retry: false } });
  const role = (data?.data.role as Role | undefined) ?? null;
  return { role, isManager: role === 'admin', isHost: role === 'host' };
}
