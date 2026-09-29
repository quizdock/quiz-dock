import { BadRequestException } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { strFromU8 } from 'fflate';
import {
  OPTION_COLORS,
  OPTION_SHAPES,
  questionContentSchema,
} from '../../questions/dto/question-content.schema';
import { readArchive } from './bundle-archive';
import { BUNDLE_FORMAT, type QuestionBundleItem, type QuizBundle } from './quiz-bundle.schema';

export const KAHOOT_SKIP_REASONS = [
  'missing_prompt',
  'missing_answers',
  'invalid_time',
  'invalid_correct',
  'formula',
  'invalid_content',
] as const;
export interface KahootImportReport {
  source: 'kahoot';
  converted: number;
  skipped: { row: number; reason: (typeof KAHOOT_SKIP_REASONS)[number] }[];
}

type Node = Record<string, unknown>;
const object = (value: unknown): Node =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : {};
const list = (value: unknown): unknown[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const node = object(value);
  if ('#text' in node) return text(node['#text']);
  if ('t' in node) return text(node.t);
  return list(node.r).map(text).join('');
}

function xml(bytes: Uint8Array): Node {
  const source = strFromU8(bytes);
  // Spreadsheet data has no DTD. Reject entity declarations before parsing them.
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) {
    throw new BadRequestException('import.invalid_bundle');
  }
  return new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false }).parse(
    source,
  ) as Node;
}

/** Read only the standard Kahoot template's cells; never evaluate formulas or fetch links/media. */
export function kahootSpreadsheet(
  buffer: Buffer,
  originalname?: string,
): { bundle: QuizBundle; report: KahootImportReport } | null {
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50) return null;
  const files = readArchive(
    new Uint8Array(buffer),
    (name) =>
      ['xl/workbook.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'].includes(name),
    {
      maxEntries: 2000,
      maxEntryBytes: 2 * 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
    },
  );
  if (!files['xl/workbook.xml']) return null;
  if (!files['xl/worksheets/sheet1.xml']) throw new BadRequestException('import.kahoot_template');
  const workbook = object(xml(files['xl/workbook.xml']).workbook);
  if (list(object(workbook.sheets).sheet).length !== 1)
    throw new BadRequestException('import.kahoot_template');
  const strings = files['xl/sharedStrings.xml']
    ? list(object(xml(files['xl/sharedStrings.xml']).sst).si).map(text)
    : [];
  const rows = new Map<number, Map<string, { value: string; formula: boolean }>>();
  const sheet = object(xml(files['xl/worksheets/sheet1.xml']).worksheet);
  for (const raw of list(object(sheet.sheetData).row)) {
    const row = object(raw);
    const index = Number(row['@_r']);
    if (!Number.isInteger(index) || index < 1 || index > 10000)
      throw new BadRequestException('import.kahoot_template');
    const cells = new Map<string, { value: string; formula: boolean }>();
    for (const rawCell of list(row.c)) {
      const cell = object(rawCell);
      const ref = String(cell['@_r'] ?? '');
      const column = ref.match(/^([A-Z]+)\d+$/)?.[1];
      if (!column || !'BCDEFGH'.includes(column) || column.length !== 1) continue;
      let value = text(cell.v);
      if (cell['@_t'] === 's') {
        const shared = Number(value);
        if (!Number.isInteger(shared) || shared < 0 || shared >= strings.length)
          throw new BadRequestException('import.invalid_bundle');
        value = strings[shared];
      } else if (cell['@_t'] === 'inlineStr') value = text(cell.is);
      cells.set(column, { value: value.trim(), formula: 'f' in cell });
    }
    rows.set(index, cells);
  }
  const headers = rows.get(8);
  if (
    !headers ||
    !/^Question\s*-/i.test(headers.get('B')?.value ?? '') ||
    !['C', 'D', 'E', 'F'].every((c, i) =>
      new RegExp(`^Answer ${i + 1}\\s*-`, 'i').test(headers.get(c)?.value ?? ''),
    ) ||
    !/^Time limit/i.test(headers.get('G')?.value ?? '') ||
    !/^Correct answer\(s\)/i.test(headers.get('H')?.value ?? '')
  ) {
    throw new BadRequestException('import.kahoot_template');
  }
  const items: QuestionBundleItem[] = [];
  const report: KahootImportReport = { source: 'kahoot', converted: 0, skipped: [] };
  for (const [row, cells] of [...rows].sort(([a], [b]) => a - b)) {
    if (row < 9 || ![...cells.values()].some((c) => c.value)) continue;
    const skip = (reason: KahootImportReport['skipped'][number]['reason']) =>
      report.skipped.push({ row, reason });
    if ([...cells.values()].some((c) => c.formula)) {
      skip('formula');
      continue;
    }
    const prompt = cells.get('B')?.value ?? '';
    if (!prompt) {
      skip('missing_prompt');
      continue;
    }
    const answers = ['C', 'D', 'E', 'F'].map((c) => cells.get(c)?.value ?? '');
    if (answers.filter(Boolean).length < 2) {
      skip('missing_answers');
      continue;
    }
    const time = Number(cells.get('G')?.value);
    if (!Number.isInteger(time) || time < 5 || time > 120) {
      skip('invalid_time');
      continue;
    }
    const correctText = cells.get('H')?.value ?? '';
    const correct = correctText.split(',').map((v) => Number(v.trim()));
    if (
      !/^\s*[1-4](\s*,\s*[1-4])*\s*$/.test(correctText) ||
      new Set(correct).size !== correct.length ||
      correct.some((n) => !answers[n - 1])
    ) {
      skip('invalid_correct');
      continue;
    }
    const item: QuestionBundleItem = {
      kind: 'question',
      type: correct.length === 1 ? 'single_choice' : 'multiple_choice',
      prompt,
      timeLimitS: time,
      options: answers.flatMap((answer, i) =>
        answer
          ? [
              {
                text: answer,
                color: OPTION_COLORS[i],
                shape: OPTION_SHAPES[i],
                isCorrect: correct.includes(i + 1),
              },
            ]
          : [],
      ),
    };
    if (!questionContentSchema.safeParse(item).success) {
      skip('invalid_content');
      continue;
    }
    items.push(item);
    if (items.length > 500) throw new BadRequestException('import.bundle_too_large');
  }
  if (!items.length)
    throw new BadRequestException({
      code: 'import.kahoot_empty',
      params: { row: report.skipped[0]?.row ?? 9 },
    });
  report.converted = items.length;
  const title =
    originalname
      ?.split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, '')
      .trim()
      .slice(0, 200) || 'Imported Kahoot quiz';
  return { bundle: { format: BUNDLE_FORMAT, quiz: { title }, items }, report };
}
