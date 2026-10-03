import { useHotkeys } from 'react-hotkeys-hook';

/**
 * The app's keyboard shortcuts all go through react-hotkeys-hook: one way to name
 * keys (`mod+s` is Cmd+S on macOS, Ctrl+S elsewhere), modifiers matched exactly,
 * and what is typed in a field left alone unless a shortcut says otherwise. Keys a
 * focused widget handles itself (a list's arrows, a slider's) stay on that widget.
 */

/** Escape closes what is open, from a field inside it too. */
export function useEscape(
  onEscape: (e: KeyboardEvent) => void,
  enabled: boolean,
  ignoreEventWhen?: (e: KeyboardEvent) => boolean,
) {
  useHotkeys(
    'esc',
    onEscape,
    { enabled, enableOnFormTags: true, enableOnContentEditable: true, ignoreEventWhen },
    [onEscape, ignoreEventWhen],
  );
}
