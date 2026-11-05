// Generates a small animated GIF (bouncing shaded sphere) for manual/automated testing.
// Usage: node test/make-sample-gif.js [out.gif]
const fs = require('fs');
const path = require('path');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const W = 320, H = 200, N = 24;
const out = process.argv[2] || path.join(require('os').tmpdir(), 'usl-sample.gif');
const enc = GIFEncoder();

for (let f = 0; f < N; f++) {
  const data = new Uint8ClampedArray(W * H * 4);
  const cx = 70 + ((W - 140) * f) / (N - 1);
  const cy = H / 2 + Math.sin((f / N) * Math.PI * 2) * 34;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      const ring = Math.abs(Math.hypot(x - W / 2, y - H / 2) - 90 - 8 * Math.sin(f / N * Math.PI * 2)) < 4;
      let v = 8 + (y / H) * 26;
      let r = v, g = v * 0.4, b = v * 0.5;
      if (ring) { r = 235; g = 235; b = 235; }
      if (d < 50) {
        const k = Math.max(0, 1 - Math.hypot(dx + 14, dy + 14) / 64);
        r = 60 + 195 * k; g = 10 + 200 * k * k; b = 30 + 220 * k * k;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const palette = quantize(data, 128);
  enc.writeFrame(applyPalette(data, palette), W, H, { palette, delay: 90, repeat: 0 });
}
enc.finish();
fs.writeFileSync(out, Buffer.from(enc.bytes()));
console.log('wrote', out);
