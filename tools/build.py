"""Bundle the prototype into one self-contained HTML file.

Usage (from the lapal-public-prototype folder, after tools/xlsx_to_json.py):
    python3 tools/build.py

Reads   src/index.html, src/*.css, src/*.js, data/lapal_licence_coverage.json,
        vendor/ (d3 7.9.0, topojson-client 3.1.0, world-atlas 2.0.2 50m,
        world-countries 5.1.0; copied from the patent-coverage prototype's cache)
Writes  dist/LAPaL_licence_coverage_prototype.html

Logos: assets/logos/<name>.svg or .png for each entry in LOGOS, inlined as data
URLs (LAPaL first, then the partners). A missing file is skipped with a note.

Search and AI readability (written into the HTML, readable without JavaScript):
- a text summary of every licence's figures and country lists, made by
  tools/prerender.js with the page's own view.js / coverage.js (needs Node);
- a meta description, link-preview (Open Graph) tags and schema.org Dataset data;
- dist/lapal_licence_coverage.csv, the country x licence table, linked from the page.
With SITE_URL set (the GitHub Pages workflow sets it to the live address) it also
adds the canonical / og:url tags and writes dist/robots.txt and dist/sitemap.xml.

Nothing is downloaded and nothing is published. PT Sans is linked from Google
Fonts, so it needs an internet connection; offline, the page falls back to the
system sans-serif.

Map assumptions (decided with Lobna at the plan stage):
- world-atlas identifies countries by ISO numeric code; world-countries turns
  that into ISO3, which is the key the data uses.
- Shapes are given the data's code where the two disagree or the shape has none:
  Kosovo -> XKX (World Bank code), Jersey + Guernsey -> CHI (the data's Channel
  Islands), Somaliland -> SOM, N. Cyprus -> CYP, Aland -> FIN. A country with
  several shapes is drawn as one (the page merges them, so no inner border).
- Gibraltar and Tuvalu have no shape at this scale: they are drawn as dots at
  the coordinates in POINTS.
- Antarctica is dropped. Every other shape with no data row (Falklands,
  Pitcairn, Siachen Glacier...) is kept and drawn in the "no data" tone; it is
  never counted.
"""
import base64
import csv
import html
import json
import shutil
import subprocess
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(ROOT, 'vendor')
SRC = os.path.join(ROOT, 'src')

SHAPE_TO_DATA = {'XKX': 'XKX', 'JEY': 'CHI', 'GGY': 'CHI', 'ALA': 'FIN'}
NAME_TO_DATA = {'Kosovo': 'XKX', 'Somaliland': 'SOM', 'N. Cyprus': 'CYP'}
POINTS = {'GIB': (-5.35, 36.14), 'TUV': (179.2, -8.52)}  # (longitude, latitude)

# (file name, name, role, homepage). Role 'main': header, left. 'coordinator':
# "Coordinated by". 'support': "With support from", in this order. On the page
# each logo links to its homepage.
LOGOS = [('lapal', 'LAPaL', 'main', 'https://lapal.ch'),
         ('medspal', 'MedsPaL', 'main', 'https://www.medspal.org'),
         ('mpp', 'Medicines Patent Pool', 'coordinator', 'https://medicinespatentpool.org'),
         ('unitaid', 'Unitaid', 'support', 'https://unitaid.org'),
         ('leap', 'LEAP', 'support', 'https://longactinghiv.org'),
         ('liverpool', 'University of Liverpool', 'support', 'https://www.liverpool.ac.uk'),
         ('celt', 'CELT Global Health', 'support', 'https://www.liverpool.ac.uk/celt-global-health/'),
         ('coefficient', 'Coefficient Giving', 'support', 'https://coefficientgiving.org')]

CSS = ['tokens.css', 'app.css']
JS = ['data.js', 'coverage.js', 'colours.js', 'map.js', 'view.js', 'export.js', 'slide.js', 'xlsx.js', 'ui.js']


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def world(data_isos):
    atlas = json.loads(read(os.path.join(VENDOR, 'world-atlas_2.0.2_countries-50m.json')))
    num_to_a3 = {c['ccn3']: c['cca3'] for c in json.loads(read(os.path.join(VENDOR, 'world-countries_5.1.0_countries.json')))
                 if c.get('ccn3')}
    geoms = []
    for g in atlas['objects']['countries']['geometries']:
        name = g['properties']['name']
        if name == 'Antarctica':
            continue
        iso = num_to_a3.get(g.get('id'))
        iso = NAME_TO_DATA.get(name) or SHAPE_TO_DATA.get(iso, iso)
        g['properties'] = {'name': name, 'iso3': iso if iso in data_isos else None}
        geoms.append(g)
    atlas['objects']['countries']['geometries'] = geoms
    atlas['objects'].pop('land', None)

    drawn = {g['properties']['iso3'] for g in geoms} | set(POINTS)
    missing = sorted(data_isos - drawn)
    if missing:
        sys.exit(f'ERROR: no shape or dot for {missing}; add them to SHAPE_TO_DATA, NAME_TO_DATA or POINTS')
    no_data = sorted(g['properties']['name'] for g in geoms if not g['properties']['iso3'])
    print(f'map: {len(data_isos)} data countries drawn ({len(POINTS)} as dots); '
          f'{len(no_data)} shapes with no data row: {", ".join(no_data)}')
    return {'topology': atlas, 'points': {k: list(v) for k, v in POINTS.items()}}


