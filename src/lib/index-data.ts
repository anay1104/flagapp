// Client-side access to the compact flag index written by scripts/build-data.mjs.

import { url } from './paths';
import type { Category, FlagRecord, Tier } from './types';

export interface IndexEntry {
  id: string;
  name: string;
  img: string;
  category: Category;
  tier: Tier;
  from: number | null;
  to: number | null;
  current: boolean;
  country: string;
  tags: string[];
  /** primary = the subject's main flag; former = an earlier flag; variant = state/civil/naval etc.; other = standalone flag. */
  role: Role;
  /** Local flags have no static page; they open in the viewer. */
  local: boolean;
}

export type Role = 'primary' | 'former' | 'variant' | 'other';

type Row = [string, string, string, number, Tier, number | null, number | null, 0 | 1, string, string, number];

interface IndexFile {
  categories: Category[];
  roles: Role[];
  rows: Row[];
}

const cache = new Map<string, Promise<IndexEntry[]>>();

async function load(file: string, local: boolean): Promise<IndexEntry[]> {
  const res = await fetch(url(`/data/${file}`));
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  const data: IndexFile = await res.json();
  return data.rows.map(([id, name, img, cat, tier, from, to, current, country, tags, role]) => ({
    id,
    name,
    img,
    category: data.categories[cat],
    tier,
    from,
    to,
    current: current === 1,
    country,
    tags: tags ? tags.split(' ') : [],
    role: data.roles[role],
    local,
  }));
}

/** Every flag with its own page (everything except city and municipal flags). */
export function loadIndex(): Promise<IndexEntry[]> {
  if (!cache.has('main')) cache.set('main', load('index.json', false));
  return cache.get('main')!;
}

/** City and municipal flags (large; load on demand). */
export function loadLocalIndex(): Promise<IndexEntry[]> {
  if (!cache.has('local')) cache.set('local', load('index-local.json', true));
  return cache.get('local')!;
}

export function flagHref(e: Pick<IndexEntry, 'id' | 'local'>): string {
  return e.local ? url(`/flag/view/?id=${encodeURIComponent(e.id)}`) : url(`/flag/${e.id}/`);
}

export const LOCAL_SHARDS = 64;

export function shardOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % LOCAL_SHARDS;
}

export async function loadLocalRecord(id: string): Promise<FlagRecord | undefined> {
  const res = await fetch(url(`/data/local/${shardOf(id)}.json`));
  if (!res.ok) return undefined;
  const shard: Record<string, FlagRecord> = await res.json();
  return shard[id];
}
