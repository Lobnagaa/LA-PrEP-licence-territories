/* Data layer: load lapal_licence_coverage.json, validate it, normalise it.
 *
 * No rendering and no coverage logic here. The output (`ds`) is what
 * coverage.js reads. Validation fails loudly: any error throws a
 * DataValidationError listing every problem found, and the page shows that
 * list instead of a map. Warnings are returned but do not stop the page.
 *
 * Data assumptions (each one is enforced below; change the check, not the data,
 * if a rule stops being true):
 *  - Every licence code and every country iso3 is unique.
 *  - iso3 is three capital letters. Not checked against the ISO list: the data
 *    uses World Bank codes such as XKX (Kosovo) and CHI (Channel Islands).
 *  - There is exactly one coverage row per country x licence: no missing row,
 *    no duplicate, no row for an unknown iso3 or licence code.
 *  - `covered` is "Yes" or "No".
 *  - `basis` is one of BASIS_VALUES, or null. It must be null when covered is
 *    "No". Licences with no direct/indirect distinction (LEN, AMI) leave it null
 *    everywhere.
 *  - `royalty_rate` only appears on "Direct with royalties" rows.
 *  - `income_group` is a World Bank group (current classification only) and
 *    `income_bucket` agrees with it: High -> HIC, every other group -> LMIC.
 *  - Region labels are free text taken from the data; they are not checked
 *    against a list ("Middle East, North Africa, Afghanistan & Pakistan" is an
 *    MPP grouping, not a typo).
 *  - `new_hiv_infections` is a number >= 0 or null (null = UNAIDS publishes no
 *    estimate, or the country is not in the UNAIDS tables). Values UNAIDS shows
 *    as a ceiling ("<100") are stored as half the ceiling; the original text is
 *    in `new_hiv_infections_shown_as`.
 *  - Licence row order in the data is the display order. Combination labels
 *    and colours follow it, never the order in which the reader clicks.
 */
