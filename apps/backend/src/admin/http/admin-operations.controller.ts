import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ManagerOnly } from '../../auth/manager-only.decorator';
import { OperationRunner } from '../runner/operation-runner';
import { AdminRateLimit } from './admin-rate-limit';
import { OperationAnswerDto, OperationCatalogueDto, RunOperationDto } from './admin-operations.dto';
import { apiActor, refusalError } from './outcome-http';

/**
 * The admin API (§3.4, `HttpAdapter`): the catalogue of operations and one
 * route to run any of them. No logic here — rights, scope, validation,
 * confirmation and audit are the runner's.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ManagerOnly()
@Controller('admin/operations')
export class AdminOperationsController {
  constructor(
    private readonly runner: OperationRunner,
    private readonly limits: AdminRateLimit,
  ) {}

  /** Every operation, and whether this account may run it. */
  @Get()
  @ApiOkResponse({ type: OperationCatalogueDto })
  catalogue(@CurrentUser() user: User, @Req() req: Request): OperationCatalogueDto {
    return { operations: this.runner.catalogue(apiActor(user, req)) };
  }

  /**
   * Runs an operation: its result, or a token to send back once the person
   * confirmed. A refusal answers with its code (`admin.scope_read`…).
   */
  @Post(':id')
  @HttpCode(200)
  @ApiOkResponse({ type: OperationAnswerDto })
  async run(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RunOperationDto,
  ): Promise<OperationAnswerDto> {
    await this.limits.call(user.id);
    const actor = apiActor(user, req);
    const address = actor.address ?? 'unknown';
    if (actor.adminToken) await this.limits.tokenAllowed(address);
    const outcome = await this.runner.run({
      id,
      raw: body.params ?? {},
      actor,
      dryRun: body.dryRun,
      confirmation: body.confirmation,
    });
    if (outcome.kind === 'refused') {
      if (outcome.code === 'local_mode_token' && actor.adminToken)
        await this.limits.tokenFailed(address);
      throw refusalError(outcome);
    }
    return outcome;
  }
}
