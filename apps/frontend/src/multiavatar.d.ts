declare module '@multiavatar/multiavatar' {
  /** Génère un avatar SVG déterministe à partir d'une graine (le pseudo). */
  export default function multiavatar(seed: string, sansEnv?: boolean): string;
}
