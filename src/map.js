/* World map and legend (SVG, d3-geo + topojson-client).
 *
 * Rendering only: it is given a frame (coverage.js) and its legend categories
 * (colours.js) and draws them. It computes no counts. Colours are written as
 * SVG attributes, not CSS classes, so the PNG export can serialise the SVG as
 * it is.
 *
 * Geometry assumptions (see tools/build.py): shapes carry `iso3` (or null when
 * the shape has no data row); a country with several shapes is merged into one;
 * Gibraltar and Tuvalu come as points. Countries whose shape is smaller than
 * SMALL_AREA on screen also get a dot, so that small islands such as Montserrat
 * or the Holy See stay visible and hoverable.
 *
 * Two-of-three groups (three licences overlaid) are marked by tint + pattern:
 * the missing licence's fade colour, with that licence's pattern drawn in its
 * full colour (option A, chosen at stage 2 for colour-blind readers).
 */
(function (root) {
  'use strict';
  var d3 = root.d3, topojson = root.topojson, Col = root.LapalColours;

  var WIDTH = 960;
  var SMALL_AREA = 6;  // square units of the 960-wide viewBox; 52 countries fall below it
  // One pattern per licence, by its row in the data (max 3 overlaid, so at most
  // 3 two-of-three groups exist). A fourth licence in the data would need a
  // fourth pattern here.
  var PATTERNS = ['diagonal', 'dots', 'horizontal'];

  function createMap(el, world, ds, opts) {
    opts = opts || {};
    var topo = world.topology;
    var geoms = topo.objects.countries.geometries;
    var groups = {};
    geoms.forEach(function (g) {
      if (g.properties.iso3) (groups[g.properties.iso3] = groups[g.properties.iso3] || []).push(g);
    });
    var countries = Object.keys(groups).map(function (iso) {
      return { type: 'Feature', id: iso, properties: { iso3: iso }, geometry: topojson.merge(topo, groups[iso]) };
    });
    var noData = geoms.filter(function (g) { return !g.properties.iso3; }).map(function (g) {
      return topojson.feature(topo, g);
    });

    var projection = d3.geoNaturalEarth1().fitWidth(WIDTH, { type: 'FeatureCollection', features: countries.concat(noData) });
    var path = d3.geoPath(projection);
    var b = path.bounds({ type: 'FeatureCollection', features: countries.concat(noData) });
    var HEIGHT = Math.ceil(b[1][1]);

    // Dots: countries with no shape (points) and countries too small to see.
    var dots = [];
    countries.forEach(function (f) {
      if (path.area(f) < SMALL_AREA) dots.push({ iso3: f.id, xy: largestPartCentroid(f, path) });
    });
    Object.keys(world.points || {}).forEach(function (iso) {
      dots.push({ iso3: iso, xy: projection(world.points[iso]) });
    });

    var svg = d3.select(el).append('svg')
      .attr('class', 'lapal-map').attr('viewBox', '0 0 ' + WIDTH + ' ' + HEIGHT)
      .attr('role', 'img').attr('aria-label', opts.ariaLabel || 'World map of licence coverage')
      .attr('xmlns', 'http://www.w3.org/2000/svg');
    var defs = svg.append('defs');
    svg.append('rect').attr('width', WIDTH).attr('height', HEIGHT).attr('fill', Col.token('--map-ocean') || '#FFFFFF');
    var gMap = svg.append('g');
    var border = Col.token('--map-border') || '#707070';
    var bw = parseFloat(Col.token('--map-border-width')) || 0.5;

    gMap.append('g').selectAll('path').data(noData).join('path')
      .attr('d', path).attr('fill', Col.token('--map-no-data') || '#F8F8F8')
      .attr('stroke', border).attr('stroke-width', bw)
      .on('mousemove', function (ev, f) { showTip(ev, '<b>' + esc(f.properties.name) + '</b><br>Not in the licence data'); })
      .on('mouseleave', hideTip);
    var countryPaths = gMap.append('g').selectAll('path').data(countries).join('path')
      .attr('d', path).attr('stroke', border).attr('stroke-width', bw).attr('stroke-linejoin', 'round');
    var dotR = parseFloat(Col.token('--map-small-dot-radius')) || 2.6;
    var dotMarks = gMap.append('g').selectAll('circle').data(dots).join('circle')
      .attr('cx', function (d) { return d.xy[0]; }).attr('cy', function (d) { return d.xy[1]; })
      .attr('r', dotR);

    var tip = d3.select(el).append('div').attr('class', 'lapal-tip').attr('role', 'tooltip').style('display', 'none');
    function showTip(ev, html) {
      var box = el.getBoundingClientRect();
      tip.html(html).style('display', 'block')
        .style('left', Math.min(ev.clientX - box.left + 14, box.width - 230) + 'px')
        .style('top', (ev.clientY - box.top + 14) + 'px');
    }
    function hideTip() { tip.style('display', 'none'); }

    var state = {};

    /* frame: rows from coverage.js; cats: from colours.categories;
     * hidden: Set of switched-off labels;
     * highlight: iso3 or null; tipLine(row): the coverage line for the tooltip. */
    function render(s) {
      state = s;
      var byIso = {};
      s.frame.forEach(function (r) { byIso[r.iso3] = r; });
      var off = Col.token('--map-switched-off') || '#FFFFFF';
      var recede = parseFloat(Col.token('--map-recede-opacity')) || 0.25;
      definePatterns(s.cats.list);

      function look(iso) {
        var row = byIso[iso];
        if (!row) return { fill: off, cat: null, row: null };  // outside the filters
        var cat = s.cats.styleOf(row);
        if (s.hidden.has(cat.label)) return { fill: off, cat: null, row: row };
        return { fill: cat.pattern ? 'url(#' + patternId(cat.pattern.code) + ')' : cat.fill, cat: cat, row: row };
      }
      function opacity(iso) { return s.highlight && s.highlight !== iso ? recede : 1; }

      countryPaths.each(function (f) {
        var l = look(f.id);
        d3.select(this).attr('fill', l.fill).attr('opacity', opacity(f.id));
      });
      // A dot is too small to carry a pattern: it keeps the tint and, for a
      // two-of-three group, is ringed in the missing licence's colour.
      dotMarks.each(function (d) {
        var l = look(d.iso3);
        var ring = l.cat && l.cat.pattern;
        d3.select(this).attr('fill', ring ? l.cat.fill : l.fill)
          .attr('stroke', ring ? l.cat.pattern.colour : border).attr('stroke-width', ring ? 1.2 : bw)
          .attr('opacity', opacity(d.iso3));
      });

      function hover(ev, iso) {
        var c = ds.countryByIso[iso], row = byIso[iso];
        var html = '<b>' + esc(c.country) + '</b><br>' + esc(c.region) + '<br>Income group: ' + esc(c.income_group) +
          '<br>' + (row ? esc(s.tipLine(row)) : 'Outside the current filters');
        showTip(ev, html);
      }
      countryPaths.on('mousemove', function (ev, f) { hover(ev, f.id); }).on('mouseleave', hideTip)
        .on('click', function (ev, f) { if (opts.onCountryClick) opts.onCountryClick(f.id); });
      dotMarks.on('mousemove', function (ev, d) { hover(ev, d.iso3); }).on('mouseleave', hideTip)
        .on('click', function (ev, d) { if (opts.onCountryClick) opts.onCountryClick(d.iso3); });
    }

    function patternId(code) { return 'lapal-pat-' + code; }
    function definePatterns(list) {
      var pats = list.filter(function (c) { return c.pattern; });
      var sel = defs.selectAll('pattern').data(pats, function (c) { return c.pattern.code; });
      sel.exit().remove();
      var p = sel.enter().append('pattern').merge(sel)
        .attr('id', function (c) { return patternId(c.pattern.code); })
        .attr('patternUnits', 'userSpaceOnUse').attr('width', 5).attr('height', 5);
      p.selectAll('*').remove();
      p.each(function (c) {
        var g = d3.select(this), col = c.pattern.colour;
        g.append('rect').attr('width', 5).attr('height', 5).attr('fill', c.fill);
        var kind = PATTERNS[c.pattern.index];
        if (kind === 'diagonal') {
          g.append('path').attr('d', 'M0,5 L5,0 M-1,1 L1,-1 M4,6 L6,4').attr('stroke', col).attr('stroke-width', 0.9);
        } else if (kind === 'dots') {
          g.append('circle').attr('cx', 2.5).attr('cy', 2.5).attr('r', 0.95).attr('fill', col);
        } else {
          g.append('path').attr('d', 'M0,2.5 L5,2.5').attr('stroke', col).attr('stroke-width', 0.9);
        }
      });
    }

    return { render: render, svg: svg.node(), patternId: patternId, width: WIDTH, height: HEIGHT };
  }

  /* Legend: one button per category; clicking switches it off and on. */
  function renderLegend(el, cats, s, map, onToggle) {
    var items = d3.select(el).selectAll('button').data(cats.list.filter(function (c) { return !c.none; }), function (c) { return c.label; });
    items.exit().remove();
    var enter = items.enter().append('button').attr('type', 'button').attr('class', 'lapal-legend-item');
    enter.append('svg').attr('class', 'swatch').attr('width', 22).attr('height', 14).attr('viewBox', '0 0 22 14');
    enter.append('span').attr('class', 'label');
    enter.append('span').attr('class', 'count');
    var all = enter.merge(items).order();
    all.classed('off', function (c) { return s.hidden.has(c.label); })
      .attr('aria-pressed', function (c) { return String(!s.hidden.has(c.label)); })
      .attr('title', function (c) { return (s.hidden.has(c.label) ? 'Show ' : 'Hide ') + c.label + ' on the map'; })
      .on('click', function (ev, c) { onToggle(c.label); });
    all.select('.label').text(function (c) { return c.label; });
    all.select('.count').text(function (c) { return c.count; });
    all.select('svg.swatch').each(function (c) {
      var g = d3.select(this); g.selectAll('*').remove();
      var fill = c.pattern ? 'url(#' + map.patternId(c.pattern.code) + ')' : c.fill;
      g.append('rect').attr('x', 1).attr('y', 1).attr('width', 20).attr('height', 12).attr('fill', fill)
        .attr('stroke', Col.token('--map-border') || '#707070').attr('stroke-width', 0.6);
    });
  }

  function largestPartCentroid(f, path) {
    var g = f.geometry;
    if (g.type !== 'MultiPolygon') return path.centroid(f);
    var best = null, bestA = -1;
    g.coordinates.forEach(function (poly) {
      var part = { type: 'Feature', geometry: { type: 'Polygon', coordinates: poly } };
      var a = path.area(part);
      if (a > bestA) { bestA = a; best = part; }
    });
    return path.centroid(best);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
  }

  root.LapalMap = { createMap: createMap, renderLegend: renderLegend, esc: esc };
})(window);
