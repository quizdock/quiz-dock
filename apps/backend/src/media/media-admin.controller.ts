import { Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ManagerOnly } from '../auth/manager-only.decorator';
import {
  MediaFilesPageDto,
  MediaFilesQueryDto,
  MediaFileUsagesDto,
  MediaOverviewDto,
  MediaSweepResultDto,
} from './dto/media-admin.dto';
import { MediaAdminService } from './media-admin.service';

/** The instance's media, for the `admin` role only (#54). */
@ApiTags('admin')
@ApiBearerAuth()
@ManagerOnly()
@Controller('admin/media')
export class MediaAdminController {
  constructor(private readonly admin: MediaAdminService) {}

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
