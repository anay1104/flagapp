// Pulls flag data from Wikidata into data/raw/ (a local cache, not committed).
// Run: node scripts/wikidata/fetch.mjs [--only=step] [--force]
//
// Steps:
//   ids         every entity with a flag image (P41)
//   flagitems   every "flag" item (instance of a subclass of Q14660) with an image
//   categories  QID sets used to classify entities (sovereign, historical, ...)
//   classes     instance-of (P31) of every entity
//   classcats   which broad roots each distinct class falls under
//   details     per-entity flag statements with qualifiers, labels, dates, country
//   flagdetails per-flag-item properties (designer, ratio, colours, depicts, ...)
//   aliases     English alternative names for major entities (quiz answers)

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const RAW = join(import.meta.dirname, '..', '..', 'data', 'raw');
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'flagapp/0.1 (personal vexillology project; Node fetch)';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function sparql(query, attempt = 1) {
  const retry = async (why, wait) => {
    if (attempt > 6) throw new Error(`SPARQL failed after retries: ${why}`);
    console.warn(`  ${why}, retrying in ${wait / 1000}s`);
    await sleep(wait);
    return sparql(query, attempt + 1);
  };
  let res;
  try {
    res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
      body: new URLSearchParams({ query }),
    });
  } catch (err) {
    return retry(err.cause?.code ?? err.message, 5000 * attempt);
  }
  if (res.status === 429 || res.status >= 500) {
    return retry(res.status, Number(res.headers.get('retry-after')) * 1000 || 5000 * attempt);
  }
  if (!res.ok) throw new Error(`SPARQL ${res.status}: ${(await res.text()).slice(0, 500)}`);
  let json;
  try {
    // A query that times out mid-stream returns truncated, invalid JSON.
    json = JSON.parse(await res.text());
  } catch {
    return retry('truncated response', 5000 * attempt);
  }
  return json.results.bindings.map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])),
  );
}

const qid = (uri) => uri?.replace('http://www.wikidata.org/entity/', '');

async function step(name, fn) {
  if (args.only && args.only !== name) return;
  const out = join(RAW, `${name}.json`);
  if (!args.force && (await exists(out))) {
    console.log(`[${name}] cached, skipping (use --force to refetch)`);
    return;
  }
  console.log(`[${name}] fetching...`);
  const data = await fn();
  await writeFile(out, JSON.stringify(data));
  console.log(`[${name}] wrote ${Array.isArray(data) ? data.length : Object.keys(data).length} records`);
}

