// Generates build/icon.png and build/icon.ico (run: npx electron scripts/make-icon.js)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const DRAW = `
(async () => {
  await document.fonts.load('700 100px "Gothic"');
  await document.fonts.load('40px "Sfx"');
  const out = {};
  for (const size of ${JSON.stringify([...SIZES, 512])}) {
    const c = document.getElementById('c');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const k = size / 512;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.clearRect(0, 0, 512, 512);
    // ink plate
    g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, 512, 512);
    // crimson slash panel
    g.fillStyle = '#c9002b';
    g.beginPath(); g.moveTo(250, 0); g.lineTo(512, 0); g.lineTo(512, 512); g.lineTo(60, 512); g.closePath(); g.fill();
    // halftone dots over the slash
    g.fillStyle = 'rgba(10,10,10,0.55)';
    for (let y = 14; y < 512; y += 28) for (let x = 14 + ((y / 28) % 2) * 14; x < 512; x += 28) {
      const r = Math.max(0, 7.5 * (1 - (x + (512 - y)) / 900));
      if (r > 0.6) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    }
    // paper border
    g.strokeStyle = '#f5f5f5'; g.lineWidth = 26; g.strokeRect(13, 13, 486, 486);
    // gothic U with shadow
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = '700 400px "Gothic"';
    g.fillStyle = '#0a0a0a'; g.fillText('U', 268, 392);
    g.fillStyle = '#f5f5f5'; g.fillText('U', 256, 380);
    // ascii strip
    g.fillStyle = '#0a0a0a'; g.fillRect(40, 418, 432, 50);
    g.fillStyle = '#f5f5f5'; g.font = '40px "Sfx"'; g.fillText('A S C I I', 256, 456);
    out[size] = c.toDataURL('image/png');
  }
  return out;
})()`;

function ico(pngs) {
  const n = pngs.length;
  const header = Buffer.alloc(6 + 16 * n);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(n, 4);
  let offset = header.length;
  pngs.forEach(({ size, buf }, i) => {
    const o = 6 + 16 * i;
    header[o] = size >= 256 ? 0 : size; header[o + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, o + 4); header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(buf.length, o + 8); header.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await win.loadFile(path.join(__dirname, 'icon.html'));
  const out = await win.webContents.executeJavaScript(DRAW);
  const dir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(dir, { recursive: true });
  const toBuf = (d) => Buffer.from(d.split(',')[1], 'base64');
  fs.writeFileSync(path.join(dir, 'icon.png'), toBuf(out[512]));
  fs.writeFileSync(path.join(dir, 'icon.ico'), ico(SIZES.map((s) => ({ size: s, buf: toBuf(out[s]) }))));
  console.log('icon written to build/');
  app.quit();
});
