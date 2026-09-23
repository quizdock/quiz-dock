import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/** Profil de l'utilisateur authentifié (`GET /me`). */
export class MeResponseDto {
  @ApiProperty({ description: 'Identifiant interne (ULID).' })
  id!: string;

  @ApiProperty({ description: 'Nom affiché.' })
  displayName!: string;

  // `type` explicite : sans lui, le client généré tombe sur `{ [k: string]: unknown }`.
  @ApiProperty({ type: String, description: 'Courriel, si connu.', nullable: true })
  email!: string | null;

  @ApiProperty({
    enum: UserRole,
    enumName: 'UserRole',
    isArray: true,
    description:
      'Rôles du compte. Ensemble vide = participant ; `[admin, host]` gère ET anime (RG-14).',
  })
  roles!: UserRole[];

  @ApiProperty({
    description:
      "Sujet stable du compte (`sub` OIDC, ou `local:<slug>`) — c'est ce qu'un " +
      'opérateur donne à `user:set-role`.',
  })
  subject!: string;
}
