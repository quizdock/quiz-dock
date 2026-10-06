#!/usr/bin/env node
/**
 * After shoot.mjs: the phones side by side on a light band, and the demo GIF from
 * the big screen's and the phone's frames. Reads /out/.work/assemble.json, writes
 * into /out, then removes .work. Runs where ffmpeg is (run.sh: the sample-media image).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const OUT = process.env.OUT ?? '/out';
const WORK = `${OUT}/.work`;
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
const { composites, frames } = JSON.parse(readFileSync(`${WORK}/assemble.json`, 'utf8'));

for (const { name, parts } of composites) {
  const pads = parts.map((_, i) => `[${i}:v]pad=iw+48:ih+48:24:24:color=0xf1f5f9[p${i}]`);
  const stack = `${parts.map((_, i) => `[p${i}]`).join('')}hstack=inputs=${parts.length}`;
  ffmpeg(
    ...parts.flatMap((p) => ['-i', p]),
    '-filter_complex',
    `${pads.join(';')};${stack}`,
    `${OUT}/${name}.png`,
  );
  console.log('composite', name);
}

// The GIF on the logo's purple: the host's console above the big screen, the phone
// beside them; each frame for as long as it lasted.
if (frames?.length) {
  const list = (page) =>
    frames.map(({ n, d }) => `file '${WORK}/film/${page}-${n}.png'\nduration ${d}\n`).join('') +
    `file '${WORK}/film/${page}-${frames.at(-1).n}.png'\n`;
  writeFileSync(`${WORK}/screen.txt`, list('screen'));
  writeFileSync(`${WORK}/phone.txt`, list('phone'));
  writeFileSync(`${WORK}/console.txt`, list('console'));
  ffmpeg(
    ...['-f', 'concat', '-safe', '0', '-i', `${WORK}/screen.txt`],
    ...['-f', 'concat', '-safe', '0', '-i', `${WORK}/phone.txt`],
    ...['-f', 'concat', '-safe', '0', '-i', `${WORK}/console.txt`],
    '-filter_complex',
    [
      '[0:v]scale=960:540:flags=lanczos[s]',
      '[1:v]scale=575:1150:flags=lanczos[p]',
      '[2:v]scale=960:590:flags=lanczos[c]',
      'color=c=0x2a1a4f:s=1655x1230[bg]',
      '[bg][c]overlay=40:40:shortest=1[a]',
      '[a][s]overlay=40:650:shortest=1[b]',
      '[b][p]overlay=1040:40:shortest=1,fps=10,scale=1000:-1:flags=lanczos,split[x][y]',
      '[x]palettegen=max_colors=160:stats_mode=diff[c]',
      '[y][c]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    ].join(';'),
    '-loop',
    '0',
    `${OUT}/demo.gif`,
  );
  console.log('gif', frames.length, 'frames');
}

rmSync(WORK, { recursive: true, force: true });
