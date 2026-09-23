import { UserRole } from '@prisma/client';

/**
 * Les rôles d'un compte, en **ensemble** : un compte peut gérer l'instance *et*
 * animer sa propre banque (RG-14). L'ensemble vide est un participant — `player`
 * est le plancher, pas quelque chose que l'on détient.
 */
export type RoleSet = readonly UserRole[];

/** Qui crée, édite et présente ses quiz — sa banque, pas celle des autres. */
export function isHost(roles: RoleSet): boolean {
  return roles.includes(UserRole.host);
}

/** Qui lit l'instance entière et l'administre. */
export function isManager(roles: RoleSet): boolean {
  return roles.includes(UserRole.admin);
}

/** Gestionnaire qui n'anime pas : la vue d'ensemble sans la banque. */
export function isPureManager(roles: RoleSet): boolean {
  return isManager(roles) && !isHost(roles);
}

/**
 * Rôles effectifs : l'**union** de ce qu'un opérateur a octroyé et de ce que le
 * contexte dérive — les claims du jeton sous OIDC, le siège d'hôte en mode local.
 * Un octroi survit donc à un siège expiré ou à des claims qui ne le portent plus,
 * et n'empêche jamais une promotion venue du contexte.
 */
export function effectiveRoles(assigned: RoleSet, derived: RoleSet): UserRole[] {
  return canonical([...assigned, ...derived]);
}

/** Rôle principal, pour un affichage qui n'a qu'une place (badge, table CLI). */
export function primaryRole(roles: RoleSet): UserRole {
  if (isManager(roles)) return UserRole.admin;
  if (isHost(roles)) return UserRole.host;
  return UserRole.player;
}

/**
 * Lit un ensemble de rôles depuis des noms libres (claims OIDC, CLI), dans un
 * ordre **stable** : ce qui est stocké et affiché ne doit pas dépendre de l'ordre
 * dans lequel un fournisseur d'identité a listé ses claims.
 */
export function parseRoles(names: readonly string[]): UserRole[] {
  const known = new Set(names.map((n) => n.trim().toLowerCase()));
  return canonical(
    [...known].filter((n): n is UserRole => n === UserRole.admin || n === UserRole.host),
  );
}

/** Ordre canonique d'un ensemble de rôles : gestion d'abord, animation ensuite. */
export function canonical(roles: RoleSet): UserRole[] {
  const out: UserRole[] = [];
  if (isManager(roles)) out.push(UserRole.admin);
  if (isHost(roles)) out.push(UserRole.host);
  return out;
}
