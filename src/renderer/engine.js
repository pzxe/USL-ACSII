/* USL ACSII - ASCII conversion + rendering engine (browser + Node compatible). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AsciiEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Characters are ordered from lightest (sparse) to darkest/densest ink.
  const CHARSETS = {
    detailed: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
    standard: ' .:-=+*#%@',
    manga: ' ░▒▓█',
  };

  // Monospace cell geometry in em units (JetBrains Mono: 0.6em advance, line-height 1.2).
  const CELL_W = 0.6;
  const CELL_H = 1.2;
  const COLORS = {
    ink: '#0a0a0a',
    paper: '#f5f5f5',
    crimson: '#c9002b',
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function resolveCharset(name, custom) {
    let set = name === 'custom' ? (custom || '') : CHARSETS[name] || CHARSETS.standard;
    set = Array.from(set);
    if (set.length === 0) set = Array.from(CHARSETS.standard);
    if (set.length === 1) set = [' ', set[0]];
    return set;
  }

  function gridSize(srcW, srcH, cols) {
    cols = Math.max(1, Math.round(cols));
    const rows = Math.max(1, Math.round((cols * srcH) / srcW * (CELL_W / CELL_H)));
    return { cols, rows };
  }

  /**
   * Convert RGBA pixels (cols*rows) into an ASCII frame.
   * opts: {charset, custom, color: 'mono'|'crimson'|'full', contrast(-100..100),
   *        brightness(-100..100), invert(bool)}
   */
  function convert(rgba, cols, rows, opts) {
    const set = resolveCharset(opts.charset, opts.custom);
    const n = set.length;
    const contrast = clamp(Number(opts.contrast) || 0, -100, 100);
    const brightness = clamp(Number(opts.brightness) || 0, -100, 100);
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const add = brightness * 2.55;
    const color = opts.color || 'mono';
    const invert = !!opts.invert;
    const lines = new Array(rows);
    const fg = new Uint8ClampedArray(cols * rows * 3);
    const lum = new Uint8ClampedArray(cols * rows);

    const adj = (v) => clamp(factor * (v - 128) + 128 + add, 0, 255);

    for (let y = 0; y < rows; y++) {
      let line = '';
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const p = i * 4;
        const a = rgba[p + 3] / 255;
        // Composite over black so transparency reads as empty space.
        const r = adj(rgba[p] * a);
        const g = adj(rgba[p + 1] * a);
        const b = adj(rgba[p + 2] * a);
        let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (invert) l = 255 - l;
        lum[i] = l;
        const idx = Math.min(n - 1, Math.floor((l / 255) * n));
        line += set[idx];
        const q = i * 3;
        if (color === 'full') {
          fg[q] = invert ? 255 - r : r;
          fg[q + 1] = invert ? 255 - g : g;
          fg[q + 2] = invert ? 255 - b : b;
        } else if (color === 'crimson') {
          // Deep blood-red shadows rising to Kagune crimson, highlights flash paper white.
          const t = l / 255;
          if (t > 0.88) {
            fg[q] = 245; fg[q + 1] = 245; fg[q + 2] = 245;
          } else {
            const k = clamp(0.4 + t * 0.6, 0, 1);
            fg[q] = Math.round(201 * k + 20 * (1 - k));
            fg[q + 1] = Math.round(6 * k);
            fg[q + 2] = Math.round(43 * k + 6 * (1 - k));
          }
        } else {
          fg[q] = 245; fg[q + 1] = 245; fg[q + 2] = 245;
        }
      }
      lines[y] = line;
    }
    return { cols, rows, lines, fg, lum, color };
  }

  function toText(frame) {
    return frame.lines.join('\n');
  }

  const hex2 = (n) => (n < 16 ? '0' : '') + n.toString(16);
  const cellHex = (fg, i) => '#' + hex2(fg[i * 3]) + hex2(fg[i * 3 + 1]) + hex2(fg[i * 3 + 2]);

  // Group consecutive cells of equal color on a row: [{text, color}]
  function rowRuns(frame, y) {
    const runs = [];
    const line = Array.from(frame.lines[y]);
    let cur = null;
    for (let x = 0; x < frame.cols; x++) {
      const c = cellHex(frame.fg, y * frame.cols + x);
      if (cur && cur.color === c) cur.text += line[x];
      else { cur = { text: line[x], color: c }; runs.push(cur); }
    }
    return runs;
  }

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function frameToHtmlBody(frame) {
    const rows = [];
    for (let y = 0; y < frame.rows; y++) {
      if (frame.color === 'mono') {
        rows.push(esc(frame.lines[y]));
      } else {
        rows.push(rowRuns(frame, y).map((r) => `<span style="color:${r.color}">${esc(r.text)}</span>`).join(''));
      }
    }
    return rows.join('\n');
  }

  /**
   * Build a self-contained HTML document. frames: [{frame, delay}].
   * fontBase64: optional base64 TTF embedded for exact glyph spacing.
   */
  function toHtml(frames, opts) {
    opts = opts || {};
    const title = esc(opts.title || 'USL ACSII');
    const fontFace = opts.fontBase64
      ? `@font-face{font-family:"USL Mono";src:url(data:font/ttf;base64,${opts.fontBase64}) format("truetype");font-weight:100 800;}`
      : '';
    const monoColor = frames[0].frame.color === 'crimson' ? COLORS.crimson : COLORS.paper;
    const fixedColor = frames[0].frame.color === 'mono' ? `color:${monoColor};` : '';
    const animated = frames.length > 1;
    const first = frameToHtmlBody(frames[0].frame);
    let script = '';
    if (animated) {
      const data = frames.map((f) => ({ h: frameToHtmlBody(f.frame), d: f.delay }));
      script = `<script>(function(){var F=${JSON.stringify(data).replace(/</g, '\\u003c')};var el=document.getElementById('art');var i=0;function step(){el.innerHTML=F[i].h;var d=F[i].d;i=(i+1)%F.length;setTimeout(step,d);}step();})();</script>`;
    }
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${fontFace}
html,body{margin:0;background:${COLORS.ink};min-height:100%;}
body{display:flex;justify-content:center;padding:24px;}
pre#art{margin:0;font-family:"USL Mono","JetBrains Mono","Cascadia Mono",Consolas,"Courier New",monospace;font-size:10px;line-height:1.2;letter-spacing:0;${fixedColor}white-space:pre;font-variant-ligatures:none;}
</style></head>
<body><pre id="art">${first}</pre>${script}
<!-- Generated by USL ACSII -->
</body></html>`;
  }

  /**
   * Draw a frame on a 2D canvas context. fs = font size in px.
   * Returns {width, height}. Caller sizes the canvas via measure().
   */
  function measure(frame, fs) {
    return { width: Math.ceil(frame.cols * CELL_W * fs), height: Math.ceil(frame.rows * CELL_H * fs) };
  }

  function draw(ctx, frame, fs, pad) {
    pad = pad || 0;
    const { width, height } = measure(frame, fs);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(0, 0, width + pad * 2, height + pad * 2);
    ctx.font = `${fs}px "JetBrains Mono", "Cascadia Mono", Consolas, monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const cw = CELL_W * fs;
    const ch = CELL_H * fs;
    for (let y = 0; y < frame.rows; y++) {
      const cy = pad + y * ch + ch / 2;
      if (frame.color === 'mono') {
        ctx.fillStyle = COLORS.paper;
        drawSpaced(ctx, Array.from(frame.lines[y]), pad, cy, cw);
      } else {
        const line = Array.from(frame.lines[y]);
        const fg = frame.fg;
        const base = y * frame.cols;
        let x = 0;
        while (x < frame.cols) {
          const q = (base + x) * 3;
          let e = x + 1;
          while (e < frame.cols) {
            const p = (base + e) * 3;
            if (fg[p] !== fg[q] || fg[p + 1] !== fg[q + 1] || fg[p + 2] !== fg[q + 2]) break;
            e++;
          }
          ctx.fillStyle = `rgb(${fg[q]},${fg[q + 1]},${fg[q + 2]})`;
          drawSpaced(ctx, line.slice(x, e), pad + x * cw, cy, cw);
          x = e;
        }
      }
    }
    return { width: width + pad * 2, height: height + pad * 2 };
  }

  // Place each glyph on the exact grid so canvas output matches the HTML/text layout.
  function drawSpaced(ctx, chars, x0, cy, cw) {
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch !== ' ') ctx.fillText(ch, x0 + i * cw, cy);
    }
  }

  return { CHARSETS, COLORS, CELL_W, CELL_H, resolveCharset, gridSize, convert, toText, toHtml, measure, draw };
});
