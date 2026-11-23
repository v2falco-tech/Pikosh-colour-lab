(() => {
'use strict';

/* ---------- constants & helpers ---------- */
const W = 1654, H = 2339, M = 110;            // A4 at 200 dpi, page margin
const FONT = "'Fredoka','Comic Sans MS','Chalkboard SE',system-ui,sans-serif";
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) e.append(k instanceof Node ? k : document.createTextNode(k));
  return e;
}

let toastTimer;
function toast(msg, err = false, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.className = ''), ms);
}

/* ---------- settings ---------- */
let saved = {};
try { saved = JSON.parse(localStorage.getItem('cbm-settings') || '{}'); } catch (e) {}
const settings = { accessCode: '', aspect: '3:4', cleanBW: true, ...saved };
const saveSettings = () => { try { localStorage.setItem('cbm-settings', JSON.stringify(settings)); } catch (e) {} };

/* ---------- state ---------- */
const STYLES = {
  simple: ['Toddler – very thick lines, big simple shapes', 'very thick bold outlines, a few large simple shapes, minimal detail, suitable for toddlers'],
  medium: ['Kids – clear lines, moderate detail', 'clean medium-thick outlines, moderate detail, suitable for ages 4-8'],
  detailed: ['Older kids – detailed patterns', 'finer outlines with decorative patterns and richer detail, suitable for ages 8-12']
};
const state = {
  cover: { title: 'My Colouring Book', subtitle: 'Colouring & activities for little artists', author: '', description: '', theme: '#ff7a59', image: null, prompt: '', refs: [] },
  pages: [],
  sel: 'cover'
};

const TYPES = {
  ai: { label: 'AI colouring page', icon: '🎨', make: () => ({ title: '', prompt: '', style: 'simple', refs: [], img: null }) },
  photo: { label: 'Photo → outline (free, no AI)', icon: '📷', make: () => ({ title: '', src: null, threshold: 110, thick: 1 }) },
  maze: { label: 'Maze', icon: '🧩', make: () => ({ title: 'Find your way!', level: 'medium' }) },
  wordsearch: { label: 'Word search', icon: '🔤', make: () => ({ title: 'Word Search', words: 'CAT, DOG, SUN, TREE, FISH, BIRD', level: 'easy' }) },
  dots: { label: 'Dot-to-dot', icon: '🔢', make: () => ({ title: 'Join the dots!', shape: 'star', count: 20 }) },
  trace: { label: 'Tracing letters', icon: '✏️', make: () => ({ title: 'Trace the letters', text: 'Aa Bb Cc\nDd Ee Ff' }) },
  draw: { label: 'Draw-your-own', icon: '🖊️', make: () => ({ title: 'Draw your favourite animal!', hint: '' }) }
};

/* ---------- image utilities ---------- */
const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image failed to load')); i.src = src;
  }));
  return imgCache.get(src);
}

function fileToDataURL(file, maxDim = 1600) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('Could not read file'));
    fr.onload = () => {
      const i = new Image();
      i.onerror = () => rej(new Error('That file is not a readable image'));
      i.onload = () => {
        const s = Math.min(1, maxDim / Math.max(i.width, i.height));
        const c = document.createElement('canvas');
        c.width = Math.round(i.width * s); c.height = Math.round(i.height * s);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(i, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.9));
      };
      i.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function dataURLtoBlob(u) {
  const [m, b] = u.split(',');
  const mime = /:(.*?);/.exec(m)[1];
  const bin = atob(b); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
}

const cleanCache = new Map();
function cleanBW(img, key) {
  if (cleanCache.has(key)) return cleanCache.get(key);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height); const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = .299 * p[i] + .587 * p[i + 1] + .114 * p[i + 2];
    const v = l < 110 ? 0 : l > 200 ? 255 : (l - 110) / 90 * 255;
    p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  if (cleanCache.size > 30) cleanCache.clear();
  cleanCache.set(key, c);
  return c;
}

