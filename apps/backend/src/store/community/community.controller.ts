import { Body, Controller, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { Response } from 'express';
import { mediaHeaders } from '../../media/media-response';
import { QuizDto } from '../../quizzes/dto/quiz.dto';
import { CommunityService } from './community.service';
import { CommunityCatalogueDto, CommunityPreviewDto, CommunityTakeDto } from './community.dto';
@ApiTags('community-store')
@Controller('community-store')
export class CommunityController {
  constructor(private readonly store: CommunityService) {}
  @Get()
  @ApiOkResponse({ type: CommunityCatalogueDto })
  list() {
    return this.store.list();
  }
  @Get(':key')
  @ApiOkResponse({ type: CommunityPreviewDto })
  preview(@Param('key') key: string) {
    return this.store.preview(key);
  }
  @Get(':key/media/:name')
  @ApiOkResponse({ description: 'Verified media from the cached community bundle.' })
  async media(
    @Param('key') key: string,
    @Param('name') name: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { bytes, mime } = await this.store.readMedia(key, name);
    res.set({ ...mediaHeaders(mime), 'Cache-Control': 'private, max-age=300' });
    return new StreamableFile(bytes);
  }
  @Post('take')
  @ApiCreatedResponse({ type: QuizDto })
  take(@CurrentUser() user: User, @Body() body: CommunityTakeDto) {
    return this.store.take(user.id, body.key);
  }
}
