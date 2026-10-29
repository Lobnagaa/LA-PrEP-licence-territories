/* Page controller: builds the controls from the data, keeps the state, and
 * redraws. All rules about which settings apply live in view.js; all numbers
 * come from coverage.js; colours from colours.js; drawing from map.js.
 *
 * Controls are generated from the data (licence rows, region labels), so a new licence or region in the spreadsheet needs no code change.
 * At most C.MAX_OVERLAY (3) licences can be ticked at once.
 * The income filter offers Low, Lower-middle and Upper-middle income
 * (V.INCOME_FILTER); state.incomeBuckets (LMIC/HIC) has no control.
 */
(function (root) {
  'use strict';
  var D = root.LapalData, C = root.LapalCoverage, Col = root.LapalColours,
      M = root.LapalMap, V = root.LapalView;

  // Footer links (SPEC "Footer text" 4). Not in the data's `texts`; move them
  // there if they should change without a code change.
  var LINKS = [
    ['Medicines Patent Pool', 'https://medicinespatentpool.org'],
    ['All MPP licences', 'https://medicinespatentpool.org/progress-achievements/licences'],
    ['MedsPaL', 'https://www.medspal.org'],
    ['LAPaL', 'https://lapal.ch'],
  ];

  // Public licence texts, listed under Data sources and, for the selected
  // licences, in the PNG, on the slide and in its speaker notes. Keyed by
  // licence code and shown only for licences present in the data. Not in the
  // spreadsheet; a `licence_url` column on the Licences sheet could replace this.
  // CAB: the July 2025 amended and restated agreement, whose 133-country
  // territory is the one in the data.
  var LICENCE_SOURCES = {
    CAB: ['Cabotegravir licence agreement, amended July 2025 (ViiV Healthcare, MPP)', 'https://medicinespatentpool.org/uploads/2023/09/2025.07.10-CAB-Amended-and-Restated-License-Agreement_private-markets-Tx-FINAL-signed.pdf'],
    LEN: ['Lenacapavir licence agreement (Gilead)', 'https://www.gilead.com/-/media/gileadcorpredesign/pdf/Other/LEN-VL.pdf'],
    AMI: ['Alimatravir sample licence agreement (MSD)', 'https://www.msd.com/wp-content/uploads/sites/9/2026/07/Alimatravir-Sample-VL-Agreement.pdf'],
  };

  function start() {
    var ds;
    try {
      ds = D.buildDataset(root.LAPAL_DATA);
    } catch (e) {
      showError(e);
      return;
    }
    ds.warnings.forEach(function (w) { console.warn('[data] ' + w); });

    var state = V.initialState(ds);
    var hidden = new Set();  // legend categories switched off
    var openList = null;     // id of the tile whose List is open
    var openDetail = {};     // tile id -> true when its explanation is shown
    var openTables = {};     // table id -> true when the table is expanded (all start collapsed)
    var openRows = {};       // 'tableId|row key' -> true when that row's country list is shown
    var lookupIso = null;    // country shown in the lookup panel
    var current = null;      // last drawn {c, cats}, for the PNG export
    var map = M.createMap(document.getElementById('map'), root.LAPAL_WORLD, ds, {
      // A click highlights the country (a second click clears it) and opens it in the lookup.
      onCountryClick: function (iso) {
        lookupIso = iso;
        el('lookup-input').value = ds.countryByIso[iso].country;
        renderLookup();
        set({ highlight: state.highlight === iso ? null : iso });
      },
    });
    var el = function (id) { return document.getElementById(id); };

    buildControls();
    // Tiles are redrawn on every change; one listener handles their buttons.
    el('tiles').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tile]');
      if (!btn) return;
      var id = btn.getAttribute('data-tile');
      if (btn.getAttribute('data-act') === 'list') openList = openList === id ? null : id;
      else openDetail[id] = !openDetail[id];
      draw([]);
    });
    el('tables').addEventListener('click', function (e) {
      var btn = e.target.closest('button.row-toggle');
      if (!btn) return;
      var id = btn.getAttribute('data-row');
      openRows[id] = !openRows[id];
      draw([]);
    });
    // <details> toggles itself; remember it so a redraw keeps it open or closed.
    el('tables').addEventListener('toggle', function (e) {
      var d = e.target;
      if (d.matches && d.matches('details[data-table]')) openTables[d.getAttribute('data-table')] = d.open;
    }, true);
    buildLookup();
    renderFooter();
    renderLogos();
    renderLookup();
    el('export-png').addEventListener('click', exportPng);
    el('export-pptx').addEventListener('click', exportPptx);
    el('export-xlsx').addEventListener('click', exportXlsx);
    el('tile-list').addEventListener('click', function (e) {
      if (e.target.closest('button.list-close')) { openList = null; draw([]); }
    });
    draw([]);

    function set(patch) {
      var r = V.normalise(ds, Object.assign({}, state, patch));
      state = r.state;
      draw(r.notes);
    }

    // --------------------------------------------------------------------- //
    // Controls (built once from the data)
    // --------------------------------------------------------------------- //
    function buildControls() {
      el('licence-picker').innerHTML = ds.licences.map(function (l) {
        return '<label class="check"><input type="checkbox" name="licence" value="' + M.esc(l.code) + '">' +
          '<span class="swatch-dot" style="background:' + M.esc(l.colour) + '"></span>' +
          '<span><b>' + M.esc(l.code) + '</b> ' + M.esc(l.name) +
          ' <span class="muted">(' + M.esc(l.licence_type) + ', ' + M.esc(l.originator) + ')</span></span></label>';
      }).join('');
      el('licence-picker').addEventListener('change', function () {
        set({ licences: checked('licence') });
      });

      el('merge').addEventListener('change', function (e) { set({ merge: e.target.checked }); });
      el('merge-row').hidden = !V.mergeNote(ds);
      el('merge-tag').textContent = ds.licences.filter(function (l) { return l.has_bases; })
        .map(function (l) { return l.code; }).join(', ') + ' only';

      el('mode-picker').innerHTML = [['combination', 'Combinations'], ['any', 'ANY (covered by at least one)'],
                                     ['all', 'ALL (covered by every selected)']].map(function (m) {
        return '<label class="check"><input type="radio" name="mode" value="' + m[0] + '">' + m[1] + '</label>';
      }).join('');
      el('mode-picker').addEventListener('change', function (e) { set({ mode: e.target.value }); });

      el('tier').addEventListener('change', function (e) {
        set({ expandDepth: e.target.value === '' ? null : +e.target.value });
      });

      el('region-filter').innerHTML = ds.regions.map(function (r) {
        return '<label class="check"><input type="checkbox" name="region" value="' + M.esc(r) + '">' + M.esc(r) + '</label>';
      }).join('');
      el('region-filter').addEventListener('change', function () { set({ regions: checked('region') }); });

      el('income-filter').innerHTML = V.INCOME_FILTER.map(function (g) {
        return '<label class="check"><input type="checkbox" name="income" value="' + g + '">' + V.incomeLabel(g) + '</label>';
      }).join('');
      el('income-filter').addEventListener('change', function () { set({ incomeGroups: checked('income') }); });

      el('clear-filters').addEventListener('click', function () { set({ regions: [], incomeGroups: [] }); });

      el('highlight').innerHTML = '<option value="">None</option>' + C.searchIndex(ds).map(function (c) {
        return '<option value="' + c.iso3 + '">' + M.esc(c.country) + '</option>';
      }).join('');
      el('highlight').addEventListener('change', function (e) { set({ highlight: e.target.value || null }); });
    }

    function checked(name) {
      return Array.prototype.map.call(document.querySelectorAll('input[name=' + name + ']:checked'),
                                      function (i) { return i.value; });
    }

    /* Put the controls back in line with the (normalised) state, and show only
     * the controls that apply to it. */
    function syncControls() {
      var n = state.licences.length;
      document.querySelectorAll('input[name=licence]').forEach(function (i) {
        i.checked = state.licences.indexOf(i.value) >= 0;
        // Keep at least one ticked and at most MAX_OVERLAY.
        i.disabled = (i.checked && n === 1) || (!i.checked && n >= C.MAX_OVERLAY);
      });
      el('licence-hint').textContent = n >= C.MAX_OVERLAY ? 'Up to ' + C.MAX_OVERLAY + ' licences at once.'
        : (n === 1 ? 'Tick a second licence to compare.' : '');

      var single = n === 1 ? ds.licenceByCode[state.licences[0]] : null;
      // Always shown (when some licence records bases) so readers know it exists;
      // usable only with such a licence selected on its own.
      var mergeUsable = !!(single && single.has_bases);
      el('merge').disabled = !mergeUsable;
      el('merge').checked = mergeUsable && state.merge;
      el('merge-row').classList.toggle('is-off', !mergeUsable);
      var mn = V.mergeNote(ds);
      if (mn) el('merge-note').textContent = mn.note + (mergeUsable ? '' : ' ' + mn.howTo);

      el('mode-row').hidden = n < 2;
      document.querySelectorAll('input[name=mode]').forEach(function (i) { i.checked = i.value === state.mode; });

      var tiers = V.tierOptions(ds, state);
      el('tier-row').hidden = !(n === C.MAX_OVERLAY && state.mode === C.MODE_COMBINATION);
      el('tier').innerHTML = '<option value="">No, show every combination</option>' + tiers.map(function (t) {
        return '<option value="' + t.depth + '">' + M.esc(t.label) + ' (' + t.nCombinations + ' combination' +
          (t.nCombinations === 1 ? '' : 's') + ')</option>';
      }).join('');
      el('tier').value = state.expandDepth == null ? '' : String(state.expandDepth);

      document.querySelectorAll('input[name=region]').forEach(function (i) { i.checked = state.regions.indexOf(i.value) >= 0; });
      document.querySelectorAll('input[name=income]').forEach(function (i) { i.checked = state.incomeGroups.indexOf(i.value) >= 0; });
      el('clear-filters').hidden = !state.regions.length && !state.incomeGroups.length;
      el('highlight').value = state.highlight || '';
    }

    // --------------------------------------------------------------------- //
    // Drawing
    // --------------------------------------------------------------------- //
    function draw(notes) {
      syncControls();
      var c = V.compute(ds, state);
      var cats = Col.categories(ds, c.view, c.frame);
      // Forget switched-off categories that no longer exist in this view.
      var labels = cats.list.map(function (k) { return k.label; });
      hidden.forEach(function (l) { if (labels.indexOf(l) < 0) hidden.delete(l); });

      current = { c: c, cats: cats };
      var s = { frame: c.frame, cats: cats, hidden: hidden, highlight: state.highlight,
                tipLine: function (r) { return V.tipLine(ds, c.view, r); } };
      map.render(s);
      M.renderLegend(el('legend'), cats, s, map, function (label) {
        if (hidden.has(label)) hidden.delete(label); else hidden.add(label);
        draw([]);
      });

      el('title').textContent = V.title(ds, state);
      document.title = V.title(ds, state) + ' · LAPaL';
      el('summary').textContent = V.summary(ds, state, c.frame.length);

      var msgs = notes.slice();
      if (!c.frame.length) msgs.push('No country matches these filters. Change the region or income filter.');
      if (state.highlight && !c.frame.some(function (r) { return r.iso3 === state.highlight; })) {
        msgs.push(ds.countryByIso[state.highlight].country + ' is outside the current filters.');
      }
      el('notes').hidden = !msgs.length;
      el('notes').innerHTML = msgs.map(function (m) { return '<p>' + M.esc(m) + '</p>'; }).join('');

      renderBreakout(c);
      renderTiles(c);
      renderTables(c);

      var nn = V.noneNote(ds, state, c);
      el('none-note').hidden = !nn;
      el('none-note').textContent = nn || '';

      var ami = el('ami-disclaimer');
      ami.hidden = state.licences.indexOf('AMI') < 0;
      ami.textContent = ds.texts.ami_disclaimer;
    }

    /* Tiles: every count has a List button showing the countries behind it,
     * taken from the same frame as the number (coverage.countriesBehind). */
    function renderTiles(c) {
      var ts = V.tiles(ds, state, c);
      if (!ts.some(function (t) { return t.id === openList && t.list; })) openList = null;
      el('tiles').innerHTML = ts.map(function (t) {
        var h = '<div class="tile" data-id="' + t.id + '">' +
          '<div class="tile-label">' + M.esc(t.label) + '</div>' +
          '<div class="tile-value">' + M.esc(t.value) + '</div>' +
          '<div class="tile-sub">' + M.esc(t.sub) + '</div>';
        if (t.world) {
          h += '<div class="tile-world" title="' + M.esc(t.world.sub) + '"><b>' + M.esc(t.world.value) + '</b> ' +
               M.esc(t.world.label) + '<span class="visually-hidden"> (' + M.esc(t.world.sub) + ')</span></div>';
        }
        h += '<div class="tile-actions">';
        if (t.list) {
          h += '<button type="button" class="tile-btn" data-tile="' + t.id + '" data-act="list" aria-expanded="' +
               (openList === t.id) + '" aria-controls="tile-list">' + (openList === t.id ? 'Hide list' : 'List') + '</button>';
        }
        if (t.detail) {
          h += '<button type="button" class="tile-btn tile-info" data-tile="' + t.id + '" data-act="detail" aria-expanded="' +
               !!openDetail[t.id] + '">' + (openDetail[t.id] ? 'Hide details' : 'About this figure') + '</button>';
        }
        h += '</div>';
        if (t.detail && openDetail[t.id]) h += '<p class="tile-detail">' + M.esc(t.detail) + '</p>';
        return h + '</div>';
      }).join('');

      var box = el('tile-list');
      var open = ts.filter(function (t) { return t.id === openList; })[0];
      if (!open) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = '<div class="list-head"><h2>' + M.esc(open.label) + '</h2>' +
        '<button type="button" class="tile-btn list-close">Hide</button></div>' +
        open.list.map(function (sec) {
          var n = sec.rows.length;
          return '<h3>' + (sec.title ? M.esc(sec.title) + ': ' : '') + n + ' countr' + (n === 1 ? 'y' : 'ies') + '</h3>' +
            // One name per line: several names contain commas ("Congo, Dem. Rep.").
            (n ? '<ul class="country-list">' + sec.rows.map(function (r) { return '<li>' + M.esc(r.country) + '</li>'; }).join('') + '</ul>'
               : '<p>None</p>');
        }).join('');
    }

    /* Tables below the map: live, following the filters. */
    /* Tables start collapsed behind their heading; once open, a click on a row
     * shows its covered and not-covered countries. Open state survives redraws. */
    function renderTables(c) {
      el('tables').innerHTML = V.tables(ds, state, c).map(function (t) {
        return '<details class="table-block" data-table="' + t.id + '"' + (openTables[t.id] ? ' open' : '') + '>' +
          '<summary><h2>' + M.esc(t.title) + '</h2></summary><table class="data-table">' +
          '<thead><tr><th scope="col">' + M.esc(t.keyLabel) + '</th><th scope="col" class="num">Covered</th>' +
          '<th scope="col" class="num">Total</th><th scope="col" class="num">%</th></tr></thead><tbody>' +
          t.rows.map(function (r) {
            var cells = '<td class="num">' + r.covered + '</td><td class="num">' + r.in_scope + '</td>' +
              '<td class="num">' + (r.pct == null ? '—' : r.pct.toFixed(1) + '%') + '</td>';
            if (r.total) return '<tr class="total"><th scope="row">' + M.esc(r.key) + '</th>' + cells + '</tr>';
            var id = t.id + '|' + r.key, open = !!openRows[id];
            var h = '<tr class="group-row' + (open ? ' is-open' : '') + '"><th scope="row"><button type="button" class="row-toggle" ' +
              'data-row="' + M.esc(id) + '" aria-expanded="' + open + '">' + M.esc(r.key) + '</button></th>' + cells + '</tr>';
            if (open) {
              h += '<tr class="row-detail"><td colspan="4">' + r.lists.map(function (sec) {
                return '<p class="row-detail-title">' + sec.title + ' (' + sec.rows.length + ')</p>' +
                  (sec.rows.length ? '<ul class="country-list">' + sec.rows.map(function (x) {
                    return '<li>' + M.esc(x.country) + '</li>'; }).join('') + '</ul>' : '<p class="muted">None.</p>');
              }).join('') + '</td></tr>';
            }
            return h;
          }).join('') + '</tbody></table></details>';
      }).join('');
    }

    // --------------------------------------------------------------------- //
    // Country lookup
    // --------------------------------------------------------------------- //
    function buildLookup() {
      var input = el('lookup-input'), list = el('lookup-suggest');
      var matches = [];
      function suggest() {
        matches = V.findCountries(ds, input.value, 8);
        // Typing a full name or ISO3 opens it straight away.
        var q = V.fold(input.value);
        if (matches.length && (V.fold(matches[0].country) === q || matches[0].iso3.toLowerCase() === q)) {
          choose(matches[0].iso3, false); return;
        }
        list.hidden = !input.value.trim();
        list.innerHTML = matches.length ? matches.map(function (c) {
          return '<li><button type="button" data-iso="' + c.iso3 + '">' + M.esc(c.country) +
            ' <span class="muted">' + c.iso3 + '</span></button></li>';
        }).join('') : '<li class="muted">No country matches “' + M.esc(input.value) + '”.</li>';
      }
      function choose(iso, fill) {
        lookupIso = iso;
        if (fill) input.value = ds.countryByIso[iso].country;
        list.hidden = true; list.innerHTML = '';
        renderLookup();
      }
      input.addEventListener('input', suggest);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && matches.length) { e.preventDefault(); choose(matches[0].iso3, true); }
        if (e.key === 'Escape') { list.hidden = true; }
      });
      list.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-iso]');
        if (b) choose(b.getAttribute('data-iso'), true);
      });
      el('lookup-detail').addEventListener('click', function (e) {
        if (e.target.closest('button.show-on-map')) set({ highlight: lookupIso });
      });
    }

    function renderLookup() {
      var box = el('lookup-detail');
      var d = lookupIso ? V.lookup(ds, lookupIso) : null;
      if (!d) { box.innerHTML = '<p class="muted">No country selected.</p>'; return; }
      box.innerHTML = '<div class="lookup-facts"><h3>' + M.esc(d.country) + '</h3><dl>' +
        d.facts.map(function (f) { return '<dt>' + M.esc(f[0]) + '</dt><dd>' + M.esc(f[1]) + '</dd>'; }).join('') +
        '</dl><button type="button" class="tile-btn show-on-map">Highlight on the map</button></div>' +
        '<div class="lookup-status"><h3>Licence status (all licences)</h3><table class="data-table"><thead><tr>' +
        '<th scope="col">Licence</th><th scope="col">Type</th><th scope="col">Covered</th><th scope="col">Detail</th></tr></thead><tbody>' +
        d.statuses.map(function (st) {
          return '<tr><th scope="row"><span class="swatch-dot" style="background:' + M.esc(st.colour) + '"></span> <b>' +
            M.esc(st.licence) + '</b> ' + M.esc(st.name) + '</th><td>' + M.esc(st.type) + '</td><td>' + st.covered +
            '</td><td>' + M.esc(st.detail) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        d.royaltyLines.map(function (l) { return '<p class="royalty-line">' + M.esc(l) + '</p>'; }).join('') + '</div>';
    }

    // --------------------------------------------------------------------- //
    // Footer (wording from the data)
    // --------------------------------------------------------------------- //
    function bilateralSources() {
      var items = ds.licences.filter(function (l) { return LICENCE_SOURCES[l.code]; }).map(function (l) {
        var src = LICENCE_SOURCES[l.code];
        return '<li><a href="' + src[1] + '" target="_blank" rel="noopener">' + M.esc(src[0]) + '</a> (PDF)</li>';
      });
      return items.length ? '<p class="sources-label">Licence texts:</p><ul class="footer-links">' + items.join('') + '</ul>' : '';
    }

    /* LAPaL and MedsPaL in the header; MPP ("Coordinated by") and the
     * supporters ("With support from") at the bottom of the page. */
    function logoGroups() {
      var logos = root.LAPAL_LOGOS || [];
      function role(r) { return logos.filter(function (l) { return l.role === r; }); }
      return { main: role('main'), coordinator: role('coordinator'), support: role('support') };
    }
    function renderLogos() {
      var g = logoGroups();
      // Each logo links to the organisation's homepage (new tab); the alt text names the link.
      function img(l, cls) {
        var tag = '<img src="' + l.src + '" alt="' + M.esc(l.name) + '"' + (cls ? ' class="' + cls + '"' : '') + '>';
        return l.url ? '<a class="logo-link" href="' + M.esc(l.url) + '" target="_blank" rel="noopener" title="' +
          M.esc(l.name) + ' (opens in a new tab)">' + tag + '</a>' : tag;
      }
      if (g.main.length) {
        el('logo-bar').innerHTML = g.main.map(function (l) { return img(l, l.id === 'lapal' ? 'logo-main' : 'logo-' + l.id); }).join('');
        el('logo-bar').hidden = false;
      }
      var groups = [['Coordinated by', g.coordinator], ['With support from', g.support]].filter(function (x) { return x[1].length; });
      if (groups.length) {
        el('partners').innerHTML = groups.map(function (x) {
          return '<div class="partner-group"><span class="partner-label">' + x[0] + '</span>' +
            x[1].map(function (l) { return img(l); }).join('') + '</div>';
        }).join('');
        el('partners').hidden = false;
      }
    }

    function renderFooter() {
      var t = ds.texts;
      el('page-footer').innerHTML =
        '<div><h2>About this map</h2><p>' + M.esc(t.coverage_definition) + '</p><p>' + M.esc(t.licence_types) + '</p>' +
        // AMI disclaimer: shown here whenever AMI is selected (toggled in draw()).
        '<p id="ami-disclaimer" class="ami-disclaimer" hidden></p>' +
        '<p class="definitions">' + M.esc(V.DEFINITIONS) + '</p></div>' +
        '<div><h2>Data sources</h2><p>' + M.esc(t.data_sources) + '</p>' +
        bilateralSources() +
        '<p>' + M.esc(t.currency_note) + '</p><ul class="footer-links">' +
        LINKS.map(function (l) {
          return '<li><a href="' + l[1] + '" target="_blank" rel="noopener">' + M.esc(l[0]) + '</a></li>';
        }).join('') + '<li><a href="lapal_licence_coverage.csv" download>Full country data (CSV)</a></li>' +
        '</ul><p class="muted">Data as of ' + M.esc(ds.generated) + '.</p></div>';
    }

    // --------------------------------------------------------------------- //
    // PNG and PowerPoint export
    // --------------------------------------------------------------------- //
    function exportOptions(now) {
      var t = ds.texts;
      // notesOnly: on the slide, these go in the speaker notes only (Lobna, 29 Oct); the PNG keeps them.
      var paragraphs = [{ heading: null, text: t.coverage_definition },
                        { heading: 'Data sources', text: t.data_sources, notesOnly: true }];
      if (state.licences.indexOf('AMI') >= 0) paragraphs.push({ heading: null, text: t.ami_disclaimer, notesOnly: true });
      paragraphs.push({ heading: null, text: V.DEFINITIONS });
      return {
        map: map, cats: current.cats, hidden: hidden,
        highlight: state.highlight ? ds.countryByIso[state.highlight].country : null,
        title: V.title(ds, state), subtitle: V.exportSubtitle(state),
        // Below the map, a label makes clear the line lists the filters in use.
        summary: 'Active filters: ' + V.summary(ds, state, current.c.frame.length),
        stamp: V.exportStamp(ds, now), paragraphs: paragraphs,
        credit: 'LAPaL licence coverage · lapal.ch · Medicines Patent Pool · medicinespatentpool.org',
        noneNote: V.noneNote(ds, state, current.c),
        logos: logoGroups(),
        // Licence texts of the selected licences, for the PNG, the slide and its notes.
        sources: state.licences.filter(function (c) { return LICENCE_SOURCES[c]; }).map(function (c) {
          return { label: LICENCE_SOURCES[c][0], url: LICENCE_SOURCES[c][1] };
        }),
      };
    }
    function exportPng() {
      var btn = el('export-png'), now = new Date();
      btn.disabled = true; btn.textContent = 'Preparing PNG…';
      root.LapalExport.download(exportOptions(now), V.pngFilename(state, now))
        .catch(function (e) { console.error(e); alert('The PNG could not be made: ' + e.message); })
        .then(function () { btn.disabled = false; btn.textContent = 'Download PNG'; });
    }
    function exportPptx() {
      var btn = el('export-pptx'), now = new Date(), label = btn.textContent;
      var opts = exportOptions(now);
      opts.tiles = V.tiles(ds, state, current.c);
      btn.disabled = true; btn.textContent = 'Preparing slide…';
      root.LapalSlide.download(opts, V.pptxFilename(state, now))
        .catch(function (e) { console.error(e); alert('The slide could not be made: ' + e.message); })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    }
    function spreadsheetSheets(now) {
      var o = exportOptions(now);
      return V.spreadsheet(ds, state, current.c, { subtitle: o.subtitle, summary: V.summary(ds, state, current.c.frame.length),
                                                  stamp: o.stamp, credit: o.credit, sources: o.sources });
    }
    function exportXlsx() {
      var btn = el('export-xlsx'), now = new Date(), label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Preparing spreadsheet…';
      root.LapalXlsx.download(spreadsheetSheets(now), V.xlsxFilename(state, now))
        .catch(function (e) { console.error(e); alert('The spreadsheet could not be made: ' + e.message); })
        .then(function () { btn.disabled = false; btn.textContent = label; });
    }
    root.LapalPreviewXlsx = function () { return root.LapalXlsx.build(spreadsheetSheets(new Date())); };
    // For checking the export without downloading (used by the stage 5 browser check).
    root.LapalPreviewPng = function () { return root.LapalExport.render(exportOptions(new Date())); };
    root.LapalPreviewSlide = function () {
      var opts = exportOptions(new Date()); opts.tiles = V.tiles(ds, state, current.c);
      return root.LapalSlide.build(opts);
    };

    /* SPEC: a break-out lists the tier's countries in text, by combination. */
    function renderBreakout(c) {
      var box = el('breakout-list');
      if (state.expandDepth == null) { box.hidden = true; box.innerHTML = ''; return; }
      var groups = V.breakoutList(c.frame);
      box.hidden = false;
      box.innerHTML = '<h2>' + M.esc(V.tierName(state.expandDepth, state.licences.length)) + ': countries by combination</h2>' +
        groups.map(function (g) {
          return '<p><b>' + M.esc(g.combination) + '</b> (' + g.countries.length + '): ' +
            g.countries.map(M.esc).join('; ') + '</p>';  // semicolons: some names contain commas
        }).join('');
    }
  }

  function showError(e) {
    var box = document.getElementById('data-error');
    box.hidden = false;
    box.querySelector('ul').innerHTML = (e.errors || [e.message]).map(function (m) {
      return '<li>' + M.esc(m) + '</li>';
    }).join('');
    document.getElementById('controls').hidden = true;
    document.getElementById('tiles-area').hidden = true;
    document.getElementById('tables').hidden = true;
    document.getElementById('lookup').hidden = true;
    document.getElementById('map-area').hidden = true;
    console.error(e);
  }

  root.addEventListener('DOMContentLoaded', start);
})(window);
