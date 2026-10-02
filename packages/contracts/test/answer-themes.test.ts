import { describe, expect, it } from 'vitest';
import {
  ANSWER_THEMES,
  answerTheme,
  answerThemeCss,
  closestPairs,
  glyphOf,
} from '../src/admin/answer-themes';

describe('answer themes (administration, lot 6)', () => {
  const minimum = (id: string, count: number) =>
    Math.min(...closestPairs(answerTheme(id), count).map((p) => p.distance));

  it('every theme draws a glyph beside the colour: never colour alone', () => {
    for (const theme of ANSWER_THEMES) expect(['shape', 'letter', 'number']).toContain(theme.glyph);
    expect(glyphOf('letter', 0)).toBe('A');
    expect(glyphOf('number', 3)).toBe('4');
    expect(glyphOf('shape', 1)).toBeNull();
  });

  it('the colour-blind theme keeps the slots apart under every common deficiency, far better than the classic', () => {
    expect(minimum('colorblind', 4)).toBeGreaterThan(0.12);
    expect(minimum('colorblind', 8)).toBeGreaterThan(0.07);
    expect(minimum('colorblind', 4)).toBeGreaterThan(2.5 * minimum('classic', 4));
  });

  it('a theme writes only the colours it changes', () => {
    expect(answerThemeCss(answerTheme('classic'))).toBe('');
    expect(answerThemeCss(answerTheme('colorblind'))).toContain('--answer-red: #cc3311;');
    expect(answerTheme('nope').id).toBe('classic');
  });
});
