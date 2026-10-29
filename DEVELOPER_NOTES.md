# LAPaL public licence-coverage view: developer notes

A framework-free prototype of the public licence-coverage page, to be rebuilt in
LAPaL's Vue front end. Behaviour is specified in
`../licence-territory-dashboard/lapal-public-handoff/SPEC.md` and colours in `PALETTE.md`; these notes cover
how the prototype is put together and what to keep when porting it.

## Run it

```bash
python3 tools/xlsx_to_json.py      # spreadsheet -> data/lapal_licence_coverage.json
node tools/check_data.js           # validate the JSON (exit 1 and a list of errors on failure)
python3 tools/build.py             # bundle into dist/LAPaL_licence_coverage_prototype.html + dist/lapal_licence_coverage.csv
```

The output is one self-contained HTML file (about 1.7 MB: data, map shapes, d3
and PptxGenJS inlined). Only PT Sans comes from the internet, from Google Fonts. Node is not
needed in production; it is only used for the checks.

## Modules

Each module has a single job. In Vue, keep the first five as plain JS modules
and replace the last two with components.

| File | Job | DOM? |
|---|---|---|
| `src/data.js` | Loads and validates the JSON and builds lookup tables. Fails loudly. | no |
| `src/coverage.js` | All coverage logic, ported from `reference/coverage_reference.py` with the same function names in camelCase. Every number on the page comes from here. | no |
| `src/colours.js` | Which fill and pattern each legend category gets (the PALETTE.md rules) | no |
| `src/view.js` | Turns page state into what is drawn: which controls apply, tiles, tables, lookup, titles, PNG naming | no |
| `src/export.js` | PNG export (canvas) | yes |
| `src/slide.js` | PowerPoint export: one 16:9 slide (PptxGenJS 3.12.0) | yes |
| `src/embed.js` | Inside an iframe, reports the page height to the parent page (see "Embedding in LAPaL") | yes |
| `src/xlsx.js` | Spreadsheet export: writes an .xlsx with JSZip (bundled with PptxGenJS). Sheet contents come from `view.spreadsheet` | yes |
| `src/map.js` | SVG world map and legend (d3-geo + topojson-client) | yes |
| `src/ui.js` | Builds the controls from the data, holds state, redraws | yes |
| `src/tokens.css` | The single tokens block: LAPaL colours, PT Sans, map tones | |
| `src/app.css` | Page styles, using tokens only | |

`tools/build.py` also prepares the map shapes. It uses world-atlas 50m
(`vendor/`), assigns each shape its ISO3, crops Antarctica, and stops if a data
country has neither a shape nor a dot. Mapping exceptions:
- The Channel Islands are Jersey and Guernsey combined.
- Somaliland is drawn as part of Somalia, Northern Cyprus as part of Cyprus, and Åland as part of Finland.
- Gibraltar and Tuvalu are drawn as dots.

Only `d3-geo` functions are called, so the Vue build can depend on `d3-geo` and
`topojson-client` alone.

## Data contract (`data/lapal_licence_coverage.json`)

```
generated   "2026-10-27"
licences[]  code, name, licence_type, originator, disease, indication,
            colour, fade_colour, ramp_direct, ramp_indirect      (row order = display order)
countries[] iso3, country, region, income_group, income_bucket,
            new_hiv_infections, new_hiv_infections_shown_as,
            hiv_incidence_per_1000_uninfected                    (numbers null where UNAIDS has none)
coverage[]  iso3, licence, covered ("Yes"/"No"), basis, royalty_rate   (exactly one row per country x licence)
texts{}     coverage_definition, licence_types, data_sources, currency_note, ami_disclaimer
impact{}    year, global_new_infections, source
```

### Checks on load (`data.js`)

These stop the page. It shows a red box listing every problem instead of a wrong map.

- **Identifiers:**
  - ISO3 codes must be three capital letters, and unique.
  - Licence codes must be unique.
- **Coverage rows:**
  - Exactly one row for each country × licence.
  - An unknown ISO3 or licence, a missing row or a duplicate row is an error.
- **Field values:**
  - `covered` must be "Yes" or "No".
  - `basis` must be one of `Direct`, `Direct with royalties`, `Indirect` or blank, and blank whenever the country is not covered.
  - `royalty_rate` may only appear on a "Direct with royalties" row.
  - Colours must be hex codes.
  - `income_group` must be High, Upper-middle, Lower-middle or Low, and `income_bucket` must match it.
  - HIV figures must be numbers of 0 or more.
- **Required content:** every text and impact field must be present.

Warnings (logged, not fatal): "Direct with royalties" with no rate; a
`shown_as` value that is not "<N" or not stored as N/2.

### Data assumptions the code relies on