async function load(name) {
  return JSON.parse(await readFile(join(RAW, `${name}.json`), 'utf8'));
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Runs a VALUES-batched query over ids, with a resumable per-batch cache.
async function batched(name, ids, size, build) {
  const dir = join(RAW, `${name}.parts`);
  await mkdir(dir, { recursive: true });
  const batches = chunk(ids, size);
  const rows = [];
  for (let i = 0; i < batches.length; i++) {
    const part = join(dir, `${i}.json`);
    let data;
    if (await exists(part)) {
      data = JSON.parse(await readFile(part, 'utf8'));
    } else {
      const values = batches[i].map((q) => `wd:${q}`).join(' ');
      data = await sparql(build(values));
      await writeFile(part, JSON.stringify(data));
      await sleep(300);
    }
    rows.push(...data);
    if (i % 10 === 0 || i === batches.length - 1) {
      console.log(`  batch ${i + 1}/${batches.length} (${rows.length} rows)`);
    }
  }
  return rows;
}

await mkdir(RAW, { recursive: true });

await step('ids', async () => {
  const rows = await sparql('SELECT DISTINCT ?e WHERE { ?e wdt:P41 [] . }');
  return rows.map((r) => qid(r.e));
});

await step('flagitems', async () => {
  const rows = await sparql(`
    SELECT DISTINCT ?f WHERE {
      ?f wdt:P31/wdt:P279* wd:Q14660 .
      ?f wdt:P18 [] .
    }`);
  return rows.map((r) => qid(r.f));
});

// Classification sets. Order matters later: first match wins.
const CATEGORY_QUERIES = {
  sovereign: '?e wdt:P31 wd:Q3624078 .',
  historical: '?e wdt:P31/wdt:P279* wd:Q3024240 .',
  territory: '?e wdt:P31/wdt:P279* wd:Q161243 .',
  subdivision: '?e wdt:P31/wdt:P279* wd:Q10864048 .',
};

// Broad roots that time out as single queries; resolved per class instead.
const CLASS_ROOTS = {
  organization: 'Q43229',
  ethnic: 'Q41710',
  settlement: 'Q486972',
  municipality: 'Q15284',
  military: 'Q176799',
  religious: 'Q13414953',
};

await step('categories', async () => {
  const out = {};
  for (const [cat, pattern] of Object.entries(CATEGORY_QUERIES)) {
    const rows = await sparql(`SELECT DISTINCT ?e WHERE { ?e wdt:P41 [] . ${pattern} }`);
    out[cat] = rows.map((r) => qid(r.e));
    console.log(`  ${cat}: ${out[cat].length}`);
    await sleep(500);
  }
  return out;
});

await step('classes', async () => {
  const ids = await load('ids');
  return batched('classes', ids, 2000, (values) => `
    SELECT ?e ?class WHERE { VALUES ?e { ${values} } ?e wdt:P31 ?class . }`);
});

await step('classcats', async () => {
  const classes = [...new Set((await load('classes')).map((r) => qid(r.class)))];
  console.log(`  ${classes.length} distinct classes`);
  // Walk upward from each class (cheap) instead of downward from each root (times out).
  const rows = await batched('ancestors', classes, 60, (values) => `
    SELECT ?c ?super WHERE { VALUES ?c { ${values} } ?c wdt:P279* ?super . }`);
  const ancestors = new Map();
  for (const r of rows) {
    const c = qid(r.c);
    if (!ancestors.has(c)) ancestors.set(c, new Set());
    ancestors.get(c).add(qid(r.super));
  }
  const out = {};
  for (const [cat, root] of Object.entries(CLASS_ROOTS)) {
    out[cat] = classes.filter((c) => ancestors.get(c)?.has(root));
    console.log(`  ${cat}: ${out[cat].length} classes`);
  }
  return out;
});

await step('details', async () => {
  const ids = await load('ids');
  return batched('details', ids, 400, (values) => `
    SELECT ?e ?label ?desc ?img ?rank ?start ?end ?inception ?dissolved ?country ?countryLabel ?enwiki WHERE {
      VALUES ?e { ${values} }
      ?e p:P41 ?st .
      ?st ps:P41 ?img ; wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank)
      OPTIONAL { ?st pq:P580 ?start }
      OPTIONAL { ?st pq:P582 ?end }
      OPTIONAL { ?e wdt:P571 ?inception }
      OPTIONAL { ?e wdt:P576 ?dissolved }
      OPTIONAL { ?e wdt:P17 ?country . ?country rdfs:label ?countryLabel FILTER(lang(?countryLabel) = "en") }
      OPTIONAL { ?e rdfs:label ?label FILTER(lang(?label) = "en") }
      OPTIONAL { ?e rdfs:label ?label FILTER(lang(?label) = "mul") }
      OPTIONAL { ?e schema:description ?desc FILTER(lang(?desc) = "en") }
      OPTIONAL { ?enwiki schema:about ?e ; schema:isPartOf <https://en.wikipedia.org/> }
    }`);
});

await step('flagdetails', async () => {
  const ids = await load('flagitems');
  return batched('flagdetails', ids, 200, (values) => `
    SELECT ?f ?label ?desc ?img ?subject ?subjectLabel ?inception ?start ?end ?dissolved
           ?ratio ?designer ?designerLabel ?color ?colorLabel ?depicts ?depictsLabel
           ?follows ?followedBy ?enwiki WHERE {
      VALUES ?f { ${values} }
      ?f wdt:P18 ?img .
      OPTIONAL { ?f rdfs:label ?label FILTER(lang(?label) = "en") }
      OPTIONAL { ?f schema:description ?desc FILTER(lang(?desc) = "en") }
      OPTIONAL { ?f wdt:P1001 ?subject . ?subject rdfs:label ?subjectLabel FILTER(lang(?subjectLabel) = "en") }
      OPTIONAL { ?f wdt:P571 ?inception }
      OPTIONAL { ?f wdt:P580 ?start }
      OPTIONAL { ?f wdt:P582 ?end }
      OPTIONAL { ?f wdt:P576 ?dissolved }
      OPTIONAL { ?f wdt:P2061 ?ratio }
      OPTIONAL { ?f wdt:P170 ?designer . ?designer rdfs:label ?designerLabel FILTER(lang(?designerLabel) = "en") }
      OPTIONAL { ?f wdt:P462 ?color . ?color rdfs:label ?colorLabel FILTER(lang(?colorLabel) = "en") }
      OPTIONAL { ?f wdt:P180 ?depicts . ?depicts rdfs:label ?depictsLabel FILTER(lang(?depictsLabel) = "en") }
      OPTIONAL { ?f wdt:P155 ?follows }
      OPTIONAL { ?f wdt:P156 ?followedBy }
      OPTIONAL { ?enwiki schema:about ?f ; schema:isPartOf <https://en.wikipedia.org/> }
    }`);
});

// English aliases for the non-local entities, so quiz answers like "China" or
// "USSR" are accepted. Local (city/municipal) entities are skipped: too many.
await step('aliases', async () => {
  const cats = await load('categories');
  const ids = [...new Set(Object.values(cats).flat())];
  return batched('aliases', ids, 500, (values) => `
    SELECT ?e ?alias WHERE {
      VALUES ?e { ${values} }
      ?e skos:altLabel ?alias FILTER(lang(?alias) = "en")
    }`);
});

console.log('done');
