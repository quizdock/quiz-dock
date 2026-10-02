import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { RefusalAuditFilter } from './refusal-audit.filter';
import { ApiBearerAuth, ApiConsumes, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ManagerOnly } from '../../auth/manager-only.decorator';
import { OperationRunner } from '../runner/operation-runner';
import { AdminRateLimit } from './admin-rate-limit';
import { OperationAnswerDto, OperationCatalogueDto, RunOperationDto } from './admin-operations.dto';
import { OperationFileInterceptor } from './operation-file.interceptor';
import { apiActor, refusalError } from './outcome-http';

/**
 * The admin API (§3.4, `HttpAdapter`): the catalogue of operations and one
 * route to run any of them. No logic here — rights, scope, validation,
 * confirmation and audit are the runner's.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ManagerOnly()
@UseFilters(RefusalAuditFilter)
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
  run(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RunOperationDto,
  ): Promise<OperationAnswerDto> {
    return this.execute(user, req, id, body.params ?? {}, body);
  }

  /**
   * The same, for an operation that takes a file (`upload`: a quiz bundle):
   * multipart — the file as `file`, the other parameters as JSON in `params` —
   * so a large file never travels as base64 in a JSON body.
   */
  @Post(':id/file')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ type: OperationAnswerDto })
  @UseInterceptors(OperationFileInterceptor)
  runWithFile(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: { params?: string; dryRun?: string; confirmation?: string },
  ): Promise<OperationAnswerDto> {
    let params: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(body.params || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      params = parsed as Record<string, unknown>;
    } catch {
      throw new HttpException({ code: 'admin.invalid_params' }, HttpStatus.BAD_REQUEST);
    }
    return this.execute(
      user,
      req,
      id,
      params,
      { dryRun: body.dryRun === 'true', confirmation: body.confirmation },
      file ? { file: { buffer: file.buffer, name: file.originalname } } : {},
    );
  }

  private async execute(
    user: User,
    req: Request,
    id: string,
    raw: Record<string, unknown>,
    options: { dryRun?: boolean; confirmation?: string },
    attachments?: Record<string, unknown>,
  ): Promise<OperationAnswerDto> {
    await this.limits.call(user.id);
    const actor = apiActor(user, req);
    const address = actor.address ?? 'unknown';
    if (actor.adminToken) await this.limits.tokenAllowed(address);
    const outcome = await this.runner.run({
      id,
      raw,
      actor,
      dryRun: options.dryRun,
      confirmation: options.confirmation,
      ...(attachments ? { attachments } : {}),
    });
    if (outcome.kind === 'refused') {
      if (outcome.code === 'local_mode_token' && actor.adminToken)
        await this.limits.tokenFailed(address);
      throw refusalError(outcome);
    }
    return outcome;
  }
}
