#!/usr/bin/env node
/**
 * Keys a locale gained since a git ref — `pnpm --filter @quiz-dock/frontend i18n:since <ref> [locale]`.
 *
 * Lists, per namespace, the keys of `<locale>` (default `zh-TW`) that did not
 * exist at `<ref>` (a tag, branch or commit), plus the keys whose `en` text
 * changed since, as a Markdown table `key | en | <locale>` on stdout. Meant to
 * hand a native reviewer exactly the strings written since their last pass —
 * paste it into an issue after each release. Reads git only, writes nothing.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [ref, locale = 'zh-TW'] = process.argv.slice(2);
if (!ref) {
  console.error('usage: locale-since.mjs <git-ref> [locale]');
  process.exit(2);
}
const REFERENCE = 'en';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localesRel = 'src/i18n/locales';

/** Flattens a JSON object into `dotted.key → string` pairs. */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

/** The namespace file at `ref` (empty map when it did not exist), or on disk when `ref` is null. */
function load(lang, ns, at) {
  const rel = `${localesRel}/${lang}/${ns}.json`;
  try {
    const text = at
      ? execFileSync('git', ['show', `${at}:apps/frontend/${rel}`], {
          cwd: root,
          stdio: ['ignore', 'pipe', 'ignore'],
        }).toString()
      : readFileSync(join(root, rel), 'utf8');
    return flatten(JSON.parse(text));
  } catch {
    return new Map();
  }
}

const cell = (s) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const namespaces = readdirSync(join(root, localesRel, REFERENCE))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

const out = [];
let total = 0;
for (const ns of namespaces) {
  const enNow = load(REFERENCE, ns, null);
  const enThen = load(REFERENCE, ns, ref);
  const locThen = load(locale, ns, ref);
  const locNow = load(locale, ns, null);
  const rows = [];
  for (const [key, en] of enNow) {
    const isNew = !locThen.has(key);
    const enChanged = enThen.has(key) && enThen.get(key) !== en;
    if (isNew || enChanged)
      rows.push([`${isNew ? '' : '✎ '}${key}`, cell(en), cell(locNow.get(key) ?? '_missing_')]);
  }
  if (rows.length === 0) continue;
  total += rows.length;
  out.push(
    `### \`${ns}.json\` — ${rows.length}`,
    '',
    `| key | \`${REFERENCE}\` | \`${locale}\` |`,
    '| --- | --- | --- |',
  );
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  out.push('');
}
process.stdout.write(
  [
    `## \`${locale}\` — ${total} string(s) since \`${ref}\` (✎ = English text changed, translation may be stale)`,
    '',
    ...out,
  ].join('\n'),
);