function toOutline(img, thr, thick) {
  const s = Math.min(1, 1400 / Math.max(img.width, img.height));
  const w = Math.max(3, Math.round(img.width * s)), hh = Math.max(3, Math.round(img.height * s));
  const c = document.createElement('canvas'); c.width = w; c.height = hh;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(img, 0, 0, w, hh);
  const d = x.getImageData(0, 0, w, hh);
  const g = new Float32Array(w * hh);
  for (let i = 0; i < g.length; i++) g[i] = .299 * d.data[i * 4] + .587 * d.data[i * 4 + 1] + .114 * d.data[i * 4 + 2];
  const b = new Float32Array(g.length);               // 3x3 box blur
  for (let y = 0; y < hh; y++) for (let xx = 0; xx < w; xx++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= hh) continue;
      for (let dx = -1; dx <= 1; dx++) { const xq = xx + dx; if (xq < 0 || xq >= w) continue; sum += g[yy * w + xq]; n++; } }
    b[y * w + xx] = sum / n;
  }
  let edge = new Uint8Array(w * hh);                  // Sobel
  for (let y = 1; y < hh - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx;
    const gx = -b[i - w - 1] + b[i - w + 1] - 2 * b[i - 1] + 2 * b[i + 1] - b[i + w - 1] + b[i + w + 1];
    const gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
    edge[i] = Math.hypot(gx, gy) > thr ? 1 : 0;
  }
  for (let t = 0; t < thick; t++) {                   // thicken lines
    const n2 = new Uint8Array(edge);
    for (let y = 1; y < hh - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
      const i = y * w + xx;
      if (edge[i]) { n2[i - 1] = n2[i + 1] = n2[i - w] = n2[i + w] = 1; }
    }
    edge = n2;
  }
  const out = x.createImageData(w, hh);
  for (let i = 0; i < edge.length; i++) {
    const v = edge[i] ? 0 : 255;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v; out.data[i * 4 + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  return c;
}
const outlineCache = new Map();

/* ---------- AI generation (browser -> Netlify Function -> AI Gateway) ---------- */
async function shrink(dataURL, maxDim = 1024) {      // keep request under Netlify's ~4.5 MB limit
  const img = await loadImg(dataURL);
  const s = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}
async function generateImage(prompt, refs) {
  if (!settings.accessCode) { $('#settings').open = true; throw new Error('Enter your access code in AI settings first.'); }
  const small = [];
  for (const r of (refs || []).slice(0, 4)) small.push(await shrink(r));
  let res;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-code': settings.accessCode },
      body: JSON.stringify({ prompt, refs: small, aspect: settings.aspect })
    });
  } catch (e) { throw new Error('Could not reach the server. Is the site deployed with its function?'); }
  let j = {}; try { j = await res.json(); } catch (e) {}
  if (res.status === 404) throw new Error('The /api/generate function was not found. The site must be deployed from GitHub (not drag-and-drop) so the function is included.');
  if (!res.ok) throw new Error(j.error || `Image request failed (${res.status})`);
  if (!j.image) throw new Error('No image came back');
  return j.image;
}

function colouringPrompt(p) {
  const style = STYLES[p.style || 'simple'][1];
  const ref = p.refs && p.refs.length ? ' Use the attached reference image(s) for the subject, characters and look, redrawn as colouring-page line art.' : '';
  return `A children's colouring book page, A4 portrait composition. Black line art only: ${style}. Pure white background, no grey, no shading, no filled black areas, all shapes closed so they are easy to colour in, no text or letters. Subject: ${p.prompt}.${ref}`;
}
function coverPrompt(c) {
  const ref = c.refs && c.refs.length ? ' Use the attached reference image(s) for the subject and characters.' : '';
  return `Illustration for the front of a children's colouring book, black line art on pure white, bold clean outlines, no shading, no grey, no text. Subject: ${c.prompt}.${ref}`;
}

/* ---------- canvas drawing helpers ---------- */
function newPage() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.textBaseline = 'alphabetic';
  return [c, x];
}
function breakWord(ctx, word, maxW) {
  const parts = []; let cur = '';
  for (const ch of word) { if (ctx.measureText(cur + ch).width > maxW && cur) { parts.push(cur); cur = ch; } else cur += ch; }
  parts.push(cur); return parts;
}
function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (let word of para.split(/\s+/)) {
      const pieces = ctx.measureText(word).width > maxW ? breakWord(ctx, word, maxW) : [word];
      for (const w of pieces) {
        const t = line ? line + ' ' + w : w;
        if (!line || ctx.measureText(t).width <= maxW) line = t; else { out.push(line); line = w; }
      }
    }
    out.push(line);
  }
  return out;
}
function fitBlock(ctx, text, maxW, maxH, maxF, minF, weight = 400) {
  let lines, lh, f;
  for (f = maxF; f >= minF; f -= 2) {
    ctx.font = `${weight} ${f}px ${FONT}`; lines = wrap(ctx, text, maxW); lh = f * 1.3;
    if (lines.length * lh <= maxH) return { f, lines, lh, rest: [] };
  }
  f = minF; const n = Math.max(0, Math.floor(maxH / lh));
  return { f, lines: lines.slice(0, n), lh, rest: lines.slice(n) };
}
function darken(hex, k = .55) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round((n >> 16 & 255) * k), g = Math.round((n >> 8 & 255) * k), b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}
function rrect(x, px, py, w, hh, r) {
  x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + hh, r); x.arcTo(px + w, py + hh, px, py + hh, r);
  x.arcTo(px, py + hh, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}
