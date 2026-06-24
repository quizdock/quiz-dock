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

  it('dérive le principal de l’en-tête X-Local-User (rôle host)', async () => {
    const principal = await provider.authenticate(reqWith({ 'x-local-user': 'Marc' }));
    expect(principal).toEqual({
      sub: 'local:marc',
      displayName: 'Marc',
      email: null,
      roles: ['host'],
    });
  });

  it('utilise un utilisateur par défaut sans en-tête', async () => {
    const principal = await provider.authenticate(reqWith({}));
    expect(principal.sub).toBe('local:animateur-local');
    expect(principal.displayName).toBe('Animateur local');
  });

  it('isole deux noms distincts par des sub différents', async () => {
    const a = await provider.authenticate(reqWith({ 'x-local-user': 'Alice' }));
    const b = await provider.authenticate(reqWith({ 'x-local-user': 'Bob' }));
    expect(a.sub).not.toBe(b.sub);
  });
});