(function (root) {
  'use strict';

  var BASIS_VALUES = ['Direct', 'Direct with royalties', 'Indirect'];
  var ROYALTY_BASIS = 'Direct with royalties';
  var INCOME_BUCKETS = {
    'High': 'HIC', 'Upper-middle': 'LMIC', 'Lower-middle': 'LMIC', 'Low': 'LMIC',
  };
  var REQUIRED_TEXTS = ['coverage_definition', 'licence_types', 'data_sources',
                        'currency_note', 'ami_disclaimer'];
  var HEX = /^#[0-9A-Fa-f]{6}$/;
  var ISO3 = /^[A-Z]{3}$/;

  function DataValidationError(errors) {
    this.name = 'DataValidationError';
    this.errors = errors;
    this.message = 'The licence coverage data failed ' + errors.length +
      ' check(s):\n- ' + errors.join('\n- ');
    this.stack = new Error(this.message).stack;
  }
  DataValidationError.prototype = Object.create(Error.prototype);

  /* Check the raw JSON. Returns {errors: [], warnings: []}; never throws. */
  function validate(raw) {
    var errors = [], warnings = [];
    function err(m) { errors.push(m); }

    if (!raw || typeof raw !== 'object') return { errors: ['Data is not an object'], warnings: warnings };
    ['licences', 'countries', 'coverage'].forEach(function (k) {
      if (!Array.isArray(raw[k]) || !raw[k].length) err('`' + k + '` is missing or empty');
    });
    if (errors.length) return { errors: errors, warnings: warnings };

    // Licences
    var codes = {};
    raw.licences.forEach(function (l, i) {
      var where = 'licence row ' + (i + 1) + (l.code ? ' (' + l.code + ')' : '');
      if (!l.code) err(where + ': no code');
      else if (codes[l.code]) err('licence code ' + l.code + ' appears twice');
      codes[l.code] = l;
      if (!l.name) err(where + ': no name');
      ['colour', 'fade_colour'].forEach(function (c) {
        if (!HEX.test(l[c] || '')) err(where + ': ' + c + ' ' + JSON.stringify(l[c]) + ' is not a #RRGGBB colour');
      });
      ['ramp_direct', 'ramp_indirect'].forEach(function (c) {
        if (l[c] != null && !HEX.test(l[c])) err(where + ': ' + c + ' ' + JSON.stringify(l[c]) + ' is not a #RRGGBB colour');
      });
    });

    // Countries
    var isos = {};
    raw.countries.forEach(function (c, i) {
      var where = 'country row ' + (i + 1) + (c.iso3 ? ' (' + c.iso3 + ')' : '');
      if (!ISO3.test(c.iso3 || '')) err(where + ': iso3 ' + JSON.stringify(c.iso3) + ' is not three capital letters');
      else if (isos[c.iso3]) err('country ' + c.iso3 + ' appears twice');
      isos[c.iso3] = c;
      if (!c.country) err(where + ': no country name');
      if (!c.region) err(where + ': no region');
      if (!(c.income_group in INCOME_BUCKETS)) {
        err(where + ': unknown income_group ' + JSON.stringify(c.income_group) +
            ' (expected one of ' + Object.keys(INCOME_BUCKETS).join(', ') + ')');
      } else if (c.income_bucket !== INCOME_BUCKETS[c.income_group]) {
        err(where + ': income_bucket ' + JSON.stringify(c.income_bucket) + ' does not match income_group ' +
            c.income_group + ' (expected ' + INCOME_BUCKETS[c.income_group] + ')');
      }
      var n = c.new_hiv_infections;
      if (n != null && (typeof n !== 'number' || !isFinite(n) || n < 0)) {
        err(where + ': new_hiv_infections ' + JSON.stringify(n) + ' is not a number >= 0');
      }
      var inc = c.hiv_incidence_per_1000_uninfected;
      if (inc != null && (typeof inc !== 'number' || !isFinite(inc) || inc < 0)) {
        err(where + ': hiv_incidence_per_1000_uninfected ' + JSON.stringify(inc) + ' is not a number >= 0');
      }
      var shown = c.new_hiv_infections_shown_as;
      if (shown != null) {
        var m = /^<\s*([\d,]+)$/.exec(String(shown));
        if (!m) warnings.push(where + ': new_hiv_infections_shown_as ' + JSON.stringify(shown) + ' is not of the form "<N"');
        else if (n !== Number(m[1].replace(/,/g, '')) / 2) {
          warnings.push(where + ': shown as ' + shown + ' but stored as ' + n + ' (expected half the ceiling)');
        }
      }
    });

    // Coverage: exactly one row per country x licence
    var seen = {};
    raw.coverage.forEach(function (r, i) {
      var where = 'coverage row ' + (i + 1) + ' (' + r.iso3 + ' / ' + r.licence + ')';
      if (!isos[r.iso3]) err(where + ': unknown iso3 ' + JSON.stringify(r.iso3) + ' (not in countries)');
      if (!codes[r.licence]) err(where + ': unknown licence ' + JSON.stringify(r.licence) + ' (not in licences)');
      var key = r.iso3 + '|' + r.licence;
      if (seen[key]) err(where + ': duplicate row');
      seen[key] = true;
      if (r.covered !== 'Yes' && r.covered !== 'No') {
        err(where + ': covered must be "Yes" or "No", got ' + JSON.stringify(r.covered));
      }
      if (r.basis != null && BASIS_VALUES.indexOf(r.basis) < 0) {
        err(where + ': unknown basis ' + JSON.stringify(r.basis) + ' (expected one of ' + BASIS_VALUES.join(', ') + ', or blank)');
      }
      if (r.covered === 'No' && r.basis != null) err(where + ': not covered but has basis ' + JSON.stringify(r.basis));
      if (r.royalty_rate != null && r.basis !== ROYALTY_BASIS) {
        err(where + ': royalty_rate given but basis is ' + JSON.stringify(r.basis) + ', not "' + ROYALTY_BASIS + '"');
      }
      if (r.basis === ROYALTY_BASIS && r.royalty_rate == null) {
        warnings.push(where + ': "' + ROYALTY_BASIS + '" but no royalty_rate; the lookup will show no rate line');
      }
    });
    var missing = [];
    Object.keys(isos).forEach(function (iso) {
      Object.keys(codes).forEach(function (code) {
        if (!seen[iso + '|' + code]) missing.push(iso + ' / ' + code);
      });
    });
    if (missing.length) {
      err(missing.length + ' country x licence row(s) missing from coverage: ' +
          missing.slice(0, 10).join(', ') + (missing.length > 10 ? ', ...' : ''));
    }

    // Texts and impact
    var texts = raw.texts || {};
    REQUIRED_TEXTS.forEach(function (k) { if (!texts[k]) err('texts.' + k + ' is missing'); });
    var imp = raw.impact || {};
    if (!imp.year) err('impact.year is missing');
    if (typeof imp.global_new_infections !== 'number') err('impact.global_new_infections is missing or not a number');
    if (!imp.source) err('impact.source is missing');

    return { errors: errors, warnings: warnings };
  }

  /* Validate, then build the normalised dataset. Throws DataValidationError. */
  function buildDataset(raw) {
    var result = validate(raw);
    if (result.errors.length) throw new DataValidationError(result.errors);

    var licences = raw.licences.map(function (l) {
      return Object.assign({}, l, {
        // A licence "has bases" when any covered row records Direct/Indirect.
        // Drives the Direct/Indirect colour split and the merge toggle.
        has_bases: raw.coverage.some(function (r) { return r.licence === l.code && r.basis != null; }),
      });
    });
    var countries = raw.countries.map(function (c) { return Object.assign({}, c); })
      .sort(function (a, b) { return a.country.localeCompare(b.country); });
    var status = raw.coverage.map(function (r) {
      return { iso3: r.iso3, licence: r.licence, covered: r.covered === 'Yes',
               basis: r.basis || null, royalty_rate: r.royalty_rate || null };
    });
    var statusIndex = {};
    status.forEach(function (s) { statusIndex[s.iso3 + '|' + s.licence] = s; });

    return {
      generated: raw.generated,
      licences: licences,
      licenceByCode: licences.reduce(function (m, l) { m[l.code] = l; return m; }, {}),
      countries: countries,
      countryByIso: countries.reduce(function (m, c) { m[c.iso3] = c; return m; }, {}),
      status: status,
      statusOf: function (iso3, code) { return statusIndex[iso3 + '|' + code]; },
      regions: unique(countries.map(function (c) { return c.region; })).sort(),
      incomeBuckets: ['LMIC', 'HIC'],
      texts: raw.texts,
      impact: raw.impact,
      warnings: result.warnings,
    };
  }

  function unique(xs) { return xs.filter(function (x, i) { return xs.indexOf(x) === i; }); }

  /* Browser entry point. The bundled prototype inlines the JSON as
   * window.LAPAL_DATA; a hosted page can fetch it from a URL instead. */
  function loadDataset(urlOrObject) {
    if (urlOrObject && typeof urlOrObject === 'object') return Promise.resolve(buildDataset(urlOrObject));
    return fetch(urlOrObject).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + urlOrObject + ': HTTP ' + res.status);
      return res.json();
    }).then(buildDataset);
  }

  var api = {
    BASIS_VALUES: BASIS_VALUES, ROYALTY_BASIS: ROYALTY_BASIS, INCOME_BUCKETS: INCOME_BUCKETS,
    DataValidationError: DataValidationError,
    validate: validate, buildDataset: buildDataset, loadDataset: loadDataset,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LapalData = api;
})(typeof window !== 'undefined' ? window : globalThis);
