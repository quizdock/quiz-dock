import { BadRequestException } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { kahootSpreadsheet } from './kahoot-spreadsheet';
import { QuizPortableService } from './quiz-portable.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MediaService } from '../../media/media.service';

const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const cell = (column: string, row: number, value: string, formula = false) =>
  `<c r="${column}${row}" t="inlineStr">${formula ? '<f>1+1</f>' : ''}<is><t>${escape(value)}</t></is></c>`;
const row = (index: number, values: string[], formulaColumn = '') =>
  `<row r="${index}">${values.map((v, i) => cell('BCDEFGH'[i], index, v, 'BCDEFGH'[i] === formulaColumn)).join('')}</row>`;
const good = ['Question?', 'A', '', 'C', 'D', '30', '3'];
function workbook(rows = row(9, good), extra: Record<string, Uint8Array> = {}) {
  return Buffer.from(
    zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Quiz"/></sheets></workbook>'),
      'xl/worksheets/sheet1.xml': strToU8(
        `<worksheet><sheetData>${row(8, ['Question - 120 max length', 'Answer 1 - 75 max length', 'Answer 2 - 75 max length', 'Answer 3 - 75 max length', 'Answer 4 - 75 max length', 'Time limit', 'Correct answer(s)'])}${rows}</sheetData></worksheet>`,
      ),
      ...extra,
    }),
  );
}

describe('Kahoot spreadsheet', () => {
  it('preserves sparse answer positions and the correct answer, with a file title', () => {
    const result = kahootSpreadsheet(workbook(), 'Capitals.xlsx')!;
    expect(result.bundle.quiz).toEqual({ title: 'Capitals' });
    expect(result.bundle.items[0]).toMatchObject({
      type: 'single_choice',
      timeLimitS: 30,
      options: [
        { text: 'A', isCorrect: false, color: 'red' },
        { text: 'C', isCorrect: true, color: 'yellow' },
        { text: 'D', isCorrect: false, color: 'green' },
      ],
    });
    expect(result.report).toEqual({ source: 'kahoot', converted: 1, skipped: [] });
  });
  it('supports multiple correct answers and reports invalid rows in source order', () => {
    const result = kahootSpreadsheet(
      workbook(
        row(9, [...good.slice(0, 6), '1, 3']) +
          row(10, ['', ...good.slice(1)]) +
          row(11, ['Q', 'A', '', '', '', '30', '1']) +
          row(12, [...good.slice(0, 5), '240', '3']) +
          row(13, [...good.slice(0, 6), '2']) +
          row(14, good, 'B') +
          row(15, ['x'.repeat(1001), ...good.slice(1)]) +
          row(16, ['', '', '', '', '', '', '']),
      ),
    )!;
    expect(result.bundle.items[0]).toMatchObject({ type: 'multiple_choice' });
    expect(result.report.skipped).toEqual([
      { row: 10, reason: 'missing_prompt' },
      { row: 11, reason: 'missing_answers' },
      { row: 12, reason: 'invalid_time' },
      { row: 13, reason: 'invalid_correct' },
      { row: 14, reason: 'formula' },
      { row: 15, reason: 'invalid_content' },
    ]);
  });
  it('reads shared strings and rich text', () => {
    const sheet = `<worksheet><sheetData>${row(8, ['Question -', 'Answer 1 -', 'Answer 2 -', 'Answer 3 -', 'Answer 4 -', 'Time limit', 'Correct answer(s)'])}<row r="9"><c r="B9" t="s"><v>0</v></c>${['A', 'B', '', '', '30', '1'].map((v, i) => cell('CDEFGH'[i], 9, v)).join('')}</row></sheetData></worksheet>`;
    const result = kahootSpreadsheet(
      workbook('', {
        'xl/worksheets/sheet1.xml': strToU8(sheet),
        'xl/sharedStrings.xml': strToU8(
          '<sst><si><r><t>Hello </t></r><r><t>&amp; world</t></r></si></sst>',
        ),
      }),
    )!;
    expect(result.bundle.items[0]).toMatchObject({ prompt: 'Hello & world' });
  });
  it('lets native JSON and bundle files use the existing importer', () => {
    expect(kahootSpreadsheet(Buffer.from('{}'))).toBeNull();
    expect(kahootSpreadsheet(Buffer.from(zipSync({ 'quiz.json': strToU8('{}') })))).toBeNull();
  });
  it('rejects invalid templates, empty quizzes, entities and oversized XML', () => {
    expect(() =>
      kahootSpreadsheet(workbook('', { 'xl/worksheets/sheet1.xml': strToU8('<worksheet/>') })),
    ).toThrow('import.kahoot_template');
    expect(() => kahootSpreadsheet(workbook(row(9, ['', ...good.slice(1)])))).toThrow(
      BadRequestException,
    );
    expect(() =>
      kahootSpreadsheet(
        workbook('', {
          'xl/workbook.xml': strToU8('<!DOCTYPE workbook [<!ENTITY x "boom">]><workbook/>'),
        }),
      ),
    ).toThrow('import.invalid_bundle');
    expect(() =>
      kahootSpreadsheet(
        workbook('', { 'xl/sharedStrings.xml': strToU8('x'.repeat(2 * 1024 * 1024 + 1)) }),
      ),
    ).toThrow('import.bundle_too_large');
  });
  it('persists through the normal transaction with instance language and no licence', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'draft', questions: [] });
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ quiz: { create } })),
    };
    const media = { upload: jest.fn() };
    const service = new QuizPortableService(
      prisma as unknown as PrismaService,
      media as unknown as MediaService,
    );
    const result = await service.importBundle('host', {
      buffer: workbook(),
      mimetype: 'application/octet-stream',
    });
    expect(result.importReport?.converted).toBe(1);
    expect(create.mock.calls[0][0].data).toMatchObject({
      ownerId: 'host',
      status: 'draft',
      license: null,
      questionCount: 1,
    });
    expect(create.mock.calls[0][0].data.language).toBeTruthy();
    expect(media.upload).not.toHaveBeenCalled();
  });
});