def logos():
    """[{id, name, role, url, src, w, h}] for the logo files present, in LOGOS order."""
    out = []
    for key, name, role, url in LOGOS:
        base = os.path.join(ROOT, 'assets', 'logos', key)
        if os.path.exists(base + '.svg'):
            svg = read(base + '.svg')
            vb = re.search(r'viewBox="\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)', svg)
            if not vb:
                sys.exit(f'{key}.svg has no viewBox, so its proportions are unknown')
            w, h = float(vb.group(1)), float(vb.group(2))
            src = 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode('utf-8')).decode()
        elif os.path.exists(base + '.png'):
            with open(base + '.png', 'rb') as f:
                raw = f.read()
            w, h = struct.unpack('>II', raw[16:24])
            src = 'data:image/png;base64,' + base64.b64encode(raw).decode()
        else:
            print(f'logo: no assets/logos/{key}.svg or .png, so {name} is left out')
            continue
        out.append({'id': key, 'name': name, 'role': role, 'url': url, 'src': src, 'w': w, 'h': h})
    return out


def prerender():
    """Text summary and description from tools/prerender.js (same logic as the page)."""
    node = shutil.which('node') or os.path.expanduser('~/.local/node/bin/node')
    if not os.path.exists(node) and not shutil.which('node'):
        sys.exit('node not found: it is needed at build time for the text summary (tools/prerender.js)')
    out = subprocess.run([node, os.path.join(ROOT, 'tools', 'prerender.js'),
                          os.path.join(ROOT, 'data', 'lapal_licence_coverage.json')],
                         capture_output=True, text=True, cwd=ROOT)
    if out.returncode:
        sys.exit('tools/prerender.js failed:\n' + out.stderr)
    return json.loads(out.stdout)


def write_csv(data, path):
    """Country x licence table: a stable, citable data file. Reshaping only."""
    status = {(r['iso3'], r['licence']): r for r in data['coverage']}
    codes = [l['code'] for l in data['licences']]
    with_basis = {r['licence'] for r in data['coverage'] if r.get('basis')}
    year = data['impact']['year']
    head = ['iso3', 'country', 'region', 'income_group', 'income_bucket']
    for c in codes:
        head.append(c + '_covered')
        if c in with_basis:
            head += [c + '_basis', c + '_royalty_rate']
    head += ['new_hiv_acquisitions_' + year, 'hiv_incidence_per_1000_' + year]
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(head)
        for k in sorted(data['countries'], key=lambda x: x['country']):
            row = [k['iso3'], k['country'], k['region'], k['income_group'], k['income_bucket']]
            for c in codes:
                s = status[(k['iso3'], c)]
                row.append(s['covered'])
                if c in with_basis:
                    row += [s.get('basis') or '', s.get('royalty_rate') or '']
            # UNAIDS ceilings ("<200") as published, never the stored half-value.
            n = k.get('new_hiv_infections')
            row += ['' if n is None else (k.get('new_hiv_infections_shown_as') or ('%g' % n)),
                    '' if k.get('hiv_incidence_per_1000_uninfected') is None else k['hiv_incidence_per_1000_uninfected']]
            w.writerow(row)


SITE_URL = os.environ.get('SITE_URL', '').rstrip('/')   # e.g. https://lobnagaa.github.io/lapal-licence-coverage
PAGE_NAME = 'LAPaL_licence_coverage_prototype.html'      # the workflow publishes it as index.html


