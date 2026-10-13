// Fetches descriptive text for flags from English Wikipedia and Wikimedia
// Commons into data/raw/enrich/ (cache, not committed). Resumable.
//
// Run: node scripts/enrich/fetch.mjs [--only=step]
//
// Steps:
//   titles    find a Wikipedia article about each flag: the flag item's own
//             article, or "Flag of <entity article>" if it exists (redirects followed)
//   articles  plain-text sections of every flag article found
//   sections  "Flag"/"Colours" sections inside entity articles that have no
//             flag article of their own (non-local entities only)
//   commons   description, licence and author of every flag image on Commons

import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(RAW, 'enrich');
const UA = 'flagapp/0.1 (https://github.com/anay1104/flagapp; vexillology site)';
const WP = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const qid = (uri) => uri?.replace('http://www.wikidata.org/entity/', '');
const fileName = (uri) =>
  decodeURIComponent(uri.replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//, ''));
const titleOf = (url) => (url ? decodeURIComponent(url.replace('https://en.wikipedia.org/wiki/', '')).replace(/_/g, ' ') : null);

async function api(base, params, attempt = 1) {
  // POST: batches of long file names overflow the URL length limit on GET.
  const body = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error?.code === 'maxlag') throw new Error('maxlag');
    if (json.error) throw new Error(`${json.error.code}: ${json.error.info}`);
    return json;
  } catch (err) {
    if (attempt > 6) throw err;
    await sleep(3000 * attempt);
    return api(base, params, attempt + 1);
  }
}

