/** A language by its name, in the UI's language ("zh-TW" → "Chinese (Taiwan)"). */
export function languageName(code: string, uiLanguage: string): string {
  try {
    return new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A licence as people read it: "CC BY 4.0" rather than "CC-BY-4.0". */
const LICENSE_NAMES: Record<string, string> = {
  'CC0-1.0': 'CC0',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
};
export function licenseName(spdx: string): string {
  return LICENSE_NAMES[spdx] ?? spdx;
}
