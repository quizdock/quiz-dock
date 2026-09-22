import { Module } from '@nestjs/common';
import { QuizzesModule } from '../quizzes/quizzes.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';

@Module({
  imports: [QuizzesModule],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