async function loadParts(name) {
  const dir = join(RAW, `${name}.parts`);
  const rows = [];
  for (const f of await readdir(dir)) rows.push(...(await readJson(join(dir, f))));
  return rows;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Runs fn over items with limited concurrency, caching results per batch file. */
async function cachedBatches(name, items, size, concurrency, fn) {
  const dir = join(OUT, `${name}.parts`);
  await mkdir(dir, { recursive: true });
  const batches = chunk(items, size);
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const i = next++;
      const part = join(dir, `${i}.json`);
      if (!(await exists(part))) {
        const result = await fn(batches[i]);
        await writeFile(part, JSON.stringify(result));
        await sleep(100);
      }
      done++;
      if (done % 50 === 0 || done === batches.length) console.log(`  ${name}: ${done}/${batches.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const merged = {};
  for (let i = 0; i < batches.length; i++) Object.assign(merged, await readJson(join(dir, `${i}.json`)));
  return merged;
}

async function step(name, fn) {
  if (args.only && args.only !== name) return;
  const out = join(OUT, `${name}.json`);
  if (!args.force && (await exists(out))) {
    console.log(`[${name}] cached`);
    return;
  }
  console.log(`[${name}] fetching...`);
  const data = await fn();
  await writeFile(out, JSON.stringify(data));
  console.log(`[${name}] ${Object.keys(data).length} records`);
}

await mkdir(OUT, { recursive: true });

// ---------------------------------------------------------------- titles

await step('titles', async () => {
  // Flag items with their own article: that article is about the flag.
  const out = {};
  for (const r of await loadParts('flagdetails')) {
    const t = titleOf(r.enwiki);
    if (t) out[`flag:${qid(r.f)}`] = t;
  }
  // Entities: try "Flag of <article title>", which Wikipedia redirects to the real flag article.
  const candidates = new Map();
  for (const r of await loadParts('details')) {
    const t = titleOf(r.enwiki);
    if (t && !t.startsWith('Flag of')) candidates.set(`Flag of ${t}`, qid(r.e));
  }
  console.log(`  ${candidates.size} candidate titles`);
  const found = await cachedBatches('titles', [...candidates.keys()], 50, 3, async (titles) => {
    const json = await api(WP, { action: 'query', titles: titles.join('|'), redirects: '1' });
    const redirect = new Map((json.query.redirects ?? []).map((r) => [r.from, r.to]));
    const normal = new Map((json.query.normalized ?? []).map((r) => [r.from, r.to]));
    const ok = new Set(json.query.pages.filter((p) => !p.missing && !p.invalid).map((p) => p.title));
    const result = {};
    for (const t of titles) {
      let resolved = normal.get(t) ?? t;
      resolved = redirect.get(resolved) ?? resolved;
      // A redirect to a section of the entity's own article isn't a flag article.
      if (ok.has(resolved) && /flag|ensign|banner|jack|colours|standard|tricolou?r|dannebrog/i.test(resolved)) {
        result[t] = resolved;
      }
    }
    return result;
  });
  for (const [candidate, resolved] of Object.entries(found)) out[`entity:${candidates.get(candidate)}`] = resolved;
  return out;
});

// ---------------------------------------------------------------- articles

// Plain-text extract with "== Heading ==" markers, split into sections.
function splitSections(text) {
  const sections = [];
  let current = { heading: '', level: 1, text: [] };
  for (const line of text.split('\n')) {
    const m = line.match(/^(={2,})\s*(.+?)\s*\1$/);
    if (m) {
      sections.push(current);
      current = { heading: m[2], level: m[1].length, text: [] };
    } else if (line.trim()) {
      current.text.push(line.trim());
    }
  }
  sections.push(current);
  return sections
    .map((s) => ({ heading: s.heading, level: s.level, text: s.text.join('\n\n') }))
    .filter((s) => s.text);
}

async function extract(title) {
  const json = await api(WP, {
    action: 'query',
    prop: 'extracts|info',
    inprop: 'url',
    explaintext: '1',
    exsectionformat: 'wiki',
    titles: title,
    redirects: '1',
  });
  const page = json.query.pages[0];
  if (!page || page.missing || !page.extract) return null;
  return { title: page.title, url: page.fullurl, revid: page.lastrevid, sections: splitSections(page.extract) };
}

await step('articles', async () => {
  const titles = [...new Set(Object.values(await readJson(join(OUT, 'titles.json'))))];
  console.log(`  ${titles.length} flag articles`);
  return cachedBatches('articles', titles, 10, 4, async (batch) => {
    const result = {};
    for (const t of batch) {
      const a = await extract(t);
      if (a) result[t] = a;
    }
    return result;
  });
});

// ---------------------------------------------------------------- sections

const FLAG_HEADING = /\b(flags?|colou?rs|banners?|ensigns?|standards?|vexillology|symbols?)\b/i;

await step('sections', async () => {
  const titles = await readJson(join(OUT, 'titles.json'));
  const cats = await readJson(join(RAW, 'categories.json'));
  const major = new Set(Object.values(cats).flat());
  const classcats = await readJson(join(RAW, 'classcats.json'));
  const militaryClasses = new Set(classcats.military ?? []);
  for (const r of await readJson(join(RAW, 'classes.json'))) {
    if (militaryClasses.has(qid(r.class))) major.add(qid(r.e));
  }
  const want = new Map();
  for (const r of await loadParts('details')) {
    const q = qid(r.e);
    const t = titleOf(r.enwiki);
    if (t && major.has(q) && !titles[`entity:${q}`]) want.set(t, q);
  }
  console.log(`  ${want.size} entity articles to scan`);
  return cachedBatches('sections', [...want.keys()], 10, 4, async (batch) => {
    const result = {};
    for (const t of batch) {
      const a = await extract(t);
      if (!a) continue;
      const keep = a.sections.filter((s) => s.heading && FLAG_HEADING.test(s.heading) && s.text.length > 80);
      if (keep.length) result[t] = { title: a.title, url: a.url, revid: a.revid, sections: keep };
    }
    return result;
  });
});

// ---------------------------------------------------------------- commons

const stripHtml = (s) =>
  s
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();

await step('commons', async () => {
  const files = new Set();
  for (const r of await loadParts('details')) files.add(fileName(r.img));
  for (const r of await loadParts('flagdetails')) files.add(fileName(r.img));
  console.log(`  ${files.size} files`);
  return cachedBatches('commons', [...files], 50, 3, async (batch) => {
    const json = await api(COMMONS, {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'extmetadata',
      iiextmetadatafilter: 'ImageDescription|LicenseShortName|LicenseUrl|Artist|AttributionRequired|Credit',
      iiextmetadatalanguage: 'en',
      titles: batch.map((f) => `File:${f}`).join('|'),
      redirects: '1',
    });
    const normal = new Map((json.query.normalized ?? []).map((r) => [r.to, r.from]));
    const redirect = new Map((json.query.redirects ?? []).map((r) => [r.to, r.from]));
    const result = {};
    for (const p of json.query.pages) {
      const meta = p.imageinfo?.[0]?.extmetadata;
      if (!meta) continue;
      // Map back to the file name Wikidata used.
      let original = redirect.get(p.title) ?? p.title;
      original = normal.get(original) ?? original;
      result[original.replace(/^File:/, '')] = {
        description: stripHtml(meta.ImageDescription?.value),
        license: meta.LicenseShortName?.value,
        licenseUrl: meta.LicenseUrl?.value,
        artist: stripHtml(meta.Artist?.value),
        attribution: meta.AttributionRequired?.value === 'true',
        renamedTo: p.title !== original ? p.title.replace(/^File:/, '') : undefined,
      };
    }
    return result;
  });
});

console.log('done');