These are also commented where they are used.

- `income_bucket` is derived from `income_group` (High = HIC; all others =
  LMIC), using the current World Bank classification only.
- A licence "has bases" (shows Direct / Indirect, and offers the merge toggle)
  when any of its coverage rows has a basis. Today that is CAB only.
- "Direct with royalties" is the same coverage as Direct. It has no colour or
  legend entry of its own; it shows only in the tooltip and the lookup.
- UNAIDS ceilings such as "<100" are stored as half the ceiling, as the SPEC
  says. The lookup shows the published text.
- Countries with no UNAIDS estimate count on neither side of the share of new HIV
  acquisitions.
- The `impact{}` block has no disease field. The figures are taken to be HIV
  figures (`IMPACT_DISEASE` in `view.js`), and the tile shows only when every
  selected licence's `disease` is "HIV".
- Region labels come from the data and are shown as written.

## Spreadsheet to JSON

`tools/xlsx_to_json.py` reads the spreadsheet read-only. It only reshapes the data
and computes nothing. Each sheet becomes one key:

- **Countries** → `countries[]`
- **Licences** → `licences[]`
- **Coverage** → `coverage[]`
- **Notes** (key/value rows) → `generated`, `impact{}`, `texts{}`. The keys are
  `generated`, `impact_year`, `impact_global_new_infections`, `impact_source`,
  and `text_<name>`, which becomes `texts.<name>`.

Columns are found by header name. A missing required column, or text in a
numeric column, stops the script. All content checks are in `data.js`, so the page
and `check_data.js` apply the same rules.

## When the spreadsheet is replaced

Re-run the three commands above. No code change is needed for:

- coverage changes;
- new or removed countries, if world-atlas has a shape for them (see below);
- new region labels;
- changed wording in `texts`;
- a new HIV licence (at most three can be overlaid at once).

**Things that do need a change:**

| Change in the data | What to do |
|---|---|
| A country with no map shape, or a shape under another code | `build.py` stops and names it. Add it to `SHAPE_TO_DATA`, `NAME_TO_DATA` or `POINTS` (longitude, latitude) in `tools/build.py`. |
| A fourth licence overlaid with three others | Only three can be overlaid (`MAX_OVERLAY`). A fourth row is fine, but `PATTERNS` in `map.js` has one pattern per licence row: add a fourth. |
| A non-HIV licence | Its own map, tiles and tables work. The impact tile hides itself for any selection that includes it. |
| A future-dated column | Not supported yet. Port `future_from` from the reference and show the tile only when the count is above zero (SPEC). |
| Logos | Files in `assets/logos/` (`.svg` preferred, `.png` accepted), listed with a role in `LOGOS` in `tools/build.py`. "main" (LAPaL, MedsPaL) go in the page header and, on the slide, under the figures. "coordinator" (MPP) and "support" (Unitaid, LEAP, University of Liverpool, CELT Global Health, Coefficient Giving, in that order) go in a "Coordinated by … With support from …" row at the bottom of the page, the PNG and the slide. Each entry also has a homepage URL; on the page every logo links to it (new tab). The build inlines the files present and names any missing. |
| Footer link URLs | They are in `LINKS` in `ui.js`, not in the data. Move them to Notes if they should change without a code change. |
| Licence documents (CAB: MPP July 2025 amended agreement; LEN: Gilead; AMI: MSD) | Their URLs are in `LICENCE_SOURCES` in `ui.js`, keyed by licence code. They are listed under Data sources, and those for the selected licences go into the PNG (URLs written out), onto the slide (clickable) and into its speaker notes. A new licence needs an entry there; a `licence_url` column on the Licences sheet would remove the need for one. |

**Tests pinned to the 2026-10-27 data.**
- `tools/test_stage1.js` and `tools/test_stage3–5.js` check the SPEC
  reference figures (CAB 133, 87.2% and so on), so they will fail on new data by
  design.
- After a data update, regenerate the Python comparison with
  `../licence-territory-dashboard/.venv/bin/python tools/parity_reference.py` and update the pinned figures.
- `check_data.js` is the check that must always pass.

## Rules to carry into the Vue rebuild

- **Compute live.** Every count comes from `coverage[]` at run time. Nothing is
  precomputed.
- **Round half to even, to one decimal** (`round1`, as Python and pandas do).
  Otherwise figures such as 3/48 show 6.3% here and 6.2% in the private
  dashboard.
- **A break-out regroups the map only.** Tiles, Lists and tables always count the
  whole overlay (`countFrame` in `view.compute`), so the headline does not
  shrink to one tier.
