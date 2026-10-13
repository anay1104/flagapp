// Merges the Wikidata cache (data/raw) with hand-written entries (data/curated)
// into the files the site reads:
//
//   src/generated/pages.json        full records for every flag that gets a static page
//   src/generated/tags.json         tag vocabulary with counts
//   public/data/index.json          compact list of flags with pages (search, browse, quizzes)
//   public/data/index-local.json    compact list of city and municipal flags
//   public/data/local/<n>.json      full records for local flags, sharded by id hash
//   public/data/clues.json          quiz clue lines by flag id
//   public/data/aliases.json        alternative names by flag id (quiz answers)
//
// Run: node scripts/build-data.mjs

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const RAW = join(ROOT, 'data', 'raw');
const CURATED = join(ROOT, 'data', 'curated');
const GEN = join(ROOT, 'src', 'generated');
const PUB = join(ROOT, 'public', 'data');
const LOCAL_SHARDS = 64;

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const qid = (uri) => uri?.replace('http://www.wikidata.org/entity/', '');
const year = (date) => {
  const m = date?.match(/^(-?\d+)-/);
  return m ? Number(m[1]) : null;
};
const fileName = (uri) =>
  decodeURIComponent(uri.replace(/^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//, ''));

export function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Commons hash path ("a/ab/File_name.svg") so the client needn't compute MD5. */
function commonsPath(name) {
  const f = name.replace(/ /g, '_');
  const h = createHash('md5').update(f).digest('hex');
  return `${h[0]}/${h.slice(0, 2)}/${f}`;
}

async function loadParts(name) {
  const dir = join(RAW, `${name}.parts`);
  const files = (await readdir(dir)).sort((a, b) => parseInt(a) - parseInt(b));
  const rows = [];
  for (const f of files) rows.push(...(await readJson(join(dir, f))));
  return rows;
}

// ---------------------------------------------------------------- categories

const PRIORITY = [
  'sovereign',
  'historical',
  'territory',
  'subdivision',
  'ethnic',
  'military',
  'religious',
  'local',
  'organization',
  'other',
];
const rank = (c) => PRIORITY.indexOf(c);

const categorySets = await readJson(join(RAW, 'categories.json'));
const classCats = await readJson(join(RAW, 'classcats.json'));
const entityCategory = new Map();
const assign = (id, cat) => {
  const cur = entityCategory.get(id);
  if (!cur || rank(cat) < rank(cur)) entityCategory.set(id, cat);
};
for (const [cat, ids] of Object.entries(categorySets)) for (const id of ids) assign(id, cat);

const classToCat = new Map();
const CLASS_CAT = {
  ethnic: 'ethnic',
  military: 'military',
  religious: 'religious',
  settlement: 'local',
  municipality: 'local',
  organization: 'organization',
};
for (const [root, classes] of Object.entries(classCats)) {
  for (const c of classes) {
    const cat = CLASS_CAT[root];
    const cur = classToCat.get(c);
    if (!cur || rank(cat) < rank(cur)) classToCat.set(c, cat);
  }
}
for (const r of await readJson(join(RAW, 'classes.json'))) {
  const cat = classToCat.get(qid(r.class));
  if (cat) assign(qid(r.e), cat);
}

// ---------------------------------------------------------------- entities

const nameOverrides = await readJson(join(ROOT, 'data', 'names.json'));

/** @type {Map<string, any>} */
const entities = new Map();
for (const r of await loadParts('details')) {
  const id = qid(r.e);
  let e = entities.get(id);
  if (!e) {
    e = { qid: id, label: r.label, desc: r.desc, enwiki: r.enwiki, inception: null, dissolved: null, country: null, flags: new Map() };
    entities.set(id, e);
  }
  e.label ??= r.label;
  e.desc ??= r.desc;
  e.enwiki ??= r.enwiki;
  const inc = year(r.inception);
  if (inc !== null && (e.inception === null || inc < e.inception)) e.inception = inc;
  const dis = year(r.dissolved);
  if (dis !== null && (e.dissolved === null || dis > e.dissolved)) e.dissolved = dis;
  if (r.countryLabel && !e.country) e.country = r.countryLabel;

  // One image can have several periods (Russia's tricolour: 1896–1918 and 1993–).
  const img = fileName(r.img);
  let f = e.flags.get(img);
  if (!f) {
    f = { image: img, periods: new Map(), preferred: false };
    e.flags.set(img, f);
  }
  const s = year(r.start);
  const t = year(r.end);
  f.periods.set(`${s}|${t}`, { from: s, to: t });
  if (r.rank?.endsWith('PreferredRank')) f.preferred = true;
}

// Collapse periods: drop an undated period when dated ones exist, sort by start.
for (const e of entities.values()) {
  if (nameOverrides[e.qid]) {
    e.officialName = e.label;
    e.label = nameOverrides[e.qid];
  }
  for (const f of e.flags.values()) {
    let periods = [...f.periods.values()];
    if (periods.length > 1) periods = periods.filter((p) => p.from !== null || p.to !== null);
    periods.sort((a, b) => (a.from ?? -99999) - (b.from ?? -99999));
    f.periods = periods;
    f.from = periods.reduce((m, p) => (p.from !== null && (m === null || p.from < m) ? p.from : m), null);
    f.open = periods.some((p) => p.to === null);
    f.to = f.open ? null : Math.max(...periods.map((p) => p.to));
  }
}

// ---------------------------------------------------------------- flag items

const flagItems = new Map();
for (const r of await loadParts('flagdetails')) {
  const id = qid(r.f);
  let f = flagItems.get(id);
  if (!f) {
    f = {
      qid: id,
      label: r.label,
      desc: r.desc,
      image: fileName(r.img),
      subject: qid(r.subject),
      subjectLabel: r.subjectLabel,
      from: null,
      to: null,
      ratio: null,
      designers: new Set(),
      colors: new Set(),
      depicts: new Set(),
      enwiki: r.enwiki,
    };
    flagItems.set(id, f);
  }
  f.label ??= r.label;
  f.subject ??= qid(r.subject);
  f.subjectLabel ??= r.subjectLabel;
  for (const d of [r.start, r.inception]) {
    const y = year(d);
    if (y !== null && (f.from === null || y < f.from)) f.from = y;
  }
  for (const d of [r.end, r.dissolved]) {
    const y = year(d);
    if (y !== null && (f.to === null || y > f.to)) f.to = y;
  }
  if (r.ratio && !f.ratio) f.ratio = r.ratio;
  if (r.designerLabel) f.designers.add(r.designerLabel);
  if (r.colorLabel) f.colors.add(r.colorLabel);
  if (r.depictsLabel) f.depicts.add(r.depictsLabel);
}

// ---------------------------------------------------------------- auto tags

// Keyword → tag rules applied to Wikidata "depicts" and colour labels, so
// catalogue flags can take part in tag-based quizzes too.
const DEPICT_RULES = [
  [/\bstars?\b|pentagram/, 'star'],
  [/crescent/, 'crescent'],
  [/\bsun\b/, 'sun'],
  [/\bmoon\b/, 'moon'],
  [/coat of arms|escutcheon/, 'coat-of-arms'],
  [/\bemblem|\bseal\b/, 'emblem'],
  [/union jack|union flag/, 'union-jack'],
  [/southern cross|crux/, 'southern-cross'],
  [/eagle/, 'eagle'],
  [/eagle|bird|dove|falcon|hawk|parrot|condor|owl|crane|swan|pelican|rooster/, 'bird'],
  [/lion|horse|bull|bear|wolf|deer|elephant|tiger|leopard|\box\b|goat|fish|dog|\bcat\b|animal/, 'animal'],
  [/dragon|griffin|unicorn|wyvern|phoenix/, 'dragon'],
  [/tree|leaf|plant|flower|palm|cedar|wheat|branch|olive|laurel|oak|rose/, 'plant'],
  [/sword|spear|rifle|gun|weapon|axe|arrow|\bbow\b|cannon|machete|dagger/, 'weapon'],
  [/hammer|sickle|hoe|tool|anchor|cogwheel|pickaxe/, 'tool'],
  [/\bbook\b|quran|bible/, 'book'],
  [/\bmap\b/, 'map'],
  [/\bcrown\b/, 'crown'],
  [/castle|tower|building|church|mosque|temple/, 'building'],
  [/shield/, 'shield'],
  [/wave|water|\bsea\b|river/, 'water'],
  [/mountain|volcano/, 'mountain'],
  [/wheel|chakra/, 'wheel'],
  [/saltire/, 'saltire'],
  [/nordic cross|scandinavian cross/, 'nordic-cross'],
  [/\bcross\b/, 'cross'],
  [/canton/, 'canton'],
  [/inscription|\btext\b|motto|writing/, 'text'],
];
const COLOR_RULES = [
  [/light blue|sky blue|azure|celeste/, 'light-blue'],
  [/maroon|burgundy/, 'maroon'],
  [/\bred\b|crimson|scarlet|vermilion/, 'red'],
  [/white/, 'white'],
  [/\bblue\b|navy|ultramarine/, 'blue'],
  [/green/, 'green'],
  [/yellow|gold/, 'yellow'],
  [/orange|saffron/, 'orange'],
  [/black/, 'black'],
  [/purple|violet/, 'purple'],
  [/brown/, 'brown'],
  [/grey|gray|silver/, 'grey'],
];
function autoTags(depicts, colors) {
  const tags = new Set();
  for (const d of depicts) {
    const l = d.toLowerCase();
    for (const [re, tag] of DEPICT_RULES) if (re.test(l)) tags.add(tag);
  }
  for (const c of colors) {
    const l = c.toLowerCase();
    const hit = COLOR_RULES.find(([re]) => re.test(l));
    if (hit) tags.add(hit[1]);
  }
  return [...tags];
}

// ---------------------------------------------------------------- records

/** @type {Map<string, any>} image filename -> record */
const byImage = new Map();
// "view" is the client-side viewer route under /flag/.
const usedIds = new Set(['view']);

function uniqueId(base, country, fallback) {
  const fb = fallback.toLowerCase();
  if (base && !usedIds.has(base)) return base;
  const withCountry = base && country ? `${base}-${slugify(country)}` : null;
  if (withCountry && !usedIds.has(withCountry)) return withCountry;
  let id = base ? `${base}-${fb}` : fb;
  let n = 2;
  while (usedIds.has(id)) id = `${base || fb}-${fb}-${n++}`;
  return id;
}

// Hand-written entries claim their ids first so auto-generated ones never collide.
const curated = [];
for (const f of (await readdir(CURATED)).filter((f) => f.endsWith('.json'))) {
  const c = await readJson(join(CURATED, f));
  if (c.id !== f.replace(/\.json$/, '')) throw new Error(`${f}: id "${c.id}" must match file name`);
  curated.push(c);
  usedIds.add(c.id);
}

// File-name words that mark a variant rather than "the" flag of a subject.
const VARIANT_WORDS =
  /\b(civil|state|naval|navy|ensign|jack|standard|pantone|digital|reverse|bordered|variant|converted|war|air force|army|presidential|royal|governor|vertical|unofficial|alternative|alternate|proposed|construction|darker|lighter|shade|official|specifications?|aspect)\b|\d+-\d+\)/i;

function primaryScore(f, label) {
  const name = f.image.replace(/\.[a-z]+$/i, '').toLowerCase();
  const l = (label ?? '').toLowerCase();
  let s = 0;
  if (f.preferred) s -= 100;
  if (!f.open) s += 50;
  if (name === `flag of ${l}` || name === `flag of the ${l}`) s -= 20;
  else if (name.startsWith('flag of')) s -= 5;
  if (name.includes('(')) s += 5;
  if (VARIANT_WORDS.test(name)) s += 10;
  return s;
}

/** "Flag of Costa Rica (state).svg" -> "Flag of Costa Rica (state)" */
function variantName(image, name) {
  const base = image.replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
  return /flag|ensign|jack|standard|banner/i.test(base) ? base : `Flag of ${name} (variant)`;
}

// Entities in category priority order, so e.g. the country Georgia gets "georgia".
const sortedEntities = [...entities.values()].sort(
  (a, b) =>
    rank(entityCategory.get(a.qid) ?? 'other') - rank(entityCategory.get(b.qid) ?? 'other') ||
    a.qid.localeCompare(b.qid, 'en', { numeric: true }),
);

// Categories whose names are worth listing as "also used by" or as a display name.
const NAMED_CATS = new Set(['sovereign', 'historical', 'territory', 'subdivision', 'ethnic']);

/** qid -> image of that entity's primary flag */
const entityPrimary = new Map();

for (const e of sortedEntities) {
  const category = entityCategory.get(e.qid) ?? 'other';
  const flags = [...e.flags.values()];
  const dissolved = e.dissolved !== null;
  const primary = [...flags].sort((a, b) => primaryScore(a, e.label) - primaryScore(b, e.label))[0];
  entityPrimary.set(e.qid, primary.image);

  for (const f of flags) {
    const isPrimary = f === primary;
    if (byImage.has(f.image)) {
      const existing = byImage.get(f.image);
      // A plainer name from a comparable entity wins ("Denmark" over "Kingdom of Denmark").
      if (
        isPrimary &&
        existing.role === 'primary' &&
        NAMED_CATS.has(category) &&
        rank(category) <= rank(existing.category) + 2 &&
        e.label &&
        e.label.length < existing.name.length &&
        existing.name.includes(e.label)
      ) {
        existing.alsoUsedBy.push(existing.name);
        existing.name = e.label;
        existing.flagName = `Flag of ${e.label}`;
        existing.subjectQids.push(e.qid);
        const better = slugify(e.label);
        if (better && !usedIds.has(better)) {
          usedIds.delete(existing.id);
          usedIds.add(better);
          existing.id = better;
        }
      } else if (NAMED_CATS.has(category) && e.label && existing.alsoUsedBy.length < 12) {
        existing.alsoUsedBy.push(e.label);
      }
      continue;
    }
    const name = e.label ?? e.qid;
    const role = isPrimary ? 'primary' : f.open && !dissolved ? 'variant' : 'former';
    const base = slugify(name);
    const id =
      role === 'primary'
        ? uniqueId(base, e.country, e.qid)
        : uniqueId(f.from !== null ? `${base}-${f.from}` : `${base}-${role}`, e.country, e.qid);
    usedIds.add(id);
    byImage.set(f.image, {
      id,
      name,
      flagName: role === 'variant' ? variantName(f.image, name) : `Flag of ${name}`,
      image: f.image,
      category,
      tier: 3,
      role,
      from: f.from ?? (isPrimary ? e.inception : null),
      to: f.open ? (dissolved ? e.dissolved : null) : f.to,
      current: !dissolved && f.open,
      periods: f.periods.length > 1 ? f.periods : undefined,
      country: e.country && e.country !== name ? e.country : undefined,
      description: e.desc,
      wikidata: e.qid,
      subjectQids: [e.qid],
      wikipedia: e.enwiki,
      alsoUsedBy: [],
    });
  }
}

// Flag items: merge into the matching image, or add as their own records.
for (const f of flagItems.values()) {
  const extra = {
    ratio: f.ratio ?? undefined,
    designer: f.designers.size ? [...f.designers].join(', ') : undefined,
    colorNames: f.colors.size ? [...f.colors] : undefined,
    depicts: f.depicts.size ? [...f.depicts] : undefined,
    flagItem: f.qid,
  };
  const existing = byImage.get(f.image);
  if (existing) {
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && existing[k] === undefined) existing[k] = v;
    if (existing.from === null && f.from !== null) existing.from = f.from;
    continue;
  }
  const subjectEntity = f.subject ? entities.get(f.subject) : undefined;
  const subjectName = f.subjectLabel ?? subjectEntity?.label;
  // "flag of X" items belong to X; others (Gadsden flag, naval jacks…) keep their own name.
  const isSubjectFlag = /^flag of /i.test(f.label ?? '') && !!subjectName;
  const label = f.label ? f.label.charAt(0).toUpperCase() + f.label.slice(1) : undefined;
  const name = isSubjectFlag ? subjectName : (label ?? subjectName ?? f.qid);
  const category = isSubjectFlag ? ((f.subject && entityCategory.get(f.subject)) ?? 'other') : 'other';
  const base = slugify(f.from !== null && f.to !== null ? `${name}-${f.from}` : name);
  const id = uniqueId(base, subjectEntity?.country, f.qid);
  usedIds.add(id);
  const dissolved = subjectEntity?.dissolved != null;
  byImage.set(f.image, {
    id,
    name,
    flagName: label ?? `Flag of ${name}`,
    image: f.image,
    category,
    tier: 3,
    role: isSubjectFlag ? (f.to === null && !dissolved ? 'variant' : 'former') : 'other',
    from: f.from,
    to: f.to,
    current: f.to === null && !dissolved,
    country: isSubjectFlag ? subjectEntity?.country : subjectName,
    description: f.desc,
    wikidata: f.qid,
    subjectQids: isSubjectFlag && f.subject ? [f.subject] : [],
    wikipedia: f.enwiki ?? (isSubjectFlag ? subjectEntity?.enwiki : undefined),
    alsoUsedBy: [],
    ...extra,
  });
}

