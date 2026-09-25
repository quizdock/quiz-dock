import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RedisService } from '../redis/redis.service';
import { UsersModule } from '../users/users.module';
import { AuthConfigController } from './auth-config.controller';
import { isOidcMode } from './auth-mode';
import { AUTH_PROVIDER, type AuthProvider } from './auth-provider';
import { AuthGuard } from './auth.guard';
import { HostSeatController } from './host-seat.controller';
import { NoAuthProvider } from './no-auth.provider';
import { OidcSessionController } from './oidc-session.controller';
import { OidcProvider } from './oidc.provider';
import { OidcClient, oidcSettings } from './oidc/oidc-client';
import { OidcSessions } from './oidc/oidc-sessions';

/**
 * Sélectionne l'implémentation d'auth selon `AUTH_MODE` et enregistre le garde
 * d'auth en garde **global** (sécurité par défaut ; échappatoire via `@Public()`).
 * En mode oidc, le client OIDC et les sessions du navigateur (BFF) ; `null` sinon.
 */
@Module({
  imports: [UsersModule],
  controllers: [AuthConfigController, HostSeatController, OidcSessionController],
  providers: [
    {
      provide: OidcClient,
      useFactory: (): OidcClient | null => {
        if (!isOidcMode()) return null;
        if (process.env.OIDC_SESSION_SCOPE) {
          new Logger('Auth').warn(
            'OIDC_SESSION_SCOPE is ignored: the session is a cookie the tabs share, the tokens stay on the server.',
          );
        }
        return new OidcClient(oidcSettings());
      },
    },
    {
      provide: OidcSessions,
      inject: [RedisService, OidcClient],
      useFactory: (redis: RedisService, client: OidcClient | null) =>
        client ? new OidcSessions(redis, client) : null,
    },
    {
      provide: OidcProvider,
      inject: [OidcClient, OidcSessions],
      useFactory: (client: OidcClient | null, sessions: OidcSessions | null) =>
        client && sessions ? new OidcProvider(client, sessions) : null,
    },
    {
      provide: AUTH_PROVIDER,
      inject: [OidcProvider],
      useFactory: (oidc: OidcProvider | null): AuthProvider => oidc ?? new NoAuthProvider(),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AUTH_PROVIDER],
})
export class AuthModule {}
