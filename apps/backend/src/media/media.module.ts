import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaJanitor } from './media-janitor.service';
import { MediaLibraryService } from './media-library.service';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaJanitor, MediaLibraryService],
  exports: [MediaService, MediaLibraryService],
})
export class MediaModule {}
