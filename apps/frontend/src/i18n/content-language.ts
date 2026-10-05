import i18next from 'i18next';
import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { type AppLang, type Namespace, supportedLngs } from './languages';

const files = import.meta.glob<{ default: Record<string, unknown> }>('./locales/*/*.json');

/** The language the app speaks for a quiz's BCP 47 tag (`fr-CA` → `fr`), if it speaks it. */
export function contentLang(tag: string): AppLang | null {
  const lower = tag.toLowerCase();
  const exact = supportedLngs.find((lang) => lang.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('-')[0];
  return supportedLngs.find((lang) => lang === base) ?? null;
}

/** Loads one namespace of a language other than the instance's. */
export async function loadNamespace(lang: AppLang, ns: Namespace): Promise<void> {
  if (i18next.hasResourceBundle(lang, ns)) return;
  const { default: bundle } = await files[`./locales/${lang}/${ns}.json`]();
  i18next.addResourceBundle(lang, ns, bundle, true, true);
}

/**
 * `t` in a quiz's language (#83), for the text the app writes into a quiz (the True and
 * False of a true or false question). The interface's language while that one loads, or
 * when the app does not speak it.
 */
export function useContentT(language: string | undefined, ns: Namespace) {
  const { t } = useTranslation(ns);
  const [, loaded] = useReducer((n: number) => n + 1, 0);
  const lang = language ? contentLang(language) : null;
  const ready = lang !== null && i18next.hasResourceBundle(lang, ns);
  useEffect(() => {
    if (lang && !ready) void loadNamespace(lang, ns).then(loaded);
  }, [lang, ns, ready]);
  return ready ? i18next.getFixedT(lang, ns) : t;
}
