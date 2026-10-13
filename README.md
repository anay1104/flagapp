# Vexillum

Every flag, past and present, with vexillological detail (colours, symbols, origins, evolution), plus quizzes to learn them.

Static site built with [Astro](https://astro.build) and [Preact](https://preactjs.com) for the interactive parts. No backend; quiz progress lives in the browser.

## Running it

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
npm run preview    # serve dist/
```

## Where the data comes from

There are two sources, merged by `scripts/build-data.mjs`:

| Source | What | Where |
|---|---|---|
| Wikidata import | ~58,000 flags: image, owner, dates, category, colours/objects depicted, aliases | `data/raw/` (cache, not committed) |
| Hand-written entries | Full vexillological entries | `data/curated/<id>.json` |
| Feature sheet | Hand-checked layout/symbol/colour tags for flags without a full entry | `data/feature-tags.json` |
| Tag vocabulary | Every allowed tag and its label | `data/tags.json` |
| Name overrides | Display names for awkward official names ("China", not "People's Republic of China") | `data/names.json` |

```bash
npm run fetch-data   # re-download from Wikidata into data/raw (slow, ~30 min; resumable)
npm run data         # rebuild src/generated and public/data from raw + curated
```

`npm run data` writes:

- `src/generated/pages.json`: every flag that gets a static page (all except city/municipal flags)
- `public/data/index.json`: compact index used by search, browse and quizzes
- `public/data/index-local.json` and `public/data/local/*.json`: city and municipal flags, loaded on demand and shown by `/flag/view/?id=…`
- `public/data/clues.json` and `public/data/aliases.json`: quiz data

Flag images are hotlinked from Wikimedia Commons thumbnails (standard widths only: 120, 250, 330, 500, 960, 1280).

## Writing a full entry

Create `data/curated/<id>.json`, where `<id>` matches the flag's current id (see its URL, `/flag/<id>/`). Set `wikidata` to the QID of the country or entity, and the build attaches the right image and history automatically. Use `data/curated/france.json` as a template. The type is `FlagRecord` in `src/lib/types.ts`.

Rules:

- Every colour and symbol meaning gets a `basis`: `official` (law, constitution, adopting body), `traditional` (long-standing, documented) or `popular` (folk explanation). Don't present popular readings as official.
- `clues` must describe the flag without naming its owner. They're used in clue mode.
- `tags` must come from `data/tags.json`. Colour tags are added automatically from each colour's `family`.
- `lookalikes` are flag ids. The build warns about unknown ids.
- Write original text; cite sources. Don't copy Wikipedia prose.
- Run `node scripts/check-links.mjs` to verify source URLs.

## Quiz modes

Name the flag (multiple choice), type the name (aliases from Wikidata accepted, small typos forgiven), pick the flag, clue mode, and list challenge (name every flag with a feature). Questions are weighted toward unseen and often-missed flags. Logic is in `src/lib/quiz.ts`, UI in `src/components/QuizApp.tsx`.
