import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/** Profil de l'utilisateur authentifié (`GET /me`). */
export class MeResponseDto {
  @ApiProperty({ description: 'Identifiant interne (ULID).' })
  id!: string;

  @ApiProperty({ description: 'Nom affiché.' })
  displayName!: string;

  @ApiProperty({ description: 'Courriel, si connu.', nullable: true })
  email!: string | null;

  @ApiProperty({ enum: UserRole, enumName: 'UserRole', description: 'Rôle.' })
  role!: UserRole;
}
