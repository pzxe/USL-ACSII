const assert = require('assert');
const E = require('../src/renderer/engine.js');

function makeRgba(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v.length > 3 ? v[3] : 255;
  }
  return d;
}

const base = { charset: 'standard', color: 'mono', contrast: 0, brightness: 0, invert: false };

// grid size keeps aspect ratio with cell aspect correction
assert.deepStrictEqual(E.gridSize(100, 100, 80), { cols: 80, rows: 40 });
assert.deepStrictEqual(E.gridSize(200, 100, 100), { cols: 100, rows: 25 });

// black -> lightest char, white -> densest char
const bw = makeRgba(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255]));
let f = E.convert(bw, 2, 1, base);
assert.strictEqual(f.lines[0], ' @');

// invert swaps them
f = E.convert(bw, 2, 1, { ...base, invert: true });
assert.strictEqual(f.lines[0], '@ ');

// manga blocks
f = E.convert(bw, 2, 1, { ...base, charset: 'manga' });
assert.strictEqual(f.lines[0], ' █');

// custom charset + single char fallback + empty fallback
f = E.convert(bw, 2, 1, { ...base, charset: 'custom', custom: 'ab' });
assert.strictEqual(f.lines[0], 'ab');
f = E.convert(bw, 2, 1, { ...base, charset: 'custom', custom: '' });
assert.strictEqual(f.lines[0], ' @');
f = E.convert(bw, 2, 1, { ...base, charset: 'custom', custom: '#' });
assert.strictEqual(f.lines[0], ' #');

// brightness shifts mid-grey toward denser chars
const grey = makeRgba(1, 1, () => [100, 100, 100]);
const dark = E.convert(grey, 1, 1, { ...base, brightness: -60 }).lines[0];
const bright = E.convert(grey, 1, 1, { ...base, brightness: 60 }).lines[0];
const set = E.resolveCharset('standard');
assert.ok(set.indexOf(bright) > set.indexOf(dark));

// contrast pushes values apart
const lo = makeRgba(1, 1, () => [90, 90, 90]);
const hiC = E.convert(lo, 1, 1, { ...base, contrast: 80 }).lines[0];
const loC = E.convert(lo, 1, 1, { ...base, contrast: 0 }).lines[0];
assert.ok(set.indexOf(hiC) <= set.indexOf(loC));

// transparency reads as empty
const clear = makeRgba(1, 1, () => [255, 255, 255, 0]);
assert.strictEqual(E.convert(clear, 1, 1, base).lines[0], ' ');

// full colour keeps source colour
const red = makeRgba(1, 1, () => [200, 10, 20]);
f = E.convert(red, 1, 1, { ...base, color: 'full' });
assert.deepStrictEqual(Array.from(f.fg), [200, 10, 20]);

// crimson mode: bright cells -> paper white, mid cells reddish
f = E.convert(bw, 2, 1, { ...base, color: 'crimson' });
assert.deepStrictEqual(Array.from(f.fg.slice(3, 6)), [245, 245, 245]);
assert.ok(f.fg[0] > f.fg[1] && f.fg[0] > f.fg[2]);

// html export: self-contained, escapes, animation
const frame = E.convert(makeRgba(2, 1, () => [255, 255, 255]), 2, 1, { ...base, charset: 'custom', custom: ' <&' });
const html = E.toHtml([{ frame, delay: 100 }], { fontBase64: 'AAAA' });
assert.ok(html.includes('&amp;'));
assert.ok(html.includes('data:font/ttf;base64,AAAA'));
assert.ok(!html.includes('<script'));
const anim = E.toHtml([{ frame, delay: 80 }, { frame, delay: 120 }], {});
assert.ok(anim.includes('<script>') && anim.includes('"d":120'));

// text export
assert.strictEqual(E.toText({ lines: ['ab', 'cd'] }), 'ab\ncd');

console.log('engine tests passed');
