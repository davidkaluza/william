/* William's Kart – ein Comic-Rennspiel für Kinder.
 * Pseudo-3D-Straße (Segment-Projektion), Lenkung per Kippen (iPhone/iPad),
 * Touch- und Tastatur-Fallback. Eigene Bilder aus images/ (siehe images/list.json)
 * erscheinen als Figuren am Straßenrand.
 */
(() => {
  'use strict';

  // ---------- Konstanten ----------
  const SEG = 200;             // Länge eines Straßensegments
  const RUMBLE = 3;            // Segmente pro Farbstreifen
  const ROAD_W = 2000;         // halbe Straßenbreite (Welt-Einheiten)
  const CAM_H = 1000;          // Kamerahöhe
  const DRAW = 200;            // Sichtweite in Segmenten
  const CAM_DEPTH = 1 / Math.tan((50 * Math.PI) / 180);
  const PLAYER_Z = CAM_H * CAM_DEPTH;
  const MAX_SPEED = SEG * 60;
  const ZONE_LEN = 560;        // Segmente pro Landschaft
  const INK = '#1b1b22';
  const FONT = '"Chalkboard SE","Marker Felt","Comic Sans MS","Comic Neue",sans-serif';
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------- Helfer ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
  const easeOutBack = p => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
  let seed = 4242;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  function weighted(list) {
    let total = 0; for (const [, w] of list) total += w;
    let r = rnd() * total;
    for (const [k, w] of list) { if ((r -= w) <= 0) return k; }
    return list[0][0];
  }

  const store = {
    get(k, d) { try { const v = localStorage.getItem('william.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('william.' + k, JSON.stringify(v)); } catch { /* egal */ } },
  };
  const settings = {
    mode: store.get('mode', 'steady'),   // 'steady' | 'faster'
    sound: store.get('sound', true),
    invert: store.get('invert', false),
  };

  // ---------- Landschaften ----------
  const ZONES = [
    { name: 'WIESE', sky: ['#2f9dff', '#c9efff'], grass: ['#7bd64a', '#6dc83e'], road: ['#8b8b97', '#83838f'],
      rumble: ['#ff3b3b', '#ffffff'], bg: 'hills', scenery: [['tree', 4], ['bush', 3], ['flowers', 3], ['sign', 0.5]] },
    { name: 'WALD', sky: ['#4cb6ff', '#dcf5ff'], grass: ['#3fa33c', '#379535'], road: ['#80808c', '#787884'],
      rumble: ['#ffd23b', '#ffffff'], bg: 'forest', scenery: [['pine', 6], ['tree', 2], ['mushroom', 2], ['bush', 1]] },
    { name: 'WÜSTE', sky: ['#ff9f43', '#ffe7a3'], grass: ['#f3c66e', '#eab75c'], road: ['#9a8f86', '#928780'],
      rumble: ['#ff6a00', '#ffffff'], bg: 'dunes', scenery: [['cactus', 5], ['rock', 3]] },
    { name: 'SCHNEE', sky: ['#6ec3ff', '#eef9ff'], grass: ['#f5f9ff', '#e3ecf8'], road: ['#8e95a3', '#868d9b'],
      rumble: ['#2a7bff', '#ffffff'], bg: 'mountains', scenery: [['pineSnow', 5], ['snowman', 3], ['rock', 1]] },
    { name: 'STRAND', sky: ['#1fb8ff', '#c8f6ff'], grass: ['#ffe18c', '#f8d676'], road: ['#8b8b97', '#83838f'],
      rumble: ['#ff3b8b', '#ffffff'], bg: 'beach', scenery: [['palm', 5], ['parasol', 3], ['rock', 1]] },
  ];

  // Welt-Höhe der Objekte und welcher Anteil der Breite "anstößt" (0 = durchfahrbar)
  const SPR = {
    tree: { h: 3400, hit: 0.25 }, pine: { h: 3800, hit: 0.2 }, pineSnow: { h: 3800, hit: 0.2 },
    bush: { h: 1000, hit: 0.6 }, flowers: { h: 700, hit: 0 }, mushroom: { h: 900, hit: 0.5 },
    cactus: { h: 2600, hit: 0.4 }, rock: { h: 900, hit: 0.7 }, snowman: { h: 1700, hit: 0.6 },
    palm: { h: 4000, hit: 0.15 }, parasol: { h: 2000, hit: 0.1 }, sign: { h: 1700, hit: 0.8 },
    person: { h: 1500, hit: 0.5 }, user: { h: 1700, hit: 0.5 },
  };

  // ---------- Comic-Zeichenhilfen ----------
  function mk(w, h, fn) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = INK;
    fn(g, w, h); return c;
  }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  const circ = (x, y, r) => g => g.arc(x, y, r, 0, Math.PI * 2);
  const ell = (x, y, rx, ry, rot = 0) => g => g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  const rect = (x, y, w, h, r = 0) => g => rr(g, x, y, w, h, r);
  const poly = (...p) => g => { g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); };
  // Mehrere Formen als eine Silhouette mit dicker Außenlinie
  function blob(g, fill, shapes, lw = 12) {
    g.lineWidth = lw;
    for (const s of shapes) { g.beginPath(); s(g); g.stroke(); }
    g.fillStyle = fill;
    for (const s of shapes) { g.beginPath(); s(g); g.fill(); }
  }
  function limb(g, x1, y1, x2, y2, w, col) {
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.lineWidth = w + 10; g.strokeStyle = INK; g.stroke();
    g.lineWidth = w; g.strokeStyle = col; g.stroke(); g.strokeStyle = INK;
  }
  function shine(g, x, y, r) { g.fillStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function flower(g, x, y, col, r = 11) {
    g.lineWidth = 4;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.8, 0, Math.PI * 2);
      g.fillStyle = col; g.fill(); g.stroke();
    }
    g.beginPath(); g.arc(x, y, r * 0.7, 0, Math.PI * 2); g.fillStyle = '#ffd400'; g.fill(); g.stroke();
  }

  // ---------- Sprites ----------
  const SPRITES = {
    tree: mk(220, 320, g => {
      blob(g, '#9a5b2c', [rect(92, 180, 36, 132, 8)]);
      blob(g, '#43c043', [circ(110, 100, 76), circ(58, 160, 52), circ(162, 160, 52), circ(110, 178, 54)]);
      shine(g, 86, 72, 18); shine(g, 46, 150, 9);
    }),
    pine: mk(180, 340, g => {
      blob(g, '#8a5527', [rect(76, 280, 28, 54, 6)]);
      blob(g, '#2d8f4e', [poly(90, 10, 150, 120, 30, 120), poly(90, 70, 165, 200, 15, 200), poly(90, 140, 175, 290, 5, 290)]);
    }),
    pineSnow: mk(180, 340, g => {
      blob(g, '#8a5527', [rect(76, 280, 28, 54, 6)]);
      blob(g, '#2d7f56', [poly(90, 10, 150, 120, 30, 120), poly(90, 70, 165, 200, 15, 200), poly(90, 140, 175, 290, 5, 290)]);
      g.lineWidth = 4; g.fillStyle = '#ffffff';
      for (const [ty, dx] of [[10, 24], [70, 26], [140, 25]]) {
        g.beginPath(); poly(90, ty, 90 + dx, ty + 45, 90 + dx * 0.4, ty + 36, 90, ty + 48, 90 - dx * 0.4, ty + 36, 90 - dx, ty + 45)(g);
        g.fill(); g.stroke();
      }
    }),
    bush: mk(200, 130, g => {
      blob(g, '#3fb84a', [circ(52, 82, 44), circ(100, 62, 54), circ(150, 82, 44), rect(20, 80, 160, 44, 20)]);
      for (const [x, y, c] of [[60, 70, '#ff4d6d'], [110, 45, '#ffffff'], [145, 85, '#ff4d6d'], [90, 95, '#ffd400']]) {
        g.lineWidth = 3; g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fillStyle = c; g.fill(); g.stroke();
      }
    }),
    flowers: mk(170, 150, g => {
      for (const [x1, x2, y2] of [[40, 45, 60], [85, 85, 40], [130, 125, 70]]) limb(g, x1, 148, x2, y2, 6, '#3fae4a');
      flower(g, 45, 60, '#ff4d6d'); flower(g, 85, 40, '#ffffff'); flower(g, 125, 70, '#9b59ff');
    }),
    mushroom: mk(160, 160, g => {
      blob(g, '#fff3dc', [rect(58, 80, 44, 74, 14)]);
      blob(g, '#ff3b3b', [g2 => { g2.moveTo(10, 95); g2.bezierCurveTo(10, 8, 150, 8, 150, 95); g2.closePath(); }]);
      g.lineWidth = 4; g.fillStyle = '#fff';
      for (const [x, y, r] of [[50, 60, 11], [92, 42, 13], [120, 74, 9], [76, 80, 7]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); }
    }),
    cactus: mk(180, 300, g => {
      blob(g, '#3fae4a', [rect(65, 30, 50, 266, 25), rect(18, 100, 36, 100, 18), rect(18, 172, 70, 34, 17),
        rect(126, 70, 36, 110, 18), rect(92, 148, 70, 34, 17)]);
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 4;
      for (const x of [80, 100]) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x, 280); g.stroke(); }
      g.strokeStyle = INK; flower(g, 90, 32, '#ff6fb5', 8);
    }),
    rock: mk(200, 120, g => {
      blob(g, '#9aa0aa', [poly(10, 115, 25, 55, 70, 20, 130, 15, 175, 45, 192, 115)]);
      shine(g, 70, 45, 12);
    }),
    snowman: mk(180, 300, g => {
      blob(g, '#ffffff', [circ(90, 232, 62), circ(90, 145, 46), circ(90, 76, 36)]);
      blob(g, '#ff3b3b', [rect(52, 102, 76, 18, 8)], 6);
      blob(g, '#26262e', [rect(60, 6, 60, 42, 4), rect(46, 42, 88, 12, 5)], 8);
      g.fillStyle = INK;
      for (const [x, y, r] of [[78, 70, 5], [102, 70, 5], [90, 150, 6], [90, 178, 6], [90, 225, 7]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      g.lineWidth = 3; g.fillStyle = '#ff8a1f'; g.beginPath(); poly(90, 80, 128, 88, 90, 92)(g); g.fill(); g.stroke();
      limb(g, 48, 150, 10, 110, 6, '#8a5527'); limb(g, 132, 150, 170, 110, 6, '#8a5527');
    }),
    palm: mk(260, 400, g => {
      blob(g, '#b97f43', [poly(110, 395, 150, 395, 152, 270, 142, 150, 126, 150, 118, 270)]);
      g.lineWidth = 4; for (let y = 180; y < 390; y += 30) { g.beginPath(); g.moveTo(120, y); g.lineTo(150, y - 6); g.stroke(); }
      const leaves = [-2.9, -2.3, -1.7, -1.1, -0.45, 0.2].map(a => ell(134 + Math.cos(a) * 62, 140 + Math.sin(a) * 34, 70, 17, a));
      blob(g, '#33b24a', leaves);
      blob(g, '#7a4a1f', [circ(122, 158, 12), circ(146, 160, 12), circ(134, 172, 12)], 8);
    }),
    parasol: mk(220, 300, g => {
      blob(g, '#e8e8e8', [rect(104, 60, 12, 236, 5)], 10);
      const canopy = g2 => { g2.moveTo(8, 104); g2.quadraticCurveTo(110, -30, 212, 104); g2.closePath(); };
      g.save(); g.beginPath(); canopy(g); g.lineWidth = 12; g.stroke(); g.fillStyle = '#ffffff'; g.fill(); g.clip();
      g.fillStyle = '#ff3b3b';
      for (let i = 0; i < 6; i += 2) { g.beginPath(); g.moveTo(110, 10); g.lineTo(8 + i * 34, 110); g.lineTo(8 + (i + 1) * 34, 110); g.closePath(); g.fill(); }
      g.restore(); g.lineWidth = 6; g.beginPath(); canopy(g); g.stroke();
    }),
    sign: mk(260, 220, g => {
      blob(g, '#9a5b2c', [rect(40, 90, 22, 126, 6), rect(198, 90, 22, 126, 6)]);
      blob(g, '#ffd23b', [rect(8, 16, 244, 92, 14)]);
      g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 7; g.strokeText('LOS, WILLIAM!', 130, 63); g.fillStyle = '#ff3b3b'; g.fillText('LOS, WILLIAM!', 130, 63);
    }),
    star: mk(120, 120, g => {
      g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 24 : 54, a = -Math.PI / 2 + (i * Math.PI) / 5; g.lineTo(60 + Math.cos(a) * r, 62 + Math.sin(a) * r); }
      g.closePath(); g.lineWidth = 8; g.stroke(); g.fillStyle = '#ffd400'; g.fill(); shine(g, 48, 46, 9);
    }),
    kart: mk(320, 230, g => {
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(160, 215, 152, 15, 0, 0, Math.PI * 2); g.fill();
      blob(g, '#9aa0aa', [rect(70, 150, 180, 22, 8)]);
      blob(g, '#2b2b33', [rect(12, 118, 72, 104, 20), rect(236, 118, 72, 104, 20)]);
      g.strokeStyle = '#55555f'; g.lineWidth = 5;
      for (const x of [12, 236]) for (let y = 136; y < 212; y += 16) { g.beginPath(); g.moveTo(x + 14, y); g.lineTo(x + 58, y); g.stroke(); }
      g.strokeStyle = INK;
      blob(g, '#2fbf4f', [rect(56, 104, 208, 90, 26)]);
      blob(g, '#ff3b3b', [rect(108, 52, 104, 70, 20)]);
      blob(g, '#3d7bff', [ell(160, 96, 60, 26)]);
      blob(g, '#ffd400', [circ(160, 54, 42)]);
      g.lineWidth = 4; g.fillStyle = '#ff3b3b'; g.beginPath(); g.ellipse(160, 54, 11, 41, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      shine(g, 140, 34, 9);
      blob(g, '#ffd400', [rect(68, 166, 184, 28, 12)], 10);
      blob(g, '#ffffff', [rect(134, 156, 52, 34, 6)], 6);
      g.font = `900 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText('W', 160, 174);
      for (const x of [100, 220]) { blob(g, '#b8bec8', [circ(x, 196, 11)], 6); g.fillStyle = INK; g.beginPath(); g.arc(x, 196, 5, 0, Math.PI * 2); g.fill(); }
    }),
  };

  // Platzhalter-Kinder, solange keine eigenen Bilder in images/ liegen
  const KIDS = [0, 1, 2, 3, 4, 5].map(i => mk(150, 290, g => {
    const shirt = ['#ff4d4d', '#3d7bff', '#ffb000', '#9b59ff', '#20c997', '#ff6fb5'][i];
    const skin = ['#ffd7b5', '#e8b48a', '#a8714a'][i % 3];
    const hair = ['#5a3412', '#f1c232', '#1b1b22', '#c0392b'][i % 4];
    limb(g, 62, 200, 58, 268, 18, '#2f5fb3'); limb(g, 88, 200, 92, 268, 18, '#2f5fb3');
    blob(g, '#26262e', [ell(54, 274, 18, 9), ell(96, 274, 18, 9)], 6);
    limb(g, 50, 128, 18, 62, 14, skin); limb(g, 100, 128, 132, i % 2 ? 62 : 150, 14, skin);
    blob(g, skin, [circ(18, 58, 11), circ(132, i % 2 ? 58 : 154, 11)], 8);
    blob(g, shirt, [rect(42, 110, 66, 100, 22)]);
    blob(g, skin, [circ(75, 72, 36)]);
    g.lineWidth = 6; g.fillStyle = hair; g.beginPath(); g.arc(75, 66, 37, Math.PI * 1.05, Math.PI * 1.95); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(62, 74, 4.5, 0, Math.PI * 2); g.arc(88, 74, 4.5, 0, Math.PI * 2); g.fill();
    g.lineWidth = 4; g.beginPath(); g.arc(75, 84, 13, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  }));

  // Eigene Bilder bekommen eine dicke Comic-Kontur
  function outlined(img) {
    const s = Math.min(1, 420 / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
    const p = 8;
    const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
    const sg = sil.getContext('2d'); sg.drawImage(img, 0, 0, w, h);
    sg.globalCompositeOperation = 'source-in'; sg.fillStyle = INK; sg.fillRect(0, 0, w, h);
    const c = document.createElement('canvas'); c.width = w + 2 * p; c.height = h + 2 * p;
    const g = c.getContext('2d');
    for (let a = 0; a < 16; a++) g.drawImage(sil, p + Math.cos((a / 16) * Math.PI * 2) * p * 0.85, p + Math.sin((a / 16) * Math.PI * 2) * p * 0.85);
    g.drawImage(img, p, p, w, h);
    return c;
  }
  const userImgs = [];
  fetch('images/list.json', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      for (const f of Array.isArray(list) ? list : []) {
        const img = new Image();
        img.onload = () => { try { userImgs.push(outlined(img)); } catch { /* ignorieren */ } };
        img.src = 'images/' + encodeURIComponent(f);
      }
    })
    .catch(() => {});

  // ---------- Hintergründe (kachelbar) ----------
  function wave(x, w, parts) { let y = 0; for (const [a, k, ph] of parts) y += a * Math.sin((Math.PI * 2 * k * x) / w + ph); return y; }
  function hillLayer(g, w, h, base, parts, col) {
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, base + wave(x, w, parts));
    g.lineTo(w, h); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 5; g.stroke();
  }
  const BG = {
    hills: mk(1024, 320, (g, w, h) => {
      hillLayer(g, w, h, 190, [[40, 1, 0.3], [22, 3, 1.2], [10, 5, 2]], '#5cbf4f');
      hillLayer(g, w, h, 255, [[26, 2, 2.1], [14, 4, 0.4]], '#43a83f');
    }),
    forest: mk(1024, 320, (g, w, h) => {
      hillLayer(g, w, h, 200, [[30, 1, 1], [14, 3, 0.2]], '#2f8a45');
      seed = 99;
      for (let i = 0; i < 34; i++) {
        const x = i * (w / 34) + rnd() * 12, th = 60 + rnd() * 60, by = 268 + wave(x, w, [[8, 2, 0.5]]);
        for (const ox of [-w, 0, w]) {
          g.beginPath(); poly(x + ox, by - th, x + ox + 22, by, x + ox - 22, by)(g);
          g.fillStyle = '#1f6b3a'; g.fill(); g.lineWidth = 4; g.stroke();
        }
      }
      g.fillStyle = '#1f6b3a'; g.fillRect(0, 262, w, h - 262);
    }),
    dunes: mk(1024, 320, (g, w, h) => {
      hillLayer(g, w, h, 215, [[35, 1, 0.8], [18, 2, 2.4]], '#f0b45a');
      hillLayer(g, w, h, 270, [[22, 3, 1.1], [10, 5, 0.3]], '#e39a3d');
    }),
    mountains: mk(1024, 320, (g, w, h) => {
      seed = 7;
      const peaks = [];
      for (let i = 0; i < 8; i++) peaks.push([i * 128 + 30 + rnd() * 60, 30 + rnd() * 90]);
      for (const ox of [-w, 0, w]) {
        for (const [px, py] of peaks) {
          const x = px + ox, half = 130;
          g.beginPath(); poly(x, py, x + half, 300, x - half, 300)(g);
          g.fillStyle = '#4a90d9'; g.fill(); g.lineWidth = 5; g.stroke();
          const ch = (300 - py) * 0.32, cw = half * ((300 - py) * 0.32) / (300 - py);
          g.beginPath(); poly(x, py, x + cw, py + ch, x + cw * 0.4, py + ch * 0.75, x, py + ch * 1.08, x - cw * 0.4, py + ch * 0.75, x - cw, py + ch)(g);
          g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 4; g.stroke();
        }
      }
      hillLayer(g, w, h, 290, [[14, 2, 0.4], [7, 5, 1.7]], '#dfe9f7');
    }),
    beach: mk(1024, 320, (g, w, h) => {
      // Insel mit Palme
      g.beginPath(); g.ellipse(720, 262, 90, 28, 0, Math.PI, 0); g.closePath(); g.fillStyle = '#f7d474'; g.fill(); g.lineWidth = 4; g.stroke();
      limb(g, 720, 240, 728, 196, 6, '#b97f43');
      blob(g, '#33b24a', [-2.6, -1.6, -0.5].map(a => ell(728 + Math.cos(a) * 20, 196 + Math.sin(a) * 10, 24, 7, a)), 6);
      // Segelboot
      blob(g, '#ff3b3b', [poly(220, 248, 290, 248, 278, 262, 232, 262)], 6);
      blob(g, '#ffffff', [poly(254, 190, 254, 244, 222, 244)], 6);
      g.fillStyle = '#1a9fe0'; g.fillRect(0, 258, w, h - 258);
      g.lineWidth = 5; g.beginPath(); g.moveTo(0, 258); g.lineTo(w, 258); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3;
      for (let i = 0; i < 16; i++) {
        const x = (i * 67) % w, y = 274 + (i % 3) * 14;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 6, x + 20, y); g.quadraticCurveTo(x + 30, y + 6, x + 40, y); g.stroke();
      }
      g.strokeStyle = INK;
    }),
  };
  const CLOUD = mk(300, 150, g => {
    blob(g, '#ffffff', [ell(80, 95, 60, 40), ell(150, 68, 72, 54), ell(222, 95, 60, 40), ell(150, 108, 112, 30)], 10);
    shine(g, 128, 50, 14);
  });
  const DOTS = mk(10, 10, g => { g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(5, 5, 1.6, 0, Math.PI * 2); g.fill(); });

  // ---------- Strecke ----------
  const segments = [];
  let N = 0, trackLen = 0;
  const lastY = () => (segments.length ? segments[segments.length - 1].p2.world.y : 0);
  function addSegment(curve, y, zone) {
    const n = segments.length;
    segments.push({
      index: n, curve, zone, sprites: [], stars: [], alt: Math.floor(n / RUMBLE) % 2, clip: 0, fog: 0,
      p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { y, z: (n + 1) * SEG }, camera: {}, screen: {} },
    });
  }
  function addRoad(enter, hold, leave, curve, y, zone) {
    const startY = lastY(), endY = startY + y * SEG, total = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total), zone);
    for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total), zone);
    for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total), zone);
  }
  function buildTrack() {
    seed = 4242;
    ZONES.forEach((z, zi) => {
      const start = segments.length;
      addRoad(10, 20, 10, 0, 0, zi);
      while (segments.length - start < ZONE_LEN) {
        const r = rnd(), len = 15 + Math.floor(rnd() * 18);
        const c = (rnd() < 0.5 ? -1 : 1) * (1.5 + rnd() * 2.5);
        const ly = lastY() / SEG;
        let hill = 0;
        if (rnd() < 0.55) hill = (10 + rnd() * 20) * (ly > 20 ? -1 : ly < -20 ? 1 : rnd() < 0.5 ? -1 : 1);
        if (r < 0.25) addRoad(len, len, len, 0, hill, zi);
        else if (r < 0.75) addRoad(len, len + 10, len, c, hill, zi);
        else { addRoad(len, len, len, c, hill / 2, zi); addRoad(len, len, len, -c, -hill / 2, zi); }
      }
    });
    addRoad(30, 30, 30, 0, -lastY() / SEG, ZONES.length - 1);
    segments[segments.length - 1].p2.world.y = 0;
    N = segments.length; trackLen = N * SEG;

    for (let i = 12; i < N; i++) {
      const s = segments[i], z = ZONES[s.zone];
      if (i % 20 === 10) {
        const side = Math.floor(i / 20) % 2 ? 1 : -1;
        s.sprites.push({ type: 'person', k: Math.floor(rnd() * 1000), offset: side * (1.3 + rnd() * 0.3) });
      } else if (i % 6 === 0 && rnd() < 0.9) {
        s.sprites.push({ type: weighted(z.scenery), offset: (rnd() < 0.5 ? -1 : 1) * (1.45 + rnd() * 1.6) });
      }
      if (i % 5 === 2 && rnd() < 0.7) s.sprites.push({ type: weighted(z.scenery), offset: (rnd() < 0.5 ? -1 : 1) * (3.2 + rnd() * 3.5) });
      if (i % 80 === 40) {
        const lane = pick([-0.55, 0, 0.55]);
        for (let j = 0; j < 5; j++) segments[(i + j * 4) % N].stars.push({ offset: lane, got: false });
      }
    }
  }
  const findSeg = z => segments[Math.floor(z / SEG) % N];

  // ---------- Zustand ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, kartW = 100, kartH = 72;
  let state = 'splash';                  // 'splash' | 'play' | 'settings'
  let position = 0, playerX = 0, speed = 0, elapsed = 0, starCount = 0;
  let steerVis = 0, offroad = false, bonkCool = 0, shake = 0, time = 0;
  let bgOff = 0, cloudOff = 0, curZone = 0, bgFrom = 0, bgTo = 0, bgT = 1;
  let banner = null; const popups = [];

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    let s = Math.min(window.devicePixelRatio || 1, 2);
    if (W * H * s * s > 2.6e6) s = Math.sqrt(2.6e6 / (W * H));
    canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    kartW = W > H ? Math.min(W * 0.22, H * 0.45) : W * 0.32;
    kartH = (kartW * 230) / 320;
  }

  // ---------- Eingabe ----------
  let tilt = 0, keyL = false, keyR = false;
  const touches = new Map();
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    let ang = typeof window.orientation === 'number' ? window.orientation : (screen.orientation ? screen.orientation.angle : 0);
    ang = ((ang % 360) + 360) % 360;
    let s = ang === 90 ? -a.y : ang === 270 ? a.y : ang === 180 ? -a.x : a.x;
    if (!IS_IOS) s = -s;                       // Android meldet das Vorzeichen umgekehrt
    const deg = (Math.asin(clamp(s / 9.81, -1, 1)) * 180) / Math.PI;
    const v = Math.sign(deg) * clamp((Math.abs(deg) - 3) / 22, 0, 1);
    tilt = lerp(tilt, settings.invert ? -v : v, 0.35);
  }
  canvas.addEventListener('pointerdown', e => { touches.set(e.pointerId, e.clientX); });
  canvas.addEventListener('pointermove', e => { if (touches.has(e.pointerId)) touches.set(e.pointerId, e.clientX); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) canvas.addEventListener(t, e => touches.delete(e.pointerId));
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keyL = true;
    if (e.key === 'ArrowRight' || e.key === 'd') keyR = true;
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft' || e.key === 'a') keyL = false;
    if (e.key === 'ArrowRight' || e.key === 'd') keyR = false;
  });
  function steerInput() {
    let v = tilt + (keyR ? 1 : 0) - (keyL ? 1 : 0);
    for (const x of touches.values()) v += x < W / 2 ? -1 : 1;
    return clamp(v, -1, 1);
  }

  // ---------- Ton ----------
  let actx = null, engine = null;
  function initAudio() {
    if (actx) { actx.resume && actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 380; g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(actx.destination); o.start();
      engine = { o, g };
    } catch { actx = null; }
  }
  function beep(f1, f2, dur, type = 'sine', vol = 0.15, delay = 0) {
    if (!actx || !settings.sound) return;
    const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function engineUpdate(sp) {
    if (!engine) return;
    const on = settings.sound && state === 'play';
    engine.g.gain.setTargetAtTime(on ? 0.03 : 0, actx.currentTime, 0.1);
    engine.o.frequency.setTargetAtTime(55 + sp * 90, actx.currentTime, 0.1);
  }

  // ---------- Spiel-Logik ----------
  function targetSpeed() {
    if (settings.mode === 'steady') return MAX_SPEED * 0.55;
    return Math.min(MAX_SPEED * 1.3, MAX_SPEED * (0.4 + elapsed * 0.006));
  }
  function showBanner(text, color) { banner = { text, color, t: 0, d: 2.2 }; }
  function popup(text, color) { popups.push({ text, color, t: 0 }); }

  function update(dt) {
    time += dt; elapsed += dt;
    const pSeg = findSeg(position + PLAYER_Z);
    const sp = speed / MAX_SPEED;
    const steer = steerInput();
    steerVis = lerp(steerVis, steer, Math.min(1, dt * 10));

    const dx = dt * 2.0 * Math.max(0.5, Math.min(1, sp));
    playerX += dx * steer;
    playerX -= dx * sp * pSeg.curve * 0.18;
    playerX = clamp(playerX, -2.4, 2.4);

    offroad = Math.abs(playerX) > 1.05;
    let target = targetSpeed();
    if (offroad) target *= 0.45;
    speed += (target - speed) * Math.min(1, dt * (target < speed ? 2.5 : 0.6));

    const old = position;
    position = (position + dt * speed) % trackLen;
    if (position < old) for (const s of segments) for (const st of s.stars) st.got = false;

    // Zusammenstöße am Rand – freundlich, ohne Verlieren
    bonkCool -= dt; shake = Math.max(0, shake - dt);
    const kHalf = kartW / 2 / W;
    if (bonkCool <= 0) {
      for (const s of pSeg.sprites) {
        const meta = SPR[spriteKind(s)], img = spriteImg(s);
        if (!meta.hit || !img) continue;
        const sHalf = ((meta.h * (img.width / img.height) * H) / (ROAD_W * W)) * 0.5 * meta.hit;
        if (Math.abs(playerX - s.offset) < kHalf + sHalf) {
          speed *= 0.3; bonkCool = 0.6; shake = 0.35;
          playerX = s.offset - Math.sign(s.offset) * (kHalf + sHalf + 0.05);
          popup(pick(['BONK!', 'HUPS!', 'BUMM!']), '#ff3b3b');
          beep(220, 70, 0.25, 'square', 0.1);
          break;
        }
      }
    }
    // Sterne einsammeln
    for (const s of [pSeg, segments[(pSeg.index + 1) % N]]) {
      for (const st of s.stars) {
        if (!st.got && Math.abs(st.offset - playerX) < kHalf + 0.12) {
          st.got = true; starCount++;
          document.getElementById('starCount').textContent = starCount;
          popup('+1', '#ffd400'); beep(880, 1760, 0.18, 'triangle', 0.14);
          if (starCount % 10 === 0) { showBanner('SUPER!', '#ff3b8b'); beep(523, 523, 0.12, 'triangle', 0.12); beep(784, 784, 0.25, 'triangle', 0.12, 0.13); }
        }
      }
    }

    bgOff += pSeg.curve * sp * dt * 110;
    cloudOff += pSeg.curve * sp * dt * 35 + dt * 6;

    if (pSeg.zone !== curZone) {
      curZone = pSeg.zone; bgFrom = bgTo; bgTo = curZone; bgT = 0;
      showBanner(ZONES[curZone].name + '!');
      beep(660, 990, 0.15, 'triangle', 0.1);
    }
    bgT = Math.min(1, bgT + dt / 1.2);
    if (banner && (banner.t += dt) > banner.d) banner = null;
    for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].t += dt) > 0.9) popups.splice(i, 1);
  }

  const spriteKind = s => (s.type === 'person' && userImgs.length ? 'user' : s.type);
  function spriteImg(s) {
    if (s.type === 'person') return userImgs.length ? userImgs[s.k % userImgs.length] : KIDS[s.k % KIDS.length];
    return SPRITES[s.type];
  }

  // ---------- Darstellung ----------
  function project(p, camX, camY, camZ) {
    p.camera.x = -camX; p.camera.y = p.world.y - camY; p.camera.z = p.world.z - camZ;
    const sc = (p.screen.scale = CAM_DEPTH / p.camera.z);
    p.screen.x = W / 2 + sc * p.camera.x * W / 2;
    p.screen.y = H / 2 - sc * p.camera.y * H / 2;
    p.screen.w = sc * ROAD_W * W / 2;
  }
  function quad(x1, y1, x2, y2, x3, y3, x4, y4, col) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
  }
  function line(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }

  function drawSegment(s) {
    const z = ZONES[s.zone], a = s.alt;
    const { x: x1, y: y1, w: w1 } = s.p1.screen, { x: x2, y: y2, w: w2 } = s.p2.screen;
    const yb = y1 + 1;
    ctx.fillStyle = z.grass[a]; ctx.fillRect(0, y2, W, yb - y2);
    const r1 = w1 / 6, r2 = w2 / 6;
    quad(x1 - w1 - r1, yb, x1 - w1, yb, x2 - w2, y2, x2 - w2 - r2, y2, z.rumble[a]);
    quad(x1 + w1 + r1, yb, x1 + w1, yb, x2 + w2, y2, x2 + w2 + r2, y2, z.rumble[a]);
    quad(x1 - w1, yb, x1 + w1, yb, x2 + w2, y2, x2 - w2, y2, z.road[a]);
    if (a === 0) { const l1 = w1 / 36, l2 = w2 / 36; quad(x1 - l1, yb, x1 + l1, yb, x2 + l2, y2, x2 - l2, y2, '#ffffff'); }
    ctx.strokeStyle = INK; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, w1 / 70);
    line(x1 - w1 - r1, y1, x2 - w2 - r2, y2); line(x1 + w1 + r1, y1, x2 + w2 + r2, y2);
    ctx.lineWidth = Math.max(0.5, w1 / 160);
    line(x1 - w1, y1, x2 - w2, y2); line(x1 + w1, y1, x2 + w2, y2);
    if (s.fog > 0) { ctx.globalAlpha = s.fog; ctx.fillStyle = z.sky[1]; ctx.fillRect(0, y2, W, yb - y2); ctx.globalAlpha = 1; }
  }

  function drawImageClipped(img, x, y, w, h, clipY) {
    if (w < 1 || h < 1 || x > W || x + w < 0) return;
    if (clipY < H && y + h > clipY) {
      const cut = y + h - clipY; if (cut >= h) return;
      ctx.drawImage(img, 0, 0, img.width, img.height * (h - cut) / h, x, y, w, h - cut);
    } else ctx.drawImage(img, x, y, w, h);
  }

  function drawSky(zi, alpha) {
    const z = ZONES[zi], g = ctx.createLinearGradient(0, 0, 0, H / 2);
    g.addColorStop(0, z.sky[0]); g.addColorStop(1, z.sky[1]);
    ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H / 2 + 2); ctx.globalAlpha = 1;
  }
  function drawLayer(zi, alpha) {
    const c = BG[ZONES[zi].bg], lh = H * 0.3, s = lh / c.height, tw = c.width * s;
    const ox = -((((bgOff * s) % tw) + tw) % tw);
    ctx.globalAlpha = alpha;
    for (let x = ox; x < W; x += tw) ctx.drawImage(c, x, H / 2 - lh + 1, tw + 1, lh);
    ctx.globalAlpha = 1;
  }
  let dotPattern = null;
  function drawBackground() {
    if (bgT < 1) { drawSky(bgFrom, 1); drawSky(bgTo, bgT); } else drawSky(bgTo, 1);
    dotPattern = dotPattern || ctx.createPattern(DOTS, 'repeat');
    ctx.fillStyle = dotPattern; ctx.fillRect(0, 0, W, H / 2);
    // Sonne
    const sr = Math.min(W, H) * 0.07, sx = W * 0.82 - ((bgOff * 0.05) % W), sy = H * 0.14;
    ctx.save(); ctx.translate(sx, sy); ctx.strokeStyle = '#ffb000'; ctx.lineWidth = sr * 0.12; ctx.lineCap = 'round';
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 + time * 0.3; line(Math.cos(a) * sr * 1.3, Math.sin(a) * sr * 1.3, Math.cos(a) * sr * 1.7, Math.sin(a) * sr * 1.7); }
    ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke(); ctx.restore();
    // Wolken
    const cw = Math.min(W, H) * 0.32;
    for (const [fx, fy, fs] of [[0.08, 0.06, 1], [0.42, 0.15, 0.7], [0.7, 0.04, 0.9], [1.0, 0.18, 0.6]]) {
      const span = W + cw * 2;
      const x = ((((fx * span - cloudOff * fs * 3) % span) + span) % span) - cw;
      ctx.drawImage(CLOUD, x, fy * H, cw * fs, cw * fs * 0.5);
    }
    if (bgT < 1) { drawLayer(bgFrom, 1); drawLayer(bgTo, bgT); } else drawLayer(bgTo, 1);
    ctx.fillStyle = ZONES[bgTo].grass[0]; ctx.fillRect(0, H / 2, W, H / 2);
  }

  function drawPlayer() {
    const bounce = offroad ? (Math.random() - 0.5) * kartH * 0.07 : Math.sin(time * 18) * kartH * 0.01;
    ctx.save();
    ctx.translate(W / 2, H - kartH * 0.06 + bounce);
    ctx.rotate(steerVis * 0.09);
    ctx.drawImage(SPRITES.kart, -kartW / 2, -kartH, kartW, kartH);
    ctx.restore();
  }

  function drawSpeedLines(sp) {
    if (sp < 0.85) return;
    const n = Math.floor((sp - 0.85) * 60), R = Math.max(W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r0 = R * (0.45 + Math.random() * 0.15);
      ctx.lineWidth = 2 + Math.random() * 3;
      line(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0 * 0.7, W / 2 + Math.cos(a) * (r0 + R * 0.3), H / 2 + Math.sin(a) * (r0 + R * 0.3) * 0.7);
    }
  }

  function comicText(text, x, y, size, fill) {
    ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.18; ctx.strokeStyle = INK; ctx.strokeText(text, x, y);
    ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  function drawBanner() {
    if (!banner) return;
    const { t, d } = banner;
    const alpha = t < 0.25 ? t / 0.25 : t > d - 0.4 ? (d - t) / 0.4 : 1;
    const sc = t < 0.25 ? 0.4 + 0.6 * easeOutBack(t / 0.25) : 1;
    const R = Math.min(W, H) * 0.1;
    ctx.save(); ctx.globalAlpha = clamp(alpha, 0, 1); ctx.translate(W / 2, H * 0.2); ctx.scale(sc, sc);
    ctx.font = `900 ${R * 0.8}px ${FONT}`;
    const bw = Math.max(R * 2.2, ctx.measureText(banner.text).width * 0.75 + R * 0.6);
    ctx.beginPath();
    for (let i = 0; i < 32; i++) { const r = i % 2 ? 0.72 : 1, a = (i / 32) * Math.PI * 2; ctx.lineTo(Math.cos(a) * bw * r, Math.sin(a) * R * r); }
    ctx.closePath(); ctx.fillStyle = '#ffe14d'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#ff3b3b'; ctx.stroke();
    comicText(banner.text, 0, 0, R * 0.8, banner.color || '#2a7bff');
    ctx.restore();
  }
  function drawPopups() {
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 0.9;
      comicText(p.text, W / 2, H - kartH * 1.25 - p.t * 70, Math.min(W, H) * 0.08, p.color);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    const base = findSeg(position), basePct = (position % SEG) / SEG;
    const pSeg = findSeg(position + PLAYER_Z), pPct = ((position + PLAYER_Z) % SEG) / SEG;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake);
    drawBackground();

    let maxy = H, x = 0, dx = -(base.curve * basePct);
    const visible = [];
    for (let n = 0; n < DRAW; n++) {
      const s = segments[(base.index + n) % N];
      const camZ = position - (s.index < base.index ? trackLen : 0);
      s.fog = Math.pow(Math.max(0, (n / DRAW - 0.55) / 0.45), 1.5) * 0.85;
      s.clip = maxy;
      project(s.p1, playerX * ROAD_W - x, playerY + CAM_H, camZ);
      project(s.p2, playerX * ROAD_W - x - dx, playerY + CAM_H, camZ);
      x += dx; dx += s.curve;
      if (s.p1.camera.z <= CAM_DEPTH || s.p2.screen.y >= s.p1.screen.y || s.p2.screen.y >= maxy) continue;
      visible.push(s);
      maxy = s.p2.screen.y;
    }
    for (let i = visible.length - 1; i >= 0; i--) drawSegment(visible[i]);

    for (let n = DRAW - 1; n >= 0; n--) {
      const s = segments[(base.index + n) % N];
      if (s.p1.camera.z > CAM_DEPTH) {
        const sc = s.p1.screen.scale, k = (sc * H) / 2;
        ctx.globalAlpha = 1 - s.fog * 0.9;
        for (const sp of s.sprites) {
          const img = spriteImg(sp), meta = SPR[spriteKind(sp)];
          if (!img) continue;
          const h = meta.h * k, w = h * (img.width / img.height);
          const sx = s.p1.screen.x + sc * sp.offset * ROAD_W * W / 2;
          drawImageClipped(img, sx - w / 2, s.p1.screen.y - h, w, h, s.clip);
        }
        for (const st of s.stars) {
          if (st.got) continue;
          const h = 420 * k, sx = s.p1.screen.x + sc * st.offset * ROAD_W * W / 2;
          const sy = s.p1.screen.y - h - 220 * k + Math.sin(time * 5 + s.index) * 60 * k;
          drawImageClipped(SPRITES.star, sx - h / 2, sy, h, h, s.clip);
        }
        ctx.globalAlpha = 1;
      }
      if (s === pSeg) drawPlayer();
    }
    drawSpeedLines(speed / MAX_SPEED);
    ctx.restore();
    drawBanner(); drawPopups();
  }

  // ---------- Hauptschleife ----------
  let last = performance.now(), acc = 0;
  const STEP = 1 / 60;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (state === 'play') {
      acc += dt;
      while (acc >= STEP) { update(STEP); acc -= STEP; }
    } else acc = 0;
    if (state !== 'splash') render();
    engineUpdate(speed / MAX_SPEED);
    requestAnimationFrame(frame);
  }

  // ---------- Oberfläche ----------
  const $ = id => document.getElementById(id);
  const splash = $('splash'), hud = $('hud'), panel = $('settings');

  function restart() {
    position = 0; playerX = 0; speed = 0; elapsed = 0; starCount = 0;
    curZone = 0; bgFrom = bgTo = 0; bgT = 1; banner = null; popups.length = 0;
    for (const s of segments) for (const st of s.stars) st.got = false;
    $('starCount').textContent = '0';
  }
  function syncSettingsUI() {
    for (const b of panel.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === settings.mode);
    $('soundBtn').textContent = settings.sound ? '🔊 Ton an' : '🔇 Ton aus';
    $('invertBtn').textContent = settings.invert ? '↔️ Lenkung umgedreht' : '↔️ Lenkung normal';
  }
  function openSettings() { if (state !== 'play') return; state = 'settings'; syncSettingsUI(); panel.hidden = false; }
  function closeSettings() { panel.hidden = true; state = 'play'; last = performance.now(); initAudio(); }

  function start() {
    // iOS: Erlaubnis für Bewegungssensor muss direkt im Tipp-Ereignis angefragt werden
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(r => { if (r === 'granted') window.addEventListener('devicemotion', onMotion); })
        .catch(() => {});
    } else {
      window.addEventListener('devicemotion', onMotion);
    }
    initAudio();
    splash.classList.add('gone');
    setTimeout(() => { splash.hidden = true; }, 500);
    hud.hidden = false;
    state = 'play'; last = performance.now();
    showBanner('LOS GEHT\'S!', '#ff3b3b');
    beep(523, 523, 0.12, 'triangle', 0.12); beep(659, 659, 0.12, 'triangle', 0.12, 0.13); beep(784, 784, 0.3, 'triangle', 0.12, 0.26);
  }

  splash.addEventListener('click', start, { once: true });
  $('gear').addEventListener('click', openSettings);
  $('closeBtn').addEventListener('click', closeSettings);
  $('restartBtn').addEventListener('click', () => { restart(); closeSettings(); });
  for (const b of panel.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      if (settings.mode !== b.dataset.mode) { settings.mode = b.dataset.mode; store.set('mode', settings.mode); elapsed = 0; }
      syncSettingsUI();
    });
  }
  $('soundBtn').addEventListener('click', () => { settings.sound = !settings.sound; store.set('sound', settings.sound); syncSettingsUI(); });
  $('invertBtn').addEventListener('click', () => { settings.invert = !settings.invert; store.set('invert', settings.invert); tilt = 0; syncSettingsUI(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) openSettings(); });
  document.addEventListener('gesturestart', e => e.preventDefault());
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  buildTrack();
  resize();
  requestAnimationFrame(frame);
})();
