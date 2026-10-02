import { Module } from '@nestjs/common';
import { MediaAdminController } from '../../media/media-admin.controller';
import { MediaModule } from '../../media/media.module';
import { AdminModule } from '../admin.module';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminRateLimit } from './admin-rate-limit';

/** The administration's HTTP access (§3.4): the admin API and the media page's routes. */
@Module({
  imports: [AdminModule, MediaModule],
  controllers: [AdminOperationsController, MediaAdminController],
  providers: [AdminRateLimit],
})
export class AdminHttpModule {}
