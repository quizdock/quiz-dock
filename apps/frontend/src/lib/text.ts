/** Accent- and case-insensitive folding, so « Été » is found by typing « ete ». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