// ---------------------------------------------------------------- curated

const records = [...byImage.values()];
const warnings = [];
for (const c of curated) {
  const primaryImage = c.image ?? (c.wikidata ? entityPrimary.get(c.wikidata) : undefined);
  const base = primaryImage ? byImage.get(primaryImage) : undefined;
  if (!base && !c.image) {
    warnings.push(`${c.id}: no Wikidata match for ${c.wikidata} and no image given`);
    continue;
  }
  const target = base ?? { alsoUsedBy: [], subjectQids: c.wikidata ? [c.wikidata] : [] };
  if (base) usedIds.delete(base.id);
  const { wikidata, ...fields } = c;
  Object.assign(target, fields, {
    image: c.image ?? base.image,
    flagName: c.flagName ?? `Flag of ${c.name}`,
    wikidata: c.wikidata ?? target.wikidata,
    role: c.role ?? 'primary',
    current: c.to === null || c.to === undefined,
    curated: true,
  });
  if (c.wikidata && !target.subjectQids.includes(c.wikidata)) target.subjectQids.unshift(c.wikidata);
  if (!base) {
    byImage.set(target.image, target);
    records.push(target);
  }
}

// Tags: curated tags + colour families; then the hand-checked feature sheet;
// then Wikidata auto-tags for everything else.
const featureTags = await readJson(join(ROOT, 'data', 'feature-tags.json'));
const featureIds = new Set(Object.keys(featureTags).filter((k) => !k.startsWith('_')));
for (const r of records) {
  const tags = new Set(r.tags ?? []);
  if (r.colors) for (const c of r.colors) tags.add(c.family);
  if (!r.curated) {
    if (featureIds.has(r.id)) {
      for (const t of featureTags[r.id].split(/\s+/)) tags.add(t);
      featureIds.delete(r.id);
    } else {
      for (const t of autoTags(r.depicts ?? [], r.colorNames ?? [])) tags.add(t);
    }
  }
  r.tags = [...tags];
}
for (const id of featureIds) warnings.push(`feature-tags.json: unknown flag id "${id}"`);

