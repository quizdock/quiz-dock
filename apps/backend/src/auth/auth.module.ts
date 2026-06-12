import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthConfigController } from './auth-config.controller';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { AuthGuard } from './auth.guard';
import { NoAuthProvider } from './no-auth.provider';
import { OidcProvider } from './oidc.provider';

/**
 * Sélectionne l'implémentation d'auth selon `AUTH_MODE` et enregistre le garde
 * d'auth en garde **global** (sécurité par défaut ; échappatoire via `@Public()`).
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthConfigController],
  providers: [
    {
      provide: AUTH_PROVIDER,
      useFactory: (): AuthProvider =>
        (process.env.AUTH_MODE ?? 'none') === 'oidc' ? new OidcProvider() : new NoAuthProvider(),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH_PROVIDER],
})
export class AuthModule {}
