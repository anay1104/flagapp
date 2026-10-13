// Full flag page body. Rendered statically by /flag/[id] and on the client by
// the local-flag viewer, so it must not depend on build-time-only data.

import type { FlagRecord } from '../lib/types';
import { BASIS_LABELS, CATEGORY_LABELS, TIER_LABELS, formatDate, years } from '../lib/format';
import { commonsPage, original, thumb } from '../lib/img';

export interface RelatedFlag {
  id: string;
  name: string;
  img: string;
  from: number | null;
  to: number | null;
  current: boolean;
  href: string;
}

interface Props {
  flag: FlagRecord;
  related?: RelatedFlag[];
  lookalikes?: RelatedFlag[];
  tagLabels?: Record<string, string>;
}

function MiniFlag({ f }: { f: RelatedFlag }) {
  return (
    <a class="mini card" href={f.href}>
      <img
        class="flag-img"
        src={thumb(f.img, 250)}
        data-original={original(f.img)}
        alt={`Flag of ${f.name}`}
        loading="lazy"
      />
      <span class="mini-name">{f.name}</span>
      <span class="muted small">{years(f.from, f.to, f.current)}</span>
    </a>
  );
}

export default function FlagDetail({ flag: f, related = [], lookalikes = [], tagLabels = {} }: Props) {
  const facts: [string, string | undefined][] = [
    ['Used by', f.name],
    ['Type', CATEGORY_LABELS[f.category]],
    [
      'In use',
      f.periods && f.periods.length > 1
        ? f.periods.map((p) => years(p.from, p.to, p.to === null && f.current)).join(', ')
        : years(f.from, f.to, f.current),
    ],
    ['Adopted', f.adopted ? formatDate(f.adopted) : undefined],
    ['Proportions', f.ratio],
    ['Designer', f.designer],
    ['Country', f.country],
    ['Also used by', f.alsoUsedBy?.join(', ')],
  ];
  const historyById = new Map(related.map((r) => [r.id, r]));
  historyById.set(f.id, { id: f.id, name: f.name, img: f.img, from: f.from, to: f.to, current: f.current, href: '#' });

  return (
    <article class="flag-detail">
      <header class="hero">
        <div class="hero-flag">
          <img
            class="flag-img"
            src={thumb(f.img, 960)}
            data-original={original(f.img)}
            alt={f.flagName}
          />
        </div>
        <div class="hero-text">
          <p class="eyebrow">
            <span class={`tier-dot tier-${f.tier}`} />
            {TIER_LABELS[f.tier]} · {CATEGORY_LABELS[f.category]}
          </p>
          <h1>{f.flagName}</h1>
          {f.nickname && <p class="nickname">{f.nickname}</p>}
          {f.summary ? <p class="summary">{f.summary}</p> : f.description && <p class="summary">{capitalise(f.description)}.</p>}
          <dl class="facts">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} class={k === 'Also used by' ? 'wide' : undefined}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </header>

      {f.colors && f.colors.length > 0 && (
        <section>
          <h2>Colours</h2>
          <div class="colours">
            {f.colors.map((c) => (
              <div class="colour card" key={c.name}>
                <span class="swatch" style={{ background: c.hex }} />
                <div>
                  <h3>
                    {c.name} <code class="muted small">{c.hex}</code>
                  </h3>
                  {c.meaning && <p>{c.meaning}</p>}
                  {c.basis && <Basis basis={c.basis} />}
                </div>
              </div>
            ))}
          </div>
          <p class="muted small">Hex values are screen approximations; official specifications often use Pantone or CMYK.</p>
        </section>
      )}

      {f.symbols && f.symbols.length > 0 && (
        <section>
          <h2>Symbols</h2>
          <div class="symbols">
            {f.symbols.map((s) => (
              <div class="symbol card" key={s.name}>
                <h3>{s.name}</h3>
                <p class="muted">{s.description}</p>
                {s.meaning && <p>{s.meaning}</p>}
                {s.basis && <Basis basis={s.basis} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {f.origin && f.origin.length > 0 && (
        <section class="prose">
          <h2>Origin</h2>
          {f.origin.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      {f.history && f.history.length > 0 && (
        <section>
          <h2>Evolution</h2>
          <ol class="timeline">
            {f.history.map((h, i) => {
              const linked = h.flagId ? historyById.get(h.flagId) : undefined;
              return (
                <li key={i}>
                  <div class="when">{years(h.from, h.to, h.to === null)}</div>
                  <div class="what">
                    {linked && (
                      <img
                        class="flag-img tl-img"
                        src={thumb(linked.img, 120)}
                        data-original={original(linked.img)}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <div>
                      <h3>{linked && linked.href !== '#' ? <a href={linked.href}>{h.label}</a> : h.label}</h3>
                      {h.note && <p class="muted">{h.note}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {f.facts && f.facts.length > 0 && (
        <section class="prose">
          <h2>Did you know?</h2>
          <ul>
            {f.facts.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </section>
      )}

      {!f.curated && (f.depicts?.length || f.colorNames?.length) ? (
        <section>
          <h2>Elements</h2>
          {f.colorNames && <p>Colours: {f.colorNames.join(', ')}</p>}
          {f.depicts && <p>Depicts: {f.depicts.join(', ')}</p>}
        </section>
      ) : null}

      {related.length > 0 && (
        <section>
          <h2>Other flags of {f.name}</h2>
          <div class="mini-grid">
            {related.map((r) => (
              <MiniFlag f={r} key={r.id} />
            ))}
          </div>
        </section>
      )}

      {lookalikes.length > 0 && (
        <section>
          <h2>Often confused with</h2>
          <div class="mini-grid">
            {lookalikes.map((r) => (
              <MiniFlag f={r} key={r.id} />
            ))}
          </div>
        </section>
      )}

      {f.tags && f.tags.length > 0 && (
        <section>
          <h2>Features</h2>
          <div class="tags">
            {f.tags.map((t) => (
              <a class="chip" href={`/flags/?tag=${t}`} key={t}>
                {tagLabels[t] ?? t}
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Sources</h2>
        <ul class="sources small">
          {f.sources?.map((s) => (
            <li key={s.title}>{s.url ? <a href={s.url}>{s.title}</a> : s.title}</li>
          ))}
          {f.wikipedia && !f.sources?.some((s) => s.url === f.wikipedia) && (
            <li>
              <a href={f.wikipedia}>Wikipedia article</a>
            </li>
          )}
          {f.wikidata && (
            <li>
              <a href={`https://www.wikidata.org/wiki/${f.wikidata}`}>Wikidata {f.wikidata}</a>
            </li>
          )}
          <li>
            <a href={commonsPage(f.image)}>Image on Wikimedia Commons</a> (see the file page for its licence)
          </li>
        </ul>
        {!f.curated && (
          <p class="muted small">
            This is a catalogue entry imported from Wikidata. It has no written description yet, so check dates against the
            sources.
          </p>
        )}
      </section>
    </article>
  );
}

function Basis({ basis }: { basis: keyof typeof BASIS_LABELS }) {
  return <span class={`basis basis-${basis}`}>{BASIS_LABELS[basis]}</span>;
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