- **Show LMIC figures next to global ones:**
  - The "% of LMICs" tile, whose List shows covered and not-covered LMICs.
  - The "LMICs only" line on the impact tile.
  - The income-group table (Low, Lower-middle, Upper-middle, High).
  - With a filter on, the "% of all 222" figure sits beside the scoped percentage.
- **Colours** (PALETTE.md for the licences; overlaps changed with Lobna on
  2026-10-29, tokens in `tokens.css`):
  - "X only" is always X's colour (CAB navy, LEN pink, AMI blue).
  - Exactly two licences: the pair's own solid colour, whether two or three
    are selected. CAB + LEN violet `#7B4FD6`, CAB + AMI yellow `#E8D44D`,
    LEN + AMI deep orange `#E07B00`.
  - All three, and ANY / ALL modes: olive green `#5F7D36` (`--map-overlap`).
  - These replace PALETTE.md's near-black overlap and its "missing licence's
    tint + pattern" for two of three. Patterns were dropped at Lobna's choice.
    In a colour-blindness simulation (protanopia, deuteranopia, tritanopia),
    every new colour stays at least as distinct from every other map colour as
    CAB navy is from LEN pink (the closest existing pair).
  - A pair with no `--map-pair-…` token (e.g. after adding a licence) falls back
    to the old tint + pattern rule, so the map never shows an uncoloured group.
  - A switched-off legend entry turns white and keeps its borders.
- **Colours are written as SVG attributes**, not CSS classes, so the PNG and the
  slide can serialise the map as it is.
- **The PNG** draws its text on a canvas (so it uses PT Sans) and the map and
  swatches as SVG images. It contains:
  - the title, the subtitle "Long-Acting PrEP Generic License(s) Coverage"
    (`view.exportSubtitle`, plural from two licences), and the time stamp;
  - the map as shown, including switched-off entries and the highlight;
  - the legend, then the filters and settings line;
  - the coverage definition and data sources;
  - the AMI disclaimer whenever AMI is selected;
  - the licence texts of the selected licences, with full URLs, and the logos.
- **The PowerPoint slide** (`slide.js`) is one 16:9 slide: the title and settings line;
  the map and legend swatches as PNG pictures; the headline figures down the right;
  and the definition, licence texts and time stamp along the bottom. The data sources
  and the AMI disclaimer go in the speaker notes only (Lobna, 29 Oct). The map, legend
  swatches and legend labels form one PowerPoint group, "Map and legend": PptxGenJS
  cannot group shapes, so `toBlob()` patches `slide1.xml` after writing (shapes named
  `Map and legend: …` are moved into one `<p:grpSp>`).
  All text is editable PowerPoint text in Arial, because PT Sans is rarely installed
  where the file is opened. The map shrinks to leave room for a long legend.
  In Vue, `pptxgenjs` is available as an npm package.
- **The spreadsheet** (`view.spreadsheet` + `xlsx.js`) follows the current selection and
  filters. It has three sheets:
  - *Countries*: one row per country in scope, with region, income group, map
    category, covered Yes/No per selected licence (plus basis and royalty rate
    for CAB), and UNAIDS figures. Ceilings such as "<200" are kept as text, as
    published, never the stored half-value.
  - *Summary*: the headline figures and the region and income-group tables.
  - *About*: the title, filters, time stamp, texts, and licence links.
  Strings are written as inline strings, so nothing can be read as a formula.
- **Grey countries have no legend entry** ("Not covered" / "None of the selected"
  are tagged `none` in `colours.js`). Instead a footnote (`view.noneNote`) gives
  their number and how many are HICs, on the page, the PNG and the slide.
- **Definitions** of PrEP, LMICs and HICs (`view.DEFINITIONS`) appear in "About
  this map", the PNG, the slide and the spreadsheet. They are in code, not in
  the spreadsheet's Notes sheet; a `text_definitions` row there could replace them.
- **MPP homepage**: listed first under the page links, added to the export credit
  line, and set as the link on the MPP logo on the slide.
- **Titles** start with "Long-acting HIV PrEP: " (`TITLE_PREFIX` in `view.js`). This
  applies to the page heading, the browser tab, the PNG, the slide (whose font
  shrinks to keep a long title on one line) and the spreadsheet.
- **Layout:** filters sit in a sticky left sidebar; the Licences picker is a white card with a
  pink top edge so it stands out as the main control. The main column opens with
  the map and legend, then the headline tiles, then the country lookup with the
  region and income-group tables beside it, then "About this map" and "Data
  sources" side by side. Below 860 px the filters move above the map; below
  1000 px the lookup and the tables stack.
- **Tables:** "By region" and "By income group" start collapsed (`<details>`).
  Once open, clicking a row shows its covered and not-covered countries
  (`rows[].lists` from `view.tables`). Open tables and rows stay open across
  redraws and follow the filters.
