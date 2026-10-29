/* Colour assignment: which fill (and pattern) each legend category gets.
 *
 * Rendering-side only: it reads a frame from coverage.js and returns legend
 * categories; it never changes a count. The rules (PALETTE.md):
 *  - Single licence: its own colour. For a licence that records a basis (CAB),
 *    Direct (incl. "with royalties") takes ramp_direct and Indirect takes
 *    ramp_indirect, unless the reader merges them.
 *  - Overlay, combinations mode: a country covered by exactly one selected
 *    licence takes that licence's colour, whatever else is selected ("CAB
 *    only" is always CAB's colour). Covered by exactly two licences: that
 *    pair's own solid colour (--map-pair-CAB-LEN and so on), whether two or
 *    three are selected. Covered by all three: the overlap colour (green).
 *    Worked out from `covered_codes`, never by reading the label. A pair with
 *    no colour token (a new licence) falls back to PALETTE.md's rule: the fade
 *    colour of the licence it is missing, plus that licence's pattern.
 *  - ANY and ALL modes: covered = the overlap colour (green).
 *  - Break-out view: countries in other tiers take the "other" tone.
 *  - Not covered by any selected licence: the not-covered tone.
 */
(function (root) {
  'use strict';
  var C = root.LapalCoverage || (typeof require !== 'undefined' && require('./coverage.js'));

  /* Read a colour token from tokens.css, with the documented value as fallback
   * (the fallback is what Node tests and a page without the CSS get). */
  var FALLBACK = {
    '--map-overlap': '#5F7D36', '--map-not-covered': '#E5E5E5', '--map-other': '#9E9E9E',
    '--map-pair-CAB-LEN': '#7B4FD6', '--map-pair-CAB-AMI': '#E8D44D', '--map-pair-LEN-AMI': '#E07B00',
  };
  function token(name) {
    if (typeof document !== 'undefined') {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    }
    return FALLBACK[name];
  }

  /* view: {kind: 'single', licence, merge} or
   *       {kind: 'overlay', licences, mode, expandDepth}
   * Returns legend categories in legend order:
   *   [{label, fill, pattern, count}]  pattern is null or {code, index, colour}
   * plus `styleOf(row)` for the map. */
  function categories(ds, view, frame) {
    var counts = {};
    frame.forEach(function (r) { counts[r.coverage_label] = (counts[r.coverage_label] || 0) + 1; });
    var labels = view.kind === 'single'
      ? C.orderedLabels(frame.map(function (r) { return r.coverage_label; }))
      : C.orderedOverlayLabels(frame);

    // One representative row per label carries the covered_codes that decide its colour.
    var sample = {};
    frame.forEach(function (r) { if (!sample[r.coverage_label]) sample[r.coverage_label] = r; });

    var selected = view.kind === 'single' ? [view.licence]
      : ds.licences.map(function (l) { return l.code; })
          .filter(function (c) { return view.licences.indexOf(c) >= 0; });

    function styleFor(label) {
      if (label === C.NOT_COVERED || label === C.NONE_LABEL) return { fill: token('--map-not-covered'), pattern: null };
      if (label === C.OTHER_LABEL) return { fill: token('--map-other'), pattern: null };
      if (view.kind === 'single') {
        var lic = ds.licenceByCode[view.licence];
        if (label.indexOf('Indirect') >= 0 && lic.ramp_indirect) return { fill: lic.ramp_indirect, pattern: null };
        if (label.indexOf('Direct') >= 0 && lic.ramp_direct) return { fill: lic.ramp_direct, pattern: null };
        return { fill: lic.colour, pattern: null };
      }
      if (view.mode === C.MODE_ANY || view.mode === C.MODE_ALL) return { fill: token('--map-overlap'), pattern: null };
      var codes = sample[label].covered_codes;
      if (codes.length === 1) return { fill: ds.licenceByCode[codes[0]].colour, pattern: null };
      if (codes.length === 2) {
        // Pair colour, named in data order (CAB-LEN, CAB-AMI, LEN-AMI).
        var pair = token('--map-pair-' + ds.licences.map(function (l) { return l.code; })
          .filter(function (c) { return codes.indexOf(c) >= 0; }).join('-'));
        if (pair) return { fill: pair, pattern: null };
      }
      if (codes.length === selected.length) return { fill: token('--map-overlap'), pattern: null };
      // Fallback for a pair with no colour of its own: the missing licence's tint and pattern.
      var missing = selected.filter(function (c) { return codes.indexOf(c) < 0; })[0];
      var m = ds.licenceByCode[missing];
      return { fill: m.fade_colour,
               pattern: { code: missing, index: ds.licences.indexOf(m), colour: m.colour } };
    }

    var cats = labels.map(function (label) {
      var s = styleFor(label);
      // `none`: the grey "not covered by any selected licence" group. It is drawn
      // on the map but left out of every legend; a footnote gives its count.
      return { label: label, fill: s.fill, pattern: s.pattern, count: counts[label] || 0,
               none: label === C.NOT_COVERED || label === C.NONE_LABEL };
    });
    var byLabel = {};
    cats.forEach(function (c) { byLabel[c.label] = c; });
    return { list: cats, styleOf: function (row) { return byLabel[row.coverage_label]; } };
  }

  var api = { categories: categories, token: token };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LapalColours = api;
})(typeof window !== 'undefined' ? window : globalThis);
