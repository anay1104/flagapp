// Quiz logic that doesn't touch the DOM: pools, weighted picking, distractors,
// answer matching and saved progress.

import type { IndexEntry } from './index-data';

export type Mode = 'name' | 'type' | 'pick' | 'clue' | 'list';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type PoolId = 'countries' | 'territories' | 'historical' | 'subdivisions' | 'curated' | 'all';

export const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: 'name', label: 'Name the flag', blurb: 'See a flag, choose its name from a set of options.' },
  { id: 'type', label: 'Type the name', blurb: 'See a flag, type its name. No options to lean on.' },
  { id: 'pick', label: 'Pick the flag', blurb: 'See a name, pick its flag from look-alikes.' },
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

// ---------------------------------------------------------------- difficulty

export interface DifficultySettings {
  id: Difficulty;
  label: string;
  blurb: string;
  /** Share of the set used, best-known flags first (by how many Wikipedias cover them). */
  share: number;
  /** Answer options per question, including the right one. */
  options: number;
  /** How the wrong options are chosen. */
  distractors: DistractorStyle;
  /** Seconds per question; 0 for no clock. */
  seconds: number;
  /** Typed answers: first-letter hint and how many typos are forgiven. */
  hint: boolean;
  typos: Tolerance;
}

export const DIFFICULTIES: DifficultySettings[] = [
  {
    id: 'easy',
    label: 'Easy',
    blurb: 'Best-known flags only, options that look different, hints when typing.',
    share: 0.4,
    options: 4,
    distractors: 'unlike',
    seconds: 0,
    hint: true,
    typos: 'lenient',
  },
  {
    id: 'medium',
    label: 'Medium',
    blurb: 'Most of the set, with some look-alike options.',
    share: 0.75,
    options: 4,
    distractors: 'mixed',
    seconds: 0,
    hint: false,
    typos: 'normal',
  },
  {
    id: 'hard',
    label: 'Hard',
    blurb: 'Every flag, six close look-alikes, strict spelling and 15 seconds a question.',
    share: 1,
    options: 6,
    distractors: 'close',
    seconds: 15,
    hint: false,
    typos: 'strict',
  },
];

/** The best-known part of a set; small sets are kept whole so there's enough to ask. */
export function byDifficulty(pool: IndexEntry[], d: DifficultySettings, min = 24): IndexEntry[] {
  if (d.share >= 1 || pool.length <= min) return pool;
  const n = Math.max(min, Math.round(pool.length * d.share));
  return [...pool].sort((a, b) => b.fame - a.fame).slice(0, n);
}

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

export type DistractorStyle = 'unlike' | 'mixed' | 'close';

/**
 * Wrong options scored by shared tags (colours, layout, symbols): "close" picks
 * the nearest look-alikes, "unlike" the most different, "mixed" look-alikes with
 * enough randomness that it's not always the same set.
 */
export function distractors(answer: IndexEntry, pool: IndexEntry[], n = 3, style: DistractorStyle = 'mixed'): IndexEntry[] {
  const answerTags = new Set(answer.tags);
  const seenNames = new Set([answer.name]);
  const scored = shuffle(pool)
    .filter((e) => e.id !== answer.id)
    .map((e) => {
      let shared = 0;
      for (const t of e.tags) if (answerTags.has(t)) shared++;
      const score =
        style === 'close' ? shared + Math.random() * 0.4 : style === 'unlike' ? -shared + Math.random() * 1.5 : shared + Math.random() * 1.5;
      return { e, score };
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

export type Tolerance = 'lenient' | 'normal' | 'strict';

function typosAllowed(length: number, t: Tolerance): number {
  if (t === 'lenient') return length >= 8 ? 2 : length >= 4 ? 1 : 0;
  if (t === 'strict') return length >= 10 ? 1 : 0;
  return length >= 10 ? 2 : length >= 5 ? 1 : 0;
}

/** Accepts the name or an alias, allowing small typos on longer names. */
export function matches(input: string, names: string[], tolerance: Tolerance = 'normal'): boolean {
  const a = normalise(input);
  if (!a) return false;
  return names.some((name) => {
    const b = normalise(name);
    if (a === b) return true;
    const allowed = typosAllowed(b.length, tolerance);
    return allowed > 0 && levenshtein(a, b) <= allowed;
  });
}