// Related flags: every record for the same subject, oldest first.
const bySubject = new Map();
for (const r of records) {
  for (const q of r.subjectQids ?? []) {
    if (!bySubject.has(q)) bySubject.set(q, []);
    bySubject.get(q).push(r);
  }
}
for (const r of records) {
  const group = new Set();
  for (const q of r.subjectQids ?? []) for (const o of bySubject.get(q) ?? []) if (o !== r) group.add(o);
  if (!group.size) continue;
  r.related = [...group].sort((a, b) => (a.from ?? -99999) - (b.from ?? -99999)).map((o) => o.id);
}

// Link curated history steps to matching records by their dates.
for (const r of records.filter((r) => r.curated && r.history)) {
  const group = [r, ...(r.related ?? []).map((id) => records.find((o) => o.id === id))].filter(Boolean);
  for (const step of r.history) {
    if (step.flagId) continue;
    // The open-ended step is the current flag itself.
    if (step.to === null && r.current) {
      step.flagId = r.id;
      continue;
    }
    const match = group.find((g) => {
      const periods = g.periods ?? [{ from: g.from, to: g.to }];
      return periods.some((p) => p.from !== null && p.from === step.from && (p.to ?? null) === (step.to ?? null));
    });
    if (match) step.flagId = match.id;
  }
}

