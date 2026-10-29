/* Coverage logic: a port of the private dashboard's data_layer/coverage.py
 * (copy in ../licence-territory-dashboard/lapal-public-handoff/reference/coverage_reference.py).
 *
 * Pure functions over the dataset built by data.js. No DOM, no colours. Every
 * number on the page is computed here, live, from `ds.status`; nothing is
 * precomputed in the spreadsheet. Function names follow the Python
 * (snake_case -> camelCase) so the two can be compared side by side.
 *
 * A "frame" is an array of row objects, one per country in scope: the
 * country's own fields plus `covered` (boolean) and `coverage_label`, and for
 * overlays `covered_codes`, `depth` and `combination`.
 *
 * Left out of the port, because the public data has no such columns:
 *  - income-group vintages (current World Bank classification only);
 *  - low-confidence rows (`confidence`);
 *  - future-dated coverage (`future_from`). If it is ever added to the data,
 *    restore it from the Python and show the future-dated tile only when its
 *    count is above zero (SPEC.md).
 */
(function (root) {
  'use strict';

  var NOT_COVERED = 'Not covered';
  var COVERED = 'Covered';
  var LMIC = 'LMIC';

  // ------------------------------------------------------------------------ //
  // Country-level filtering
  // ------------------------------------------------------------------------ //

  /* Apply the region / income-bucket filters. Empty or missing = no filter. */
  function filterCountries(ds, filters) {
    filters = filters || {};
    var regions = filters.regions || [], buckets = filters.incomeBuckets || [], groups = filters.incomeGroups || [];
    return ds.countries.filter(function (c) {
      return (!regions.length || regions.indexOf(c.region) >= 0) &&
             (!buckets.length || buckets.indexOf(c.income_bucket) >= 0) &&
             (!groups.length || groups.indexOf(c.income_group) >= 0);
    });
  }

  // ------------------------------------------------------------------------ //
  // Coverage labelling
  // ------------------------------------------------------------------------ //

  // "Direct with royalties" describes the same coverage as "Direct": it must not
  // become a legend category or colour of its own.
  var ROYALTY_SUFFIX = ' with royalties';

  /* Legend/colour category for one (country, licence) row. With detail=true
   * the basis is kept as recorded (e.g. "Direct with royalties") for the
   * country lookup; otherwise it is folded onto its base category. */
  function coverageLabel(covered, basis, detail) {
    if (!covered) return NOT_COVERED;
    if (basis) {
      if (!detail && basis.slice(-ROYALTY_SUFFIX.length) === ROYALTY_SUFFIX) {
        basis = basis.slice(0, -ROYALTY_SUFFIX.length);
      }
      return COVERED + ' — ' + basis;
    }
    return COVERED;
  }

  /* Sort order for legends, strongest coverage first. */
  function labelRank(label) {
    if (label === NOT_COVERED) return 90;
    if (label === COVERED) return 15;
    if (label.indexOf('Indirect') >= 0) return 20;
    if (label.indexOf('Direct') >= 0) return 10;
    return 30;
  }

  function orderedLabels(labels) {
    return uniq(labels).sort(function (a, b) {
      return (labelRank(a) - labelRank(b)) || cmp(a, b);
    });
  }

  // ------------------------------------------------------------------------ //
  // Single-licence view
  // ------------------------------------------------------------------------ //

  /* One row per country for a single licence, with a coverage label.
   * mergeBases=true shows Direct and Indirect as one "Covered" category. */
  function licenceFrame(ds, code, countries, mergeBases) {
    var scope = countries || ds.countries;
    return scope.map(function (c) {
      var s = ds.statusOf(c.iso3, code);
      return Object.assign({}, c, {
        covered: s.covered, basis: s.basis, royalty_rate: s.royalty_rate,
        coverage_label: mergeBases ? (s.covered ? COVERED : NOT_COVERED)
                                   : coverageLabel(s.covered, s.basis),
      });
    });
  }

  /* The countries behind one headline number. Keeps a number and the names
   * behind it computed in the same place, so they can never drift apart. */
  function countriesBehind(frame, metric, bucket) {
    bucket = bucket || LMIC;
    var test = {
      covered: function (r) { return r.covered; },
      not_covered: function (r) { return !r.covered; },
      bucket_covered: function (r) { return r.covered && r.income_bucket === bucket; },
      bucket_not_covered: function (r) { return !r.covered && r.income_bucket === bucket; },
      in_scope: function () { return true; },
    }[metric];
    if (!test) throw new Error('Unknown metric ' + JSON.stringify(metric));
    return frame.filter(test).map(function (r) {
      return { country: r.country, iso3: r.iso3, region: r.region,
               income_group: r.income_group, coverage_label: r.coverage_label };
    }).sort(function (a, b) { return cmp(a.country, b.country); });
  }

  // ------------------------------------------------------------------------ //
  // Overlay across up to MAX_OVERLAY licences
  // ------------------------------------------------------------------------ //

  var MAX_OVERLAY = 3;
  var MODE_COMBINATION = 'combination';
  var MODE_DEPTH = 'depth';  // ported for completeness; the public page does not offer it
  var MODE_ANY = 'any';
  var MODE_ALL = 'all';
  var NONE_LABEL = 'None of the selected';
  var OTHER_LABEL = 'Covered, other combinations';

  /* "CAB only" for one of several selected; "CAB + AMI" for an overlap;
   * NONE_LABEL for none. `codes` is already in data (display) order. */
  function combinationLabel(codes, nSelected) {
    if (!codes.length) return NONE_LABEL;
    if (codes.length === 1) return nSelected > 1 ? codes[0] + ' only' : codes[0] + ' covered';
    return codes.join(' + ');
  }

  /* One row per country describing overlap across the selected licences.
   * opts: {mode, isolate, expandDepth}. */
  function overlayFrame(ds, licences, countries, opts) {
    opts = opts || {};
    var mode = opts.mode || MODE_COMBINATION;
    if (!licences || !licences.length) throw new Error('Select at least one licence');
    if (licences.length > MAX_OVERLAY) {
      throw new Error('At most ' + MAX_OVERLAY + ' licences can be overlaid (got ' + licences.length + ')');
    }
    // Keep data order regardless of click order, so labels and colours are stable.
    var selected = ds.licences.map(function (l) { return l.code; })
      .filter(function (c) { return licences.indexOf(c) >= 0; });
    var n = selected.length;
    var scope = countries || ds.countries;

    var out = scope.map(function (c) {
      var codes = selected.filter(function (code) { return ds.statusOf(c.iso3, code).covered; });
      var depth = codes.length;
      return Object.assign({}, c, {
        covered_codes: codes, depth: depth,
        combination: combinationLabel(codes, n),
        any_covered: depth >= 1, all_covered: depth === n,
      });
    });

    out.forEach(function (r) {
      if (mode === MODE_ALL) {
        r.covered = r.all_covered;
        r.coverage_label = r.covered ? 'Covered by all ' + n : NONE_LABEL;
      } else if (mode === MODE_DEPTH) {
        r.covered = r.any_covered;
        r.coverage_label = r.depth === 0 ? NONE_LABEL
          : (r.depth === n ? 'All ' + n + ' selected' : r.depth + ' of ' + n + ' selected');
      } else if (mode === MODE_ANY) {
        r.covered = r.any_covered;
        r.coverage_label = r.covered ? (n > 1 ? 'Covered by ≥1 of ' + n : 'Covered') : NONE_LABEL;
      } else {
        r.covered = r.any_covered;
        r.coverage_label = r.combination;
      }
    });

    // Break one depth tier out into its exact combinations; everything else
    // collapses to OTHER_LABEL (covered elsewhere) or NONE_LABEL.
    if (opts.expandDepth != null) {
      out.forEach(function (r) {
        r.coverage_label = r.depth === opts.expandDepth ? r.combination
          : (r.depth === 0 ? NONE_LABEL : OTHER_LABEL);
        r.covered = r.depth === opts.expandDepth;
      });
    }
    if (opts.isolate) {
      out.forEach(function (r) {
        r.coverage_label = r.combination === opts.isolate ? opts.isolate : NONE_LABEL;
        r.covered = r.combination === opts.isolate;
      });
    }
    return out;
  }

  /* Country count per exact combination, deepest overlaps first. */
  function combinationCounts(frame) {
    var m = {};
    frame.forEach(function (r) {
      var k = r.combination;
      if (!m[k]) m[k] = { combination: k, depth: r.depth, countries: 0 };
      m[k].countries += 1;
    });
    return Object.keys(m).map(function (k) { return m[k]; })
      // Ties fall back to the label, as pandas' groupby-then-stable-sort does.
      .sort(function (a, b) {
        return (b.depth - a.depth) || (b.countries - a.countries) || cmp(a.combination, b.combination);
      });
  }

  /* Map each coverage label to its overlap depth, for colour assignment. */
  function overlayLabelDepths(frame) {
    var depths = {};
    frame.forEach(function (r) {
      // A label spanning several depths (ANY/ALL modes) takes its deepest.
      depths[r.coverage_label] = Math.max(r.depth, depths[r.coverage_label] || 0);
    });
    depths[NONE_LABEL] = 0;
    return depths;
  }

  /* Legend order: deepest overlap first, then the context tones last. */
  function orderedOverlayLabels(frame) {
    var depths = overlayLabelDepths(frame);
    var trailing = [OTHER_LABEL, NONE_LABEL];
    var present = uniq(frame.map(function (r) { return r.coverage_label; }));
    var labels = present.filter(function (l) { return trailing.indexOf(l) < 0; })
      .sort(function (a, b) { return ((depths[b] || 0) - (depths[a] || 0)) || cmp(a, b); });
    trailing.forEach(function (t) { if (present.indexOf(t) >= 0) labels.push(t); });
    return labels;
  }

  /* [{depth, label, nCombinations}] per populated tier, deepest first.
   * Drives the "break out a tier" control. */
  function depthTierOptions(frame, nSelected) {
    var tiers = uniq(frame.map(function (r) { return r.depth; }))
      .filter(function (d) { return d > 0; }).sort(function (a, b) { return b - a; });
    return tiers.map(function (d) {
      var combos = uniq(frame.filter(function (r) { return r.depth === d; })
                             .map(function (r) { return r.combination; }));
      return { depth: d,
               label: d === nSelected ? 'All ' + nSelected + ' selected' : d + ' of ' + nSelected + ' selected',
               nCombinations: combos.length };
    });
  }

  // ------------------------------------------------------------------------ //
  // Counts
  // ------------------------------------------------------------------------ //

  /* Totals for the current selection and filters, across everything in scope
   * and restricted to one income bucket (LMIC by default). */
  function headlineCounts(frame, bucket) {
    bucket = bucket || LMIC;
    var scoped = frame.filter(function (r) { return r.income_bucket === bucket; });
    var cov = function (rs) { return rs.filter(function (r) { return r.covered; }).length; };
    return {
      in_scope: frame.length,
      covered: cov(frame),
      not_covered: frame.length - cov(frame),
      bucket: bucket,
      bucket_in_scope: scoped.length,
      bucket_covered: cov(scoped),
      bucket_not_covered: scoped.length - cov(scoped),
    };
  }

  /* Share of new HIV acquisitions in covered countries. Only countries with a
   * UNAIDS estimate enter either side; the count of covered countries without
   * one is returned for the tooltip. */
  function impactCounts(frame, bucket) {
    bucket = bucket || LMIC;
    var total = function (test) {
      return frame.reduce(function (s, r) {
        return r.new_hiv_infections != null && test(r) ? s + r.new_hiv_infections : s;
      }, 0);
    };
    var inBucket = function (r) { return r.income_bucket === bucket; };
    return {
      with_data: frame.filter(function (r) { return r.new_hiv_infections != null; }).length,
      covered_infections: total(function (r) { return r.covered; }),
      scope_infections: total(function () { return true; }),
      covered_without_data: frame.filter(function (r) { return r.covered && r.new_hiv_infections == null; }).length,
      bucket_covered_infections: total(function (r) { return r.covered && inBucket(r); }),
      bucket_scope_infections: total(inBucket),
    };
  }

  /* Percentage string, or an em dash when the denominator is empty. */
  function share(numerator, denominator) {
    if (!denominator) return '—';
    return round1(100 * numerator / denominator).toFixed(1) + '%';
  }

  /* One decimal, ties to even (6.25 -> 6.2, 6.35 -> 6.4), as Python and pandas
   * round in the private dashboard; JavaScript's own rounding would give 6.3
   * and the two dashboards would disagree on figures such as 3/48. */
  function round1(x) {
    var t = x * 10, f = Math.floor(t);
    var r = (t - f === 0.5) ? (f % 2 === 0 ? f : f + 1) : Math.round(t);
    return r / 10;
  }

  /* Covered / in-scope / % by region or income group, live. */
  function breakdown(frame, dimension) {
    var m = {};
    frame.forEach(function (r) {
      var k = r[dimension];
      if (!m[k]) m[k] = { key: k, covered: 0, in_scope: 0 };
      m[k].in_scope += 1;
      if (r.covered) m[k].covered += 1;
    });
    return Object.keys(m).map(function (k) {
      var g = m[k];
      g.pct = round1(100 * g.covered / g.in_scope);
      return g;
    }).sort(function (a, b) { return b.covered - a.covered; });
  }

  // ------------------------------------------------------------------------ //
  // Country detail
  // ------------------------------------------------------------------------ //

  /* Everything known about one country, for the lookup panel. */
  function countryDetail(ds, iso3) {
    var country = ds.countryByIso[iso3];
    if (!country) return null;
    return {
      country: country,
      statuses: ds.licences.map(function (l) {
        var s = ds.statusOf(iso3, l.code);
        return { licence: l.code, covered: s.covered, basis: s.basis, royalty_rate: s.royalty_rate,
                 coverage_label: coverageLabel(s.covered, s.basis, true) };
      }),
    };
  }

  /* iso3 + country for the search box, alphabetical by name. */
  function searchIndex(ds) {
    return ds.countries.map(function (c) { return { iso3: c.iso3, country: c.country }; })
      .sort(function (a, b) { return cmp(a.country, b.country); });
  }

  function uniq(xs) { return xs.filter(function (x, i) { return xs.indexOf(x) === i; }); }
  // Python's sort is by code point; match it so legend and list order agree with the private dashboard.
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  var api = {
    NOT_COVERED: NOT_COVERED, COVERED: COVERED, LMIC: LMIC, ROYALTY_SUFFIX: ROYALTY_SUFFIX,
    MAX_OVERLAY: MAX_OVERLAY, MODE_COMBINATION: MODE_COMBINATION, MODE_DEPTH: MODE_DEPTH,
    MODE_ANY: MODE_ANY, MODE_ALL: MODE_ALL, NONE_LABEL: NONE_LABEL, OTHER_LABEL: OTHER_LABEL,
    filterCountries: filterCountries, coverageLabel: coverageLabel, labelRank: labelRank,
    orderedLabels: orderedLabels, licenceFrame: licenceFrame, countriesBehind: countriesBehind,
    combinationLabel: combinationLabel, overlayFrame: overlayFrame, combinationCounts: combinationCounts,
    overlayLabelDepths: overlayLabelDepths, orderedOverlayLabels: orderedOverlayLabels,
    depthTierOptions: depthTierOptions, headlineCounts: headlineCounts, impactCounts: impactCounts,
    share: share, round1: round1, breakdown: breakdown, countryDetail: countryDetail, searchIndex: searchIndex,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LapalCoverage = api;
})(typeof window !== 'undefined' ? window : globalThis);
