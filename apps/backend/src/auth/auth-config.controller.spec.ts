import { AuthConfigController } from './auth-config.controller';

describe('AuthConfigController', () => {
  const controller = new AuthConfigController();
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it('renvoie le mode none par défaut (sans OIDC)', () => {
    process.env = { ...env, AUTH_MODE: 'none' };
    expect(controller.config()).toEqual({ mode: 'none', oidc: null });
  });

  it('renvoie le mode oidc avec authority + clientId', () => {
    process.env = {
      ...env,
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'http://localhost:18080/realms/live-quizz',
      OIDC_CLIENT_ID: 'live-quizz-frontend',
    };
    expect(controller.config()).toEqual({
      mode: 'oidc',
      oidc: {
        authority: 'http://localhost:18080/realms/live-quizz',
        clientId: 'live-quizz-frontend',
      },
    });
  });
});
