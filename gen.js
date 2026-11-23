/* Pure puzzle/shape generators (no DOM) – works in browser and Node */
(function (root) {
  function makeMaze(cols, rows) {
    const cells = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ n: 1, e: 1, s: 1, w: 1, v: 0 })));
    const D = [['n', 0, -1, 's'], ['e', 1, 0, 'w'], ['s', 0, 1, 'n'], ['w', -1, 0, 'e']];
    const stack = [[0, 0]];
    cells[0][0].v = 1;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = D.filter(([, dx, dy]) => {
        const nx = cx + dx, ny = cy + dy;
        return nx >= 0 && ny >= 0 && nx < cols && ny < rows && !cells[ny][nx].v;
      });
      if (!opts.length) { stack.pop(); continue; }
      const [d, dx, dy, o] = opts[Math.floor(Math.random() * opts.length)];
      cells[cy][cx][d] = 0;
      const nc = cells[cy + dy][cx + dx];
      nc[o] = 0; nc.v = 1;
      stack.push([cx + dx, cy + dy]);
    }
    cells[0][0].n = 0;               // entrance (top-left)
    cells[rows - 1][cols - 1].s = 0; // exit (bottom-right)
    return { cols, rows, cells };
  }

  function makeWordSearch(rawWords, level) {
    const words = [...new Set(rawWords.map(w => w.toUpperCase().replace(/[^A-Z]/g, '')).filter(w => w.length >= 2))].slice(0, 24);
    const longest = Math.max(0, ...words.map(w => w.length));
    const total = words.reduce((a, w) => a + w.length, 0);
    const n = Math.min(18, Math.max(10, longest, Math.ceil(Math.sqrt(total * 2.6))));
    const grid = Array.from({ length: n }, () => Array(n).fill(''));
    const dirs = level === 'hard'
      ? [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]]
      : [[1, 0], [0, 1], [1, 1]];
    const placed = [], skipped = [];
    for (const w of [...words].sort((a, b) => b.length - a.length)) {
      let ok = false;
      for (let t = 0; t < 400 && !ok; t++) {
        const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
        const sx = Math.floor(Math.random() * n), sy = Math.floor(Math.random() * n);
        const ex = sx + dx * (w.length - 1), ey = sy + dy * (w.length - 1);
        if (ex < 0 || ey < 0 || ex >= n || ey >= n) continue;
        let fits = true;
        for (let i = 0; i < w.length; i++) {
          const c = grid[sy + dy * i][sx + dx * i];
          if (c && c !== w[i]) { fits = false; break; }
        }
        if (!fits) continue;
        for (let i = 0; i < w.length; i++) grid[sy + dy * i][sx + dx * i] = w[i];
        ok = true;
      }
      (ok ? placed : skipped).push(w);
    }
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      if (!grid[y][x]) grid[y][x] = A[Math.floor(Math.random() * 26)];
    return { n, grid, placed: placed.sort(), skipped };
  }

  function resampleClosed(poly, n) {
    const pts = poly.concat([poly[0]]);
    const seg = []; let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      seg.push(d); L += d;
    }
    const out = []; let i = 0, acc = 0;
    for (let k = 0; k < n; k++) {
      const t = k * L / n;
      while (i < seg.length - 1 && acc + seg[i] < t) { acc += seg[i]; i++; }
      const f = seg[i] ? (t - acc) / seg[i] : 0;
      out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
    }
    return out;
  }

  // keep polygon corners, add midpoints on the longest edges until we have n points
  function fillPolygon(poly, n) {
    const pts = poly.map(p => p.slice());
    while (pts.length < n) {
      let bi = 0, bl = -1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > bl) { bl = l; bi = i; }
      }
      const a = pts[bi], b = pts[(bi + 1) % pts.length];
      pts.splice(bi + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    return pts;
  }

  function normalise(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const s = 2 / Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return pts.map(([x, y]) => [(x - cx) * s, (y - cy) * s]);
  }

  function shapePoints(shape, n) {
    n = Math.max(8, Math.min(60, n | 0));
    let pts;
    if (shape === 'heart') {
      const poly = [];
      for (let k = 0; k < 400; k++) {
        const t = k / 400 * 2 * Math.PI;
        poly.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
      }
      pts = resampleClosed(poly, n);
    } else if (shape === 'star') {
      const poly = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 0.42 : 1, a = -Math.PI / 2 + k * Math.PI / 5;
        poly.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      pts = fillPolygon(poly, Math.max(n, 10));
    } else if (shape === 'house') {
      pts = fillPolygon([[-1, 0.1], [-1, 1], [1, 1], [1, 0.1], [1.2, 0.1], [0, -1], [-1.2, 0.1]], Math.max(n, 7));
    } else {
      const poly = [];
      for (let k = 0; k < n; k++) poly.push([Math.cos(k / n * 2 * Math.PI - Math.PI / 2), Math.sin(k / n * 2 * Math.PI - Math.PI / 2)]);
      pts = poly;
    }
    return normalise(pts);
  }

  const api = { makeMaze, makeWordSearch, shapePoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gen = api;
})(typeof window !== 'undefined' ? window : globalThis);
