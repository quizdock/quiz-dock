import { ApiProperty } from '@nestjs/swagger';

/** Candidate addresses for the invitations (QR code, link) of a session. */
export class JoinAddressesDto {
  @ApiProperty({
    description: 'APP_PUBLIC_URL when configured — the address of a real deployment.',
    nullable: true,
    type: String,
  })
  publicUrl!: string | null;

  @ApiProperty({
    description:
      'LAN IPv4 addresses of the machine (bare IPs; the browser adds its own scheme and port). From HOST_LAN_IPS when set, else detected.',
    type: [String],
  })
  lanIps!: string[];

  @ApiProperty({
    description:
      'How the LAN addresses were obtained: "configured" (HOST_LAN_IPS), "detected" (host interfaces), or "hidden" (the process only sees a container bridge — Docker Desktop, bridge network).',
    enum: ['configured', 'detected', 'hidden'],
  })
  lanSource!: 'configured' | 'detected' | 'hidden';

  @ApiProperty({
    description:
      'Invitation addresses (origins) a phone reached in the phone test of the administration: offered first.',
    type: [String],
  })
  tested!: string[];
}
