import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaJanitor } from './media-janitor.service';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaJanitor],
  exports: [MediaService],
})
export class MediaModule {}
