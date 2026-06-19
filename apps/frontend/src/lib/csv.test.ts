import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from './csv';

describe('toCsv', () => {
  it('sépare par « ; » et joint les lignes en CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['c', 'd'],
      ]),
    ).toBe('a;b\r\nc;d');
  });

  it('encadre de guillemets les cellules avec « ; », guillemet ou saut de ligne', () => {
    expect(toCsv([['a;b', 'x"y', 'l\nigne']])).toBe('"a;b";"x""y";"l\nigne"');
  });

  it('laisse les nombres négatifs intacts (pas de préfixe sur les numériques)', () => {
    expect(toCsv([[-5, 3.5]])).toBe('-5;3.5');
  });

  it('neutralise l’injection de formule sur les chaînes (préfixe apostrophe)', () => {
    expect(toCsv([['=cmd()']])).toBe("'=cmd()");
    expect(toCsv([['+1', '-x', '@a']])).toBe("'+1;'-x;'@a");
  });
});

describe('csvFilename', () => {
  it('produit un slug ASCII sûr et ajoute .csv', () => {
    expect(csvFilename('Mon Quiz Été', '123456')).toBe('mon-quiz-ete-123456.csv');
  });

  it('retombe sur « export » si tout est filtré', () => {
    expect(csvFilename('***')).toBe('export.csv');
  });
});
