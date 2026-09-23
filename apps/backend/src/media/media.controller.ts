import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { MediaAltDto, MediaDescriptionDto } from './dto/media-alt.dto';
import { MediaUploadResultDto } from './dto/media-upload-result.dto';
import { MediaService } from './media.service';
import { parseRange } from './range';

const MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 10 * 1024 * 1024);

interface UploadedMediaFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiCreatedResponse({ type: MediaUploadResultDto })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  upload(@CurrentUser() user: User, @UploadedFile() file: UploadedMediaFile | undefined) {
    return this.media.upload(user.id, file);
  }

  /** The alternative text of one of the caller's media (#43). */
  @Get(':id/meta')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MediaDescriptionDto })
  describe(@CurrentUser() user: User, @Param('id') id: string): Promise<MediaDescriptionDto> {
    return this.media.describe(user.id, id);
  }

  @Put(':id/alt')
  @ApiBearerAuth()
  @ApiOkResponse({ type: MediaDescriptionDto })
  setAlt(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: MediaAltDto,
  ): Promise<MediaDescriptionDto> {
    return this.media.setAlt(user.id, id, body.alt);
  }

  /**
   * The bytes of a media, whole or by `Range` — Safari plays no video it cannot
   * seek into. An id names one file forever (a replaced media gets a new id), so
   * the response may be cached for good; `nosniff` keeps the browser to the type
   * the server decided.
   */
  @Get(':id')
  @Public()
  @ApiOkResponse({ description: 'Contenu binaire du média.' })
  @ApiResponse({ status: 206, description: 'Partie demandée par `Range`.' })
  @ApiResponse({ status: 416, description: 'Plage hors du fichier.' })
  async serve(
    @Param('id') id: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | undefined> {
    const size = await this.media.sizeOf(id);
    res.set({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    });
    const range = parseRange(rangeHeader, size);
    if (range === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${size}`);
      return undefined;
    }
    const { stream, mime } = await this.media.openStream(id, range ?? undefined);
    if (range) {
      res.status(206).set({
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      });
    } else {
      res.set('Content-Length', String(size));
    }
    res.set('Content-Type', mime);
    return new StreamableFile(stream);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.media.remove(user.id, id);
  }
}
