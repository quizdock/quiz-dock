import { Module } from '@nestjs/common';
import { MediaAdminController } from './media-admin.controller';
import { MediaAdminService } from './media-admin.service';
import { MediaController } from './media.controller';
import { MediaJanitor } from './media-janitor.service';
import { MediaLibraryService } from './media-library.service';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController, MediaAdminController],
  providers: [MediaService, MediaJanitor, MediaLibraryService, MediaAdminService],
  exports: [MediaService, MediaLibraryService],
})
export class MediaModule {}
