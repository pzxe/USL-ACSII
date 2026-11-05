/* USL ACSII - renderer */
(function () {
  'use strict';
  const E = window.AsciiEngine;
  const $ = (id) => document.getElementById(id);
  const usl = window.usl;

  const MAX_GIF_FRAMES = 400;
  const GIF_FRAME_MAX_SIDE = 800;
  const STATIC_MAX_SIDE = 2400;
  const SETTINGS_KEY = 'usl.settings.v1';

  const DEFAULTS = { charset: 'standard', custom: ' .oO@', cols: 100, color: 'mono', contrast: 0, brightness: 0, invert: false };
  const settings = Object.assign({}, DEFAULTS, safeParse(localStorage.getItem(SETTINGS_KEY)));

  const els = {
    charset: $('charset'), custom: $('custom-chars'), cols: $('cols'), contrast: $('contrast'),
    brightness: $('brightness'), invert: $('invert'), preview: $('charset-preview'),
    origCanvas: $('orig-canvas'), asciiCanvas: $('ascii-canvas'), origBody: $('orig-body'), asciiBody: $('ascii-body'),
    status: $('status'), frameCount: $('frame-count'), play: $('play'), toast: $('toast'),
  };

  let media = null; // {name, base, width, height, frames:[{bitmap, delay}], animated}
  let frameIdx = 0;
  let playing = true;
  let lastSwitch = 0;
  let dirty = true;
  let settingsVersion = 0;
  let exporting = false;
  const sampleCache = new Map();
  const frameCache = new Map();
  let fontB64 = null;

  function safeParse(s) { try { return JSON.parse(s) || {}; } catch (_) { return {}; } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextTick = () => new Promise((r) => setTimeout(r, 0));

  /* ---------------- toast / status ---------------- */
  let toastTimer;
  function toast(msg, err) {
    els.toast.textContent = msg;
    els.toast.classList.toggle('err', !!err);
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), err ? 4200 : 2200);
  }
  function setStatus(msg, err) { els.status.textContent = msg; els.status.classList.toggle('err', !!err); }

  /* ---------------- decoding ---------------- */
  function sniff(u8) {
    const s = (a, b) => String.fromCharCode(...u8.slice(a, b));
    if (s(0, 4) === 'GIF8') return 'image/gif';
    if (u8[0] === 0x89 && s(1, 4) === 'PNG') return 'image/png';
    if (u8[0] === 0xff && u8[1] === 0xd8) return 'image/jpeg';
    if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'image/webp';
    return null;
  }

  function scaledSize(w, h, maxSide) {
    const k = Math.min(1, maxSide / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  async function decodeMedia(name, buf) {
    const u8 = new Uint8Array(buf);
    const type = sniff(u8);
    if (!type) throw new Error('Unsupported file. Use PNG, JPG, WEBP or GIF.');
    const base = name.replace(/\.[^.]+$/, '') || 'usl-acsii';

    if ((type === 'image/gif' || type === 'image/webp') && 'ImageDecoder' in window) {
      try {
        const dec = new ImageDecoder({ data: u8, type });
        await dec.tracks.ready;
        const count = dec.tracks.selectedTrack.frameCount;
        if (count > 1) {
          const frames = [];
          let W = 0, H = 0;
          const n = Math.min(count, MAX_GIF_FRAMES);
          for (let i = 0; i < n; i++) {
            const { image } = await dec.decode({ frameIndex: i, completeFramesOnly: true });
            if (i === 0) { W = image.displayWidth; H = image.displayHeight; }
            const sz = scaledSize(W, H, GIF_FRAME_MAX_SIDE);
            const bitmap = await createImageBitmap(image, { resizeWidth: sz.w, resizeHeight: sz.h, resizeQuality: 'high' });
            let delay = image.duration ? image.duration / 1000 : 100;
            if (delay <= 10) delay = 100;
            frames.push({ bitmap, delay: Math.max(20, Math.round(delay)) });
            image.close();
            if (i % 8 === 7) setStatus(`Decoding frames ${i + 1}/${n}…`);
          }
          dec.close();
          return { name, base, width: W, height: H, frames, animated: true, type, total: count };
        }
        dec.close();
      } catch (e) {
        if (type === 'image/gif') console.warn('ImageDecoder failed, falling back to static', e);
      }
    }

    const blob = new Blob([u8], { type });
    const probe = await createImageBitmap(blob);
    const sz = scaledSize(probe.width, probe.height, STATIC_MAX_SIDE);
    const bitmap = sz.w === probe.width ? probe : await createImageBitmap(probe, { resizeWidth: sz.w, resizeHeight: sz.h, resizeQuality: 'high' });
    const W = probe.width, H = probe.height;
    if (bitmap !== probe) probe.close();
    return { name, base, width: W, height: H, frames: [{ bitmap, delay: 100 }], animated: false, type, total: 1 };
  }

  async function loadFromBuffer(name, buf) {
    try {
      setStatus('Decoding ' + name + '…');
      const m = await decodeMedia(name, buf);
      if (media) media.frames.forEach((f) => f.bitmap.close && f.bitmap.close());
      media = m;
      frameIdx = 0;
      lastSwitch = performance.now();
      sampleCache.clear();
      frameCache.clear();
      settingsVersion++;
      els.origBody.classList.add('has-media');
      els.asciiBody.classList.add('has-media');
      $('orig-dims').textContent = `${m.width}×${m.height} · ${m.type.split('/')[1].toUpperCase()}${m.animated ? ' · ' + m.frames.length + ' frames' : ''}`;
      $('file-info').innerHTML = `<b>${escapeHtml(name)}</b><br>${m.width}×${m.height}px${m.animated ? ' · animated, ' + m.frames.length + ' frames' : ''}`;
      const anyExport = ['ex-copy', 'ex-txt', 'ex-html', 'ex-png'];
      anyExport.forEach((id) => ($(id).disabled = false));
      $('ex-gif').disabled = !m.animated;
      $('ex-gif').title = m.animated ? 'Render every ASCII frame into an animated GIF' : 'Available when the input is an animated GIF';
      els.play.disabled = !m.animated;
      playing = true;
      updatePlayButton();
      dirty = true;
      setStatus(m.animated ? `Loaded ${name} — ${m.frames.length} frames${m.total > m.frames.length ? ' (capped from ' + m.total + ')' : ''}` : `Loaded ${name}`);
      if (m.total > m.frames.length) toast('GIF capped to ' + MAX_GIF_FRAMES + ' frames', true);
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), true);
      toast(e.message || 'Could not open file', true);
    }
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------------- conversion ---------------- */
  const scratch = document.createElement('canvas');
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

  function sampleBitmap(bitmap, w, h) {
    scratch.width = w; scratch.height = h;
    scratchCtx.fillStyle = '#000';
    scratchCtx.fillRect(0, 0, w, h);
    scratchCtx.imageSmoothingEnabled = true;
    scratchCtx.imageSmoothingQuality = 'high';
    // Step down by halves for cleaner averaging on large reductions.
    let src = bitmap, sw = bitmap.width, sh = bitmap.height;
    const temps = [];
    while (sw / 2 >= w && sh / 2 >= h) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(sw / 2)); c.height = Math.max(1, Math.floor(sh / 2));
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, c.width, c.height);
      src = c; sw = c.width; sh = c.height; temps.push(c);
    }
    scratchCtx.drawImage(src, 0, 0, w, h);
    return scratchCtx.getImageData(0, 0, w, h).data;
  }

  function convertOpts() {
    return { charset: settings.charset, custom: settings.custom, color: settings.color, contrast: settings.contrast, brightness: settings.brightness, invert: settings.invert };
  }

  function frameAscii(i) {
    const cached = frameCache.get(i);
    if (cached && cached.v === settingsVersion) return cached.frame;
    const { cols, rows } = E.gridSize(media.frames[0].bitmap.width, media.frames[0].bitmap.height, settings.cols);
    const key = i + ':' + cols + 'x' + rows;
    let px = sampleCache.get(key);
    if (!px) {
      px = sampleBitmap(media.frames[i].bitmap, cols, rows);
      if (sampleCache.size > 600) sampleCache.clear();
      sampleCache.set(key, px);
    }
    const frame = E.convert(px, cols, rows, convertOpts());
    frameCache.set(i, { v: settingsVersion, frame });
    return frame;
  }

  /* ---------------- rendering ---------------- */
  function bodyBox(body) {
    const r = body.getBoundingClientRect();
    return { w: Math.max(40, r.width - 24), h: Math.max(40, r.height - 24) };
  }

  function render() {
    if (!media) return;
    const dpr = window.devicePixelRatio || 1;
    const bm = media.frames[frameIdx].bitmap;

    // original
    {
      const box = bodyBox(els.origBody);
      const k = Math.min(box.w / bm.width, box.h / bm.height);
      const cw = Math.max(1, Math.floor(bm.width * k)), ch = Math.max(1, Math.floor(bm.height * k));
      const c = els.origCanvas;
      const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
      if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; c.style.width = cw + 'px'; c.style.height = ch + 'px'; }
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, bw, bh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(bm, 0, 0, bw, bh);
    }

    // ascii
    const frame = frameAscii(frameIdx);
    {
      const box = bodyBox(els.asciiBody);
      let fs = Math.floor(Math.min((box.w * dpr) / (frame.cols * E.CELL_W), (box.h * dpr) / (frame.rows * E.CELL_H)));
      fs = Math.max(3, Math.min(48, fs));
      const m = E.measure(frame, fs);
      const c = els.asciiCanvas;
      if (c.width !== m.width || c.height !== m.height) {
        c.width = m.width; c.height = m.height;
        c.style.width = m.width / dpr + 'px'; c.style.height = m.height / dpr + 'px';
      }
      E.draw(c.getContext('2d'), frame, fs, 0);
      $('ascii-dims').textContent = `${frame.cols}×${frame.rows} chars`;
    }
    els.frameCount.textContent = media.animated ? `FRAME ${frameIdx + 1}/${media.frames.length}` : '';
  }

  function tick(t) {
    requestAnimationFrame(tick);
    if (!media) return;
    if (playing && media.animated) {
      const d = media.frames[frameIdx].delay;
      if (t - lastSwitch >= d) {
        frameIdx = (frameIdx + 1) % media.frames.length;
        lastSwitch += d;
        if (t - lastSwitch > d) lastSwitch = t;
        dirty = true;
      }
    }
    if (dirty) { dirty = false; render(); }
  }

  function settingsChanged() {
    settingsVersion++;
    dirty = true;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    updateCharsetPreview();
  }

  function updateCharsetPreview() {
    els.preview.textContent = E.resolveCharset(settings.charset, settings.custom).join('').replace(/ /g, '\u00a0') || '';
  }

  function updatePlayButton() { els.play.innerHTML = playing ? '&#10074;&#10074;' : '&#9654;'; }

  /* ---------------- controls ---------------- */
  function setFill(input) {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--fill', ((input.value - min) / (max - min)) * 100 + '%');
  }

  function bindControls() {
    els.charset.value = settings.charset;
    els.custom.value = settings.custom;
    els.custom.hidden = settings.charset !== 'custom';
    ['cols', 'contrast', 'brightness'].forEach((k) => {
      const input = els[k];
      input.value = settings[k];
      setFill(input);
      $('v-' + k).textContent = settings[k];
      input.addEventListener('input', () => {
        settings[k] = Number(input.value);
        $('v-' + k).textContent = input.value;
        setFill(input);
        settingsChanged();
      });
    });
    els.invert.checked = settings.invert;
    els.invert.addEventListener('change', () => { settings.invert = els.invert.checked; settingsChanged(); });

    els.charset.addEventListener('change', () => {
      settings.charset = els.charset.value;
      els.custom.hidden = settings.charset !== 'custom';
      settingsChanged();
    });
    els.custom.addEventListener('input', () => { settings.custom = els.custom.value; settingsChanged(); });

    document.querySelectorAll('#color-seg button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === settings.color);
      b.addEventListener('click', () => {
        settings.color = b.dataset.v;
        document.querySelectorAll('#color-seg button').forEach((x) => x.classList.toggle('on', x === b));
        settingsChanged();
      });
    });

    $('reset-tone').addEventListener('click', () => {
      settings.contrast = 0; settings.brightness = 0; settings.invert = false;
      ['contrast', 'brightness'].forEach((k) => { els[k].value = 0; setFill(els[k]); $('v-' + k).textContent = '0'; });
      els.invert.checked = false;
      settingsChanged();
    });

    els.play.addEventListener('click', togglePlay);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
    });

    updateCharsetPreview();
  }

  function togglePlay() {
    if (!media || !media.animated) return;
    playing = !playing;
    lastSwitch = performance.now();
    updatePlayButton();
  }

  /* ---------------- file input / drag & drop ---------------- */
  function bindInput() {
    const dz = $('dropzone');
    const browse = async () => {
      const f = await usl.openDialog();
      if (f) loadFromBuffer(f.name, f.data.buffer ? f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) : f.data);
    };
    dz.addEventListener('click', browse);
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } });

    let depth = 0;
    const overlay = $('drop-overlay');
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; overlay.classList.add('show'); });
    window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('show'); });
    window.addEventListener('drop', async (e) => {
      e.preventDefault(); depth = 0; overlay.classList.remove('show');
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (file) loadFromBuffer(file.name, await file.arrayBuffer());
    });
    window.addEventListener('paste', async (e) => {
      const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (item) { const f = item.getAsFile(); loadFromBuffer(f.name || 'pasted-image.png', await f.arrayBuffer()); }
    });
  }

  /* ---------------- exports ---------------- */
  function progress(p, text) {
    const box = $('progress');
    box.hidden = p == null;
    if (p != null) { box.querySelector('i').style.width = Math.round(p * 100) + '%'; $('progress-text').textContent = text || ''; }
  }

  function setExportDisabled(dis) {
    exporting = dis;
    ['ex-copy', 'ex-txt', 'ex-html', 'ex-png', 'ex-gif'].forEach((id) => {
      $(id).disabled = dis || !media || (id === 'ex-gif' && !media.animated);
    });
  }

  async function save(defaultName, ext, label, data) {
    const r = await usl.saveFile({ defaultName, filters: [{ name: label, extensions: [ext] }], data });
    if (r.saved) { toast('SAVED ' + ext.toUpperCase()); setStatus('Saved ' + r.path); }
    return r.saved;
  }

  function currentAscii() { return frameAscii(frameIdx); }

  async function exCopy() {
    await usl.copyText(E.toText(currentAscii()));
    toast('COPIED TO CLIPBOARD');
  }
  async function exTxt() { await save(media.base + '.txt', 'txt', 'Text file', E.toText(currentAscii())); }

  async function allFrames(label) {
    const out = [];
    for (let i = 0; i < media.frames.length; i++) {
      out.push({ frame: frameAscii(i), delay: media.frames[i].delay });
      if (i % 4 === 3) { progress(i / media.frames.length, `${label} ${i + 1}/${media.frames.length}`); await nextTick(); }
    }
    return out;
  }

  async function exHtml() {
    setExportDisabled(true);
    try {
      if (fontB64 === null) fontB64 = await usl.getFontBase64();
      const frames = media.animated ? await allFrames('Building HTML') : [{ frame: currentAscii(), delay: 100 }];
      const html = E.toHtml(frames, { title: 'USL ACSII - ' + media.base, fontBase64: fontB64 });
      progress(null);
      await save(media.base + '.html', 'html', 'HTML file', html);
    } finally { progress(null); setExportDisabled(false); }
  }

  function renderToCanvas(frame, fs, pad) {
    const m = E.measure(frame, fs);
    const c = document.createElement('canvas');
    c.width = m.width + pad * 2; c.height = m.height + pad * 2;
    E.draw(c.getContext('2d', { willReadFrequently: true }), frame, fs, pad);
    return c;
  }

  async function exPng() {
    setExportDisabled(true);
    try {
      const frame = currentAscii();
      const fs = Math.max(14, Math.min(40, Math.ceil(2400 / (frame.cols * E.CELL_W))));
      const c = renderToCanvas(frame, fs, Math.round(fs * 2));
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const data = new Uint8Array(await blob.arrayBuffer());
      await save(media.base + '-ascii.png', 'png', 'PNG image', data);
    } finally { setExportDisabled(false); }
  }

  async function exGif() {
    setExportDisabled(true);
    try {
      const { GIFEncoder, quantize, applyPalette } = window.gifenc;
      const enc = GIFEncoder();
      const n = media.frames.length;
      const first = frameAscii(0);
      const fs = Math.max(6, Math.min(16, Math.floor(960 / (first.cols * E.CELL_W))));
      const pad = Math.round(fs);
      for (let i = 0; i < n; i++) {
        const c = renderToCanvas(frameAscii(i), fs, pad);
        const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        enc.writeFrame(index, c.width, c.height, { palette, delay: Math.max(20, media.frames[i].delay), repeat: 0 });
        progress((i + 1) / n, `Encoding GIF ${i + 1}/${n}`);
        await nextTick();
      }
      enc.finish();
      progress(null);
      await save(media.base + '-ascii.gif', 'gif', 'Animated GIF', enc.bytes());
    } catch (e) {
      console.error(e);
      toast('GIF export failed: ' + e.message, true);
    } finally { progress(null); setExportDisabled(false); }
  }

  function bindExports() {
    const wrap = (fn) => async () => {
      if (!media || exporting) return;
      try { await fn(); } catch (e) { console.error(e); toast('Export failed: ' + e.message, true); setStatus('Export failed: ' + e.message, true); }
    };
    $('ex-copy').addEventListener('click', wrap(exCopy));
    $('ex-txt').addEventListener('click', wrap(exTxt));
    $('ex-html').addEventListener('click', wrap(exHtml));
    $('ex-png').addEventListener('click', wrap(exPng));
    $('ex-gif').addEventListener('click', wrap(exGif));
  }

  /* ---------------- window chrome ---------------- */
  function bindChrome() {
    $('btn-min').addEventListener('click', () => usl.minimize());
    $('btn-max').addEventListener('click', () => usl.toggleMaximize());
    $('btn-close').addEventListener('click', () => usl.close());
    $('titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('.tb-controls')) usl.toggleMaximize(); });
    window.addEventListener('resize', () => { dirty = true; });
    new ResizeObserver(() => { dirty = true; }).observe($('stage'));
  }

  /* ---------------- manga assets ---------------- */
  function pick(arr, used) {
    const pool = arr.filter((x) => !used.has(x));
    const src = pool.length ? pool : arr;
    const v = src[Math.floor(Math.random() * src.length)];
    used.add(v);
    return v;
  }
  const cssUrl = (u) => `url("${u}")`;

  async function applyManga() {
    let list = [];
    try { list = await usl.getMangaImages(); } catch (_) { /* fall back to CSS only */ }
    if (!list.length) return;
    const used = new Set();
    $('splash-art').style.backgroundImage = cssUrl(pick(list, used));
    $('bg-texture').style.backgroundImage = cssUrl(pick(list, used));
    $('banner').style.backgroundImage = cssUrl(pick(list, used));
    const dz = $('dropzone');
    dz.style.setProperty('--dz-bg', cssUrl(pick(list, used)));
    dz.classList.add('has-bg');
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    bindControls();
    bindInput();
    bindExports();
    bindChrome();
    usl.onMangaReady(() => applyManga());
    requestAnimationFrame(tick);
    const started = performance.now();
    await Promise.all([applyManga(), document.fonts.load('16px "JetBrains Mono"').catch(() => {}), document.fonts.load('20px "Gothic"').catch(() => {})]);
    const wait = Math.max(0, 1900 - (performance.now() - started));
    setTimeout(() => $('splash').classList.add('done'), wait);

    const cli = await usl.getCliFile();
    if (cli) loadFromBuffer(cli.name, cli.data.buffer ? cli.data.buffer.slice(cli.data.byteOffset, cli.data.byteOffset + cli.data.byteLength) : cli.data);
    else setStatus('Drop an image or GIF to begin.');
  }

  boot();
})();
