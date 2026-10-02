import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { ThemeService } from '../theme/theme.service';

/** The instance's palette, as a stylesheet every page loads (lot 5). */
@Controller()
export class ThemeController {
  constructor(private readonly theme: ThemeService) {}

  @Public()
  @Get('branding/theme.css')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/css; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  css(): Promise<string> {
    return this.theme.css();
  }
}
