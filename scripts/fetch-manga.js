#!/usr/bin/env node
/*
 * USL ACSII - automatic manga background fetcher.
 * Downloads 10-15 high-resolution dark / monochrome Tokyo Ghoul images
 * into assets/manga_bg/ using public image APIs (Wallhaven, Safebooru).
 * Runs automatically via the "prebuild"/"predist" npm hooks.
 * Fail-soft: never breaks the build; the app falls back to CSS screentones.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_OUT_DIR = path.join(__dirname, '..', 'assets', 'manga_bg');
const TARGET_MIN = 10;
const TARGET_MAX = 15;
const MAX_BYTES = 7 * 1024 * 1024;
const MIN_SIDE = 700;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) USL-ACSII/1.0';
const IMG_RE = /\.(jpe?g|png)$/i;

const SOURCES = [
  { type: 'safebooru', q: 'kaneki_ken monochrome' },
  { type: 'wallhaven', q: 'tokyo ghoul' },
  { type: 'safebooru', q: 'tokyo_ghoul greyscale' },
  { type: 'wallhaven', q: 'kaneki ken' },
  { type: 'safebooru', q: 'tokyo_ghoul comic monochrome' },
  { type: 'wallhaven', q: 'monochrome manga' },
  { type: 'safebooru', q: 'kaneki_ken' },
  { type: 'safebooru', q: 'tokyo_ghoul monochrome' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(opts.timeout || 45000),
      });
      if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

async function searchWallhaven(q) {
  const url = 'https://wallhaven.cc/api/v1/search?' + new URLSearchParams({
    q, categories: '010', purity: '100', sorting: 'relevance',
    atleast: '1280x720', order: 'desc',
  });
  const json = await (await http(url)).json();
  return (json.data || []).map((d) => ({
    id: 'wh-' + d.id, url: d.path, page: d.url, w: d.dimension_x, h: d.dimension_y,
    size: d.file_size, source: 'wallhaven',
  }));
}

async function searchSafebooru(q) {
  const tags = q.split(' ').concat(['rating:general']).join('+');
  const url = 'https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=60&tags=' + tags;
  const res = await http(url);
  const text = await res.text();
  if (!text.trim()) return [];
  const json = JSON.parse(text);
  return (Array.isArray(json) ? json : []).map((p) => ({
    id: 'sb-' + p.id,
    url: `https://safebooru.org/images/${p.directory}/${p.image}`,
    fallback: p.sample_url,
    page: `https://safebooru.org/index.php?page=post&s=view&id=${p.id}`,
    w: Number(p.width), h: Number(p.height), score: Number(p.score) || 0, source: 'safebooru',
    tags: p.tags,
  }));
}

async function download(item, dest) {
  const candidates = [item.url, item.fallback].filter(Boolean);
  for (const u of candidates) {
    if (!IMG_RE.test(u.split('?')[0])) continue;
    try {
      const res = await http(u, { timeout: 90000 });
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES || buf.length < 20000) continue;
      const ext = path.extname(u.split('?')[0]).toLowerCase().replace('jpeg', 'jpg');
      const file = dest + ext;
      fs.writeFileSync(file, buf);
      return { file, bytes: buf.length, url: u };
    } catch (_) { /* try next candidate */ }
  }
  return null;
}

async function main(OUT_DIR = DEFAULT_OUT_DIR) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const existing = fs.readdirSync(OUT_DIR).filter((f) => IMG_RE.test(f));
  if (existing.length >= TARGET_MIN) {
    console.log(`[fetch-manga] ${existing.length} images already present in assets/manga_bg - skipping.`);
    return;
  }

  const metaPath = path.join(OUT_DIR, 'sources.json');
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { /* fresh */ }
  const seen = new Set(meta.map((m) => m.id));

  console.log('[fetch-manga] Searching public image APIs...');
  const pools = [];
  for (const s of SOURCES) {
    try {
      const items = s.type === 'wallhaven' ? await searchWallhaven(s.q) : await searchSafebooru(s.q);
      const ok = items
        .filter((i) => Math.min(i.w, i.h) >= MIN_SIDE || Math.max(i.w, i.h) >= 1280)
        .filter((i) => !seen.has(i.id));
      if (s.type === 'safebooru') ok.sort((a, b) => (b.score || 0) - (a.score || 0));
      console.log(`  ${s.type.padEnd(9)} "${s.q}" -> ${ok.length} candidates`);
      pools.push(ok);
    } catch (e) {
      console.warn(`  ${s.type} "${s.q}" failed: ${e.message}`);
    }
    await sleep(400);
  }

  let count = existing.length;
  // Round-robin across queries for variety.
  let progressed = true;
  while (count < TARGET_MAX && progressed) {
    progressed = false;
    for (const pool of pools) {
      if (count >= TARGET_MAX) break;
      while (pool.length) {
        const item = pool.shift();
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        progressed = true;
        const name = `panel_${String(count + 1).padStart(2, '0')}_${item.id}`;
        const got = await download(item, path.join(OUT_DIR, name));
        if (got) {
          count++;
          meta.push({ id: item.id, file: path.basename(got.file), source: item.source, page: item.page, url: got.url, width: item.w, height: item.h });
          console.log(`  [${count}/${TARGET_MAX}] ${path.basename(got.file)} (${(got.bytes / 1024).toFixed(0)} KB)`);
          break;
        }
      }
    }
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  if (count < TARGET_MIN) {
    console.warn(`[fetch-manga] WARNING: only ${count} images downloaded (wanted >= ${TARGET_MIN}). App will fall back to CSS screentones where needed.`);
  } else {
    console.log(`[fetch-manga] Done. ${count} images in assets/manga_bg/`);
  }
}

module.exports = { fetchManga: main };

if (require.main === module) {
  main().catch((e) => {
    console.warn('[fetch-manga] Non-fatal error: ' + e.message);
  }).finally(() => process.exit(0));
}
