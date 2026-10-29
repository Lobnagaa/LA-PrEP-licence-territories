/* Stage 4 checks: tiles, the lists behind them, and the tables (src/view.js),
 * against the SPEC reference values. Run: node tools/test_stage4.js */
'use strict';
const assert = require('assert');
const D = require('../src/data.js');
const V = require('../src/view.js');
const ds = D.buildDataset(require('../data/lapal_licence_coverage.json'));

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + e.message); }
}
const at = patch => {
  const st = V.normalise(ds, Object.assign(V.initialState(ds), patch)).state;
  const c = V.compute(ds, st);
  const ts = V.tiles(ds, st, c);
  return { st, c, ts, tile: id => ts.find(x => x.id === id), tables: V.tables(ds, st, c) };
};

// SPEC reference values: [covered, LMIC covered / in scope, % LMICs, impact, impact LMIC-only]
const REF = [
  [{ licences: ['CAB'] }, 133, '85.6%', '87.2%', '88.4%'],
  [{ licences: ['LEN'] }, 120, '80.3%', '84.3%', '86.0%'],
  [{ licences: ['AMI'] }, 129, '87.1%', '85.6%', '87.3%'],
  [{ licences: ['CAB', 'LEN', 'AMI'], mode: 'any' }, 146, '90.9%', '87.9%', '89.1%'],
  [{ licences: ['CAB', 'LEN', 'AMI'], mode: 'all' }, 108, '75.8%', '83.9%', '85.6%'],
];
REF.forEach(([p, cov, lmic, imp, impL]) => t('reference figures ' + JSON.stringify(p), () => {
  const r = at(p);
  assert.strictEqual(r.tile('covered').value, String(cov));
  assert.strictEqual(r.tile('lmic').value, lmic);
  assert.strictEqual(r.tile('impact').value, imp);
  assert.ok(r.tile('impact').sub.startsWith('LMICs only: ' + impL), r.tile('impact').sub);
}));
t('combinations mode counts the union, like ANY', () => {
  assert.strictEqual(at({ licences: ['CAB', 'LEN', 'AMI'] }).tile('covered').value, '146');
});
t('break-out does not shrink the headline (counts use the whole overlay)', () => {
  const r = at({ licences: ['CAB', 'LEN', 'AMI'], expandDepth: 2 });
  assert.strictEqual(r.st.expandDepth, 2);
  assert.strictEqual(r.tile('covered').value, '146');
  assert.strictEqual(r.tile('covered').list[0].rows.length, 146);
});
t('tile labels follow the mode', () => {
  assert.strictEqual(at({}).tile('covered').label, 'Countries covered');
  assert.strictEqual(at({ licences: ['CAB', 'LEN'] }).tile('covered').label, 'Covered by ≥1 of 2');
  assert.strictEqual(at({ licences: ['CAB', 'LEN'], mode: 'all' }).tile('covered').label, 'Covered by all 2');
});
t('every List matches its number', () => {
  const r = at({ licences: ['CAB'] });
  assert.strictEqual(r.tile('covered').list[0].rows.length, 133);
  assert.strictEqual(r.tile('share').list[0].rows.length, 133);
});
t('LMIC tile shows covered only, with no details text', () => {
  const tl = at({}).tile('lmic');
  assert.strictEqual(tl.sub, '113 of 132 LMICs covered');
  assert.strictEqual(tl.detail, null);
});
t('LMIC List shows both sides (113 covered + 19 not)', () => {
  const l = at({}).tile('lmic').list;
  assert.deepStrictEqual(l.map(s => [s.title, s.rows.length]), [['Covered LMICs', 113], ['Not covered LMICs', 19]]);
  assert.ok(l[1].rows.every(r => r.income_group !== 'High'));
});
t('no global share without a filter; shown with one', () => {
  assert.strictEqual(at({}).tile('share').world, undefined);
  const r = at({ regions: ['Sub-Saharan Africa'] });
  assert.strictEqual(r.tile('share').label, '% of Sub-Saharan Africa');
  assert.deepStrictEqual([r.tile('share').world.label, r.tile('share').world.value], ['% of all 222', '59.9%']);
});
t('global share follows the overlay mode, not the break-out', () => {
  const r = at({ licences: ['CAB', 'LEN', 'AMI'], mode: 'all', incomeBuckets: ['LMIC'] });
  assert.strictEqual(r.tile('share').world.value, '48.6%');  // 108 / 222
  assert.strictEqual(r.tile('share').value, '75.8%');       // 100 / 132
});
t('scope names', () => {
  assert.strictEqual(at({}).tile('share').label, '% of all countries');
  assert.strictEqual(at({ incomeBuckets: ['LMIC'] }).tile('share').label, '% of LMIC');
  assert.strictEqual(at({ regions: ['South Asia', 'Sub-Saharan Africa'] }).tile('share').label, '% of 2 regions');
  assert.strictEqual(at({ regions: ['Sub-Saharan Africa'], incomeBuckets: ['LMIC'] }).tile('share').label, '% of Sub-Saharan Africa, LMIC');
});
t('impact tooltip says what the spec asks', () => {
  const d = at({}).tile('impact').detail;
  assert.ok(/33 covered countries have no estimate/.test(d), d);
  assert.ok(/In LMICs only: 88\.4%/.test(d), d);
  assert.ok(/about 1\.2 million/.test(d), d);
  assert.ok(/among the 133 countries in scope with a UNAIDS estimate/.test(d), d);
});
t('HIC filter: LMIC tile and impact LMIC line say there are none', () => {
  const r = at({ incomeBuckets: ['HIC'] });
  assert.strictEqual(r.tile('lmic').value, '—');
  assert.strictEqual(r.tile('lmic').sub, 'No LMICs in scope');
  assert.ok(r.tile('impact').sub.startsWith('No LMICs in scope'));
});
t('empty scope: no impact tile, dashes, no crash', () => {
  const r = at({ regions: ['North America'], incomeBuckets: ['LMIC'] });
  assert.strictEqual(r.tile('covered').value, '0');
  assert.strictEqual(r.tile('share').value, '—');
  assert.strictEqual(r.tile('impact'), undefined);
  assert.strictEqual(r.tables[0].rows.slice(-1)[0].pct, null);
});
t('impact tile hidden for a non-HIV licence', () => {
  const raw = JSON.parse(JSON.stringify(require('../data/lapal_licence_coverage.json')));
  raw.licences[2].disease = 'Influenza';
  const ds2 = D.buildDataset(raw);
  const st = V.normalise(ds2, Object.assign(V.initialState(ds2), { licences: ['CAB', 'AMI'] })).state;
  assert.ok(!V.tiles(ds2, st, V.compute(ds2, st)).some(x => x.id === 'impact'));
});
t('tables: totals and region sums, no LMIC/HIC table', () => {
  const r = at({});
  const [reg, inc] = r.tables;
  assert.strictEqual(r.tables.length, 2);
  assert.deepStrictEqual(reg.rows.slice(-1)[0], { key: 'All countries', covered: 133, in_scope: 222, pct: 59.9, total: true });
  assert.strictEqual(reg.rows.length, 8);
  assert.strictEqual(reg.rows.slice(0, -1).reduce((a, x) => a + x.covered, 0), 133);
  assert.strictEqual(inc.rows.length, 5);
});
t('tables: region selected -> total row is that region', () => {
  const r = at({ regions: ['Latin America & Caribbean'] });
  const total = r.tables[1].rows.slice(-1)[0];
  assert.strictEqual(total.key, 'All of Latin America & Caribbean');
  assert.strictEqual(total.in_scope, r.c.countFrame.length);
  assert.strictEqual(at({ regions: ['Sub-Saharan Africa'], incomeBuckets: ['LMIC'] }).tables[0].rows.slice(-1)[0].key, 'All in scope');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
