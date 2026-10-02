import { Module } from '@nestjs/common';
import { MediaAdminController } from '../../media/media-admin.controller';
import { MediaModule } from '../../media/media.module';
import { AdminModule } from '../admin.module';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminRateLimit } from './admin-rate-limit';
import { SetupController } from './setup.controller';
import { ThemeController } from './theme.controller';
import { AuthModule } from '../../auth/auth.module';
import { UsersModule } from '../../users/users.module';

/** The administration's HTTP access (§3.4): the admin API and the media page's routes. */
@Module({
  imports: [AdminModule, MediaModule, AuthModule, UsersModule],
  controllers: [AdminOperationsController, MediaAdminController, SetupController, ThemeController],
  providers: [AdminRateLimit],
})
export class AdminHttpModule {}
