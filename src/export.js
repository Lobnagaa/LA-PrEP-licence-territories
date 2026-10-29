/* PNG export. (The PowerPoint slide, slide.js, reuses the helpers below.)
 *
 * Layout, top to bottom: title; subtitle ("Long-Acting PrEP Generic
 * License(s) Coverage"); the time stamp; the map as it is on screen
 * (switched-off categories and a highlight included); the legend; the filters
 * and settings line; then, in a smaller font,
 * the coverage definition, the data sources and, whenever AMI is selected, the
 * AMI disclaimer; then LAPaL and MedsPaL, and a row "Coordinated by [MPP] ·
 * With support from [Unitaid, LEAP, ...]".
 *
 * How it is drawn: the map SVG (and each patterned legend swatch) is
 * serialised and drawn as an image; all text is drawn on the canvas, so it uses
 * the page's loaded PT Sans. An SVG drawn as an image cannot load web fonts,
 * which is why no text is put inside the SVG.
 */
(function (root) {
  'use strict';
  var Col = root.LapalColours;

  var WIDTH = 1200;   // logical px; the PNG is drawn at SCALE times this
  var SCALE = 2;
  var PAD = 40;
  var SW = { w: 26, h: 16 };  // legend swatch

  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function loadImage(svgText) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not draw the map for export')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });
  }

  function loadSrc(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Could not draw a logo for export')); };
      img.src = src;
    });
  }

  /* A standalone swatch: copies the category's pattern out of the map's <defs>. */
  function swatchSvg(cat, mapSvg, patternId, border) {
    var defs = '', fill = cat.fill;
    if (cat.pattern) {
      var p = mapSvg.querySelector('#' + patternId(cat.pattern.code));
      if (p) { defs = '<defs>' + new XMLSerializer().serializeToString(p) + '</defs>'; fill = 'url(#' + p.id + ')'; }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + SW.w * SCALE + '" height="' + SW.h * SCALE +
      '" viewBox="0 0 ' + SW.w + ' ' + SW.h + '">' + defs + '<rect x="0.5" y="0.5" width="' + (SW.w - 1) +
      '" height="' + (SW.h - 1) + '" fill="' + fill + '" stroke="' + border + '" stroke-width="0.6"/></svg>';
  }

  /* Word-wrap `text` to `maxW` with the context's current font. */
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  /* opts: {map: createMap() result, cats, hidden: Set, highlight: name|null,
   *        title, subtitle, summary, stamp, paragraphs: [{heading, text}], credit}
   * Resolves to a <canvas>. */
  function render(opts) {
    var font = css('--font-family', 'sans-serif');
    var ink = css('--lapal-ink', '#212529'), body = css('--lapal-body', '#3E3E3E'),
        soft = css('--lapal-ink-soft', '#707070'), rule = css('--lapal-hairline', '#E5E5E5'),
        bg = css('--page-bg', '#FFFFFF'), border = Col.token('--map-border') || '#707070';
    var inner = WIDTH - 2 * PAD;
    var lg = opts.logos || { main: [], coordinator: [], support: [] };
    var allLogos = lg.main.concat(lg.coordinator, lg.support);
    var mapH = Math.round(inner * opts.map.height / opts.map.width);

    var mapClone = opts.map.svg.cloneNode(true);
    mapClone.setAttribute('width', inner * SCALE);
    mapClone.setAttribute('height', mapH * SCALE);
    var shown = opts.cats.list.filter(function (c) { return !c.none && !opts.hidden.has(c.label); });
    var hiddenLabels = opts.cats.list.filter(function (c) { return !c.none && opts.hidden.has(c.label); })
      .map(function (c) { return c.label; });

    var fonts = document.fonts ? Promise.all([
      document.fonts.load('700 28px ' + font), document.fonts.load('15px ' + font)]).catch(function () {}) : Promise.resolve();
    return fonts.then(function () {
      return Promise.all([loadImage(new XMLSerializer().serializeToString(mapClone))].concat(
        shown.map(function (c) { return loadImage(swatchSvg(c, opts.map.svg, opts.map.patternId, border)); }),
        allLogos.map(function (l) { return loadSrc(l.src); })));
    }).then(function (imgs) {
      var mapImg = imgs[0], swatches = imgs.slice(1, 1 + shown.length), logoImgs = imgs.slice(1 + shown.length);
      var imgOf = {};
      allLogos.forEach(function (l, i) { imgOf[l.id] = logoImgs[i]; });
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');

      // Pass 1 measures, pass 2 draws: the height depends on how the text wraps.
      function pass(draw) {
        var y = PAD;
        function text(str, size, colour, weight, gap) {
          ctx.font = (weight || '400') + ' ' + size + 'px ' + font;
          wrap(ctx, str, inner).forEach(function (line) {
            if (draw) { ctx.fillStyle = colour; ctx.fillText(line, PAD, y + size); }
            y += Math.round(size * 1.35);
          });
          y += gap || 0;
        }
        text(opts.title, 28, ink, '700', 4);
        text(opts.subtitle, 17, body, '400', 0);
        text(opts.stamp, 13, soft, '400', 14);

        if (draw) ctx.drawImage(mapImg, PAD, y, inner, mapH);
        y += mapH + 12;

        // Legend: swatch, label, count; wraps onto new rows.
        ctx.font = '400 15px ' + font;
        var x = PAD, rowH = 24;
        shown.forEach(function (c, i) {
          var label = c.label + '  ' + c.count;
          var w = SW.w + 8 + ctx.measureText(label).width + 22;
          if (x + w > PAD + inner && x > PAD) { x = PAD; y += rowH; }
          if (draw) {
            ctx.drawImage(swatches[i], x, y + 2, SW.w, SW.h);
            ctx.fillStyle = ink; ctx.fillText(c.label, x + SW.w + 8, y + 15);
            var lw = ctx.measureText(c.label + '  ').width;
            ctx.fillStyle = soft; ctx.fillText(String(c.count), x + SW.w + 8 + lw, y + 15);
          }
          x += w;
        });
        y += rowH + 4;
        text(opts.summary, 14, body, '400', 2);
        text((opts.noneNote ? opts.noneNote + ' ' : '') + 'Numbers are country counts.' +
             (hiddenLabels.length ? ' Not shown on this map: ' + hiddenLabels.join(', ') + '.' : '') +
             (opts.highlight ? ' Highlighted: ' + opts.highlight + '.' : ''), 13, soft, '400', 10);

        if (draw) { ctx.fillStyle = rule; ctx.fillRect(PAD, y, inner, 1); }
        y += 12;
        opts.paragraphs.forEach(function (p) {
          text((p.heading ? p.heading + ': ' : '') + p.text, 13, body, '400', 6);
        });
        // An image cannot hold links, so the licence texts are written out in full.
        if ((opts.sources || []).length) {
          text('Licence texts:', 12, body, '700', 0);
          opts.sources.forEach(function (src) { text(src.label + ': ' + src.url, 11, body, '400', 0); });
          y += 6;
        }
        text(opts.credit, 12, soft, '400', 0);
        if (allLogos.length) {
          // A row of logos, all the same height, wrapping at the right edge.
          // Items are logos or labels ({label}).
          var row = function (items, LH) {
            var lx = PAD;
            ctx.font = '400 13px ' + font;
            items.forEach(function (it) {
              var w = it.label ? ctx.measureText(it.label).width : LH * it.w / it.h;
              if (lx + w > PAD + inner && lx > PAD) { lx = PAD; y += LH + 12; }
              if (draw) {
                if (it.label) { ctx.fillStyle = soft; ctx.fillText(it.label, lx, y + LH / 2 + 5); }
                else ctx.drawImage(imgOf[it.id], lx, y, w, LH);
              }
              lx += w + (it.label ? 12 : 24) + (it.gapAfter || 0);
            });
            y += LH;
          };
          y += 16;
          if (lg.main.length) { row(lg.main, 36); y += 16; }
          var partners = [];
          if (lg.coordinator.length) partners = partners.concat([{ label: 'Coordinated by' }], lg.coordinator);
          if (partners.length) partners[partners.length - 1] = Object.assign({}, partners[partners.length - 1], { gapAfter: 20 });
          if (lg.support.length) partners = partners.concat([{ label: 'With support from' }], lg.support);
          if (partners.length) row(partners, 26);
        }
        return y + PAD - 10;
      }

      var height = pass(false);
      canvas.width = WIDTH * SCALE;
      canvas.height = Math.ceil(height * SCALE);
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, WIDTH, height);
      ctx.textBaseline = 'alphabetic';
      pass(true);
      return canvas;
    });
  }

  /* Render and hand the PNG to the browser as a download. */
  function download(opts, filename) {
    return render(opts).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
          resolve(canvas);
        }, 'image/png');
      });
    });
  }

  root.LapalExport = { render: render, download: download,
                       helpers: { css: css, loadImage: loadImage, swatchSvg: swatchSvg } };
})(window);
