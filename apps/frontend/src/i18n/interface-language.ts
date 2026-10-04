import i18next from 'i18next';
import { useEffect, useSyncExternalStore } from 'react';
import { contentLang, loadNamespace } from './content-language';
import { namespaces, resolveLang } from './languages';

/**
 * The interface's language (#209). The instance's by default (`APP_LANG`); a host's
 * own screens follow their preference; the audience's screens (the projection, a
 * participant's once in a game) follow the room's choice, else the quiz's language.
 * A language the app does not speak falls back to the instance's.
 */

/** Switches the interface to `tag` (BCP 47) when the app speaks it, else to the instance's. */
export async function setInterfaceLanguage(tag: string | null): Promise<void> {
  const lang = (tag && contentLang(tag)) || resolveLang();
  if (i18next.language === lang) return;
  await Promise.all(namespaces.map((ns) => loadNamespace(lang, ns)));
  await i18next.changeLanguage(lang);
  document.documentElement.lang = lang;
}

let audience: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const tell = (tag: string | null) => {
  audience = tag;
  for (const listener of listeners) listener();
};

/** A game screen asks for the audience's language while it is shown (null: not known yet). */
export function useAudienceLanguage(tag: string | null | undefined): void {
  useEffect(() => {
    tell(tag ?? null);
    return () => tell(null);
  }, [tag]);
}

/** Applies the language: the audience's on a game screen, else `hostLanguage`, else the instance's. */
export function useInterfaceLanguage(hostLanguage: string | null): void {
  const wanted = useSyncExternalStore(subscribe, () => audience) ?? hostLanguage;
  useEffect(() => {
    void setInterfaceLanguage(wanted);
  }, [wanted]);
}
