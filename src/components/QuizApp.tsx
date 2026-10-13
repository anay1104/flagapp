import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { flagHref, loadIndex, type IndexEntry } from '../lib/index-data';
import { original, thumb } from '../lib/img';
import { years } from '../lib/format';
import {
  MODES,
  POOLS,
  distractors,
  loadProgress,
  matches,
  normalise,
  pickQuestions,
  record,
  saveProgress,
  shuffle,
  type ItemStats,
  type Mode,
  type PoolId,
} from '../lib/quiz';

interface Props {
  tagLabels: Record<string, string>;
}

interface Question {
  answer: IndexEntry;
  options: IndexEntry[];
  clue?: string;
}

interface Answered {
  q: Question;
  correct: boolean;
  given: string;
}

type Phase = 'setup' | 'play' | 'done';

const LENGTHS = [10, 20, 50, 0];

const Flag = ({ e, size = 500, alt = '' }: { e: IndexEntry; size?: number; alt?: string }) => (
  <img class="flag-img" src={thumb(e.img, size)} data-original={original(e.img)} alt={alt} />
);

export default function QuizApp({ tagLabels }: Props) {
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [clues, setClues] = useState<Record<string, string[]>>({});
  const [aliases, setAliases] = useState<Record<string, string[]>>({});
  const [mode, setMode] = useState<Mode>('name');
  const [poolId, setPoolId] = useState<PoolId>('countries');
  const [length, setLength] = useState(10);
  const [tag, setTag] = useState('star');
  const [phase, setPhase] = useState<Phase>('setup');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answered, setAnswered] = useState<Answered[]>([]);
  const progress = useRef<Record<string, ItemStats>>({});

  useEffect(() => {
    progress.current = loadProgress();
    const p = new URLSearchParams(location.search);
    const m = p.get('mode') as Mode | null;
    if (m && MODES.some((x) => x.id === m)) setMode(m);
    const t = p.get('tag');
    if (t) setTag(t);
    const pool = p.get('pool') as PoolId | null;
    if (pool && POOLS.some((x) => x.id === pool)) setPoolId(pool);
    loadIndex().then(setIndex);
    fetch('/data/clues.json').then((r) => r.json()).then(setClues, () => {});
    fetch('/data/aliases.json').then((r) => (r.ok ? r.json() : {})).then(setAliases, () => {});
  }, []);

  const pool = useMemo(() => {
    if (!index) return [];
    const test = POOLS.find((p) => p.id === poolId)!.test;
    let list = index.filter(test);
    if (mode === 'clue') list = list.filter((e) => clues[e.id]?.length);
    return list;
  }, [index, poolId, mode, clues]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, Set<string>> = {};
    for (const e of pool) for (const t of e.tags) (counts[t] ??= new Set()).add(e.name);
    return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.size]));
  }, [pool]);

  const start = () => {
    const n = length === 0 ? pool.length : Math.min(length, pool.length);
    const picked = pickQuestions(pool, n, progress.current);
    setQuestions(
      picked.map((answer) => ({
        answer,
        options: mode === 'type' ? [] : shuffle([answer, ...distractors(answer, pool)]),
        clue: mode === 'clue' ? shuffle(clues[answer.id] ?? [])[0] : undefined,
      })),
    );
    setAnswered([]);
    setPhase('play');
  };

  const answer = (correct: boolean, given: string) => {
    const q = questions[answered.length];
    record(progress.current, q.answer.id, correct);
    saveProgress(progress.current);
    const next = [...answered, { q, correct, given }];
    setAnswered(next);
  };

  if (!index) return <p class="muted">Loading flags…</p>;

  if (phase === 'setup') {
    const canStart = mode === 'list' ? (tagCounts[tag] ?? 0) > 0 : pool.length >= 4;
    return (
      <div class="quiz-setup">
        <fieldset>
          <legend>Mode</legend>
          <div class="mode-grid">
            {MODES.map((m) => (
              <label class={`mode card ${mode === m.id ? 'selected' : ''}`} key={m.id}>
                <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
                <strong>{m.label}</strong>
                <span class="muted small">{m.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div class="setup-row">
          <label>
            <span>Flags</span>
            <select value={poolId} onChange={(e) => setPoolId((e.target as HTMLSelectElement).value as PoolId)}>
              {POOLS.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {mode === 'list' ? (
            <label>
              <span>Feature</span>
              <select value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)}>
                {Object.entries(tagCounts)
                  .filter(([, n]) => n >= 2)
                  .sort((a, b) => (tagLabels[a[0]] ?? a[0]).localeCompare(tagLabels[b[0]] ?? b[0]))
                  .map(([k, n]) => (
                    <option value={k} key={k}>
                      {tagLabels[k] ?? k} ({n})
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <label>
              <span>Questions</span>
              <select value={length} onChange={(e) => setLength(Number((e.target as HTMLSelectElement).value))}>
                {LENGTHS.map((n) => (
                  <option value={n} key={n}>
                    {n === 0 ? `All (${pool.length})` : n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p class="muted small">
          {mode === 'list'
            ? 'Features come from written entries and Wikidata, so coverage grows as more entries are written.'
            : `${pool.length.toLocaleString()} flags in this set.`}
          {mode === 'clue' && ' Clue mode only uses flags with full written entries.'}
        </p>
        <button class="btn primary" disabled={!canStart} onClick={() => (mode === 'list' ? setPhase('play') : start())}>
          Start
        </button>
      </div>
    );
  }

  if (mode === 'list') {
    return (
      <ListChallenge
        pool={pool}
        tag={tag}
        tagLabel={tagLabels[tag] ?? tag}
        aliases={aliases}
        onExit={() => setPhase('setup')}
      />
    );
  }

  if (phase === 'play' && answered.length < questions.length) {
    return (
      <QuestionView
        key={answered.length}
        mode={mode}
        q={questions[answered.length]}
        number={answered.length + 1}
        total={questions.length}
        score={answered.filter((a) => a.correct).length}
        aliases={aliases}
        onAnswer={answer}
        onQuit={() => setPhase('done')}
      />
    );
  }

  const score = answered.filter((a) => a.correct).length;
  const missed = answered.filter((a) => !a.correct);
  return (
    <div class="quiz-done">
      <h2>
        {score} / {answered.length}
      </h2>
      <p class="muted">{verdict(score, answered.length)}</p>
      <div class="row">
        <button class="btn primary" onClick={start}>
          Play again
        </button>
        <button class="btn" onClick={() => setPhase('setup')}>
          Change settings
        </button>
      </div>
      {missed.length > 0 && (
        <>
          <h3 style={{ marginTop: '2rem' }}>Review the ones you missed</h3>
          <p class="muted small">These will come up more often next time.</p>
          <div class="flag-grid">
            {missed.map(({ q, given }) => (
              <a class="flag-tile card" href={flagHref(q.answer)} key={q.answer.id}>
                <div class="frame">
                  <Flag e={q.answer} size={250} />
                </div>
                <span class="name">{q.answer.name}</span>
                <span class="meta">
                  {years(q.answer.from, q.answer.to, q.answer.current)}
                  {given && ` · you said ${given}`}
                </span>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function verdict(score: number, total: number): string {
  if (!total) return 'No questions answered.';
  const r = score / total;
  if (r === 1) return 'Perfect score.';
  if (r >= 0.8) return 'Excellent.';
  if (r >= 0.5) return 'Good going. The missed flags will come round again.';
  return 'Keep practising; missed flags come up more often.';
}

function label(e: IndexEntry, all: IndexEntry[]): string {
  // Disambiguate historical variants of the same name with their years.
  const clash = all.some((o) => o !== e && o.name === e.name);
  return clash || !e.current ? `${e.name} (${years(e.from, e.to, e.current)})` : e.name;
}

interface QuestionProps {
  mode: Mode;
  q: Question;
  number: number;
  total: number;
  score: number;
  aliases: Record<string, string[]>;
  onAnswer: (correct: boolean, given: string) => void;
  onQuit: () => void;
}

function QuestionView({ mode, q, number, total, score, aliases, onAnswer, onQuit }: QuestionProps) {
  const [chosen, setChosen] = useState<IndexEntry | null>(null);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (mode === 'type') input.current?.focus();
  }, []);
  useEffect(() => {
    if (result !== null) nextBtn.current?.focus();
  }, [result]);

  const choose = (e: IndexEntry) => {
    if (result !== null) return;
    setChosen(e);
    setResult(e.id === q.answer.id);
  };

  const submitTyped = (ev: Event) => {
    ev.preventDefault();
    if (result !== null || !typed.trim()) return;
    setResult(matches(typed, [q.answer.name, ...(aliases[q.answer.id] ?? [])]));
  };

  const next = () => onAnswer(result === true, mode === 'type' ? typed : chosen ? chosen.name : '');
  const showFlagPrompt = mode === 'name' || mode === 'type';

  return (
    <div class="question">
      <div class="q-head">
        <span>
          Question {number} of {total}
        </span>
        <span>Score {score}</span>
        <button class="linkish" onClick={onQuit}>
          End quiz
        </button>
      </div>
      <div class="progress-bar">
        <span style={{ width: `${((number - 1) / total) * 100}%` }} />
      </div>

      {showFlagPrompt && (
        <div class="q-flag">
          <Flag e={q.answer} size={500} alt="Which flag is this?" />
        </div>
      )}
      {mode === 'pick' && (
        <h2 class="q-prompt">
          Which is the flag of <strong>{q.answer.name}</strong>
          {!q.answer.current && <span class="muted"> ({years(q.answer.from, q.answer.to, false)})</span>}?
        </h2>
      )}
      {mode === 'clue' && (
        <blockquote class="q-clue">
          <p>{q.clue}</p>
        </blockquote>
      )}

      {mode === 'name' && (
        <div class="options text">
          {q.options.map((o) => (
            <button
              key={o.id}
              class={`btn option ${result !== null && o.id === q.answer.id ? 'right' : ''} ${
                result === false && chosen?.id === o.id ? 'wrong' : ''
              }`}
              onClick={() => choose(o)}
              disabled={result !== null && o.id !== q.answer.id && chosen?.id !== o.id}
            >
              {label(o, q.options)}
            </button>
          ))}
        </div>
      )}

      {(mode === 'pick' || mode === 'clue') && (
        <div class="options flags">
          {q.options.map((o) => (
            <button
              key={o.id}
              class={`option-flag card ${result !== null && o.id === q.answer.id ? 'right' : ''} ${
                result === false && chosen?.id === o.id ? 'wrong' : ''
              }`}
              onClick={() => choose(o)}
              aria-label={result === null ? 'Option' : o.name}
            >
              <Flag e={o} size={330} />
              {result !== null && <span class="small">{o.name}</span>}
            </button>
          ))}
        </div>
      )}

      {mode === 'type' && (
        <form class="typed" onSubmit={submitTyped}>
          <input
            ref={input}
            type="text"
            value={typed}
            onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
            placeholder="Type the name…"
            disabled={result !== null}
            autocomplete="off"
            aria-label="Your answer"
          />
          {result === null && (
            <>
              <button class="btn primary" type="submit">
                Check
              </button>
              <button class="btn" type="button" onClick={() => setResult(false)}>
                Reveal
              </button>
            </>
          )}
        </form>
      )}

      {result !== null && (
        <div class={`feedback ${result ? 'good' : 'bad'}`}>
          <p>
            {result ? 'Correct! ' : 'Not quite. '}
            It's <a href={flagHref(q.answer)} target="_blank" rel="noopener">{q.answer.name}</a>
            {!q.answer.current && ` (${years(q.answer.from, q.answer.to, false)})`}.
          </p>
          <button class="btn primary" ref={nextBtn} onClick={next}>
            {number === total ? 'See results' : 'Next'}
          </button>
        </div>
      )}
    </div>
  );
}

interface ListProps {
  pool: IndexEntry[];
  tag: string;
  tagLabel: string;
  aliases: Record<string, string[]>;
  onExit: () => void;
}

function ListChallenge({ pool, tag, tagLabel, aliases, onExit }: ListProps) {
  // One target per distinct name, so historical variants don't count twice.
  const targets = useMemo(() => {
    const byName = new Map<string, IndexEntry>();
    for (const e of pool) if (e.tags.includes(tag) && !byName.has(e.name)) byName.set(e.name, e);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pool, tag]);
  const [found, setFound] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [startedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finished]);

  useEffect(() => {
    if (found.length === targets.length && targets.length) setFinished(true);
  }, [found]);

  const onInput = (value: string) => {
    setTyped(value);
    // Accept as soon as the text exactly names a remaining target.
    const n = normalise(value);
    const hit = targets.find(
      (t) => !found.includes(t.id) && [t.name, ...(aliases[t.id] ?? [])].some((x) => normalise(x) === n),
    );
    if (hit) {
      setFound([...found, hit.id]);
      setTyped('');
      setFlash(hit.name);
    }
  };

  const onSubmit = (ev: Event) => {
    ev.preventDefault();
    const hit = targets.find((t) => !found.includes(t.id) && matches(typed, [t.name, ...(aliases[t.id] ?? [])]));
    if (hit) {
      setFound([...found, hit.id]);
      setFlash(hit.name);
    } else {
      setFlash(found.some((id) => matches(typed, [targets.find((t) => t.id === id)!.name])) ? 'Already found' : 'Not on the list');
    }
    setTyped('');
  };

  const secs = Math.floor((now - startedAt) / 1000);
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const shown = finished ? targets : targets.filter((t) => found.includes(t.id));

  return (
    <div class="list-challenge">
      <div class="q-head">
        <span>
          <strong>{found.length}</strong> / {targets.length} found
        </span>
        <span>{clock}</span>
        <button class="linkish" onClick={onExit}>
          Back to setup
        </button>
      </div>
      <h2 class="q-prompt">Name every flag with: {tagLabel}</h2>
      {!finished ? (
        <form class="typed" onSubmit={onSubmit}>
          <input
            type="text"
            value={typed}
            onInput={(e) => onInput((e.target as HTMLInputElement).value)}
            placeholder="Type a name…"
            autocomplete="off"
            autoFocus
            aria-label="Flag name"
          />
          <button class="btn" type="button" onClick={() => setFinished(true)}>
            Give up
          </button>
        </form>
      ) : (
        <p class="feedback good">
          {found.length === targets.length ? 'You got them all!' : `You found ${found.length} of ${targets.length}.`} Time {clock}.
        </p>
      )}
      {flash && !finished && <p class="muted small">{flash}</p>}
      <div class="flag-grid" style={{ marginTop: '1rem' }}>
        {shown.map((t) => (
          <a class={`flag-tile card ${found.includes(t.id) ? '' : 'missed'}`} href={flagHref(t)} key={t.id}>
            <div class="frame">
              <Flag e={t} size={250} />
            </div>
            <span class="name">{t.name}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