// Aliases for quiz answers.
const aliasRows = await loadParts('aliases');
const aliasesByQid = new Map();
for (const r of aliasRows) {
  const q = qid(r.e);
  if (!aliasesByQid.has(q)) aliasesByQid.set(q, new Set());
  aliasesByQid.get(q).add(r.alias);
}
const aliases = {};
for (const r of records) {
  if (r.category === 'local' || r.role === 'variant' || r.role === 'other') continue;
  const set = new Set(r.aliases ?? []);
  for (const q of r.subjectQids ?? []) {
    for (const a of aliasesByQid.get(q) ?? []) set.add(a);
    const ent = entities.get(q);
    if (ent?.label) set.add(ent.label);
    if (ent?.officialName) set.add(ent.officialName);
  }
  // Dedupe on the same normalisation the quiz uses ("the U.S." == "U.S."), shortest first.
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();
  const seen = new Set([norm(r.name)]);
  const list = [];
  for (const a of [...set].sort((x, y) => x.length - y.length)) {
    const n = norm(a);
    if (!n || seen.has(n) || a.length > 60) continue;
    seen.add(n);
    list.push(a);
  }
  if (list.length) aliases[r.id] = list.slice(0, 20);
}

// Validate cross-references.
const allIds = new Set(records.map((r) => r.id));
for (const r of records.filter((r) => r.curated)) {
  for (const l of r.lookalikes ?? []) if (!allIds.has(l)) warnings.push(`${r.id}: unknown lookalike "${l}"`);
}

