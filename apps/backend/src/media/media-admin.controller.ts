import {
  Body,
  Controller,
  Req,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UseFilters,
} from '@nestjs/common';
import { RefusalAuditFilter } from '../admin/http/refusal-audit.filter';
import { FileInterceptor } from '@nestjs/platform-express';
import type { User } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { apiActor, unwrap } from '../admin/http/outcome-http';
import { OperationRunner } from '../admin/runner/operation-runner';
import { ManagerOnly } from '../auth/manager-only.decorator';
import { MediaDescriptionDto } from './dto/media-alt.dto';
import { MediaUploadResultDto } from './dto/media-upload-result.dto';
import {
  InstanceMediaCreditDto,
  MediaFilesPageDto,
  MediaFilesQueryDto,
  MediaFileUsagesDto,
  MediaOverviewDto,
  MediaSweepResultDto,
} from './dto/media-admin.dto';
import { MediaAdminService } from './media-admin.service';
import { uploadCeiling } from './media.config';

/**
 * The instance's media, for the `admin` role only (#54). What changes something
 * goes through the administration's runner (`media.*` operations): the same
 * services, with the audit; the page confirms on its own what it destroys.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ManagerOnly()
@UseFilters(RefusalAuditFilter)
@Controller('admin/media')
export class MediaAdminController {
  constructor(
    private readonly admin: MediaAdminService,
    private readonly runner: OperationRunner,
  ) {}

  private async op<T>(
    user: User,
    req: Request,
    id: string,
    raw: Record<string, unknown>,
    attachments?: Record<string, unknown>,
  ): Promise<T> {
    return unwrap<T>(
      await this.runner.run({
        id,
        raw,
        actor: apiActor(user, req),
        attachments,
        preconfirmed: true,
      }),
    );
  }

  /** Uploads a file straight into the instance's media (#62), converted in the browser like any. */
  @Post('instance')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        durationMs: { type: 'integer' },
        peaks: { type: 'string' },
        loudnessLufs: { type: 'number' },
        peakDbfs: { type: 'number' },
        sourceSha256: { type: 'string' },
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: MediaUploadResultDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: uploadCeiling() } }))
  addUpload(
    @CurrentUser() user: User,
    @Req() req: Request,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string } | undefined,
    @Body() fields: Record<string, unknown>,
  ): Promise<MediaUploadResultDto> {
    return this.op(
      user,
      req,
      'media.upload',
      { name: file?.originalname?.slice(0, 255), size: file?.size },
      { file, fields },
    );
  }

  /** Puts an existing file among the instance's media; its author keeps their own. */
  @Post('files/:id/instance')
  @ApiCreatedResponse({ type: MediaUploadResultDto })
  addFile(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<MediaUploadResultDto> {
    return this.op(user, req, 'media.promote', { file: id });
  }

  /** The credit of a global media (no alt text: the host writes it for their quiz). */
  @Put('instance/:id')
  @ApiOkResponse({ type: MediaDescriptionDto })
  setCredit(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: InstanceMediaCreditDto,
  ): Promise<MediaDescriptionDto> {
    return this.op(user, req, 'media.credit', { media: id, credit: body.credit });
  }

  /** Takes a media out of the instance's; the hosts' copies stay theirs. */
  @Delete('instance/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<void> {
    await this.op(user, req, 'media.remove', { media: id });
  }

  @Get('overview')
  @ApiOkResponse({ type: MediaOverviewDto })
  overview(): Promise<MediaOverviewDto> {
    return this.admin.overview();
  }

  @Get('files')
  @ApiOkResponse({ type: MediaFilesPageDto })
  files(@Query() query: MediaFilesQueryDto): Promise<MediaFilesPageDto> {
    return this.admin.files(query);
  }

  /** What deleting a file would break, listed before the confirmation. */
  @Get('files/:id/usages')
  @ApiOkResponse({ type: MediaFileUsagesDto })
  usages(@Param('id') id: string): Promise<MediaFileUsagesDto> {
    return this.admin.usages(id);
  }

  /** Deletes a file and every media on it, used or not; 409 while a session plays it. */
  @Delete('files/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiResponse({ status: 409, description: 'A session is playing it.' })
  async deleteFile(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<void> {
    await this.op(user, req, 'media.delete-file', { file: id });
  }

  /** Runs the clean-up now, instead of waiting for the hourly pass. */
  @Post('sweep')
  @ApiOkResponse({ type: MediaSweepResultDto })
  @HttpCode(200)
  sweep(@CurrentUser() user: User, @Req() req: Request): Promise<MediaSweepResultDto> {
    return this.op(user, req, 'media.sweep', {});
  }
}
