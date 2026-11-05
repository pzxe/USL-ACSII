// Generates docs/screenshots/*.png by launching the real app (no manga art is shown).
// Usage: node scripts/take-screenshots.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const electron = require('electron');
const out = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });

const gif = path.join(os.tmpdir(), 'usl-sample.gif');
spawnSync(process.execPath, [path.join(root, 'test', 'make-sample-gif.js'), gif], { stdio: 'inherit' });

const setup = (charset, cols, color, extra = '') => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const set = (id, v, ev) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(ev || 'input')); };
  set('charset', '${charset}', 'change'); set('cols', ${cols});
  document.querySelector('#color-seg button[data-v="${color}"]').click();
  ${extra}
  await wait(900);
  return 'ok';
})()`;

const shots = [
  ['01-main-mono', setup('standard', 110, 'mono')],
  ['02-crimson-detailed', setup('detailed', 150, 'crimson', "set('contrast', 25);")],
  ['03-full-colour', setup('manga', 120, 'full')],
];

for (const [name, code] of shots) {
  const evalFile = path.join(os.tmpdir(), `usl-shot-${name}.js`);
  fs.writeFileSync(evalFile, code);
  const res = spawnSync(electron, [root, gif], {
    stdio: 'inherit',
    env: {
      ...process.env,
      USL_NO_MANGA: '1', USL_SIZE: '1600x1000', USL_EVAL: evalFile,
      USL_SCREENSHOT: path.join(out, name + '.png'), USL_SCREENSHOT_DELAY: '3800',
    },
  });
  console.log(name, res.status === 0 && fs.existsSync(path.join(out, name + '.png')) ? 'saved' : 'FAILED');
}
