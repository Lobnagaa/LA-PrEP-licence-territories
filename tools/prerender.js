/* Build-time text summary for search engines, AI crawlers and screen readers.
 *
 * Run by tools/build.py: node tools/prerender.js data/lapal_licence_coverage.json
 * Prints JSON {summary_html, description, licences} on stdout.
 *
 * The figures come from the same view.js / coverage.js functions the page uses
 * (view.tiles), so the static text always matches what the interactive page
 * shows for the same selection. It is written into the HTML at build time and
 * is readable without JavaScript.
 */
'use strict';
const fs = require('fs');
const D = require('../src/data.js');
const V = require('../src/view.js');

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ds = D.buildDataset(raw);

function esc(x) {
  return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function names(rows) { return rows.map(r => esc(r.country)).join('; '); }

/* One block per selection: heading, the headline figures, the countries behind them. */
function block(heading, intro, overrides) {
  const st = V.normalise(ds, Object.assign(V.initialState(ds), overrides)).state;
  const c = V.compute(ds, st);
  const ts = V.tiles(ds, st, c);
  const tile = id => ts.find(t => t.id === id);
  let h = '<h3>' + esc(heading) + '</h3>' + (intro ? '<p>' + esc(intro) + '</p>' : '') + '<ul>';
  ts.forEach(t => { h += '<li>' + esc(t.label) + ': <strong>' + esc(t.value) + '</strong> (' + esc(t.sub) + ')</li>'; });
  h += '</ul>';
  const covered = tile('covered').list[0].rows;
  h += '<p><strong>Covered countries (' + covered.length + '):</strong> ' + names(covered) + '.</p>';
  const lmic = tile('lmic') && tile('lmic').list;
  if (lmic) {
    const notCovered = lmic[1].rows;
    h += '<p><strong>LMICs not covered (' + notCovered.length + '):</strong> ' + (notCovered.length ? names(notCovered) : 'none') + '.</p>';
  }
  return h;
}

const lic = ds.licences;
let html = '<p>Figures for ' + esc(ds.impact.year) + ' HIV data; licence coverage as of ' + esc(ds.generated) + '. ' +
  esc(V.DEFINITIONS) + '</p>';
lic.forEach(l => {
  html += block(l.name + ' (' + l.code + ')', l.licence_type + ' licence' + (l.originator ? ', originator ' + l.originator : '') + '.',
                { licences: [l.code], merge: true });
});
if (lic.length > 1) {
  const codes = lic.slice(0, 3).map(l => l.code);
  html += block('Covered by at least one of ' + codes.join(', '), null, { licences: codes, mode: 'any' });
  html += block('Covered by all of ' + codes.join(', '), null, { licences: codes, mode: 'all' });
}

const list = lic.map(l => l.name.toLowerCase());
const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0];
// Search results show about 160 characters.
const description = 'Which countries the ' + joined + ' licences for long-acting HIV PrEP cover, with LMIC figures and downloadable data.';

process.stdout.write(JSON.stringify({ summary_html: html, description: description,
                                      licences: lic.map(l => ({ code: l.code, name: l.name })) }));