function fitImage(x, src, bx, by, bw, bh) {
  const s = Math.min(bw / src.width, bh / src.height), w = src.width * s, hh = src.height * s;
  x.drawImage(src, bx + (bw - w) / 2, by + (bh - hh) / 2, w, hh);
  return hh;
}
function heading(x, title, size = 96) {
  if (!title) return M;
  x.fillStyle = '#111'; x.textAlign = 'center';
  let f = size; x.font = `700 ${f}px ${FONT}`;
  while (x.measureText(title).width > W - 2 * M && f > 40) { f -= 4; x.font = `700 ${f}px ${FONT}`; }
  x.fillText(title, W / 2, M + size * .8);
  return M + size + 40;
}
function placeholder(x, msg, top) {
  x.save(); x.setLineDash([24, 16]); x.strokeStyle = '#bbb'; x.lineWidth = 6;
  rrect(x, M, top, W - 2 * M, H - M - top, 40); x.stroke(); x.restore();
  x.fillStyle = '#999'; x.textAlign = 'center'; x.font = `600 56px ${FONT}`;
  x.fillText(msg, W / 2, H / 2);
}

/* ---------- cover ---------- */
async function renderCover() {
  const c = state.cover; const [cv, x] = newPage();
  x.fillStyle = c.theme; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff'; rrect(x, 60, 60, W - 120, H - 120, 70); x.fill();
  x.save(); x.setLineDash([30, 22]); x.strokeStyle = c.theme; x.lineWidth = 10; x.lineCap = 'round';
  rrect(x, 100, 100, W - 200, H - 200, 50); x.stroke(); x.restore();

  const L = 170, CW = W - 2 * L; let y = 210;
  x.textAlign = 'center';
  const t = fitBlock(x, c.title || 'Untitled', CW, 520, 170, 64, 700);
  x.fillStyle = darken(c.theme); x.font = `700 ${t.f}px ${FONT}`;
  t.lines.forEach((ln, i) => x.fillText(ln, W / 2, y + t.f + i * t.lh));
  y += t.lines.length * t.lh + 30;

  if (c.subtitle) {
    const s = fitBlock(x, c.subtitle, CW, 220, 60, 32, 400);
    x.fillStyle = '#555'; x.font = `400 ${s.f}px ${FONT}`;
    s.lines.forEach((ln, i) => x.fillText(ln, W / 2, y + s.f + i * s.lh));
    y += s.lines.length * s.lh + 30;
  }

  const bottom = H - 190 - (c.author ? 90 : 0);
  const hasDesc = !!c.description.trim();
  let imgBottom = y;
  if (c.image) {
    const avail = bottom - y;
    const boxH = hasDesc ? Math.min(1000, avail * .55) : avail;
    const img = await loadImg(c.image);
    const drawn = fitImage(x, img, L, y, CW, boxH);
    x.strokeStyle = c.theme; x.lineWidth = 8;
    imgBottom = y + (boxH + drawn) / 2 + 40;
  }

  let rest = [], restFont = 36;
  if (hasDesc) {
    const top = imgBottom + 10;
    const d = fitBlock(x, c.description, CW, bottom - top, 64, 30, 400);
    rest = d.rest; restFont = d.f;
    x.fillStyle = '#333'; x.font = `400 ${d.f}px ${FONT}`;
    const center = d.lines.length <= 5 && !rest.length;
    x.textAlign = center ? 'center' : 'left';
    d.lines.forEach((ln, i) => x.fillText(ln, center ? W / 2 : L, top + d.f + i * d.lh));
  }
  if (c.author) {
    x.textAlign = 'center'; x.fillStyle = darken(c.theme); x.font = `600 54px ${FONT}`;
    x.fillText(c.author.startsWith('By') ? c.author : 'By ' + c.author, W / 2, H - 190);
  }
  return { canvas: cv, rest, restFont };
}

