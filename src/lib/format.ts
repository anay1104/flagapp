import type { Category, MeaningBasis } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  sovereign: 'Sovereign state',
  territory: 'Territory or dependency',
  historical: 'Historical state',
  subdivision: 'Subdivision',
  ethnic: 'People or ethnic group',
  organization: 'Organisation',
  military: 'Military',
  religious: 'Religious',
  local: 'City or municipality',
  other: 'Other',
};

export const CATEGORY_PLURALS: Record<Category, string> = {
  sovereign: 'Sovereign states',
  territory: 'Territories',
  historical: 'Historical states',
  subdivision: 'Subdivisions',
  ethnic: 'Peoples',
  organization: 'Organisations',
  military: 'Military',
  religious: 'Religious',
  local: 'Cities and municipalities',
  other: 'Other',
};

export const TIER_LABELS = {
  1: 'Full entry',
  2: 'Wikipedia entry',
  3: 'Catalogue entry',
} as const;

export const BASIS_LABELS: Record<MeaningBasis, string> = {
  official: 'Official',
  traditional: 'Traditional',
  popular: 'Popular reading',
};

function yearLabel(y: number): string {
  return y < 0 ? `${-y} BCE` : String(y);
}

export function years(from: number | null, to: number | null, current: boolean): string {
  if (from === null && to === null) return current ? 'In use' : 'Dates unknown';
  if (to === null) return current ? `${from !== null ? yearLabel(from) : '?'}–present` : `from ${yearLabel(from!)}`;
  if (from === null) return `until ${yearLabel(to)}`;
  if (from === to) return yearLabel(from);
  return `${yearLabel(from)}–${yearLabel(to)}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!m) return String(y);
  return new Date(Date.UTC(y, m - 1, d || 1)).toLocaleDateString('en-GB', {
    day: d ? 'numeric' : undefined,
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