// ---------------------------------------------------------------- output

const tagVocab = await readJson(join(ROOT, 'data', 'tags.json'));
const knownTags = new Set(Object.values(tagVocab).flatMap((g) => Object.keys(g)));
for (const r of records) {
  if (!r.curated && !featureTags[r.id]) continue;
  for (const t of r.tags) if (!knownTags.has(t)) warnings.push(`${r.id}: unknown tag "${t}"`);
}

const tagCounts = {};
for (const r of records) for (const t of r.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;

for (const r of records) {
  r.img = commonsPath(r.image);
  delete r.subjectQids;
  if (!r.alsoUsedBy?.length) delete r.alsoUsedBy;
}
records.sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.from ?? 0) - (b.from ?? 0));

const isLocal = (r) => r.category === 'local' && !r.curated;
const pages = records.filter((r) => !isLocal(r));
const local = records.filter(isLocal);

// Compact index row: [id, name, img, category, tier, from, to, current, country, tags, role]
const CAT_CODE = Object.fromEntries(PRIORITY.map((c, i) => [c, i]));
const ROLES = ['primary', 'former', 'variant', 'other'];
const ROLE_CODE = Object.fromEntries(ROLES.map((c, i) => [c, i]));
const toIndex = (list) => ({
  categories: PRIORITY,
  roles: ROLES,
  rows: list.map((r) => [
    r.id,
    r.name,
    r.img,
    CAT_CODE[r.category],
    r.tier,
    r.from,
    r.to,
    r.current ? 1 : 0,
    r.country ?? '',
    r.tags.join(' '),
    ROLE_CODE[r.role],
  ]),
});

