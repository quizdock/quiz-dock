/** Durée de vie de l'état live d'une partie (~4 h — SPECIFICATIONS-DONNEES §4). */
export const GAME_TTL_S = 4 * 60 * 60;

/**
 * Clés Redis de l'état live (SPECIFICATIONS-DONNEES §4). Centralisées ici pour
 * garantir la cohérence du nommage entre allocation, écriture et purge.
 */
export const gameKeys = {
  /** Marqueur d'allocation atomique du PIN (auto-expirant → pas de fuite). */
  pin: (pin: string) => `pin:${pin}`,
  /** Hash scalaire de la partie (état, index courant, métadonnées). */
  game: (pin: string) => `game:${pin}`,
  /** Snapshot complet du quiz (JSON) — bonnes réponses côté serveur. */
  snapshot: (pin: string) => `game:${pin}:snapshot`,
  /** Hash playerId → enregistrement joueur (JSON). */
  players: (pin: string) => `game:${pin}:players`,
  /** Set des pseudos normalisés (dédoublonnage atomique). */
  nicknames: (pin: string) => `game:${pin}:nicknames`,
  /** Hash playerId → réponse (HSETNX = 1re réponse gagne, RG-06). */
  answers: (pin: string, questionIndex: number) => `game:${pin}:answers:${questionIndex}`,
  /** ZSet playerId scoré par score (classement). */
  leaderboard: (pin: string) => `game:${pin}:leaderboard`,
  /** Jeton de session joueur → { pin, playerId } (reconnexion). */
  session: (token: string) => `session:${token}`,
};
