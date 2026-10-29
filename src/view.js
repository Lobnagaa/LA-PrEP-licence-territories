/* Page state -> what to draw. Pure functions, no DOM, so the rules behind the
 * controls can be tested in Node (tools/test_stage3.js).
 *
 * State (what the reader has chosen):
 *   { licences: ['CAB'], merge: true, mode: 'combination', expandDepth: null,
 *     regions: [], incomeGroups: [], incomeBuckets: [], highlight: null }
 * Empty `regions` / `incomeGroups` / `incomeBuckets` = no filter.
 * The page offers the income-group filter (Low, Lower-middle, Upper-middle);
 * `incomeBuckets` (LMIC/HIC) is kept for the reference checks but has no control.
 *
 * `normalise` drops choices that do not apply to the current selection
 * (the merge toggle with several licences, an overlay mode with one licence,
 * a break-out tier that has no countries under the current filters) so the
 * page never draws a combination of settings it does not show a control for.
 */
(function (root) {
  'use strict';
  var C = root.LapalCoverage || (typeof require !== 'undefined' && require('./coverage.js'));

  var MODES = [C.MODE_COMBINATION, C.MODE_ANY, C.MODE_ALL];  // MODE_DEPTH is not offered publicly

  // Income groups offered as a filter, poorest first. High income is not offered.
  var INCOME_FILTER = ['Low', 'Lower-middle', 'Upper-middle'];
  function incomeLabel(g) { return g + ' income'; }

  /* Landing view: the first licence in the data (Cabotegravir), with direct and
   * indirect coverage merged into one colour. */
  function initialState(ds) {
    return { licences: [ds.licences[0].code], merge: true, mode: C.MODE_COMBINATION,
             expandDepth: null, regions: [], incomeGroups: [], incomeBuckets: [], highlight: null };
  }

  /* Returns {state, notes}: a corrected copy of the state, and a plain-English
   * note for each choice that had to be dropped (shown on the page). */
  function normalise(ds, s) {
    var notes = [];
    var codes = ds.licences.map(function (l) { return l.code; });
    // Data order, not click order, so labels and colours stay stable.
    var licences = codes.filter(function (c) { return (s.licences || []).indexOf(c) >= 0; })
      .slice(0, C.MAX_OVERLAY);
    if (!licences.length) licences = [codes[0]];
    var n = licences.length;
    var single = n === 1 ? ds.licenceByCode[licences[0]] : null;

    var out = {
      licences: licences,
      // Kept as the reader's preference even while it does not apply, so going
      // back to CAB alone restores it; compute() applies it only to a licence
      // that records direct / indirect bases.
      merge: !!s.merge,
      mode: n > 1 && MODES.indexOf(s.mode) >= 0 ? s.mode : C.MODE_COMBINATION,
      expandDepth: null,
      regions: (s.regions || []).filter(function (r) { return ds.regions.indexOf(r) >= 0; }),
      incomeGroups: INCOME_FILTER.filter(function (g) { return (s.incomeGroups || []).indexOf(g) >= 0; }),
      incomeBuckets: (s.incomeBuckets || []).filter(function (b) { return ds.incomeBuckets.indexOf(b) >= 0; }),
      highlight: s.highlight && ds.countryByIso[s.highlight] ? s.highlight : null,
    };

    // Break-out: three licences, combinations mode, and only a tier that has
    // countries under the current filters (the tiers come from the filtered
    // frame, as in the private dashboard).
    if (s.expandDepth != null && n === C.MAX_OVERLAY && out.mode === C.MODE_COMBINATION) {
      var tiers = tierOptions(ds, out);
      if (tiers.some(function (t) { return t.depth === s.expandDepth; })) out.expandDepth = s.expandDepth;
      else notes.push('No country in scope is in the "' + tierName(s.expandDepth, n) +
                      '" tier, so the break-out was switched off.');
    }
    return { state: out, notes: notes };
  }

  function scopeOf(ds, s) {
    return C.filterCountries(ds, { regions: s.regions, incomeGroups: s.incomeGroups, incomeBuckets: s.incomeBuckets });
  }

  /* The coverage.js view description and frames for a (normalised) state.
   *  frame:      what the map and legend draw (with a break-out, the tier's
   *              combinations and everything else grouped);
   *  countFrame: what every count, tile and table uses. As in the private
   *              dashboard, a break-out regroups the map only: counting the
   *              break-out frame would make the headline shrink to one tier. */
  function compute(ds, s) {
    var countries = scopeOf(ds, s);
    var view, frame, countFrame;
    if (s.licences.length === 1) {
      var merge = s.merge && ds.licenceByCode[s.licences[0]].has_bases;
      view = { kind: 'single', licence: s.licences[0], merge: merge };
      frame = countFrame = C.licenceFrame(ds, view.licence, countries, merge);
    } else {
      view = { kind: 'overlay', licences: s.licences, mode: s.mode,
               expandDepth: s.expandDepth == null ? undefined : s.expandDepth };
      countFrame = C.overlayFrame(ds, s.licences, countries, { mode: s.mode });
      frame = view.expandDepth == null ? countFrame
        : C.overlayFrame(ds, s.licences, countries, { mode: s.mode, expandDepth: view.expandDepth });
    }
    return { view: view, frame: frame, countFrame: countFrame, countries: countries };
  }

  /* Break-out choices for the current licences and filters: [{depth, label, nCombinations}]. */
  function tierOptions(ds, s) {
    if (s.licences.length !== C.MAX_OVERLAY) return [];
    var frame = C.overlayFrame(ds, s.licences, scopeOf(ds, s), { mode: C.MODE_COMBINATION });
    return C.depthTierOptions(frame, s.licences.length).map(function (t) {
      return Object.assign({}, t, { label: tierName(t.depth, s.licences.length) });
    });
  }

  /* Reader-facing tier names. The reference labels ("2 of 3 selected") are kept
   * in coverage.js for parity; the control uses these. */
  function tierName(depth, n) {
    if (depth === n) return 'All ' + n;
    if (depth === 1) return 'One only';
    return 'Which ' + (depth === 2 ? 'two' : depth);
  }

  /* Licences that record direct / indirect bases (the merge toggle applies to
   * these only; today CAB). Worked out from the data, not hard-coded. */
  function mergeNote(ds) {
    var codes = ds.licences.filter(function (l) { return l.has_bases; }).map(function (l) { return l.code; });
    if (!codes.length) return null;
    var list = codes.length > 1 ? codes.slice(0, -1).join(', ') + ' and ' + codes[codes.length - 1] : codes[0];
    // {note, howTo}: howTo is shown only while the toggle is greyed out.
    return { note: 'Applies to ' + list + ' only.',
             howTo: 'Select ' + (codes.length > 1 ? 'one of them' : codes[0]) + ' on its own to use it.' };
  }

  /* "Long-acting HIV PrEP: Cabotegravir licence coverage". The prefix (Lobna,
   * 2026-10-29) heads the page, the PNG, the slide and the spreadsheet. */
  var TITLE_PREFIX = 'Long-acting HIV PrEP: ';
  function title(ds, s) {
    var names = s.licences.map(function (c) { return ds.licenceByCode[c].name; });
    var joined = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    return TITLE_PREFIX + joined + ' licence' + (names.length > 1 ? 's' : '') + ' coverage';
  }

  /* Footnote for the grey countries, which have no legend entry: how many, and
   * how many of them are high-income. null when every country in scope is covered. */
  function noneNote(ds, s, c) {
    var grey = c.frame.filter(function (r) { return !r.covered; });
    if (!grey.length) return null;
    var hic = grey.filter(function (r) { return r.income_bucket === 'HIC'; }).length;
    var who = s.licences.length === 1 ? 'the ' + ds.licenceByCode[s.licences[0]].name.toLowerCase() + ' licence'
      : 'any of the selected licences';
    return 'Countries in grey are not covered by ' + who + ': ' + plural(grey.length, 'country', 'countries') +
      (hic ? ', including ' + hic + ' high-income ' + (hic === 1 ? 'country' : 'countries') + ' (HICs)' : ', none of them HICs') + '.';
  }

  // Definitions footnote (page, PNG, slide, spreadsheet).
  var DEFINITIONS = 'PrEP: pre-exposure prophylaxis, medicine taken by people who do not have HIV to prevent ' +
    'acquiring it. LMICs: low- and middle-income countries, i.e. low, lower-middle and upper-middle income ' +
    'economies in the World Bank classification. HICs: high-income countries in the World Bank classification.';

  /* Subtitle of the PNG and the slide, under the title (wording from Lobna,
   * 2026-10-29). Plural once two or more licences are selected. */
  function exportSubtitle(s) {
    return 'Long-Acting PrEP Generic ' + (s.licences.length > 1 ? 'Licenses' : 'License') + ' Coverage';
  }

  /* One line naming the scope and settings, used under the title (and on the PNG later). */
  function summary(ds, s, nInScope) {
    var parts = [];
    parts.push(s.regions.length ? 'Region: ' + s.regions.join(', ') : 'All regions');
    var income = s.incomeGroups.map(incomeLabel).concat(s.incomeBuckets);
    parts.push(income.length ? income.join(', ') : 'All income groups');
    if (s.licences.length > 1) {
      parts.push({ combination: 'Combinations', any: 'Covered by any selected', all: 'Covered by all selected' }[s.mode]);
      if (s.expandDepth != null) parts.push('Break-out: ' + tierName(s.expandDepth, s.licences.length));
    } else if (ds.licenceByCode[s.licences[0]].has_bases) {
      parts.push(s.merge ? 'Direct and indirect merged' : 'Direct and indirect shown apart');
    }
    parts.push(nInScope + ' of ' + ds.countries.length + ' countries in scope');
    return parts.join(' · ');
  }

  /* The coverage line in the map tooltip. */
  function tipLine(ds, view, row) {
    if (view.kind === 'overlay') return 'Combination: ' + row.combination;
    var lic = ds.licenceByCode[view.licence];
    if (!row.covered) return 'Not covered';
    return 'Coverage: ' + (lic.has_bases && !view.merge ? row.basis : 'Covered');
  }

  /* The break-out tier's countries, by exact combination, for the text list
   * under the map: [{combination, countries: [names]}], legend order. */
  function breakoutList(frame) {
    var groups = {};
    frame.forEach(function (r) {
      if (!r.covered) return;  // in a break-out, covered = in the chosen tier
      (groups[r.combination] = groups[r.combination] || []).push(r.country);
    });
    return C.orderedOverlayLabels(frame)
      .filter(function (l) { return groups[l]; })
      .map(function (l) { return { combination: l, countries: groups[l].slice().sort() }; });
  }

  // ---------------------------------------------------------------------- //
  // Tiles and tables (SPEC "Tiles" and "Tables below the map")
  // ---------------------------------------------------------------------- //

  /* Name of the "% of ..." denominator, so a filtered percentage cannot be
   * read as a global one. Differs from the private dashboard in one case: with
   * a region AND an income filter it names both ("Sub-Saharan Africa, LMIC"),
   * where the private one names the region only. */
  function scopeName(s) {
    var region = s.regions.length === 1 ? s.regions[0]
      : (s.regions.length ? s.regions.length + ' regions' : '');
    var bucket = s.incomeGroups.map(incomeLabel).concat(s.incomeBuckets).join(' + ');
    if (region && bucket) return region + ', ' + bucket;
    return region || bucket || 'all countries';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function thousands(x) { return Math.round(x).toLocaleString('en-GB'); }
  function aboutMillions(x) {
    return x >= 1e6 ? 'about ' + (Math.round(x / 1e5) / 10) + ' million' : 'about ' + thousands(x);
  }

  /* The impact tile applies only when every selected licence is for the
   * disease the impact figures describe. ASSUMPTION: the data's `impact{}`
   * block has no disease field, so the figures are taken to be HIV figures
   * (UNAIDS). Adding an `impact_disease` key to the Notes sheet would remove
   * this constant. */
  var IMPACT_DISEASE = 'HIV';

  /* Tile definitions for the current state:
   * [{id, label, value, sub, detail, list}]
   *  sub:    short line shown on the tile;
   *  detail: longer explanation behind the tile's info toggle (or null);
   *  list:   null, or [{title, rows}] the countries behind the number, from
   *          coverage.countriesBehind on the same frame as the number. */
  function tiles(ds, s, c) {
    var f = c.countFrame, n = s.licences.length;
    var k = C.headlineCounts(f);
    var filtered = s.regions.length > 0 || s.incomeGroups.length > 0 || s.incomeBuckets.length > 0;
    var coveredLabel = n === 1 ? 'Countries covered'
      : (s.mode === C.MODE_ALL ? 'Covered by all ' + n : 'Covered by ≥1 of ' + n);
    var coveredList = [{ title: null, rows: C.countriesBehind(f, 'covered') }];
    var out = [];

    out.push({ id: 'covered', label: coveredLabel, value: String(k.covered),
               sub: 'of ' + plural(k.in_scope, 'country', 'countries') + ' in scope',
               detail: null, list: coveredList });

    var pct = { id: 'share', label: '% of ' + scopeName(s), value: C.share(k.covered, k.in_scope),
                sub: k.covered + ' of ' + k.in_scope + ' countries', detail: null, list: coveredList };
    if (filtered) {
      // SPEC: with a filter on, keep the global share visible next to the scoped one.
      var world = compute(ds, Object.assign({}, s, { regions: [], incomeGroups: [], incomeBuckets: [], expandDepth: null }));
      var w = C.headlineCounts(world.countFrame);
      pct.world = { label: '% of all ' + w.in_scope, value: C.share(w.covered, w.in_scope),
                    sub: w.covered + ' of ' + w.in_scope + ' countries worldwide, ignoring the filters' };
    }
    out.push(pct);

    out.push({ id: 'lmic', label: '% of LMICs', value: C.share(k.bucket_covered, k.bucket_in_scope),
               sub: k.bucket_in_scope ? k.bucket_covered + ' of ' + k.bucket_in_scope + ' LMICs covered' : 'No LMICs in scope',
               detail: null,
               // SPEC: this tile's List shows both sides (there is no "not covered" tile).
               list: [{ title: 'Covered LMICs', rows: C.countriesBehind(f, 'bucket_covered') },
                      { title: 'Not covered LMICs', rows: C.countriesBehind(f, 'bucket_not_covered') }] });

    var imp = ds.impact;
    var hiv = s.licences.every(function (code) { return ds.licenceByCode[code].disease === IMPACT_DISEASE; });
    var x = hiv ? C.impactCounts(f) : null;
    if (x && x.scope_infections) {
      var lmicShare = C.share(x.bucket_covered_infections, x.bucket_scope_infections);
      out.push({ id: 'impact', label: '% of new HIV acquisitions', value: C.share(x.covered_infections, x.scope_infections),
                 sub: (x.bucket_scope_infections ? 'LMICs only: ' + lmicShare : 'No LMICs in scope') + ' · UNAIDS ' + imp.year,
                 detail: 'About ' + thousands(x.covered_infections) + ' of ' + thousands(x.scope_infections) +
                   ' new HIV acquisitions in ' + imp.year + ' are in covered countries, among the ' +
                   x.with_data + ' countries in scope with a UNAIDS estimate. In LMICs only: ' + lmicShare + '. ' +
                   plural(x.covered_without_data, 'covered country has', 'covered countries have') +
                   ' no estimate and ' + (x.covered_without_data === 1 ? 'is' : 'are') + ' not counted. ' +
                   'Worldwide UNAIDS reports ' + aboutMillions(imp.global_new_infections) +
                   '; countries it does not publish (for example China, Russia, Ukraine, the United States) ' +
                   'make up the gap. Source: ' + imp.source + '.',
                 list: null });
    }
    return out;
  }

  /* Region and income-group tables, following the filters. (No LMIC/HIC table:
   * the LMIC figures are on the "% of LMICs" and impact tiles.)
   * Each has a "total in scope" row; with a region filter on, that row is the
   * selected region's own share (our reading of SPEC "When a region is
   * selected the percentages also show the region's own share"). */
  function tables(ds, s, c) {
    var f = c.countFrame, k = C.headlineCounts(f);
    var incomeOn = s.incomeGroups.length || s.incomeBuckets.length;
    var totalLabel = s.regions.length === 1 && !incomeOn ? 'All of ' + s.regions[0]
      : (s.regions.length || incomeOn ? 'All in scope' : 'All countries');
    var total = { key: totalLabel, covered: k.covered, in_scope: k.in_scope,
                  pct: k.in_scope ? C.round1(100 * k.covered / k.in_scope) : null, total: true };
    function withTotal(rows) { return rows.concat([total]); }
    // Each group row carries the countries behind its counts, for the click-to-open list.
    function withCountries(dimension) {
      return C.breakdown(f, dimension).map(function (r) {
        var sub = f.filter(function (x) { return x[dimension] === r.key; });
        r.lists = [{ title: 'Covered', rows: C.countriesBehind(sub, 'covered') },
                   { title: 'Not covered', rows: C.countriesBehind(sub, 'not_covered') }];
        return r;
      });
    }
    return [
      { id: 'region', title: 'By region', keyLabel: 'Region', rows: withTotal(withCountries('region')) },
      { id: 'income', title: 'By income group', keyLabel: 'Income group', rows: withTotal(withCountries('income_group')) },
    ];
  }

  // ---------------------------------------------------------------------- //
  // Country lookup (SPEC "Controls" 7)
  // ---------------------------------------------------------------------- //

  /* Fold case and accents so "cote" finds "Cote d’Ivoire" and "curacao" "Curaçao". */
  function fold(x) {
    return String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").toLowerCase().trim();
  }

  /* Countries matching a search, best first: exact name or ISO3, then names
   * starting with the query, then names containing it. At most `limit`. */
  function findCountries(ds, query, limit) {
    var q = fold(query || '');
    if (!q) return [];
    var exact = [], starts = [], contains = [];
    C.searchIndex(ds).forEach(function (c) {
      var name = fold(c.country);
      if (name === q || c.iso3.toLowerCase() === q) exact.push(c);
      else if (name.indexOf(q) === 0) starts.push(c);
      else if (name.indexOf(q) > 0) contains.push(c);
    });
    return exact.concat(starts, contains).slice(0, limit || 8);
  }

  /* Display-ready detail for one country: every licence in the data, not
   * only the selected ones (as in the private dashboard's lookup). */
  function lookup(ds, iso3) {
    var d = C.countryDetail(ds, iso3);
    if (!d) return null;
    var c = d.country, year = ds.impact.year, burden;
    if (c.new_hiv_infections == null) {
      burden = 'no UNAIDS estimate published';
    } else {
      // A ceiling such as "<100" is shown as published, not as the stored half-value.
      burden = c.new_hiv_infections_shown_as || thousands(c.new_hiv_infections);
      if (c.hiv_incidence_per_1000_uninfected != null) {
        burden += ' · incidence ' + c.hiv_incidence_per_1000_uninfected + ' per 1,000 uninfected';
      }
    }
    return {
      iso3: c.iso3, country: c.country,
      facts: [['ISO3', c.iso3], ['Region', c.region],
              ['Income group', c.income_group + ' (' + c.income_bucket + ')'],
              ['New HIV acquisitions ' + year, burden]],
      statuses: d.statuses.map(function (st) {
        var l = ds.licenceByCode[st.licence];
        return { licence: l.code, name: l.name, type: l.licence_type, colour: l.colour,
                 covered: st.covered ? 'Yes' : 'No', detail: st.coverage_label };
      }),
      // SPEC: a second line for "Direct with royalties" countries.
      royaltyLines: d.statuses.filter(function (st) {
        return st.covered && st.royalty_rate && st.basis &&
               st.basis.slice(-C.ROYALTY_SUFFIX.length) === C.ROYALTY_SUFFIX;
      }).map(function (st) { return st.licence + ' royalty rate: ' + st.royalty_rate; }),
    };
  }

  // ---------------------------------------------------------------------- //
  // PNG export naming
  // ---------------------------------------------------------------------- //

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* "Exported 27 Oct 2026, 21:05 (local time) · Data as of 2026-10-27" */
  function exportStamp(ds, now) {
    return 'Exported ' + now.getDate() + ' ' + MONTHS[now.getMonth()] + ' ' + now.getFullYear() + ', ' +
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ' (local time) · Data as of ' + ds.generated;
  }

  /* LAPaL_licence_coverage_CAB-LEN_2026-10-27_2105.png */
  function pngFilename(s, now) {
    return 'LAPaL_licence_coverage_' + s.licences.join('-') + '_' + now.getFullYear() + '-' +
      pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + '.png';
  }

  /* The spreadsheet download: one sheet of countries in scope, one of the
   * headline figures and tables, one of context and sources. Plain rows of
   * strings and numbers; xlsx.js turns them into a file.
   * extra: {subtitle, summary, stamp, credit, sources: [{label, url}]} */
  function spreadsheet(ds, s, c, extra) {
    var year = ds.impact.year;
    var codes = s.licences;
    var head = ['Country', 'ISO3', 'Region', 'Income group', 'LMIC / HIC', 'Map category'];
    codes.forEach(function (code) {
      head.push(code + ' covered');
      if (ds.licenceByCode[code].has_bases) head.push(code + ' basis', code + ' royalty rate');
    });
    head.push('New HIV acquisitions ' + year + ' (UNAIDS)', 'HIV incidence per 1,000 uninfected ' + year);
    var rows = c.countFrame.slice().sort(function (a, b) { return a.country < b.country ? -1 : a.country > b.country ? 1 : 0; })
      .map(function (r) {
        var k = ds.countryByIso[r.iso3], d = C.countryDetail(ds, r.iso3);
        var row = [k.country, k.iso3, k.region, k.income_group, k.income_bucket, r.coverage_label];
        codes.forEach(function (code) {
          var st = d.statuses.filter(function (x) { return x.licence === code; })[0];
          row.push(st.covered ? 'Yes' : 'No');
          if (ds.licenceByCode[code].has_bases) row.push(st.basis || '', st.royalty_rate || '');
        });
        // A UNAIDS ceiling such as "<100" is kept as published text, not the stored half-value.
        row.push(k.new_hiv_infections == null ? 'No estimate' : (k.new_hiv_infections_shown_as || k.new_hiv_infections),
                 k.hiv_incidence_per_1000_uninfected == null ? '' : k.hiv_incidence_per_1000_uninfected);
        return row;
      });

    var summary = [['Figure', 'Value', 'Detail']];
    tiles(ds, s, c).forEach(function (t) {
      summary.push([t.label, t.value, t.sub]);
      if (t.world) summary.push([t.world.label, t.world.value, t.world.sub]);
    });
    tables(ds, s, c).forEach(function (t) {
      summary.push([], [t.title], [t.keyLabel, 'Covered', 'Total', '%']);
      t.rows.forEach(function (r) { summary.push([r.key, r.covered, r.in_scope, r.pct == null ? '' : r.pct]); });
    });

    var tx = ds.texts;
    var about = [[title(ds, s)], [extra.subtitle], [], ['Active filters', extra.summary], ['Exported', extra.stamp], [],
                 ['About this map', tx.coverage_definition], ['', tx.licence_types]];
    if (codes.indexOf('AMI') >= 0) about.push(['', tx.ami_disclaimer]);
    about.push(['Definitions', DEFINITIONS]);
    about.push([], ['Data sources', tx.data_sources]);
    (extra.sources || []).forEach(function (src, i) { about.push([i ? '' : 'Licence texts', src.label, src.url]); });
    about.push([], ['Note', tx.currency_note], ['Data as of', ds.generated], ['Source', extra.credit]);

    return [{ name: 'Countries', rows: [head].concat(rows), header: true },
            { name: 'Summary', rows: summary, header: true },
            { name: 'About', rows: about, header: false }];
  }

  /* Same name as the PNG, with .pptx. */
  function pptxFilename(s, now) { return pngFilename(s, now).replace(/\.png$/, '.pptx'); }
  function xlsxFilename(s, now) { return pngFilename(s, now).replace(/\.png$/, '.xlsx'); }

  var api = { MODES: MODES, INCOME_FILTER: INCOME_FILTER, incomeLabel: incomeLabel, initialState: initialState, normalise: normalise, compute: compute,
              tierOptions: tierOptions, tierName: tierName, title: title, summary: summary,
              tipLine: tipLine, breakoutList: breakoutList,
              scopeName: scopeName, tiles: tiles, tables: tables, IMPACT_DISEASE: IMPACT_DISEASE,
              fold: fold, findCountries: findCountries, lookup: lookup, mergeNote: mergeNote, exportStamp: exportStamp, pngFilename: pngFilename, pptxFilename: pptxFilename, xlsxFilename: xlsxFilename,
              exportSubtitle: exportSubtitle, spreadsheet: spreadsheet,
              noneNote: noneNote, DEFINITIONS: DEFINITIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LapalView = api;
})(typeof window !== 'undefined' ? window : globalThis);
