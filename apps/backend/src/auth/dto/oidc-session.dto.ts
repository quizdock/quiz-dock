import { ApiProperty } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Where to send the browser next (`POST /auth/login`, `POST /auth/logout`). */
export class AuthRedirectDto {
  @ApiProperty({
    description:
      "The provider's address to navigate to; null on logout when the provider has no end-session endpoint.",
    nullable: true,
    type: String,
  })
  url!: string | null;
}

/** The provider's answer, as the browser brought it back to `/auth/callback`. */
export const oidcCallbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(512),
  /** RFC 9207: the issuer that answered, when the provider says so. */
  iss: z.string().max(2048).optional(),
});

export class OidcCallbackDto extends createZodDto(oidcCallbackSchema) {}

/** Who signed in. */
export class OidcSignedInDto {
  @ApiProperty({ description: 'Display name of the signed-in user.' })
  name!: string;
}
