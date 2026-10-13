// Measures the colours of every flag image from a small Commons thumbnail and
// writes data/raw/enrich/colours.json: { "<file name>": [["red", 0.42], ["white", 0.33], ...] }.
// Resumable; polite to Wikimedia (limited concurrency, descriptive User-Agent).
//
// Run: node scripts/enrich/colours.mjs

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(RAW, 'enrich');
const PARTS = join(OUT, 'colours.parts');
const UA = 'flagapp/0.1 (https://github.com/anay1104/flagapp; vexillology site)';
const WIDTH = 120;
const BATCH = 50;
// One request at a time with a pause: Wikimedia answers bursts with 429s.
const CONCURRENCY = 1;
const DELAY = 700;
const MIN_SHARE = 0.04;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const fileName = (uri) =>
  decodeURIComponent(uri.replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//, ''));

function thumbUrl(name) {
  const f = name.replace(/ /g, '_');
  const h = createHash('md5').update(f).digest('hex');
  const enc = encodeURIComponent(f);
  const thumb = /\.svg$/i.test(f) ? `${WIDTH}px-${enc}.png` : `${WIDTH}px-${enc}`;
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${enc}/${thumb}`;
}

async function download(name) {
  const urls = [thumbUrl(name), `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${WIDTH}`];
  for (const url of urls) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        await sleep(DELAY);
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (res.status === 429 || res.status >= 500) {
          // Wikimedia rate-limits thumbnails; wait as long as it asks.
          const wait = (Number(res.headers.get('retry-after')) || 5 * attempt) * 1000 + 1000;
          await sleep(wait);
          continue;
        }
        if (!res.ok) break;
        return { type: res.headers.get('content-type') ?? '', buf: Buffer.from(await res.arrayBuffer()) };
      } catch {
        await sleep(2000 * attempt);
      }
    }
  }
  return null;
}

function decode({ type, buf }) {
  if (type.includes('png') || buf.subarray(1, 4).toString() === 'PNG') return PNG.sync.read(buf);
  if (type.includes('jpeg') || (buf[0] === 0xff && buf[1] === 0xd8)) return jpeg.decode(buf, { useTArray: true });
  return null; // GIF, WebP, TIFF: skipped
}

/** Maps an RGB pixel to a colour family from data/tags.json. */
function family(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l > 0.9 || (l > 0.8 && s < 0.25)) return 'white';
  if (l < 0.13) return 'black';
  if (s < 0.18) return l > 0.6 ? 'white' : l < 0.25 ? 'black' : 'grey';
  let h;
  const R = r / 255, G = g / 255, B = b / 255;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 14 || h >= 340) return l < 0.34 ? 'maroon' : 'red';
  if (h < 40) return l < 0.35 ? 'brown' : 'orange';
  if (h < 68) return l < 0.3 ? 'brown' : 'yellow';
  if (h < 165) return 'green';
  if (h < 205) return l < 0.35 ? 'green' : 'light-blue';
  if (h < 255) return l > 0.6 ? 'light-blue' : 'blue';
  if (h < 300) return 'purple';
  return l < 0.34 ? 'maroon' : 'red';
}

function analyse(img) {
  const counts = {};
  let total = 0;
  const { data, width, height } = img;
  const channels = data.length / (width * height);
  for (let i = 0; i < data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 128) continue;
    const f = family(data[i], data[i + 1], data[i + 2]);
    counts[f] = (counts[f] ?? 0) + 1;
    total++;
  }
  if (!total) return [];
  return Object.entries(counts)
    .map(([f, n]) => [f, Math.round((n / total) * 1000) / 1000])
    .filter(([, share]) => share >= MIN_SHARE)
    .sort((a, b) => b[1] - a[1]);
}

// --test="File one.svg|File two.svg" prints results for a few files without caching.
const testArg = process.argv.find((a) => a.startsWith('--test='));
if (testArg) {
  for (const name of testArg.slice(7).split('|')) {
    const file = await download(name);
    const img = file && decode(file);
    console.log(name, img ? analyse(img) : 'download or decode failed');
  }
  process.exit(0);
}

// Every image the site uses, most important first: national, historical, territorial
// and regional flags, then standalone flag items, then everything else.
const cats = await readJson(join(RAW, 'categories.json'));
const major = new Set(Object.values(cats).flat());
const tiers = [new Set(), new Set(), new Set()];
for (const part of ['details', 'flagdetails']) {
  const dir = join(RAW, `${part}.parts`);
  for (const f of await readdir(dir)) {
    for (const r of await readJson(join(dir, f))) {
      const q = (r.e ?? '').split('/').pop();
      tiers[part === 'flagdetails' ? 1 : major.has(q) ? 0 : 2].add(fileName(r.img));
    }
  }
}
const seen = new Set();
const list = [];
for (const t of tiers) for (const f of [...t].sort()) if (!seen.has(f)) seen.add(f) && list.push(f);
console.log(`${list.length} images`);
await mkdir(PARTS, { recursive: true });

const batches = [];
for (let i = 0; i < list.length; i += BATCH) batches.push(list.slice(i, i + BATCH));
let next = 0;
let done = 0;
let failed = 0;

async function worker() {
  while (next < batches.length) {
    const i = next++;
    const part = join(PARTS, `${i}.json`);
    if (!(await exists(part))) {
      const result = {};
      for (const name of batches[i]) {
        const file = await download(name);
        try {
          const img = file && decode(file);
          if (img) result[name] = analyse(img);
          else failed++;
        } catch {
          failed++;
        }
        await sleep(50);
      }
      await writeFile(part, JSON.stringify(result));
    }
    done++;
    if (done % 10 === 0 || done === batches.length) console.log(`  ${done}/${batches.length} batches (${failed} images skipped)`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const merged = {};
for (let i = 0; i < batches.length; i++) Object.assign(merged, await readJson(join(PARTS, `${i}.json`)));
await writeFile(join(OUT, 'colours.json'), JSON.stringify(merged));
console.log(`done: ${Object.keys(merged).length} images analysed`);
