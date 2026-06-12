import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Plein écran via l'API Fullscreen, sur un élément réf. Réutilisable par les
 * écrans live (projeté/joueur, v0.3.0) et l'aperçu. Dégrade proprement si l'API
 * est absente (ex. jsdom, navigateurs restreints).
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const supported = typeof document !== 'undefined' && 'fullscreenEnabled' in document;

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(async () => {
    const el = ref.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen?.();
      }
    } catch {
      // ignore (refus utilisateur / non supporté)
    }
  }, []);

  return { ref, isFullscreen, toggle, supported };
}
