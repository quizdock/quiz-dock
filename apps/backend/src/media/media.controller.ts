import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
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
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { MediaUploadResultDto } from './dto/media-upload-result.dto';
import { MediaService } from './media.service';

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

  @Get(':id')
  @Public()
  @ApiOkResponse({ description: 'Contenu binaire du média.' })
  async serve(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, mime, sizeBytes } = await this.media.openStream(id);
    res.set({ 'Content-Type': mime, 'Content-Length': String(sizeBytes) });
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
