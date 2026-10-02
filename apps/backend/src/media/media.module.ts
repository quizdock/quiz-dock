import { Module } from '@nestjs/common';
import { MediaAdminService } from './media-admin.service';
import { MediaController } from './media.controller';
import { MediaJanitor } from './media-janitor.service';
import { MediaLibraryService } from './media-library.service';
import { MediaService } from './media.service';

@Module({
  controllers: [MediaController],
  providers: [MediaService, MediaJanitor, MediaLibraryService, MediaAdminService],
  // The admin page's routes live with the administration (AdminHttpModule).
  exports: [MediaService, MediaLibraryService, MediaAdminService],
})
export class MediaModule {}