const clues = Object.fromEntries(records.filter((r) => r.clues?.length).map((r) => [r.id, r.clues]));

function shardOf(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % LOCAL_SHARDS;
}

await rm(join(PUB, 'local'), { recursive: true, force: true });
await mkdir(join(PUB, 'local'), { recursive: true });
await mkdir(GEN, { recursive: true });

const shards = Array.from({ length: LOCAL_SHARDS }, () => ({}));
for (const r of local) shards[shardOf(r.id)][r.id] = r;
await Promise.all(shards.map((s, i) => writeFile(join(PUB, 'local', `${i}.json`), JSON.stringify(s))));

await writeFile(join(GEN, 'pages.json'), JSON.stringify(pages));
await writeFile(join(GEN, 'tags.json'), JSON.stringify({ vocab: tagVocab, counts: tagCounts }));
await writeFile(join(GEN, 'stats.json'), JSON.stringify({ total: records.length, local: local.length, pages: pages.length }));
await writeFile(join(PUB, 'index.json'), JSON.stringify(toIndex(pages)));
await writeFile(join(PUB, 'index-local.json'), JSON.stringify(toIndex(local)));
await writeFile(join(PUB, 'clues.json'), JSON.stringify(clues));
await writeFile(join(PUB, 'aliases.json'), JSON.stringify(aliases));

const byCat = {};
for (const r of records) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
const byRole = {};
for (const r of records) byRole[r.role] = (byRole[r.role] ?? 0) + 1;
console.log(`records: ${records.length} (pages ${pages.length}, local ${local.length})`);
console.log('by category:', byCat);
console.log('by role:', byRole);
console.log(`curated: ${records.filter((r) => r.curated).length}`);
if (warnings.length) console.warn(`\n${warnings.length} warnings:\n  ${warnings.join('\n  ')}`);