function renderOverflow(lines, f, n, total) {
  const [cv, x] = newPage(); const L = 170, CW = W - 2 * L;
  x.fillStyle = darken(state.cover.theme); x.textAlign = 'center'; x.font = `700 80px ${FONT}`;
  x.fillText(total > 1 ? `About this book (${n}/${total})` : 'About this book', W / 2, 230);
  x.fillStyle = '#333'; x.textAlign = 'left'; x.font = `400 ${f}px ${FONT}`;
  lines.forEach((ln, i) => x.fillText(ln, L, 340 + f + i * f * 1.3));
  return cv;
}

/* ---------- page renderers ---------- */
const R = {
  async ai(p) {
    const [cv, x] = newPage(); const top = heading(x, p.title);
    if (!p.img) { placeholder(x, 'Press “Generate” to draw this page', top); return cv; }
    const img = await loadImg(p.img);
    const src = settings.cleanBW ? cleanBW(img, p.img) : img;
    fitImage(x, src, M, top, W - 2 * M, H - M - top);
    return cv;
  },
  async photo(p) {
    const [cv, x] = newPage(); const top = heading(x, p.title);
    if (!p.src) { placeholder(x, 'Upload a photo or drawing', top); return cv; }
    const key = `${p.src.length}:${p.src.slice(-40)}:${p.threshold}:${p.thick}`;
    if (!outlineCache.has(key)) {
      if (outlineCache.size > 12) outlineCache.clear();
      outlineCache.set(key, toOutline(await loadImg(p.src), +p.threshold, +p.thick));
    }
    fitImage(x, outlineCache.get(key), M, top, W - 2 * M, H - M - top);
    return cv;
  },
  async maze(p) {
    const [cv, x] = newPage(); const top = heading(x, p.title);
    const dims = { easy: [8, 11], medium: [12, 17], hard: [16, 23] }[p.level] || [12, 17];
    if (!p.data || p.dataKey !== p.level) { p.data = Gen.makeMaze(...dims); p.dataKey = p.level; }
    const { cols, rows, cells } = p.data;
    const areaH = H - M - top - 170, areaW = W - 2 * M - 40;
    const cs = Math.floor(Math.min(areaW / cols, areaH / rows));
    const ox = Math.round((W - cs * cols) / 2), oy = Math.round(top + 80 + (areaH - cs * rows) / 2);
    x.strokeStyle = '#111'; x.lineWidth = Math.max(6, cs / 9); x.lineCap = 'round';
    x.beginPath();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cell = cells[r][c], px = ox + c * cs, py = oy + r * cs;
      if (cell.n) { x.moveTo(px, py); x.lineTo(px + cs, py); }
      if (cell.w) { x.moveTo(px, py); x.lineTo(px, py + cs); }
      if (cell.s) { x.moveTo(px, py + cs); x.lineTo(px + cs, py + cs); }
      if (cell.e) { x.moveTo(px + cs, py); x.lineTo(px + cs, py + cs); }
    }
    x.stroke();
    x.fillStyle = '#111'; x.font = `700 54px ${FONT}`; x.textAlign = 'center';
    x.fillText('START ▼', ox + cs / 2, oy - 24);
    x.fillText('FINISH ▼', ox + cs * cols - cs / 2, oy + cs * rows + 66);
    return cv;
  },
  async wordsearch(p) {
    const [cv, x] = newPage(); const top = heading(x, p.title);
    const key = p.words + '|' + p.level;
    if (!p.data || p.dataKey !== key) { p.data = Gen.makeWordSearch(p.words.split(/[,\n]+/), p.level); p.dataKey = key; }
    const { n, grid, placed } = p.data;
    const rowsW = Math.ceil(placed.length / 3), wordsH = rowsW * 74 + 100;
    const cell = Math.floor(Math.min((W - 2 * M - 60) / n, (H - M - top - wordsH - 40) / n));
    const gx = Math.round((W - cell * n) / 2), gy = top + 10;
    x.strokeStyle = '#ccc'; x.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      x.beginPath(); x.moveTo(gx, gy + i * cell); x.lineTo(gx + n * cell, gy + i * cell); x.stroke();
      x.beginPath(); x.moveTo(gx + i * cell, gy); x.lineTo(gx + i * cell, gy + n * cell); x.stroke();
    }
    x.strokeStyle = '#111'; x.lineWidth = 8; x.strokeRect(gx, gy, n * cell, n * cell);
    x.fillStyle = '#111'; x.textAlign = 'center'; x.font = `600 ${Math.round(cell * .62)}px ${FONT}`;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      x.fillText(grid[r][c], gx + c * cell + cell / 2, gy + r * cell + cell * .7);
    let wy = gy + n * cell + 90;
    x.textAlign = 'left'; x.font = `700 56px ${FONT}`; x.fillText('Find these words:', M + 20, wy);
    x.font = `400 50px ${FONT}`; const colW = (W - 2 * M) / 3;
    placed.forEach((w, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      x.fillText('☐ ' + w, M + 20 + col * colW, wy + 80 + row * 74);
    });
    return cv;
  },
  async dots(p) {
    const [cv, x] = newPage(); const top = heading(x, p.title);
    const pts = Gen.shapePoints(p.shape, +p.count);
    const cx = W / 2, cy = top + (H - M - top) / 2, R0 = Math.min(W - 2 * M - 160, H - M - top - 160) / 2;
    pts.forEach(([px, py], i) => {
      const X = cx + px * R0, Y = cy + py * R0;
      x.fillStyle = '#111'; x.beginPath(); x.arc(X, Y, 11, 0, 7); x.fill();
      const len = Math.hypot(px, py) || 1, nx = px / len, ny = py / len;
      x.font = `600 46px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(i + 1), X + nx * 44, Y + ny * 44);
    });
    x.textBaseline = 'alphabetic';
    return cv;
  },
  async trace(p) {
    const [cv, x] = newPage(); let y = heading(x, p.title) + 40;
    const lines = p.text.split('\n').filter(l => l.trim()).slice(0, 6);
    const rowH = 300;
    x.textAlign = 'left';
    for (const ln of lines) {
      for (const practice of [false, true]) {
        if (y + rowH > H - M) break;
        const base = y + 215, mid = base - 80 - 20, top = base - 190;
        x.save(); x.lineWidth = 3; x.strokeStyle = '#999'; x.setLineDash([]);
        x.beginPath(); x.moveTo(M, top); x.lineTo(W - M, top); x.moveTo(M, base); x.lineTo(W - M, base); x.stroke();
        x.setLineDash([14, 12]); x.strokeStyle = '#bbb'; x.beginPath(); x.moveTo(M, mid + 10); x.lineTo(W - M, mid + 10); x.stroke();
        x.restore();
        if (!practice) {
          let f = 190; x.font = `700 ${f}px ${FONT}`;
          while (x.measureText(ln).width > W - 2 * M - 40 && f > 50) { f -= 6; x.font = `700 ${f}px ${FONT}`; }
          x.save(); x.setLineDash([12, 14]); x.lineWidth = 5; x.strokeStyle = '#222'; x.strokeText(ln, M + 20, base - 12); x.restore();
        }
        y += rowH;
      }
    }
    return cv;
  },
  async draw(p) {
    const [cv, x] = newPage(); const top = heading(x, p.title || 'Draw here!');
    let t = top;
    if (p.hint) { x.fillStyle = '#555'; x.textAlign = 'center'; x.font = `400 48px ${FONT}`; x.fillText(p.hint, W / 2, top + 30); t = top + 70; }
    x.strokeStyle = '#111'; x.lineWidth = 10; rrect(x, M, t + 20, W - 2 * M, H - M - t - 20, 50); x.stroke();
    return cv;
  }
};

async function buildAllPages(onProgress) {
  const out = [];
  const cover = await renderCover();
  out.push(cover.canvas);
  if (cover.rest.length) {
    const f = cover.restFont, per = Math.floor((H - 340 - 150) / (f * 1.3));
    const chunks = []; for (let i = 0; i < cover.rest.length; i += per) chunks.push(cover.rest.slice(i, i + per));
    chunks.forEach((c, i) => out.push(renderOverflow(c, f, i + 1, chunks.length)));
  }
  for (let i = 0; i < state.pages.length; i++) {
    out.push(await R[state.pages[i].type](state.pages[i]));
    onProgress && onProgress(i + 1, state.pages.length);
  }
  return out;
}

/* ---------- preview ---------- */
let token = 0;
async function refreshPreview() {
  const t = ++token; let cv;
  try {
    cv = state.sel === 'cover' ? (await renderCover()).canvas
      : await R[curPage().type](curPage());
  } catch (e) { toast(e.message, true); return; }
  if (t !== token) return;
  const box = $('#preview'); box.innerHTML = ''; box.appendChild(cv);
}
const refreshSoon = debounce(refreshPreview, 250);
const curPage = () => state.pages.find(p => p.id === state.sel);

/* ---------- editor UI ---------- */
function textField(obj, key, label, opts = {}) {
  const el = opts.area ? h('textarea', { rows: opts.rows || 3, placeholder: opts.ph || '' }) : h('input', { type: 'text', placeholder: opts.ph || '' });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => { obj[key] = el.value; opts.onInput ? opts.onInput() : refreshSoon(); if (key === 'title') renderList(); });
  return h('label', { class: 'f' }, label, el);
}
function selectField(obj, key, label, options, after) {
  const el = h('select', {}, options.map(([v, t]) => h('option', { value: v }, t)));
  el.value = obj[key];
  el.addEventListener('change', () => { obj[key] = el.value; after ? after() : refreshSoon(); });
  return h('label', { class: 'f' }, label, el);
}
function rangeField(obj, key, label, min, max, step = 1) {
  const el = h('input', { type: 'range', min, max, step }); el.value = obj[key];
  const out = h('span', {}, ' ' + obj[key]);
  el.addEventListener('input', () => { obj[key] = +el.value; out.textContent = ' ' + el.value; refreshSoon(); });
  return h('label', { class: 'f' }, h('span', {}, label, out), el);
}
function filesField(obj, key, label, multi, onChange) {
  const wrapEl = h('div', { class: 'f' });
  const draw = () => {
    wrapEl.innerHTML = '';
    const list = multi ? obj[key] : (obj[key] ? [obj[key]] : []);
    wrapEl.append(h('div', {}, label));
    const th = h('div', { class: 'thumbs' });
    list.forEach((src, i) => th.append(h('div', { class: 'thumb' }, h('img', { src }), h('button', { title: 'Remove', onclick: () => {
      if (multi) obj[key].splice(i, 1); else obj[key] = null;
      draw(); onChange ? onChange() : refreshSoon(); } }, '×'))));
    wrapEl.append(th);
    const inp = h('input', { type: 'file', accept: 'image/*', multiple: multi });
    inp.addEventListener('change', async () => {
      try {
        for (const f of [...inp.files]) { const u = await fileToDataURL(f); if (multi) obj[key].push(u); else obj[key] = u; }
        draw(); onChange ? onChange() : refreshSoon();
      } catch (e) { toast(e.message, true); }
    });
    wrapEl.append(inp);
  };
  draw(); return wrapEl;
}
function genButton(label, work) {
  const b = h('button', { class: 'primary' }, label);
  b.addEventListener('click', async () => {
    b.disabled = true; const old = b.textContent; b.textContent = 'Drawing… (can take up to a minute)';
    toast('Generating image…', false, 0);
    try { await work(); toast('Done!'); refreshPreview(); }
    catch (e) { toast(e.message, true, 8000); }
    b.disabled = false; b.textContent = old;
  });
  return b;
}

function renderEditor() {
  const ed = $('#editor'); ed.innerHTML = '';
  if (state.sel === 'cover') {
    const c = state.cover;
    ed.append(h('h2', {}, 'Cover page'),
      textField(c, 'title', 'Book title'),
      textField(c, 'subtitle', 'Subtitle'),
      textField(c, 'author', 'Author / “By …” line'),
      textField(c, 'description', 'Description (no length limit)', { area: true, rows: 9, ph: 'Write as much as you like. Long text shrinks to fit the cover and any extra flows onto an “About this book” page.' }),
      h('label', { class: 'f' }, 'Cover colour', (() => { const i = h('input', { type: 'color' }); i.value = c.theme; i.addEventListener('input', () => { c.theme = i.value; refreshSoon(); }); return i; })()),
      h('h2', {}, 'Cover picture'),
      filesField(c, 'image', 'Use your own image', false),
      textField(c, 'prompt', 'Or describe cover art for AI', { area: true, rows: 3, ph: 'a happy fox painting a rainbow' }),
      filesField(c, 'refs', 'Reference images for the AI (optional)', true, () => {}),
      h('div', { class: 'actions' }, genButton('✨ Generate cover art', async () => {
        if (!c.prompt.trim()) throw new Error('Describe the cover art first.');
        c.image = await generateImage(coverPrompt(c), c.refs);
      }))
    );
  } else {
    const p = curPage(); if (!p) return;
    ed.append(h('h2', {}, TYPES[p.type].icon + ' ' + TYPES[p.type].label));
    ed.append(textField(p, 'title', 'Heading on the page (optional)'));
    if (p.type === 'ai') {
      ed.append(
        textField(p, 'prompt', 'What should this page show?', { area: true, rows: 4, ph: 'a friendly dinosaur eating an ice cream' }),
        selectField(p, 'style', 'Detail level', Object.entries(STYLES).map(([k, v]) => [k, v[0]]), () => {}),
        filesField(p, 'refs', 'Reference images (optional) – AI will draw from them', true, () => {}),
        h('div', { class: 'actions' },
          genButton(p.img ? '🔄 Regenerate' : '✨ Generate this page', async () => {
            if (!p.prompt.trim()) throw new Error('Describe the page first.');
            p.img = await generateImage(colouringPrompt(p), p.refs);
          }),
          p.img ? h('button', { onclick: () => { p.img = null; refreshPreview(); } }, 'Clear image') : '')
      );
    } else if (p.type === 'photo') {
      ed.append(filesField(p, 'src', 'Photo or drawing to turn into an outline', false),
        rangeField(p, 'threshold', 'Detail (lower = more lines)', 20, 400, 5),
        rangeField(p, 'thick', 'Line thickness', 0, 3));
    } else if (p.type === 'maze') {
      ed.append(selectField(p, 'level', 'Difficulty', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']]),
        h('button', { onclick: () => { p.data = null; refreshPreview(); } }, '🔀 New maze'));
    } else if (p.type === 'wordsearch') {
      ed.append(textField(p, 'words', 'Words (comma separated)', { area: true, rows: 3 }),
        selectField(p, 'level', 'Difficulty', [['easy', 'Easy (across, down, diagonal)'], ['hard', 'Hard (all directions)']]),
        h('button', { onclick: () => { p.data = null; refreshPreview(); } }, '🔀 Reshuffle'));
    } else if (p.type === 'dots') {
      ed.append(selectField(p, 'shape', 'Shape', [['star', 'Star'], ['heart', 'Heart'], ['circle', 'Circle'], ['house', 'House']]),
        rangeField(p, 'count', 'Number of dots', 10, 50));
    } else if (p.type === 'trace') {
      ed.append(textField(p, 'text', 'Text to trace (one row per line, max 6)', { area: true, rows: 4 }));
    } else if (p.type === 'draw') {
      ed.append(textField(p, 'hint', 'Small hint under the heading (optional)'));
    }
  }
}

/* ---------- page list ---------- */
function renderList() {
  const ul = $('#pageList'); ul.innerHTML = '';
  const add = (id, label, extra) => ul.append(h('li', { class: state.sel === id ? 'sel' : '', onclick: () => select(id) },
    h('span', { class: 'nm' }, label), extra || ''));
  add('cover', '📕 Cover: ' + (state.cover.title || 'Untitled'));
  state.pages.forEach((p, i) => {
    const btn = (t, title, fn) => h('button', { class: 'tiny', title, onclick: e => { e.stopPropagation(); fn(); } }, t);
    add(p.id, `${i + 1}. ${TYPES[p.type].icon} ${p.title || p.prompt || TYPES[p.type].label}`.slice(0, 60), h('span', {},
      btn('↑', 'Move up', () => move(i, -1)), btn('↓', 'Move down', () => move(i, 1)),
      btn('⧉', 'Duplicate', () => dup(i)), btn('✕', 'Delete', () => del(i))));
  });
  $('#count').textContent = state.pages.length + ' page' + (state.pages.length === 1 ? '' : 's');
}
function select(id) { state.sel = id; renderList(); renderEditor(); refreshPreview(); }
function move(i, d) { const j = i + d; if (j < 0 || j >= state.pages.length) return; [state.pages[i], state.pages[j]] = [state.pages[j], state.pages[i]]; renderList(); }
function dup(i) { const c = JSON.parse(JSON.stringify(state.pages[i])); c.id = uid(); c.data = null; state.pages.splice(i + 1, 0, c); renderList(); }
function del(i) {
  const p = state.pages[i];
  if (!confirm('Delete this page?')) return;
  state.pages.splice(i, 1);
  if (state.sel === p.id) state.sel = 'cover';
  renderList(); renderEditor(); refreshPreview();
}
function addPage(type, extra = {}) {
  const p = { id: uid(), type, ...TYPES[type].make(), ...extra };
  state.pages.push(p); return p;
}

/* ---------- PDF ---------- */
async function downloadPdf() {
  if (!window.jspdf) { toast('PDF library did not load – check your internet connection and refresh.', true, 8000); return; }
  const blank = state.pages.filter(p => (p.type === 'ai' && !p.img) || (p.type === 'photo' && !p.src)).length;
  if (blank && !confirm(`${blank} page(s) have no image yet and will print as empty placeholders. Continue?`)) return;
  const btn = $('#btnPdf'); btn.disabled = true;
  try {
    try { await document.fonts.load(`700 40px Fredoka`); await document.fonts.load(`400 40px Fredoka`); } catch (e) {}
    toast('Building pages…', false, 0);
    const pages = await buildAllPages((i, n) => toast(`Building page ${i}/${n}…`, false, 0));
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pages.forEach((cv, i) => {
      if (i) pdf.addPage('a4', 'portrait');
      pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    });
    const name = (state.cover.title || 'colouring-book').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'colouring-book';
    pdf.save(name + '.pdf');
    toast(`Saved ${pages.length}-page PDF`);
  } catch (e) { toast('PDF failed: ' + e.message, true, 8000); }
  btn.disabled = false;
}

/* ---------- wiring ---------- */
function init() {
  const sel = $('#addType');
  Object.entries(TYPES).forEach(([k, v]) => sel.append(h('option', { value: k }, v.icon + ' ' + v.label)));
  $('#btnAdd').onclick = () => { const p = addPage(sel.value); select(p.id); };
  $('#btnBulk').onclick = () => {
    const lines = $('#bulk').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    let first; lines.forEach(l => { const p = addPage('ai', { prompt: l }); first = first || p; });
    $('#bulk').value = ''; select(first.id); toast(`Added ${lines.length} pages – open each and press Generate, or use “Generate all”.`);
  };
  $('#btnGenAll').onclick = async () => {
    const todo = state.pages.filter(p => p.type === 'ai' && !p.img && p.prompt.trim());
    if (!todo.length) { toast('No AI pages are waiting to be generated.'); return; }
    const b = $('#btnGenAll'); b.disabled = true;
    try {
      for (let i = 0; i < todo.length; i++) {
        toast(`Generating ${i + 1}/${todo.length}…`, false, 0);
        todo[i].img = await generateImage(colouringPrompt(todo[i]), todo[i].refs);
        if (state.sel === todo[i].id) refreshPreview();
      }
      toast('All pages generated!');
    } catch (e) { toast(e.message, true, 9000); }
    b.disabled = false; renderEditor();
  };
  $('#btnPdf').onclick = downloadPdf;

  // settings
  $('#sKey').value = settings.accessCode; $('#sSize').value = settings.aspect; $('#sClean').checked = settings.cleanBW;
  $('#sKey').oninput = e => { settings.accessCode = e.target.value; saveSettings(); };
  $('#sSize').onchange = e => { settings.aspect = e.target.value; saveSettings(); };
  $('#sClean').onchange = e => { settings.cleanBW = e.target.checked; saveSettings(); refreshPreview(); };

  // save / open project
  $('#btnSave').onclick = () => {
    const blob = new Blob([JSON.stringify({ v: 1, cover: state.cover, pages: state.pages })], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: (state.cover.title || 'book').replace(/\W+/g, '-') + '.cbm.json' });
    document.body.append(a); a.click(); a.remove();
  };
  $('#btnOpen').onclick = () => $('#fileOpen').click();
  $('#fileOpen').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      Object.assign(state.cover, j.cover); state.pages = (j.pages || []).filter(p => TYPES[p.type]);
      state.sel = 'cover'; renderList(); renderEditor(); refreshPreview(); toast('Project opened');
    } catch (err) { toast('Could not open that project file', true); }
    e.target.value = '';
  };

  // a starter page so it isn't empty
  addPage('ai', { prompt: 'a friendly lion with a big fluffy mane' });
  addPage('maze'); addPage('wordsearch');
  renderList(); renderEditor();
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(refreshPreview);
}
init();
})();
