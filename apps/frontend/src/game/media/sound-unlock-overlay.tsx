import { Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ChromiumNotice } from '@/components/chromium-notice';
import { unlockAudio } from './audio-unlock';

/**
 * The projection's one question to the host, at the lobby: may this window
 * play sound? A browser answers yes only after a click in this very window —
 * the console is another one — so a click anywhere on the overlay counts, once.
 */
export function SoundUnlockOverlay() {
  const { t } = useTranslation('live');
  return (
    // The whole surface answers the click; the button is there for the keyboard.
    <div
      onClick={() => void unlockAudio()}
      className="bg-background/85 absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center gap-[0.75em] p-[2em] backdrop-blur"
    >
      <button
        type="button"
        className="flex flex-col items-center gap-[0.5em] rounded-xl p-[1em] focus-visible:outline-2"
      >
        <Volume2 className="text-primary size-[3em]" />
        <span className="text-[1.75em] font-semibold">{t('media.enableSound')}</span>
      </button>
      <p className="text-muted-foreground max-w-[32em] text-[1em]">{t('media.unlockHint')}</p>
      <div className="max-w-[40em] text-left text-[0.6em]">
        <ChromiumNotice />
      </div>
    </div>
  );
}
