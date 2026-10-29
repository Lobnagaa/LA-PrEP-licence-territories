"""Run the Python reference coverage logic over the public JSON, for the parity test.

Usage (from the repository folder; needs pandas, e.g. the dashboard's .venv):
    ../.venv/bin/python tools/parity_reference.py

Reads   data/lapal_licence_coverage.json (public data only, never the private workbook)
        ../lapal-public-handoff/reference/coverage_reference.py (imported unchanged)
Writes  tools/parity_expected.json, which tools/test_stage1.js compares with coverage.js

The reference expects the private dashboard's dataset object; a small stand-in
is built here from the public JSON. Columns the public data does not carry
(future_from, confidence) are filled as empty.
"""
import importlib.util
import itertools
import json
import os
from types import SimpleNamespace

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, '..', 'lapal-public-handoff', 'reference', 'coverage_reference.py')
spec = importlib.util.spec_from_file_location('coverage_reference', REF)
cov = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cov)

raw = json.load(open(os.path.join(ROOT, 'data', 'lapal_licence_coverage.json'), encoding='utf-8'))
countries = pd.DataFrame(raw['countries']).rename(columns={'new_hiv_infections': 'new_infections'})
countries['income_group_current'] = countries['income_group']
status = pd.DataFrame(raw['coverage'])
status['covered'] = status['covered'] == 'Yes'
status['future_from'] = None
status['confidence'] = None
ds = SimpleNamespace(
    countries=countries,
    licence_status=status,
    licences=[SimpleNamespace(code=l['code']) for l in raw['licences']],
    default_income_variant='current',
    registry={'geography': {'income_buckets': {
        'High': 'HIC', 'Upper-middle': 'LMIC', 'Lower-middle': 'LMIC', 'Low': 'LMIC'}}},
)
CODES = [l['code'] for l in raw['licences']]
REGIONS = sorted(countries['region'].unique())


def plain(frame):
    """What the JS must reproduce for one frame."""
    head = cov.headline_counts(frame)
    head = {k: v for k, v in head.items() if k not in ('future_dated', 'low_confidence')}
    return {
        'labels': dict(zip(frame['iso3'], frame['coverage_label'])),
        'covered': sorted(frame.loc[frame['covered'], 'iso3']),
        'headline': head,
        'impact': cov.impact_counts(frame),
        'by_region': cov.breakdown(frame, 'region').to_dict('records'),
        'by_income': cov.breakdown(frame, 'income_group').to_dict('records'),
        'lists': {m: list(cov.countries_behind(frame, m)['iso3'])
                  for m in ('covered', 'not_covered', 'bucket_covered', 'bucket_not_covered')},
    }


FILTERS = [('all', {}), ('LMIC', {'income_buckets': ['LMIC']}), ('HIC', {'income_buckets': ['HIC']})]
FILTERS += [('region:' + r, {'regions': [r]}) for r in REGIONS]
FILTERS += [('region:Sub-Saharan Africa+LMIC', {'regions': ['Sub-Saharan Africa'], 'income_buckets': ['LMIC']})]

scenarios = []
for fname, f in FILTERS:
    scope = cov.filter_countries(ds, regions=f.get('regions'), income_buckets=f.get('income_buckets'))
    for code in CODES:
        for merge in (False, True):
            fr = cov.licence_frame(ds, code, scope, merge_bases=merge)
            scenarios.append({'filter': f, 'kind': 'single', 'licence': code, 'merge': merge,
                              'labels_order': cov.ordered_labels(fr['coverage_label']), **plain(fr)})
    for n in (2, 3):
        for combo in itertools.combinations(CODES, n):
            # Reverse the click order on purpose: results must not depend on it.
            picked = list(reversed(combo))
            for mode in ('combination', 'any', 'all'):
                fr = cov.overlay_frame(ds, picked, scope, mode=mode)
                scenarios.append({
                    'filter': f, 'kind': 'overlay', 'licences': picked, 'mode': mode,
                    'labels_order': cov.ordered_overlay_labels(fr),
                    'combination_counts': cov.combination_counts(fr).to_dict('records'),
                    'tiers': [list(t) for t in cov.depth_tier_options(fr, n)],
                    **plain(fr)})
            if n == 3:
                for depth in (1, 2, 3):
                    fr = cov.overlay_frame(ds, picked, scope, expand_depth=depth)
                    scenarios.append({'filter': f, 'kind': 'overlay', 'licences': picked,
                                      'mode': 'combination', 'expand_depth': depth,
                                      'labels_order': cov.ordered_overlay_labels(fr), **plain(fr)})

out = os.path.join(ROOT, 'tools', 'parity_expected.json')
json.dump({'scenarios': scenarios}, open(out, 'w', encoding='utf-8'), ensure_ascii=False, default=float)
print(f'wrote {os.path.relpath(out, ROOT)}: {len(scenarios)} scenarios')