- **Income filter:** Low, Lower-middle and Upper-middle income (`INCOME_FILTER`
  in `view.js`); High income is not offered. The LMIC/HIC filter and table were
  removed. LMIC figures are on the "% of LMICs" and impact tiles, and the
  income-group table gives the split by group.
- **Naming:** use "AMI", never "ALI".

## Embedding in LAPaL (iframe)

The live page can be embedded as is. GitHub Pages does not block framing.

```html
<iframe id="prep-licences"
        src="https://lobnagaa.github.io/LA-PrEP-licence-territories/"
        title="Long-acting HIV PrEP: licence coverage"
        style="width:100%; height:1800px; border:0"
        loading="lazy"></iframe>
<script>
  // The page reports its height (src/embed.js); size the iframe to fit it.
  window.addEventListener('message', function (e) {
    if (e.origin !== 'https://lobnagaa.github.io') return;
    if (!e.data || e.data.type !== 'lapal-prep-licences:height') return;
    document.getElementById('prep-licences').style.height = e.data.height + 'px';
  });
</script>
```

- `src/embed.js` runs only inside an iframe. It sends
  `{type: 'lapal-prep-licences:height', height}` on load and whenever the height
  changes (lists opening, table rows expanding, licences switched). Nothing else
  is sent.
- The 1800px is only the height before the first message arrives.
- If the iframe has a `sandbox` attribute, it needs
  `allow-scripts allow-downloads allow-popups`. Without them the exports and the
  logo and licence links do not work.
- Inside an auto-sized iframe the filter sidebar does not stay pinned while
  scrolling, because the iframe itself does not scroll. Everything else behaves
  as on the stand-alone page.
- In a Vue component, put the listener in `mounted()` and remove it in `beforeUnmount()`.

## Search engines and AI readability

Most AI crawlers (GPTBot, ClaudeBot, PerplexityBot) do not run JavaScript, and
the interactive page is built entirely by JavaScript. Before this layer was
added, a crawler read 94 words of control labels and no figures. The build now
writes the following into the HTML, so about 1,400 words are readable without
JavaScript:

- **Text summary** ("Licence coverage in text", a collapsed section at the end
  of the page). For each licence, and for "at least one" / "all" of them, it
  gives the headline figures, the covered countries and the LMICs not covered.
  `tools/prerender.js` makes it with the page's own `view.tiles`, so it always
  matches the interactive figures. It also helps screen-reader users.
- **`<meta name="description">`** and Open Graph tags (link previews in Teams,
  LinkedIn and so on).
- **schema.org `Dataset` JSON-LD**: name, description, keywords, date, creator
  (LAPaL, MedsPaL), publisher (MPP), sponsors (the "With support from"
  organisations) and the CSV as a download. Supporters are tagged `sponsor`,
  not `funder`, because not all of them fund the work.
- **`dist/lapal_licence_coverage.csv`**: the country × licence table, linked from
  the summary and from Data sources. Its contents are reshaped from the data
  only; UNAIDS ceilings are kept as published.

**For the Vue rebuild:**
1. Keep the summary in the served HTML. Use server-side rendering or
   pre-rendering (e.g. Nuxt, or `vite-ssg`); do not render it only on the client.
2. Give each licence and combination its own URL (e.g.
   `/coverage/cabotegravir`), each with its own `<title>`, description and summary.
3. Once the final URL is known, add `<link rel="canonical">`, `og:url` and an
   `og:image` (an absolute URL; the PNG export of the default view works). They
   are left out of the prototype because they need the live address.
4. Serve the CSV (or JSON) at a stable URL and keep the JSON-LD `contentUrl`
   pointing to it. Add the page to LAPaL's sitemap.
5. Check that LAPaL's `robots.txt` does not block GPTBot, ClaudeBot,
   PerplexityBot or Google-Extended, if MPP wants AI tools to cite the page.
6. Decide on a data licence (for example CC BY 4.0) and add it to the JSON-LD
   (`license`). Datasets with a stated licence are more likely to be reused and
   cited. The prototype states none, because this is MPP's decision.

## Known gaps

- Touch devices are untested: tapping for tooltips, and the "About this figure"
  buttons.
- The map has no zoom; small countries get dots (`SMALL_AREA` in `map.js`). On a
  phone the patterns are very small.
- A region-filtered PNG still shows the whole world, with out-of-scope countries
  in white. There is no crop to the region.
- The real "Download PNG" button was not clicked in testing. The image it saves
  was rendered and checked in the browser.
- SPEC.md says 42 countries have no 2025 UNAIDS estimate. The data has 89: 42
  shown as "..." by UNAIDS and 47 not in its tables at all. The page computes
  this live, so only the SPEC text is affected.
