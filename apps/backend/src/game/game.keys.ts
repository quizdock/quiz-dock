/** Durée de vie de l'état live d'une partie (~4 h — SPECIFICATIONS-DONNEES §4). */
export const GAME_TTL_S = 4 * 60 * 60;

/** Délai de lecture de l'énoncé avant ouverture des réponses (§8, défaut 3 s). */
export const READ_DELAY_MS = 3_000;

/** Tolérance serveur : réponses reçues après `endsAt + grace` rejetées (§6). */
export const GRACE_MS = 300;

/**
 * Délai de grâce avant de déclarer l'hôte parti (§7.1) : absorbe un simple
 * rechargement de la fenêtre de contrôle avant de passer en `HOST_DISCONNECTED`.
 */
export const HOST_GRACE_MS = 5_000;

/**
 * Fenêtre de reconnexion de l'hôte (§7.3) : passé ce délai en `HOST_DISCONNECTED`
 * sans retour, la partie se termine (résultats persistés en l'état).
 */
export const HOST_RECONNECT_WINDOW_MS = 120_000;

/**
 * Mode auto (§8) : temps d'affichage du reveal/classement avant d'enchaîner
 * automatiquement la question suivante. La pause suspend ce minuteur.
 */
export const AUTO_ADVANCE_MS = 5_000;

/**
 * Plancher du chrono après un retrait de temps (`host:adjust-time`) : en deçà,
 * la question est révélée immédiatement plutôt que de laisser un timer mort.
 */
export const CHRONO_FLOOR_MS = 1_000;

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
  /** Set des PINs des parties en cours d'un hôte (reprise depuis le dashboard §6.2). */
  hostGames: (userId: string) => `host:${userId}:games`,
  /** Verrou atomique de passage en REVEAL (1 seul gagnant, anti double-reveal). */
  revealLock: (pin: string, questionIndex: number) => `game:${pin}:reveal-lock:${questionIndex}`,
  /** Verrou atomique de passage à la question suivante (anti double-clic). */
  advanceLock: (pin: string, questionIndex: number) => `game:${pin}:advance-lock:${questionIndex}`,
};
