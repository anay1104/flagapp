// Quiz logic that doesn't touch the DOM: pools, weighted picking, distractors,
// answer matching and saved progress.

import type { IndexEntry } from './index-data';

export type Mode = 'name' | 'type' | 'pick' | 'clue' | 'list';
export type PoolId = 'countries' | 'territories' | 'historical' | 'subdivisions' | 'curated' | 'all';

export const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'name', label: 'Name the flag', blurb: 'See a flag, choose its name from four options.' },
  { id: 'type', label: 'Type the name', blurb: 'See a flag, type its name. No options to lean on.' },
  { id: 'pick', label: 'Pick the flag', blurb: 'See a name, pick its flag from four look-alikes.' },
  { id: 'clue', label: 'Clue mode', blurb: 'Read a description of the flag, then pick it out.' },
  { id: 'list', label: 'List challenge', blurb: 'Name every flag with a given feature, against the clock.' },
];

// Variants (state, civil, naval flags…) are left out of every pool except "all":
// they'd make "name the flag" ambiguous.
const main = (e: IndexEntry) => e.role === 'primary';
const NATIONAL = new Set(['sovereign', 'territory', 'historical']);

export const POOLS: { id: PoolId; label: string; test: (e: IndexEntry) => boolean }[] = [
  { id: 'countries', label: 'Countries (current)', test: (e) => main(e) && e.category === 'sovereign' && e.current },
  { id: 'territories', label: 'Territories and dependencies', test: (e) => main(e) && e.category === 'territory' && e.current },
  {
    id: 'historical',
    label: 'Historical national flags',
    test: (e) => (e.role === 'primary' || e.role === 'former') && !e.current && NATIONAL.has(e.category),
  },
  { id: 'subdivisions', label: 'States, provinces and regions', test: (e) => main(e) && e.category === 'subdivision' && e.current },
  { id: 'curated', label: 'Flags with full entries', test: (e) => e.tier === 1 },
  { id: 'all', label: 'Everything (hard!)', test: (e) => e.role !== 'variant' },
];

// ---------------------------------------------------------------- progress

export interface ItemStats {
  right: number;
  wrong: number;
  last: number;
}

const KEY = 'vexillum:progress:v1';

export function loadProgress(): Record<string, ItemStats> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveProgress(p: Record<string, ItemStats>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage full or blocked: progress just isn't remembered.
  }
}

export function record(p: Record<string, ItemStats>, id: string, correct: boolean) {
  const s = p[id] ?? { right: 0, wrong: 0, last: 0 };
  if (correct) s.right++;
  else s.wrong++;
  s.last = Date.now();
  p[id] = s;
}

/** Higher weight = more likely to be asked: unseen and often-missed flags first. */
function weight(s: ItemStats | undefined): number {
  if (!s) return 2;
  const total = s.right + s.wrong;
  const missRate = s.wrong / total;
  const days = (Date.now() - s.last) / 86_400_000;
  return 0.3 + missRate * 4 + Math.min(days, 14) / 7 - Math.min(s.right, 5) * 0.05;
}

/** Weighted sample without replacement. */
export function pickQuestions(pool: IndexEntry[], n: number, progress: Record<string, ItemStats>): IndexEntry[] {
  const items = pool.map((e) => ({ e, key: Math.pow(Math.random(), 1 / Math.max(weight(progress[e.id]), 0.01)) }));
  items.sort((a, b) => b.key - a.key);
  return items.slice(0, n).map((x) => x.e);
}

// ---------------------------------------------------------------- distractors

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Three wrong options that look like the answer where possible: sharing tags
 * (colours, layout, symbols) scores higher, with randomness so it's not fixed.
 */
export function distractors(answer: IndexEntry, pool: IndexEntry[], n = 3): IndexEntry[] {
  const answerTags = new Set(answer.tags);
  const seenNames = new Set([answer.name]);
  const scored = shuffle(pool)
    .filter((e) => e.id !== answer.id)
    .map((e) => {
      let shared = 0;
      for (const t of e.tags) if (answerTags.has(t)) shared++;
      return { e, score: shared + Math.random() * 1.5 };
    })
    .sort((a, b) => b.score - a.score);
  const out: IndexEntry[] = [];
  for (const { e } of scored) {
    if (seenNames.has(e.name)) continue;
    seenNames.add(e.name);
    out.push(e);
    if (out.length === n) break;
  }
  return out;
}

// ---------------------------------------------------------------- matching

export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bst\.?\s/g, 'saint ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Accepts the name or an alias, allowing small typos on longer names. */
export function matches(input: string, names: string[]): boolean {
  const a = normalise(input);
  if (!a) return false;
  return names.some((name) => {
    const b = normalise(name);
    if (a === b) return true;
    const allowed = b.length >= 10 ? 2 : b.length >= 5 ? 1 : 0;
    return allowed > 0 && levenshtein(a, b) <= allowed;
  });
}
