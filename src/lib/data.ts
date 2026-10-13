// Build-time access to generated flag data. Only import from .astro frontmatter.

import pages from '../generated/pages.json';
import tagsFile from '../generated/tags.json';
import type { FlagRecord } from './types';
import type { RelatedFlag } from '../components/FlagDetail';

export const flags = pages as unknown as FlagRecord[];
export const byId = new Map(flags.map((f) => [f.id, f]));

export const tagVocab = tagsFile.vocab as Record<string, Record<string, string>>;
export const tagCounts = tagsFile.counts as Record<string, number>;
export const tagLabels: Record<string, string> = Object.assign({}, ...Object.values(tagVocab));

export function toRelated(f: FlagRecord): RelatedFlag {
  return {
    id: f.id,
    name: f.name,
    img: f.img,
    from: f.from,
    to: f.to,
    current: f.current,
    href: `/flag/${f.id}/`,
  };
}

export function resolve(ids: string[] | undefined): RelatedFlag[] {
  return (ids ?? []).map((id) => byId.get(id)).filter((f): f is FlagRecord => !!f).map(toRelated);
}
