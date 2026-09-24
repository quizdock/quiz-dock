import { Module } from '@nestjs/common';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { HostSeatService } from './host-seat.service';
import { PreferencesService } from './preferences.service';
import { UsersService } from './users.service';

@Module({
  imports: [QuizzesModule],
  providers: [UsersService, HostSeatService, PreferencesService],
  exports: [UsersService, HostSeatService, PreferencesService],
})
export class UsersModule {}
