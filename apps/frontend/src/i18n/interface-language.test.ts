import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import './index';
import { setInterfaceLanguage } from './interface-language';

describe('the interface language (#209)', () => {
  afterEach(() => setInterfaceLanguage(null));

  it('switches to a language the app speaks, loading it first, and back', async () => {
    await setInterfaceLanguage('tr-TR');
    expect(i18next.language).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
    expect(i18next.t('live:control.start')).not.toBe('control.start');
    await setInterfaceLanguage(null);
    expect(i18next.language).toBe('fr'); // tests pin the instance to French
  });

  it("falls back to the instance's for a language the app does not speak", async () => {
    await setInterfaceLanguage('de');
    expect(i18next.language).toBe('fr');
  });
});
