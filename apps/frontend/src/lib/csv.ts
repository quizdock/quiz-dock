/**
 * Échappe une cellule CSV (RFC 4180) : encadre de guillemets si caractère spécial.
 * Neutralise aussi l'injection de formule (une saisie texte commençant par `= + - @`
 * pourrait s'exécuter dans Excel) en la préfixant d'une apostrophe — uniquement sur
 * les chaînes, pour ne pas altérer les nombres négatifs passés en numérique.
 */
function csvCell(value: string | number): string {
  let s = String(value ?? '');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Construit un CSV depuis une matrice de lignes (séparateur `;` — compat Excel FR). */
export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

/** Déclenche le téléchargement d'un fichier CSV (BOM UTF-8 pour Excel). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Nom de fichier sûr (slug ASCII, sans espaces ni caractères spéciaux). */
export function csvFilename(...parts: string[]): string {
  const slug = parts
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${slug || 'export'}.csv`;
}
