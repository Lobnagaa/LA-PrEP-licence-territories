/* PowerPoint export: one ready-to-present 16:9 slide (PptxGenJS).
 *
 * Layout: title and subtitle across the top; the map (as on screen,
 * switched-off categories and highlight included) on the left, with its legend
 * and then the settings line below; the headline figures down the right, with
 * LAPaL and MedsPaL under them; the coverage definition, licence texts and time stamp in small
 * type along the bottom. Data sources and the AMI disclaimer go in the speaker notes only.
 * The map, legend swatches and legend labels are grouped into one PowerPoint group
 * ("Map and legend"), so they move together.
 *
 * The map and the patterned legend swatches are pictures (PNG, drawn the same
 * way as the PNG export). Everything else is real PowerPoint text, so it can be
 * edited. Text uses Arial: PT Sans is not installed on most machines that will
 * open the file, and PowerPoint would substitute a font of its own choosing.
 */
(function (root) {
  'use strict';
  var X = root.LapalExport;

  var W = 13.333, H = 7.5, M = 0.45;     // slide size and margin, inches
  var FONT = 'Arial';
  var PX = 300;                          // pixels per inch for the pictures
  var GROUP = 'Map and legend: ';        // objectName prefix of the shapes grouped after writing

  function hex(c) { return String(c).replace('#', '').toUpperCase(); }

  /* SVG text -> PNG data URL at w x h inches. */
  function picture(svgText, w, h) {
    return X.helpers.loadImage(svgText).then(function (img) {
      var cv = document.createElement('canvas');
      cv.width = Math.round(w * PX); cv.height = Math.round(h * PX);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/png');
    });
  }

  /* opts: the PNG export options plus tiles (view.tiles()). Resolves to the
   * PptxGenJS presentation, ready for writeFile(). */
  function build(opts) {
    var css = X.helpers.css;
    var ink = hex(css('--lapal-ink', '#212529')), body = hex(css('--lapal-body', '#3E3E3E')),
        soft = hex(css('--lapal-ink-soft', '#707070')), rule = hex(css('--lapal-hairline', '#E5E5E5')),
        accent = hex(css('--lapal-accent', '#B53E8B'));
    var border = root.LapalColours.token('--map-border') || '#707070';

    var rightW = 3.0, gap = 0.35, colW = W - 2 * M - rightW - gap;
    var mapY = 1.25, notesY = 5.92, bandY = 7.02;   // bandY: "Coordinated by / With support from" logos
    var shown = opts.cats.list.filter(function (c) { return !c.none && !opts.hidden.has(c.label); });
    var hiddenLabels = opts.cats.list.filter(function (c) { return !c.none && opts.hidden.has(c.label); })
      .map(function (c) { return c.label; });
    var SW = { w: 0.3, h: 0.18 }, rowH = 0.28;

    // Legend positions first (left column width), so the map can shrink to leave room for them.
    var legend = [], lx = M, row = 0;
    shown.forEach(function (c) {
      var w = SW.w + 0.08 + (c.label + '  ' + c.count).length * 0.075 + 0.25;  // Arial 11pt: about 0.075 in a character
      if (lx + w > M + colW && lx > M) { lx = M; row++; }
      legend.push({ x: lx, row: row, w: w });
      lx += w;
    });
    var legendH = (row + 1) * rowH + 0.62;  // rows plus the settings line and the footnote
    var ratio = opts.map.height / opts.map.width;
    var mapH = Math.min(colW * ratio, notesY - 0.1 - mapY - 0.12 - legendH);
    var mapW = mapH / ratio;

    var mapClone = opts.map.svg.cloneNode(true);
    mapClone.setAttribute('width', Math.round(mapW * PX));
    mapClone.setAttribute('height', Math.round(mapH * PX));

    return Promise.all([picture(new XMLSerializer().serializeToString(mapClone), mapW, mapH)].concat(
      shown.map(function (c) {
        return picture(X.helpers.swatchSvg(c, opts.map.svg, opts.map.patternId, border), SW.w, SW.h);
      }))).then(function (pics) {
      var pptx = new root.PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';   // 13.333 x 7.5 in
      pptx.title = opts.title;
      pptx.company = 'LAPaL';
      var s = pptx.addSlide();
      s.background = { color: 'FFFFFF' };

      // One line: shrink the type for long titles (Arial bold averages about 0.55 em a character).
      var titlePt = Math.max(16, Math.min(26, Math.floor((W - 2 * M) * 72 / (opts.title.length * 0.55))));
      s.addText(opts.title, { x: M, y: 0.3, w: W - 2 * M, h: 0.55, fontFace: FONT, fontSize: titlePt,
        bold: true, color: ink, margin: 0, valign: 'top' });
      s.addText(opts.subtitle, { x: M, y: 0.85, w: W - 2 * M, h: 0.3, fontFace: FONT, fontSize: 14,
        color: body, margin: 0, valign: 'top' });

      s.addImage({ data: pics[0], x: M, y: mapY, w: mapW, h: mapH, altText: opts.title, objectName: GROUP + 'map' });

      // Legend under the map: swatch, label, count.
      var ly = mapY + mapH + 0.12;
      shown.forEach(function (c, i) {
        var p = legend[i], y = ly + p.row * rowH;
        s.addImage({ data: pics[i + 1], x: p.x, y: y + 0.04, w: SW.w, h: SW.h, objectName: GROUP + 'swatch ' + (i + 1) });
        s.addText([{ text: c.label + '  ', options: { color: ink } }, { text: String(c.count), options: { color: soft } }],
          { x: p.x + SW.w + 0.08, y: y, w: p.w - SW.w - 0.08, h: 0.26, fontFace: FONT, fontSize: 11, margin: 0, valign: 'middle',
            objectName: GROUP + 'label ' + (i + 1) });
      });
      var y = ly + (row + 1) * rowH;
      s.addText(opts.summary, { x: M, y: y, w: colW, h: 0.25, fontFace: FONT, fontSize: 11, color: body, margin: 0, valign: 'top' });
      y += 0.25;
      s.addText((opts.noneNote ? opts.noneNote + ' ' : '') + 'Numbers are country counts.' +
        (hiddenLabels.length ? ' Not shown on this map: ' + hiddenLabels.join(', ') + '.' : '') +
        (opts.highlight ? ' Highlighted: ' + opts.highlight + '.' : ''),
        { x: M, y: y, w: colW, h: 0.32, fontFace: FONT, fontSize: 9, color: soft, margin: 0, valign: 'top' });

      // Headline figures, stacked down the right.
      var tx = W - M - rightW, ty = mapY, th = 1.0;
      opts.tiles.forEach(function (t) {
        s.addShape(pptx.ShapeType.rect, { x: tx, y: ty, w: rightW, h: 0.04, fill: { color: accent }, line: { color: accent, width: 0 } });
        var runs = [
          { text: t.label, options: { fontSize: 10, color: soft, breakLine: true } },
          { text: t.value, options: { fontSize: 24, bold: true, color: ink, breakLine: true } },
          { text: t.sub, options: { fontSize: 9, color: soft, breakLine: !!t.world } },
        ];
        if (t.world) runs.push({ text: t.world.value + ' ' + t.world.label, options: { fontSize: 9, color: soft } });
        s.addText(runs, { x: tx, y: ty + 0.08, w: rightW, h: th - 0.18, fontFace: FONT, margin: 0, valign: 'top' });
        ty += th;
      });

      // LAPaL and MedsPaL in one row under the figures, same height, shrunk to fit the column.
      var lg = opts.logos || { main: [], coordinator: [], support: [] };
      var logos = lg.main;
      if (logos.length) {
        var LH = 0.42, lgap = 0.18;
        var total = logos.reduce(function (a, l) { return a + LH * l.w / l.h; }, 0) + lgap * (logos.length - 1);
        var k = Math.min(1, rightW / total), lx2 = tx;
        logos.forEach(function (l) {
          var w = LH * k * l.w / l.h;
          s.addImage({ data: l.src, x: lx2, y: notesY - 0.12 - LH * k, w: w, h: LH * k, altText: l.name });
          lx2 += w + lgap * k;
        });
      }

      // Notes along the bottom.
      var notes = opts.paragraphs.filter(function (p) { return !p.notesOnly; }).map(function (p) {
        return { text: (p.heading ? p.heading + ': ' : '') + p.text, options: { breakLine: true } };
      });
      // Licence texts as clickable labels; the full URLs are in the speaker notes.
      if ((opts.sources || []).length) {
        notes.push({ text: 'Licence texts: ', options: { bold: true } });
        opts.sources.forEach(function (src, i) {
          notes.push({ text: src.label + ' (PDF)', options: { hyperlink: { url: src.url, tooltip: src.url }, color: accent } });
          notes.push({ text: i < opts.sources.length - 1 ? ' · ' : '', options: { breakLine: i === opts.sources.length - 1 } });
        });
      }
      notes.push({ text: opts.stamp + ' · ' + opts.credit, options: { color: soft } });
      s.addShape(pptx.ShapeType.line, { x: M, y: notesY, w: W - 2 * M, h: 0, line: { color: rule, width: 0.75 } });
      // Partner band: "Coordinated by [MPP]   With support from [...]", one row, same height.
      var BH = 0.26, bx = M;
      function label(t) {
        var w = t.length * 0.055 + 0.05;   // Arial 8pt: about 0.055 in a character
        s.addText(t, { x: bx, y: bandY, w: w, h: BH, fontFace: FONT, fontSize: 8, color: soft, margin: 0, valign: 'middle' });
        bx += w + 0.06;
      }
      function logo(l) {
        var w = BH * l.w / l.h;
        var img = { data: l.src, x: bx, y: bandY, w: w, h: BH, altText: l.name };
        if (l.id === 'mpp') img.hyperlink = { url: 'https://medicinespatentpool.org', tooltip: 'Medicines Patent Pool' };
        s.addImage(img);
        bx += w + 0.16;
      }
      if (lg.coordinator.length) { label('Coordinated by'); lg.coordinator.forEach(logo); bx += 0.2; }
      if (lg.support.length) { label('With support from'); lg.support.forEach(logo); }

      s.addText(notes, { x: M, y: notesY + 0.08, w: W - 2 * M, h: bandY - notesY - 0.14, fontFace: FONT, fontSize: 8,
        color: body, margin: 0, valign: 'top', paraSpaceAfter: 2 });
      s.addNotes(speakerNotes(opts));
      return pptx;
    });
  }

  /* Speaker notes: what the slide shows, and every source with its full URL. */
  function speakerNotes(opts) {
    var lines = [opts.title, opts.subtitle, opts.summary, ''];
    if ((opts.sources || []).length) {
      lines.push('Licence texts:');
      opts.sources.forEach(function (src) { lines.push('- ' + src.label + ': ' + src.url); });
      lines.push('');
    }
    opts.paragraphs.forEach(function (p) { lines.push((p.heading ? p.heading + ': ' : '') + p.text); });
    lines.push('', opts.stamp, opts.credit + ' (https://lapal.ch)');
    return lines.join('\n');
  }

  /* PptxGenJS cannot group shapes, so the written file is patched: every shape whose name starts
   * with GROUP is moved, in order, into one <p:grpSp> spanning their bounding box. */
  function groupShapes(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    var P = 'http://schemas.openxmlformats.org/presentationml/2006/main',
        A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    var tree = doc.getElementsByTagNameNS(P, 'spTree')[0];
    var members = Array.prototype.filter.call(tree.children, function (n) {
      var c = n.getElementsByTagNameNS(P, 'cNvPr')[0];
      return c && (c.getAttribute('name') || '').indexOf(GROUP) === 0;
    });
    if (members.length < 2) return xml;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, maxId = 0;
    Array.prototype.forEach.call(tree.getElementsByTagNameNS(P, 'cNvPr'), function (c) { maxId = Math.max(maxId, +c.getAttribute('id') || 0); });
    members.forEach(function (n) {
      var off = n.getElementsByTagNameNS(A, 'off')[0], ext = n.getElementsByTagNameNS(A, 'ext')[0];
      var x = +off.getAttribute('x'), y = +off.getAttribute('y');
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + +ext.getAttribute('cx')); y1 = Math.max(y1, y + +ext.getAttribute('cy'));
    });
    var box = 'x="' + x0 + '" y="' + y0 + '"', size = 'cx="' + (x1 - x0) + '" cy="' + (y1 - y0) + '"';
    var grp = new DOMParser().parseFromString(
      '<p:grpSp xmlns:p="' + P + '" xmlns:a="' + A + '"><p:nvGrpSpPr><p:cNvPr id="' + (maxId + 1) + '" name="Map and legend"/>' +
      '<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off ' + box + '/><a:ext ' + size + '/>' +
      '<a:chOff ' + box + '/><a:chExt ' + size + '/></a:xfrm></p:grpSpPr></p:grpSp>', 'application/xml').documentElement;
    grp = doc.importNode(grp, true);
    tree.insertBefore(grp, members[0]);
    members.forEach(function (n) { grp.appendChild(n); });
    return new XMLSerializer().serializeToString(doc);
  }

  /* The finished .pptx as a Blob, with the map and legend grouped. */
  function toBlob(pptx) {
    return pptx.write({ outputType: 'arraybuffer' }).then(function (buf) { return root.JSZip.loadAsync(buf); })
      .then(function (zip) {
        var name = 'ppt/slides/slide1.xml';
        return zip.file(name).async('string').then(function (xml) {
          zip.file(name, groupShapes(xml));
          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
        });
      });
  }

  function download(opts, filename) {
    return build(opts).then(toBlob).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = /\.pptx$/i.test(filename) ? filename : filename + '.pptx';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }

  root.LapalSlide = { build: build, toBlob: toBlob, download: download };
})(window);
