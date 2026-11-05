const { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const IMG_RE = /\.(jpe?g|png|webp)$/i;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
let win;

// Packaged builds keep panels in the user's profile (downloaded on first launch, never shipped in the installer).
function mangaDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'manga_bg')
    : path.join(__dirname, '..', 'assets', 'manga_bg');
}

function listManga() {
  if (process.env.USL_NO_MANGA) return [];
  try {
    return fs.readdirSync(mangaDir())
      .filter((f) => IMG_RE.test(f))
      .map((f) => pathToFileURL(path.join(mangaDir(), f)).href);
  } catch (_) { return []; }
}

function ensureManga() {
  if (process.env.USL_NO_MANGA || listManga().length >= 10) return;
  try {
    const { fetchManga } = require('../scripts/fetch-manga.js');
    fetchManga(mangaDir()).then(() => {
      if (win && !win.isDestroyed() && listManga().length) win.webContents.send('assets:ready');
    }).catch(() => {});
  } catch (_) { /* offline or missing script: CSS screentones remain */ }
}

function cliFile() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  return args.find((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile()) || null;
}

function createWindow() {
  const [sw, sh] = (process.env.USL_SIZE || '1400x880').split('x').map(Number);
  win = new BrowserWindow({
    width: sw || 1400,
    height: sh || 880,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    backgroundColor: '#0a0a0a',
    title: 'USL ACSII',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:state', true));
  win.on('unmaximize', () => win.webContents.send('win:state', false));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Test hook: capture a screenshot then quit (used for automated verification).
  if (process.env.USL_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.USL_EVAL) {
          try {
            const r = await win.webContents.executeJavaScript(fs.readFileSync(process.env.USL_EVAL, 'utf8'));
            console.log('[eval]', JSON.stringify(r));
          } catch (err) { console.log('[eval-error]', err.message); }
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.USL_SCREENSHOT, img.toPNG());
        app.quit();
      }, Number(process.env.USL_SCREENSHOT_DELAY || 6000));
    });
  }
}

const lock = app.requestSingleInstanceLock();
if (!lock && !process.env.USL_SCREENSHOT) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    ipcMain.handle('assets:manga', () => listManga());

    ipcMain.handle('assets:font-base64', () => {
      try {
        return fs.readFileSync(path.join(__dirname, 'renderer', 'fonts', 'JetBrainsMono.ttf')).toString('base64');
      } catch (_) { return ''; }
    });

    ipcMain.handle('app:cli-file', () => {
      const f = cliFile();
      if (!f) return null;
      return { name: path.basename(f), data: fs.readFileSync(f) };
    });

    ipcMain.handle('dialog:open', async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'USL ACSII - choose an image or GIF',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const p = r.filePaths[0];
      return { name: path.basename(p), data: fs.readFileSync(p) };
    });

    ipcMain.handle('file:save', async (_e, { defaultName, filters, data }) => {
      // Test hook: write straight into a directory without showing the dialog.
      if (process.env.USL_SAVE_DIR) {
        const p = path.join(process.env.USL_SAVE_DIR, defaultName);
        fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data));
        return { saved: true, path: p };
      }
      const r = await dialog.showSaveDialog(win, {
        title: 'USL ACSII - export',
        defaultPath: defaultName,
        filters,
      });
      if (r.canceled || !r.filePath) return { saved: false };
      fs.writeFileSync(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
      return { saved: true, path: r.filePath };
    });

    ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
    ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); });

    ipcMain.on('win:minimize', () => win && win.minimize());
    ipcMain.on('win:toggle-maximize', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
    ipcMain.on('win:close', () => win && win.close());

    createWindow();
    ensureManga();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
