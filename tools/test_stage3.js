/* Stage 3 checks: the state rules behind the controls (src/view.js), with the
 * real data. Run: node tools/test_stage3.js */
'use strict';
const assert = require('assert');
const D = require('../src/data.js');
const C = require('../src/coverage.js');
const V = require('../src/view.js');
const Col = require('../src/colours.js');
const ds = D.buildDataset(require('../data/lapal_licence_coverage.json'));

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const norm = patch => V.normalise(ds, Object.assign(V.initialState(ds), patch));
const legend = st => { const c = V.compute(ds, st); return Col.categories(ds, c.view, c.frame).list.map(k => [k.label, k.count]); };

t('initial state is CAB alone, merged, nothing filtered', () => {
  const s = V.initialState(ds);
  assert.deepStrictEqual(s.licences, ['CAB']);
  assert.strictEqual(s.merge, true);
  assert.deepStrictEqual(legend(s), [['Covered', 133], ['Not covered', 89]]);
  assert.strictEqual(V.compute(ds, s).frame.length, 222);
});
t('click order does not matter; data order kept', () => {
  assert.deepStrictEqual(norm({ licences: ['AMI', 'CAB'] }).state.licences, ['CAB', 'AMI']);
});
t('never fewer than one licence', () => {
  assert.deepStrictEqual(norm({ licences: [] }).state.licences, ['CAB']);
});
t('unknown licence code ignored (e.g. ALI)', () => {
  assert.deepStrictEqual(norm({ licences: ['ALI', 'LEN'] }).state.licences, ['LEN']);
});
t('merge applies only to a single licence with bases, and is remembered', () => {
  const view = p => V.compute(ds, norm(p).state).view;
  assert.strictEqual(view({ licences: ['CAB'], merge: true }).merge, true);
  assert.strictEqual(view({ licences: ['LEN'], merge: true }).merge, false);
  assert.strictEqual(norm({ licences: ['CAB', 'LEN'], merge: true }).state.merge, true);  // kept as a preference
  assert.strictEqual(view({ licences: ['CAB'], merge: false }).merge, false);
});
t('merge note names the licences with bases (CAB)', () => {
  assert.deepStrictEqual(V.mergeNote(ds), { note: 'Applies to CAB only.',
                                            howTo: 'Select CAB on its own to use it.' });
});
t('overlay mode resets to combinations for one licence', () => {
  assert.strictEqual(norm({ licences: ['CAB'], mode: 'any' }).state.mode, 'combination');
  assert.strictEqual(norm({ licences: ['CAB', 'LEN'], mode: 'any' }).state.mode, 'any');
  assert.strictEqual(norm({ licences: ['CAB', 'LEN'], mode: 'depth' }).state.mode, 'combination');
});
t('break-out only with three licences in combinations mode', () => {
  assert.strictEqual(norm({ licences: ['CAB', 'LEN', 'AMI'], expandDepth: 2 }).state.expandDepth, 2);
  assert.strictEqual(norm({ licences: ['CAB', 'LEN'], expandDepth: 2 }).state.expandDepth, null);
  assert.strictEqual(norm({ licences: ['CAB', 'LEN', 'AMI'], mode: 'any', expandDepth: 2 }).state.expandDepth, null);
});
t('break-out dropped, with a note, when the tier is empty under the filters', () => {
  const r = norm({ licences: ['CAB', 'LEN', 'AMI'], expandDepth: 2, regions: ['Sub-Saharan Africa'] });
  assert.strictEqual(r.state.expandDepth, null);
  assert.strictEqual(r.notes.length, 1);
  assert.ok(/Which two/.test(r.notes[0]));
});
t('tier options follow the filters', () => {
  const all3 = { licences: ['CAB', 'LEN', 'AMI'] };
  assert.deepStrictEqual(V.tierOptions(ds, norm(all3).state).map(x => [x.depth, x.label, x.nCombinations]),
    [[3, 'All 3', 1], [2, 'Which two', 2], [1, 'One only', 3]]);
  assert.deepStrictEqual(V.tierOptions(ds, norm(Object.assign({ regions: ['South Asia'] }, all3)).state).map(x => x.depth), [3]);
  assert.deepStrictEqual(V.tierOptions(ds, norm(Object.assign({ regions: ['North America'] }, all3)).state), []);
});
t('unknown region / bucket / highlight dropped', () => {
  const s = norm({ regions: ['Atlantis', 'South Asia'], incomeBuckets: ['MIC', 'LMIC'], highlight: 'ZZZ' }).state;
  assert.deepStrictEqual(s.regions, ['South Asia']);
  assert.deepStrictEqual(s.incomeBuckets, ['LMIC']);
  assert.strictEqual(s.highlight, null);
});
t('filters narrow the frame (LMIC = 132; SSA + LMIC; empty combos)', () => {
  assert.strictEqual(V.compute(ds, norm({ incomeBuckets: ['LMIC'] }).state).frame.length, 132);
  assert.strictEqual(V.compute(ds, norm({ regions: ['North America'], incomeBuckets: ['LMIC'] }).state).frame.length, 0);
  assert.strictEqual(V.compute(ds, norm({ regions: ['South Asia'], incomeBuckets: ['HIC'] }).state).frame.length, 0);
});
t('legend: CAB, LEN, AMI and the overlays match stage 1/2 counts', () => {
  assert.deepStrictEqual(legend(norm({ merge: false }).state), [['Covered — Direct', 90], ['Covered — Indirect', 43], ['Not covered', 89]]);
  assert.deepStrictEqual(legend(norm({ merge: true }).state), [['Covered', 133], ['Not covered', 89]]);
  assert.deepStrictEqual(legend(norm({ licences: ['LEN'] }).state), [['Covered', 120], ['Not covered', 102]]);
  assert.deepStrictEqual(legend(norm({ licences: ['CAB', 'LEN', 'AMI'], mode: 'any' }).state), [['Covered by ≥1 of 3', 146], ['None of the selected', 76]]);
  assert.deepStrictEqual(legend(norm({ licences: ['CAB', 'LEN', 'AMI'], mode: 'all' }).state), [['Covered by all 3', 108], ['None of the selected', 114]]);
  assert.deepStrictEqual(legend(norm({ licences: ['CAB', 'LEN', 'AMI'], expandDepth: 2 }).state),
    [['CAB + AMI', 9], ['LEN + AMI', 11], ['Covered, other combinations', 126], ['None of the selected', 76]]);
});
t('legend counts always add up to the countries in scope', () => {
  const combos = [];
  [['CAB'], ['LEN'], ['AMI'], ['CAB', 'LEN'], ['CAB', 'AMI'], ['LEN', 'AMI'], ['CAB', 'LEN', 'AMI']].forEach(l =>
    ['combination', 'any', 'all'].forEach(m => [[], ...ds.regions.map(r => [r])].forEach(r =>
      [[], ['LMIC'], ['HIC']].forEach(b => combos.push({ licences: l, mode: m, regions: r, incomeBuckets: b })))));
  combos.forEach(p => {
    const st = norm(p).state, n = V.compute(ds, st).frame.length;
    assert.strictEqual(legend(st).reduce((a, x) => a + x[1], 0), n, JSON.stringify(p));
  });
});
t('break-out list: Which two = LEN + AMI 11, CAB + AMI 9', () => {
  const st = norm({ licences: ['CAB', 'LEN', 'AMI'], expandDepth: 2 }).state;
  const g = V.breakoutList(V.compute(ds, st).frame);
  assert.deepStrictEqual(g.map(x => [x.combination, x.countries.length]), [['CAB + AMI', 9], ['LEN + AMI', 11]]);
  assert.ok(g[1].countries.includes('Kazakhstan'));
});
t('break-out One only lists Malaysia (AMI) and Moldova (LEN)', () => {
  const st = norm({ licences: ['CAB', 'LEN', 'AMI'], expandDepth: 1 }).state;
  const g = V.breakoutList(V.compute(ds, st).frame);
  const flat = Object.fromEntries(g.map(x => [x.combination, x.countries]));
  assert.deepStrictEqual(flat['AMI only'], ['Malaysia']);
  assert.ok(flat['LEN only'][0].startsWith('Moldova') || flat['LEN only'][0].startsWith('Republic of Moldova'));
  assert.strictEqual(flat['CAB only'].length, 16);
});
t('titles: singular and plural', () => {
  assert.strictEqual(V.title(ds, norm({}).state), 'Long-acting HIV PrEP: Cabotegravir licence coverage');
  assert.strictEqual(V.title(ds, norm({ licences: ['CAB', 'LEN', 'AMI'] }).state), 'Long-acting HIV PrEP: Cabotegravir, Lenacapavir and Alimatravir licences coverage');
  assert.strictEqual(V.title(ds, norm({ licences: ['LEN', 'AMI'] }).state), 'Long-acting HIV PrEP: Lenacapavir and Alimatravir licences coverage');
});
t('summary names filters and scope', () => {
  const st = norm({ regions: ['Sub-Saharan Africa'], incomeBuckets: ['LMIC'] }).state;
  const s = V.summary(ds, st, V.compute(ds, st).frame.length);
  assert.ok(/Region: Sub-Saharan Africa · LMIC/.test(s), s);
  assert.ok(/ of 222 countries in scope$/.test(s), s);
});
t('tooltip lines', () => {
  const single = { kind: 'single', licence: 'CAB', merge: false };
  const ind = ds.countries.find(c => c.iso3 === 'IND');
  const row = C.licenceFrame(ds, 'CAB', [ind], false)[0];
  assert.strictEqual(V.tipLine(ds, single, row), 'Coverage: Direct with royalties');
  assert.strictEqual(V.tipLine(ds, Object.assign({}, single, { merge: true }), row), 'Coverage: Covered');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
