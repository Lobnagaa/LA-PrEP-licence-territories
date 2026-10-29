# Long-acting HIV PrEP: licence coverage

An interactive map of which countries the voluntary licences for long-acting HIV
pre-exposure prophylaxis (PrEP) cover: cabotegravir (CAB, MPP licence with ViiV
Healthcare), lenacapavir (LEN, bilateral, Gilead Sciences) and alimatravir (AMI,
bilateral, MSD). Figures are given for low- and middle-income countries (LMICs)
next to global ones, with the share of new HIV acquisitions (UNAIDS) in covered
countries.

**Live page:** https://lobnagaa.github.io/lapal-licence-coverage/

This is a framework-free prototype for [LAPaL](https://lapal.ch), the Long-Acting
Therapeutics Patents and Licences database coordinated by the
[Medicines Patent Pool](https://medicinespatentpool.org). It is a prototype for
LAPaL's own site, not the official LAPaL page. Territories and patent status change
over time: check [MedsPaL](https://www.medspal.org) and [LAPaL](https://lapal.ch)
before relying on it for a decision.

## What you can do on the page

- Show one licence, or overlay two or three (combinations, covered by at least one, covered by all).
- Filter by region and income group; highlight or look up a country.
- See the headline figures, and the countries behind each of them.
- Download the current view as a PNG, a PowerPoint slide or an Excel spreadsheet.
- Download the full country data as a CSV: [`lapal_licence_coverage.csv`](https://lobnagaa.github.io/lapal-licence-coverage/lapal_licence_coverage.csv).

## Data

`data/lapal_licence_coverage.json`: one row per country × licence (222 countries
and territories, 3 licences), with UNAIDS 2025 new HIV acquisitions and incidence,
and World Bank income groups. Licence coverage is derived from the licence documents:

- [Cabotegravir licence agreement, amended July 2025 (ViiV Healthcare, MPP)](https://medicinespatentpool.org/uploads/2023/09/2025.07.10-CAB-Amended-and-Restated-License-Agreement_private-markets-Tx-FINAL-signed.pdf)
- [Lenacapavir licence agreement (Gilead)](https://www.gilead.com/-/media/gileadcorpredesign/pdf/Other/LEN-VL.pdf)
- [Alimatravir sample licence agreement (MSD)](https://www.msd.com/wp-content/uploads/sites/9/2026/07/Alimatravir-Sample-VL-Agreement.pdf)

The public alimatravir licence leaves out the list of patents (Appendix 3), so the
AMI map shows the licence territory only.

## Build and run locally

Needs Python 3 and Node (Node only at build time).

```bash
node tools/check_data.js                     # validate the data
for t in tools/test_stage*.js; do node "$t"; done
python3 tools/build.py                       # writes dist/LAPaL_licence_coverage_prototype.html and dist/lapal_licence_coverage.csv
```

Open the HTML file in `dist/` in a browser. On every push to `main`, the GitHub
Actions workflow (`.github/workflows/pages.yml`) runs the same checks, builds the
page and publishes it. If a check fails, nothing is published.

`DEVELOPER_NOTES.md` explains the modules, the data contract, the rules to keep
when rebuilding it in LAPaL's Vue front end, and what is still open.

**Not included:** `tools/xlsx_to_json.py` and `tools/parity_reference.py` read the
data spreadsheet and the reference coverage logic from a handoff folder
(`../lapal-public-handoff/`). That folder is not part of this repository. The page,
the checks and the tests do not need it.

## Credits

LAPaL and MedsPaL are coordinated by the Medicines Patent Pool, with support from
Unitaid, LEAP, the University of Liverpool, CELT Global Health and Coefficient
Giving. Their logos belong to their owners. The map uses
[world-atlas](https://github.com/topojson/world-atlas) (Natural Earth),
[d3-geo](https://github.com/d3/d3-geo),
[topojson-client](https://github.com/topojson/topojson-client) and
[PptxGenJS](https://github.com/gitbrent/PptxGenJS).
