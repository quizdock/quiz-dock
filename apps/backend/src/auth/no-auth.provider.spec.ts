import type { Request } from 'express';
import { localSlug, NoAuthProvider } from './no-auth.provider';

const reqWith = (headers: Record<string, unknown>): Request => ({ headers }) as unknown as Request;

describe('localSlug', () => {
  it('normalise accents, casse et séparateurs', () => {
    expect(localSlug('Éric Martin')).toBe('eric-martin');
    expect(localSlug('  Marc!! ')).toBe('marc');
  });

  it('est déterministe (même entrée → même slug)', () => {
    expect(localSlug('Marc')).toBe(localSlug('Marc'));
  });

  it('retombe sur "default" si vide après normalisation', () => {
    expect(localSlug('!!!')).toBe('default');
  });
});

describe('NoAuthProvider', () => {
  const provider = new NoAuthProvider();

  it('dérive le principal de l’en-tête X-Local-User (rôle attribué par le siège)', async () => {
    const principal = await provider.authenticate(reqWith({ 'x-local-user': 'Marc' }));
    expect(principal).toEqual({
      sub: 'local:marc',
      displayName: 'Marc',
      email: null,
      roles: [],
    });
  });

  it('renvoie null sans en-tête (anonyme : aucun provisionnement par effet de bord)', async () => {
    expect(await provider.authenticate(reqWith({}))).toBeNull();
    expect(await provider.authenticate(reqWith({ 'x-local-user': '   ' }))).toBeNull();
  });

  it('isole deux noms distincts par des sub différents', async () => {
    const a = await provider.authenticate(reqWith({ 'x-local-user': 'Alice' }));
    const b = await provider.authenticate(reqWith({ 'x-local-user': 'Bob' }));
    expect(a?.sub).not.toBe(b?.sub);
  });

  it('sur une démo, tout nom devient le compte partagé', async () => {
    const env = process.env;
    process.env = { ...env, DEMO_MODE: 'true' };
    try {
      const principal = await provider.authenticate(reqWith({ 'x-local-user': 'Alice' }));
      expect(principal).toMatchObject({ sub: 'local:demo-user', displayName: 'demo_user' });
      // Toujours pas d'identité sans en-tête.
      expect(await provider.authenticate(reqWith({}))).toBeNull();
    } finally {
      process.env = env;
    }
  });
});
