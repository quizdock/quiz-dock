import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CONTRACTS_VERSION } from '@quiz-dock/contracts';
import { Public } from '../auth/public.decorator';
import { authMode } from '../auth/auth-mode';
import { appVersion } from '../common/app-version';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface HealthStatus {
  status: 'ok';
  service: string;
  version: string;
  contracts: string;
  authMode: string;
}

export interface ReadyStatus {
  status: 'ok' | 'unavailable';
  database: 'ok' | 'down';
  redis: 'ok' | 'down';
}

/** How long a dependency may take to answer before it counts as down. */
const READY_TIMEOUT_MS = 2_000;

const answers = (probe: Promise<unknown>): Promise<'ok' | 'down'> =>
  Promise.race([
    probe.then(() => 'ok' as const),
    new Promise<'down'>((r) => setTimeout(() => r('down'), READY_TIMEOUT_MS).unref()),
  ]).catch(() => 'down' as const);

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  @ApiOkResponse({ description: 'Service en bonne santé' })
  check(): HealthStatus {
    return {
      status: 'ok',
      service: 'quiz-dock-backend',
      version: appVersion(),
      contracts: CONTRACTS_VERSION,
      authMode: authMode(),
    };
  }

  /**
   * Whether the application can serve: its database and Redis answer. `/health`
   * says the process is up; this is what a container's health check asks.
   */
  @Public()
  @Get('ready')
  @ApiOkResponse({ description: 'Database and Redis answer.' })
  @ApiResponse({ status: 503, description: 'One of them does not.' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyStatus> {
    const [database, redis] = await Promise.all([
      answers(this.prisma.$queryRaw`SELECT 1`),
      answers(this.redis.ping()),
    ]);
    const ok = database === 'ok' && redis === 'ok';
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'unavailable', database, redis };
  }
}