def head_meta(data, pre, logo_list):
    """Meta description, Open Graph tags and schema.org Dataset JSON-LD."""
    title = 'Long-acting HIV PrEP: licence coverage · LAPaL'
    desc = pre['description']
    csv_url = (SITE_URL + '/' if SITE_URL else '') + 'lapal_licence_coverage.csv'
    org = lambda l: {'@type': 'Organization', 'name': l['name'], 'url': l['url']}
    ld = {
        '@context': 'https://schema.org', '@type': 'Dataset',
        'name': 'Long-acting HIV PrEP: licence coverage (' + ', '.join(l['name'] for l in pre['licences']) + ')',
        'description': desc + ' Country-level coverage of voluntary licences, with UNAIDS ' + data['impact']['year'] +
                       ' new HIV acquisitions and World Bank income groups.',
        'keywords': ['HIV', 'PrEP', 'pre-exposure prophylaxis', 'long-acting', 'voluntary licence', 'generic medicines',
                     'LMIC', 'access to medicines'] + [l['name'] for l in pre['licences']],
        'dateModified': data['generated'],
        'spatialCoverage': 'Worldwide (' + str(len(data['countries'])) + ' countries and territories)',
        'variableMeasured': ['Licence coverage by country', 'Share of low- and middle-income countries covered',
                             'Share of new HIV acquisitions in covered countries'],
        'creator': [org(l) for l in logo_list if l['role'] == 'main'],
        'publisher': [org(l) for l in logo_list if l['role'] == 'coordinator'],
        # "With support from" on the page; 'sponsor', not 'funder', since not all of them fund it.
        'sponsor': [org(l) for l in logo_list if l['role'] == 'support'],
        'distribution': [{'@type': 'DataDownload', 'encodingFormat': 'text/csv', 'contentUrl': csv_url}],
    }
    if SITE_URL:
        ld['url'] = SITE_URL + '/'
    e = lambda x: html.escape(x, quote=True)
    tags = ['<link rel="canonical" href="%s/">' % e(SITE_URL), '<meta property="og:url" content="%s/">' % e(SITE_URL)] if SITE_URL else []
    return '\n'.join(tags + [
        '<meta name="description" content="%s">' % e(desc),
        '<meta property="og:type" content="website">',
        '<meta property="og:title" content="%s">' % e(title),
        '<meta property="og:description" content="%s">' % e(desc),
        '<meta name="twitter:card" content="summary">',
        '<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False).replace('</', '<\\/'),
    ])


def main():
    data_txt = read(os.path.join(ROOT, 'data', 'lapal_licence_coverage.json'))
    data = json.loads(data_txt)
    geo = world({c['iso3'] for c in data['countries']})

    page = read(os.path.join(SRC, 'index.html'))
    pre = prerender()
    logo_list = logos()
    js_safe = lambda obj: json.dumps(obj, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    parts = {
        '/*__CSS__*/': '\n'.join(read(os.path.join(SRC, f)) for f in CSS),
        '/*__VENDOR__*/': read(os.path.join(VENDOR, 'd3_7.9.0_dist_d3.min.js')) + '\n' +
                          read(os.path.join(VENDOR, 'topojson-client_3.1.0_dist_topojson-client.min.js')) + '\n' +
                          read(os.path.join(VENDOR, 'pptxgenjs_3.12.0_dist_pptxgen.bundle.js')).replace('//# sourceMappingURL=pptxgen.bundle.js.map', ''),
        '/*__DATA__*/': 'window.LAPAL_DATA=' + js_safe(data) + ';window.LAPAL_WORLD=' + js_safe(geo) +
                        ';window.LAPAL_LOGOS=' + js_safe(logo_list) + ';',
        '<!--__HEAD_META__-->': head_meta(data, pre, logo_list),
        '<!--__SUMMARY__-->': pre['summary_html'],
        '/*__APP__*/': '\n'.join(read(os.path.join(SRC, f)) for f in JS),
    }
    for k, v in parts.items():
        assert page.count(k) == 1, f'{k} must appear once in src/index.html'
        page = page.replace(k, v)
    os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
    out = os.path.join(ROOT, 'dist', PAGE_NAME)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    print('wrote %s (%.1f MB)' % (os.path.relpath(out, ROOT), os.path.getsize(out) / 1e6))
    out_csv = os.path.join(ROOT, 'dist', 'lapal_licence_coverage.csv')
    write_csv(data, out_csv)
    print('wrote %s' % os.path.relpath(out_csv, ROOT))
    if SITE_URL:
        # Crawlers, AI crawlers included, are welcome: the page is meant to be found and cited.
        with open(os.path.join(ROOT, 'dist', 'robots.txt'), 'w') as f:
            f.write('User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n' % SITE_URL)
        with open(os.path.join(ROOT, 'dist', 'sitemap.xml'), 'w') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                    '  <url><loc>%s/</loc><lastmod>%s</lastmod></url>\n</urlset>\n' % (html.escape(SITE_URL), data['generated']))
        print('wrote dist/robots.txt and dist/sitemap.xml for %s' % SITE_URL)


if __name__ == '__main__':
    main()
