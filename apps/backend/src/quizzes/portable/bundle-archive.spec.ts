import { strToU8, zipSync } from 'fflate';
import { type ArchiveLimits, readArchive } from './bundle-archive';

const LIMITS: ArchiveLimits = { maxEntries: 10, maxEntryBytes: 1024, maxTotalBytes: 4096 };
const all = () => true;

/** Rewrites the uncompressed size a zip's first local header declares: the header lies. */
function declareSize(zip: Uint8Array, size: number): Uint8Array {
  const out = zip.slice();
  new DataView(out.buffer).setUint32(22, size, true);
  return out;
}

const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as Error).message;
  }
  return null;
};

describe('readArchive', () => {
  it('inflates the entries it keeps and skips the others', () => {
    const zip = zipSync({
      'quiz.json': strToU8('{}'),
      'media/a.png': new Uint8Array(10),
      'x/y': new Uint8Array(3),
    });
    const files = readArchive(zip, (name) => name !== 'x/y', LIMITS);
    expect(Object.keys(files).sort()).toEqual(['media/a.png', 'quiz.json']);
    expect(files['media/a.png']).toHaveLength(10);
  });

  it('refuses an entry larger than allowed, counted on the inflated bytes', () => {
    // Zeros deflate to almost nothing: the compressed size says nothing.
    const zip = zipSync({ 'media/a.png': new Uint8Array(2048) }, { level: 9 });
    expect(refusal(() => readArchive(zip, all, LIMITS))).toBe('import.bundle_too_large');
  });

  it('does not trust the size the header declares', () => {
    const zip = declareSize(zipSync({ 'media/a.png': new Uint8Array(2048) }, { level: 9 }), 16);
    expect(refusal(() => readArchive(zip, all, LIMITS))).toBe('import.bundle_too_large');
  });

  it('refuses entries that each fit but together exceed the total', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5; i++) files[`media/${i}.png`] = new Uint8Array(1000);
    expect(refusal(() => readArchive(zipSync(files), all, LIMITS))).toBe('import.bundle_too_large');
  });

  it('refuses too many entries, skipped ones counted', () => {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 11; i++) files[`junk/${i}`] = new Uint8Array(1);
    expect(refusal(() => readArchive(zipSync(files), () => false, LIMITS))).toBe(
      'import.bundle_too_large',
    );
  });

  it('refuses what is not a zip it can read', () => {
    const zip = zipSync({ 'quiz.json': strToU8('{"a":1}') });
    const broken = zip.slice(0, 40);
    expect(refusal(() => readArchive(broken, all, LIMITS))).not.toBeNull();
  });
});
