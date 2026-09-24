import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
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
import { CurrentUser } from '../auth/current-user.decorator';
import { ManagerOnly } from '../auth/manager-only.decorator';
import { MediaDescriptionDto } from './dto/media-alt.dto';
import { MediaUploadResultDto } from './dto/media-upload-result.dto';
import {
  InstanceMediaDetailsDto,
  MediaFilesPageDto,
  MediaFilesQueryDto,
  MediaFileUsagesDto,
  MediaOverviewDto,
  MediaSweepResultDto,
} from './dto/media-admin.dto';
import { MediaAdminService } from './media-admin.service';
import { uploadCeiling } from './media.config';
import { MediaService } from './media.service';

/** The instance's media, for the `admin` role only (#54). */
@ApiTags('admin')
@ApiBearerAuth()
@ManagerOnly()
@Controller('admin/media')
export class MediaAdminController {
  constructor(
    private readonly admin: MediaAdminService,
    private readonly media: MediaService,
  ) {}

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
      },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: MediaUploadResultDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: uploadCeiling() } }))
  addUpload(
    @CurrentUser() user: User,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string } | undefined,
    @Body() fields: Record<string, unknown>,
  ): Promise<MediaUploadResultDto> {
    return this.media.upload(user.id, file, fields, { instance: true });
  }

  /** Puts an existing file among the instance's media; its author keeps their own. */
  @Post('files/:id/instance')
  @ApiCreatedResponse({ type: MediaUploadResultDto })
  addFile(@CurrentUser() user: User, @Param('id') id: string): Promise<MediaUploadResultDto> {
    return this.media.addToInstance(user.id, id);
  }

  /** Alt text and credit of one of the instance's media. */
  @Put('instance/:id')
  @ApiOkResponse({ type: MediaDescriptionDto })
  setDetails(
    @Param('id') id: string,
    @Body() body: InstanceMediaDetailsDto,
  ): Promise<MediaDescriptionDto> {
    return this.media.setInstanceDetails(id, body);
  }

  /** Takes a media out of the instance's; the hosts' copies stay theirs. */
  @Delete('instance/:id')
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.media.removeFromInstance(id);
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
  deleteFile(@Param('id') id: string): Promise<void> {
    return this.admin.deleteFile(id);
  }

  /** Runs the clean-up now, instead of waiting for the hourly pass. */
  @Post('sweep')
  @ApiOkResponse({ type: MediaSweepResultDto })
  @HttpCode(200)
  async sweep(): Promise<MediaSweepResultDto> {
    const result = await this.admin.sweepNow();
    return { ran: result !== null, result };
  }
}
