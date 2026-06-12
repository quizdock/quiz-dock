import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/** Module global : `RedisService` injectable partout (un seul client). */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
