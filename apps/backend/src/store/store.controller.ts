import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { AllowAnyRole } from '../auth/allow-any-role.decorator';
import { AllowManager } from '../auth/allow-manager.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { QuizDto } from '../quizzes/dto/quiz.dto';
import { ShareTemplateDto } from './dto/share-template.dto';
import { StoreEntryDto } from './dto/store-entry.dto';
import { StoreService } from './store.service';

/**
 * The catalogue of shared templates (#39). Browsing is open to any signed-in
 * account; sharing, taking and withdrawing need the host privileges the global
 * guard already enforces.
 */
@ApiTags('store')
@Controller('store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Get()
  @AllowAnyRole()
  @ApiOkResponse({ type: StoreEntryDto, isArray: true })
  list(): Promise<StoreEntryDto[]> {
    return this.store.list();
  }

  /** Shares one of the caller's `ready` quizzes as a template. */
  @Post()
  @ApiOkResponse({ type: StoreEntryDto })
  share(@CurrentUser() user: User, @Body() body: ShareTemplateDto): Promise<StoreEntryDto> {
    return this.store.share(user, body.quizId);
  }

  /** Takes a copy: a new draft in the caller's own bank. */
  @Post(':id/take')
  @ApiOkResponse({ type: QuizDto })
  take(@CurrentUser() user: User, @Param('id') id: string) {
    return this.store.take(user.id, id);
  }

  /** Withdraws an entry — its author, or an `admin` for any of them. */
  @Delete(':id')
  @AllowManager()
  withdraw(@CurrentUser() user: User, @Param('id') id: string): Promise<void> {
    return this.store.withdraw(user, id);
  }
}
