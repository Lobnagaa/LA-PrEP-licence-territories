/* Stage 1 tests: data validation and coverage logic.
 *
 * Usage (from the lapal-public-prototype folder):
 *   node tools/test_stage1.js
 *
 * 1. The real data passes validation.
 * 2. The build-time reference figures in SPEC.md are reproduced.
 * 3. coverage.js matches the Python reference on every scenario in
 *    tools/parity_expected.json (regenerate with tools/parity_reference.py).
 * 4. Broken data is rejected, with a message naming the problem.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const D = require('../src/data.js');
const C = require('../src/coverage.js');

const ROOT = path.join(__dirname, '..');
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'lapal_licence_coverage.json'), 'utf8'));
let failures = 0, passes = 0;
function check(name, fn) {
  try { fn(); passes++; } catch (e) { failures++; console.log('FAIL ' + name + '\n  ' + e.message.split('\n').join('\n  ')); }
}

// 1. Real data -------------------------------------------------------------
const v = D.validate(raw);
check('real data has no errors', () => assert.deepStrictEqual(v.errors, []));
console.log('Validation: ' + v.errors.length + ' errors, ' + v.warnings.length + ' warnings');
v.warnings.forEach(w => console.log('  warning: ' + w));
const ds = D.buildDataset(raw);

// 2. Reference figures (SPEC.md) --------------------------------------------
const EXPECT = { CAB: [133, 87.2, 88.4], LEN: [120, 84.3, 86.0], AMI: [129, 85.6, 87.3] };
const summary = [];
for (const code of Object.keys(EXPECT)) {
  const fr = C.licenceFrame(ds, code);
  const h = C.headlineCounts(fr), im = C.impactCounts(fr);
  const pct = +(100 * im.covered_infections / im.scope_infections).toFixed(1);
  const lpct = +(100 * im.bucket_covered_infections / im.bucket_scope_infections).toFixed(1);
  check(code + ' reference figures', () => assert.deepStrictEqual([h.covered, pct, lpct], EXPECT[code]));
  summary.push({ code, covered: h.covered + '/' + h.in_scope, lmic: h.bucket_covered + '/' + h.bucket_in_scope,
                 'lmic %': C.share(h.bucket_covered, h.bucket_in_scope), 'HIV acq %': pct + '%', 'HIV acq % LMIC': lpct + '%',
                 'covered, no estimate': im.covered_without_data });
}
const bases = {};
C.licenceFrame(ds, 'CAB').filter(r => r.covered).forEach(r => { bases[r.basis] = (bases[r.basis] || 0) + 1; });
check('CAB basis counts', () => assert.deepStrictEqual(bases, { 'Direct': 80, 'Direct with royalties': 10, 'Indirect': 43 }));
check('ten royalty-rate rows, all 5%/10%', () => {
  const r = ds.status.filter(s => s.royalty_rate);
  assert.strictEqual(r.length, 10);
  assert.ok(r.every(s => s.royalty_rate === '5% public / 10% private'));
});
console.table(summary);

// 3. Parity with the Python reference ---------------------------------------
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'parity_expected.json'), 'utf8')).scenarios;
const byKey = rows => Object.fromEntries(rows.map(r => [r.region || r.income_group || r.key, [r.covered, r.in_scope, r.pct]]));
const near = (a, b) => Math.abs(a - b) < 1e-6;
for (const s of expected) {
  const name = JSON.stringify({ f: s.filter, l: s.licence || s.licences, m: s.mode, merge: s.merge, x: s.expand_depth });
  check(name, () => {
    const scope = C.filterCountries(ds, { regions: s.filter.regions, incomeBuckets: s.filter.income_buckets });
    const fr = s.kind === 'single'
      ? C.licenceFrame(ds, s.licence, scope, s.merge)
      : C.overlayFrame(ds, s.licences, scope, { mode: s.mode, expandDepth: s.expand_depth });
    assert.deepStrictEqual(Object.fromEntries(fr.map(r => [r.iso3, r.coverage_label])), s.labels, 'labels');
    assert.deepStrictEqual(fr.filter(r => r.covered).map(r => r.iso3).sort(), s.covered, 'covered set');
    assert.deepStrictEqual(C.headlineCounts(fr), s.headline, 'headline');
    const im = C.impactCounts(fr);
    for (const k of Object.keys(s.impact)) assert.ok(near(im[k], s.impact[k]), 'impact.' + k + ' ' + im[k] + ' vs ' + s.impact[k]);
    assert.deepStrictEqual(byKey(C.breakdown(fr, 'region')), byKey(s.by_region), 'by region');
    assert.deepStrictEqual(byKey(C.breakdown(fr, 'income_group')), byKey(s.by_income), 'by income');
    for (const m of Object.keys(s.lists)) assert.deepStrictEqual(C.countriesBehind(fr, m).map(r => r.iso3), s.lists[m], 'list ' + m);
    const order = s.kind === 'single' ? C.orderedLabels(fr.map(r => r.coverage_label)) : C.orderedOverlayLabels(fr);
    assert.deepStrictEqual(order, s.labels_order, 'legend order');
    if (s.combination_counts) {
      assert.deepStrictEqual(C.combinationCounts(fr), s.combination_counts, 'combination counts');
      assert.deepStrictEqual(C.depthTierOptions(fr, s.licences.length).map(t => [t.depth, t.label, t.nCombinations]), s.tiers, 'tiers');
    }
  });
}
console.log('Parity: ' + expected.length + ' scenarios compared with the Python reference');

// 4. Broken data is rejected --------------------------------------------------
const BROKEN = [
  ['unknown ISO3 in coverage', d => { d.coverage[0].iso3 = 'ZZZ'; }, 'unknown iso3 "ZZZ"'],
  ['missing licence row', d => { d.coverage = d.coverage.filter(r => !(r.iso3 === 'KEN' && r.licence === 'AMI')); }, 'KEN / AMI'],
  ['unknown basis', d => { d.coverage.find(r => r.basis === 'Indirect').basis = 'Indirectly'; }, 'unknown basis "Indirectly"'],
  ['licence with no coverage rows', d => { d.licences.push(Object.assign({}, d.licences[0], { code: 'DTG' })); }, 'missing from coverage'],
  ['coverage for unknown licence', d => { d.coverage.push({ iso3: 'KEN', licence: 'ALI', covered: 'Yes', basis: null, royalty_rate: null }); }, 'unknown licence "ALI"'],
  ['covered not Yes/No', d => { d.coverage[0].covered = 'yes'; }, 'covered must be'],
  ['basis on a not-covered row', d => { d.coverage.find(r => r.covered === 'No').basis = 'Direct'; }, 'not covered but has basis'],
  ['royalty rate on Indirect', d => { d.coverage.find(r => r.basis === 'Indirect').royalty_rate = '5%'; }, 'royalty_rate given'],
  ['duplicate country', d => { d.countries.push(Object.assign({}, d.countries[0])); }, 'appears twice'],
  ['malformed ISO3', d => { d.countries[0].iso3 = 'af'; }, 'not three capital letters'],
  ['unknown income group', d => { d.countries[0].income_group = 'Middle'; }, 'unknown income_group'],
  ['income bucket mismatch', d => { d.countries.find(c => c.income_group === 'High').income_bucket = 'LMIC'; }, 'does not match'],
  ['HIV figure as text', d => { d.countries[0].new_hiv_infections = '1,100'; }, 'not a number'],
  ['bad colour', d => { d.licences[0].colour = 'navy'; }, 'not a #RRGGBB'],
  ['missing AMI disclaimer', d => { delete d.texts.ami_disclaimer; }, 'texts.ami_disclaimer'],
];
for (const [name, mutate, needle] of BROKEN) {
  check('rejects: ' + name, () => {
    const d = JSON.parse(JSON.stringify(raw));
    mutate(d);
    assert.throws(() => D.buildDataset(d), e => {
      assert.ok(e instanceof D.DataValidationError, 'not a DataValidationError');
      assert.ok(e.message.includes(needle), 'message lacks ' + JSON.stringify(needle) + ':\n' + e.message);
      return true;
    });
  });
}
console.log('Rejection: ' + BROKEN.length + ' kinds of broken data tried');

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
