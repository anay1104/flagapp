// Search and filter over the full flag index, synced to the URL query string.

import { useEffect, useMemo, useState } from 'preact/hooks';
import { flagHref, loadIndex, loadLocalIndex, type IndexEntry } from '../lib/index-data';
import { CATEGORY_PLURALS, years } from '../lib/format';
import { original, thumb } from '../lib/img';
import type { Category } from '../lib/types';

const PAGE = 120;
const CATEGORIES = Object.keys(CATEGORY_PLURALS) as Category[];

interface Filters {
  q: string;
  cat: string;
  era: string;
  tag: string;
  tier: string;
  sort: string;
}

const DEFAULTS: Filters = { q: '', cat: '', era: '', tag: '', tier: '', sort: 'relevance' };

function readUrl(): Filters {
  const p = new URLSearchParams(location.search);
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, p.get(k) ?? v])) as unknown as Filters;
}

function writeUrl(f: Filters) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v && v !== DEFAULTS[k as keyof Filters]) p.set(k, v);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function Browser({ tagLabels }: { tagLabels: Record<string, string> }) {
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [main, setMain] = useState<IndexEntry[] | null>(null);
  const [local, setLocal] = useState<IndexEntry[] | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState('');

  useEffect(() => {
    setFilters(readUrl());
    loadIndex().then(setMain, (e) => setError(String(e)));
  }, []);

  const wantsLocal = filters.cat === 'local';
  useEffect(() => {
    if (wantsLocal && !local && !loadingLocal) {
      setLoadingLocal(true);
      loadLocalIndex().then(setLocal, (e) => setError(String(e)));
    }
  }, [wantsLocal]);

  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    setLimit(PAGE);
    writeUrl(next);
  };

  const results = useMemo(() => {
    const source = wantsLocal ? local ?? [] : main ?? [];
    const q = norm(filters.q.trim());
    let list = source.filter((e) => {
      if (filters.cat && e.category !== filters.cat) return false;
      if (filters.era === 'current' && !e.current) return false;
      if (filters.era === 'historical' && e.current) return false;
      if (filters.tag && !e.tags.includes(filters.tag)) return false;
      if (filters.tier === '1' && e.tier !== 1) return false;
      if (q && !norm(e.name).includes(q) && !norm(e.country).includes(q)) return false;
      return true;
    });
    if (filters.sort === 'oldest') {
      list = list.sort((a, b) => (a.from ?? 99999) - (b.from ?? 99999));
    } else if (filters.sort === 'newest') {
      list = list.sort((a, b) => (b.from ?? -99999) - (a.from ?? -99999));
    } else if (filters.sort === 'name') {
      list = list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Relevance: exact and prefix matches first, then written entries, then major categories.
      const score = (e: IndexEntry) => {
        const n = norm(e.name);
        let s = 0;
        if (q) s += n === q ? 0 : n.startsWith(q) ? 1 : 2;
        s = s * 100 + (e.tier - 1) * 20 + CATEGORIES.indexOf(e.category) * 2 + (e.current ? 0 : 1);
        return s;
      };
      list = list.map((e) => [score(e), e] as const).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
    }
    return list;
  }, [main, local, filters]);

  const loading = wantsLocal ? !local : !main;

  return (
    <div class="browser">
      <div class="filters">
        <input
          type="search"
          placeholder="Search by name or country…"
          value={filters.q}
          onInput={(e) => update({ q: (e.target as HTMLInputElement).value })}
          aria-label="Search"
        />
        <select value={filters.cat} onChange={(e) => update({ cat: (e.target as HTMLSelectElement).value })} aria-label="Type">
          <option value="">All types</option>
          {CATEGORIES.map((c) => (
            <option value={c} key={c}>
              {CATEGORY_PLURALS[c]}
            </option>
          ))}
        </select>
        <select value={filters.era} onChange={(e) => update({ era: (e.target as HTMLSelectElement).value })} aria-label="Era">
          <option value="">Current and historical</option>
          <option value="current">Current only</option>
          <option value="historical">Historical only</option>
        </select>
        <select value={filters.tag} onChange={(e) => update({ tag: (e.target as HTMLSelectElement).value })} aria-label="Feature">
          <option value="">Any feature</option>
          {Object.entries(tagLabels)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
        </select>
        <select value={filters.tier} onChange={(e) => update({ tier: (e.target as HTMLSelectElement).value })} aria-label="Detail">
          <option value="">Any detail level</option>
          <option value="1">Full entries only</option>
        </select>
        <select value={filters.sort} onChange={(e) => update({ sort: (e.target as HTMLSelectElement).value })} aria-label="Sort">
          <option value="relevance">Most relevant</option>
          <option value="name">A–Z</option>
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
      </div>

      {error && <p class="bad">Could not load flags: {error}</p>}
      {loading ? (
        <p class="muted">Loading flags…</p>
      ) : (
        <>
          <p class="muted small">
            {results.length.toLocaleString()} flag{results.length === 1 ? '' : 's'}
            {!wantsLocal && ' · city and municipal flags are under the "Cities and municipalities" type'}
          </p>
          <div class="flag-grid">
            {results.slice(0, limit).map((e) => (
              <a class="flag-tile card" href={flagHref(e)} key={e.id}>
                <div class="frame">
                  <img
                    class="flag-img"
                    src={thumb(e.img, 250)}
                    data-original={original(e.img)}
                    alt=""
                    loading="lazy"
                  />
                </div>
                <span class="name">
                  <span class={`tier-dot tier-${e.tier}`} title={e.tier === 1 ? 'Full entry' : 'Catalogue entry'} />
                  {e.name}
                </span>
                <span class="meta">
                  {years(e.from, e.to, e.current)}
                  {e.country && ` · ${e.country}`}
                </span>
              </a>
            ))}
          </div>
          {results.length > limit && (
            <p style={{ textAlign: 'center', marginTop: '1.5rem' }}>
              <button class="btn" onClick={() => setLimit(limit + PAGE)}>
                Show more ({(results.length - limit).toLocaleString()} left)
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
