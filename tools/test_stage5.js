/* Stage 5 checks: country lookup and PNG naming (src/view.js).
 * The PNG drawing itself needs a browser (src/export.js); it was checked there.
 * Run: node tools/test_stage5.js */
'use strict';
const assert = require('assert');
const D = require('../src/data.js');
const V = require('../src/view.js');
const raw = require('../data/lapal_licence_coverage.json');
const ds = D.buildDataset(raw);

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const names = q => V.findCountries(ds, q).map(c => c.country);

t('search: ISO3, prefix, substring, accents, nothing', () => {
  assert.deepStrictEqual(names('ken'), ['Kenya']);
  assert.strictEqual(names('IND')[0], 'India');          // exact ISO3 first
  assert.deepStrictEqual(names('congo'), ['Congo', 'Congo, Dem. Rep.']);
  assert.strictEqual(names('cote d\'ivoire')[0], 'Cote d’Ivoire');
  assert.ok(names('guinea').includes('Equatorial Guinea'));
  assert.deepStrictEqual(names('zzz'), []);
  assert.deepStrictEqual(names('  '), []);
  assert.ok(names('a').length <= 8);
});
t('lookup: India shows CAB basis and the royalty line', () => {
  const d = V.lookup(ds, 'IND');
  assert.strictEqual(d.statuses[0].detail, 'Covered — Direct with royalties');
  assert.deepStrictEqual(d.royaltyLines, ['CAB royalty rate: 5% public / 10% private']);
  assert.deepStrictEqual(d.statuses.map(s => s.licence), ['CAB', 'LEN', 'AMI']);
});
t('lookup: exactly the ten royalty countries get the line', () => {
  const withLine = ds.countries.filter(c => V.lookup(ds, c.iso3).royaltyLines.length).map(c => c.iso3).sort();
  assert.deepStrictEqual(withLine, ['DZA', 'EGY', 'IDN', 'IND', 'KGZ', 'MAR', 'PHL', 'TJK', 'UKR', 'VNM']);
});
t('lookup: facts and HIV figures', () => {
  assert.deepStrictEqual(V.lookup(ds, 'KEN').facts, [['ISO3', 'KEN'], ['Region', 'Sub-Saharan Africa'],
    ['Income group', 'Lower-middle (LMIC)'], ['New HIV acquisitions 2025', '14,000 · incidence 0.25 per 1,000 uninfected']]);
  assert.strictEqual(V.lookup(ds, 'CHN').facts[3][1], 'no UNAIDS estimate published');
  assert.ok(V.lookup(ds, 'ALB').facts[3][1].startsWith('<200'));   // ceiling shown as published
  assert.strictEqual(V.lookup(ds, 'ZZZ'), null);
});
t('lookup: LEN and AMI show "Covered", never a basis', () => {
  ds.countries.forEach(c => V.lookup(ds, c.iso3).statuses.slice(1).forEach(s =>
    assert.ok(s.detail === 'Covered' || s.detail === 'Not covered', c.iso3 + ' ' + s.detail)));
});
t('PNG time stamp and file name', () => {
  const now = new Date(2026, 9, 27, 9, 5);
  assert.strictEqual(V.exportStamp(ds, now), 'Exported 27 Oct 2026, 09:05 (local time) · Data as of ' + raw.generated);
  assert.strictEqual(V.pngFilename({ licences: ['CAB', 'AMI'] }, now), 'LAPaL_licence_coverage_CAB-AMI_2026-10-27_0905.png');
});

t('export subtitle: singular for one licence, plural for two or more', () => {
  assert.strictEqual(V.exportSubtitle({ licences: ['CAB'] }), 'Long-Acting PrEP Generic License Coverage');
  assert.strictEqual(V.exportSubtitle({ licences: ['CAB', 'LEN'] }), 'Long-Acting PrEP Generic Licenses Coverage');
});

t('spreadsheet: countries in scope, licence columns, ceilings as published', () => {
  const st = V.normalise(ds, Object.assign(V.initialState(ds), { licences: ['CAB', 'LEN'] })).state;
  const c = V.compute(ds, st);
  const sh = V.spreadsheet(ds, st, c, { subtitle: 's', summary: 'f', stamp: 't', credit: 'c', sources: [] });
  assert.deepStrictEqual(sh.map(x => x.name), ['Countries', 'Summary', 'About']);
  const [head, ...rows] = sh[0].rows;
  assert.strictEqual(rows.length, 222);
  assert.ok(head.includes('CAB basis') && head.includes('LEN covered') && !head.includes('LEN basis'), head.join('|'));
  assert.strictEqual(rows.filter(r => r[head.indexOf('CAB covered')] === 'Yes').length, 133);
  const alb = rows.find(r => r[1] === 'ALB');
  assert.ok(String(alb[head.length - 2]).startsWith('<'));
  const filtered = V.normalise(ds, Object.assign(V.initialState(ds), { regions: ['South Asia'] })).state;
  assert.strictEqual(V.spreadsheet(ds, filtered, V.compute(ds, filtered), { sources: [] })[0].rows.length, 1 + 6);
});

t('grey footnote: count and HICs, single and overlay', () => {
  const one = V.normalise(ds, V.initialState(ds)).state;
  const n1 = V.noneNote(ds, one, V.compute(ds, one));
  assert.ok(/^Countries in grey are not covered by the cabotegravir licence: 89 countries, including \d+ high-income countries \(HICs\)\.$/.test(n1), n1);
  const three = V.normalise(ds, Object.assign(V.initialState(ds), { licences: ['CAB', 'LEN', 'AMI'] })).state;
  const n3 = V.noneNote(ds, three, V.compute(ds, three));
  assert.ok(n3.includes('any of the selected licences: 76 countries'), n3);
  const ssa = V.normalise(ds, Object.assign(V.initialState(ds), { regions: ['Sub-Saharan Africa'] })).state;
  assert.strictEqual(V.noneNote(ds, ssa, V.compute(ds, ssa)), null);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
