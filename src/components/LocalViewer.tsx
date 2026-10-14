// Client-side page for city and municipal flags, which are too numerous for
// static pages. Reads ?id= and loads the record from its data shard.

import { url } from '../lib/paths';
import { useEffect, useState } from 'preact/hooks';
import FlagDetail, { type RelatedFlag } from './FlagDetail';
import { flagHref, loadLocalIndex, loadLocalRecord } from '../lib/index-data';
import type { FlagRecord } from '../lib/types';

export default function LocalViewer({ tagLabels }: { tagLabels: Record<string, string> }) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'missing' } | { status: 'ok'; flag: FlagRecord; related: RelatedFlag[] }
  >({ status: 'loading' });

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) {
      setState({ status: 'missing' });
      return;
    }
    (async () => {
      const flag = await loadLocalRecord(id);
      if (!flag) {
        setState({ status: 'missing' });
        return;
      }
      document.title = `${flag.flagName} · Flagdex`;
      let related: RelatedFlag[] = [];
      if (flag.related?.length) {
        const wanted = new Set(flag.related);
        related = (await loadLocalIndex())
          .filter((e) => wanted.has(e.id))
          .map((e) => ({ id: e.id, name: e.name, img: e.img, from: e.from, to: e.to, current: e.current, href: flagHref(e) }));
      }
      setState({ status: 'ok', flag, related });
    })().catch(() => setState({ status: 'missing' }));
  }, []);

  if (state.status === 'loading') return <p class="muted" style={{ paddingTop: '2rem' }}>Loading…</p>;
  if (state.status === 'missing')
    return (
      <div style={{ paddingTop: '2rem' }}>
        <h1>Flag not found</h1>
        <p>
          <a href={url("/flags/")}>Browse all flags</a>
        </p>
      </div>
    );
  return <FlagDetail flag={state.flag} related={state.related} tagLabels={tagLabels} />;
}
