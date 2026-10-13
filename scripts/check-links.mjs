// Checks every source URL in data/curated. Run: node scripts/check-links.mjs

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'data', 'curated');
const UA = 'Mozilla/5.0 (compatible; flagapp-linkcheck/0.1)';

const urls = new Map();
for (const f of (await readdir(DIR)).filter((f) => f.endsWith('.json'))) {
  const entry = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  for (const s of entry.sources ?? []) if (s.url) urls.set(s.url, [...(urls.get(s.url) ?? []), entry.id]);
}

async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', headers: { 'User-Agent': UA } });
      if (res.ok) return res.status;
      if (method === 'GET') return res.status;
    } catch (e) {
      if (method === 'GET') return e.cause?.code ?? e.message;
    }
  }
}

let bad = 0;
const list = [...urls.keys()];
for (let i = 0; i < list.length; i += 6) {
  const batch = list.slice(i, i + 6);
  const results = await Promise.all(batch.map(check));
  batch.forEach((url, j) => {
    if (results[j] !== 200) {
      bad++;
      console.log(`${results[j]}  ${url}  (${urls.get(url).join(', ')})`);
    }
  });
}
console.log(`${list.length} links checked, ${bad} not OK`);
