import { z } from 'zod';

/**
 * Normalise une réponse texte pour comparaison (RG-06) : minuscule, sans accent,
 * espaces superflus retirés. Calculé côté serveur (le client n'envoie que `text`).
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

const optionInputSchema = z.object({
  text: z.string().trim().max(500).optional(),
  mediaId: z.string().length(26).optional(),
  color: z.enum(['red', 'blue', 'yellow', 'green']),
  shape: z.enum(['triangle', 'diamond', 'circle', 'square']),
  isCorrect: z.boolean().default(false),
  correctOrderIndex: z.number().int().min(0).optional(),
});

const acceptedAnswerInputSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export const QUESTION_TYPES = [
  'single_choice',
  'multiple_choice',
  'true_false',
  'text_input',
  'numeric',
  'ordering',
  'poll',
] as const;

/** Types reposant sur une liste d'options affichées. */
const OPTION_TYPES = new Set([
  'single_choice',
  'multiple_choice',
  'true_false',
  'ordering',
  'poll',
]);

/**
 * Contenu d'une question, avec validation **par type** (technique §4, RG-03).
 * Bornes alignées sur les CHECK SQL (timeLimitS 5–120, tolérance ≥ 0).
 */
export const questionContentSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().trim().min(1).max(1000),
    mediaId: z.string().length(26).optional(),
    timeLimitS: z.number().int().min(5).max(120).default(20),
    pointsMode: z.enum(['standard', 'double', 'none']).default('standard'),
    numericValue: z.number().optional(),
    numericTolerance: z.number().min(0).optional(),
    options: z.array(optionInputSchema).max(6).default([]),
    acceptedAnswers: z.array(acceptedAnswerInputSchema).max(20).default([]),
  })
  .superRefine((d, ctx) => {
    const err = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    const correct = d.options.filter((o) => o.isCorrect).length;

    // Champs interdits hors de leur type.
    if (!OPTION_TYPES.has(d.type) && d.options.length > 0) {
      err('Aucune option permise pour ce type.', ['options']);
    }
    if (d.type !== 'text_input' && d.acceptedAnswers.length > 0) {
      err('Réponses acceptées réservées au type text_input.', ['acceptedAnswers']);
    }
    if (d.type !== 'numeric' && (d.numericValue != null || d.numericTolerance != null)) {
      err('Champs numériques réservés au type numeric.', ['numericValue']);
    }

    switch (d.type) {
      case 'single_choice':
        if (d.options.length < 2 || d.options.length > 6)
          err('Entre 2 et 6 options requises.', ['options']);
        if (correct !== 1) err('Exactement une option correcte requise.', ['options']);
        break;
      case 'multiple_choice':
        if (d.options.length < 2 || d.options.length > 6)
          err('Entre 2 et 6 options requises.', ['options']);
        if (correct < 1) err('Au moins une option correcte requise.', ['options']);
        break;
      case 'true_false':
        if (d.options.length !== 2) err('Vrai/Faux requiert exactement 2 options.', ['options']);
        if (correct !== 1) err('Exactement une option correcte requise.', ['options']);
        break;
      case 'poll':
        if (d.options.length < 2 || d.options.length > 6)
          err('Entre 2 et 6 options requises.', ['options']);
        if (correct > 0) err('Un sondage n’a pas de bonne réponse.', ['options']);
        break;
      case 'ordering': {
        if (d.options.length < 2 || d.options.length > 6)
          err('Entre 2 et 6 options requises.', ['options']);
        const idx = d.options.map((o) => o.correctOrderIndex);
        if (idx.some((i) => i == null)) {
          err('Chaque option doit porter un correctOrderIndex (type ordering).', ['options']);
        } else {
          const sorted = [...(idx as number[])].sort((a, b) => a - b);
          if (!sorted.every((v, i) => v === i))
            err('Les correctOrderIndex doivent former une permutation 0..n-1.', ['options']);
        }
        break;
      }
      case 'text_input':
        if (d.acceptedAnswers.length < 1)
          err('Au moins une réponse acceptée requise.', ['acceptedAnswers']);
        break;
      case 'numeric':
        if (d.numericValue == null)
          err('numericValue requis pour le type numeric.', ['numericValue']);
        if (d.numericTolerance == null)
          err('numericTolerance requis pour le type numeric.', ['numericTolerance']);
        break;
    }
  });

export type QuestionContent = z.infer<typeof questionContentSchema>;
