import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CONTRACTS_VERSION } from '@roux-quizz/contracts';

export interface HealthStatus {
  status: 'ok';
  service: string;
  version: string;
  contracts: string;
  authMode: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'Service en bonne santé' })
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'roux-quizz-backend',
      version: '0.1.0',
      contracts: CONTRACTS_VERSION,
      authMode: process.env.AUTH_MODE ?? 'none',
    };
  }
}
