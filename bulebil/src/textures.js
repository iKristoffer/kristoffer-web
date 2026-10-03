import * as THREE from 'three';
import { PS1, ps1Canvas, ps1Texture } from './ps1.js';

const cache = new Map();
const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function speckle(g, w, h, n, colors, sMax = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = Math.random() * sMax + 0.5;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}
function tex(c, repeat = true) {
  if (PS1 && repeat) c = ps1Canvas(c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return PS1 ? ps1Texture(t) : t;
}

function asphalt(w, h) {
  const [c, g] = cv(w, h);
  g.fillStyle = '#3a3b3e'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, (w * h) / 5, ['#2e2f32', '#45464a', '#55565a', '#28292b', '#4c4a46']);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
    g.beginPath();
    g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 10 + Math.random() * 40, Math.random() * 3, 0, 7);
    g.fill();
  }
  return [c, g];
}

export const LANE_W = 3.5;

// Texture spans full road width horizontally and 12 m along the road vertically.
export function roadTexture(perDir) {
  return once('road' + perDir, () => {
    const W = 512, H = 512;
    const [c, g] = asphalt(W, H);
    const width = perDir * 2 * LANE_W + 2, ppm = W / width;
    const line = (x, dashed, color = '#e6e6df') => {
      const wpx = 0.15 * ppm;
      g.fillStyle = color;
      if (!dashed) g.fillRect(x - wpx / 2, 0, wpx, H);
      else for (let y = 0; y < H; y += H / 2) g.fillRect(x - wpx / 2, y, wpx, H / 4);
    };
    const mid = W / 2;
    for (let i = 0; i < perDir; i++) {
      for (const sgn of [-1, 1]) {
        const cx = mid + sgn * (i + 0.5) * LANE_W * ppm;
        g.fillStyle = 'rgba(0,0,0,0.10)';
        g.fillRect(cx - 1.0 * ppm, 0, 0.5 * ppm, H);
        g.fillRect(cx + 0.5 * ppm, 0, 0.5 * ppm, H);
      }
    }
    line(1 * ppm, false); line(W - 1 * ppm, false);
    line(mid - 0.14 * ppm, false); line(mid + 0.14 * ppm, false);
    for (let i = 1; i < perDir; i++) { line(mid + i * LANE_W * ppm, true); line(mid - i * LANE_W * ppm, true); }
    speckle(g, W, H, 3000, ['rgba(40,40,40,0.5)', 'rgba(70,70,70,0.4)'], 2);
    return tex(c);
  });
}

export const asphaltTexture = () => once('asphalt', () => tex(asphalt(512, 512)[0]));

export const grassTexture = () => once('grass', () => {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#4c6b2c'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 14000, ['#3f5c22', '#5a7d35', '#66883b', '#466228', '#7a8c45'], 2);
  return tex(c);
});

export const concreteTexture = () => once('concrete', () => {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#a9a7a1'; g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 9000, ['#9c9a94', '#b6b4ae', '#8f8d88'], 2);
  g.strokeStyle = 'rgba(60,60,60,0.35)'; g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  return tex(c);
});

export const hazardTexture = () => once('hazard', () => {
  const [c, g] = cv(256, 256);
  g.fillStyle = '#f2b705'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#16161a';
  for (let i = -256; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 + 256, 256); g.lineTo(i + 256, 256); g.fill(); }
  speckle(g, 256, 256, 4000, ['rgba(0,0,0,0.15)', 'rgba(255,255,255,0.1)'], 2);
  return tex(c);
});

// Facade: one tile = one window bay (3 m wide, 3.5 m storey)
export function facadeTexture(variant) {
  return once('facade' + variant, () => {
    const [c, g] = cv(128, 128);
    const walls = ['#b9a68b', '#8d8f94', '#c9c2b3', '#7a5c4a', '#d7d3c8', '#5d6670', '#a7685a', '#e2dccd'];
    g.fillStyle = walls[variant % walls.length]; g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, 1500, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.08)'], 2);
    const glassy = variant % 4 === 3;
    const wx = glassy ? 6 : 26, wy = glassy ? 10 : 30, ww = 128 - wx * 2, wh = glassy ? 100 : 70;
    const gr = g.createLinearGradient(0, wy, 0, wy + wh);
    gr.addColorStop(0, '#5f7d96'); gr.addColorStop(0.5, '#2b3b4a'); gr.addColorStop(1, '#1c2630');
    g.fillStyle = '#3a3a3a'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
    g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
    if (Math.random() < 0.5) { g.fillStyle = 'rgba(255,240,200,0.15)'; g.fillRect(wx, wy, ww, wh); }
    g.fillStyle = '#3a3a3a'; g.fillRect(64 - 2, wy, 4, wh);
    return tex(c);
  });
}

export function iconTexture(type) {
  return once('icon' + type, () => {
    const [c, g] = cv(256, 256);
    const col = { x2: '#ffb000', x4: '#ff6a00', cash: '#20c45a', heart: '#e0153f', breaker: '#ff3d00' }[type];
    g.fillStyle = col; g.beginPath(); g.arc(128, 128, 118, 0, 7); g.fill();
    g.lineWidth = 12; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 120px "Russo One", sans-serif';
    if (type === 'x2') g.fillText('×2', 128, 136);
    else if (type === 'x4') g.fillText('×4', 128, 136);
    else if (type === 'cash') g.fillText('$', 128, 136);
    else if (type === 'heart') {
      g.beginPath(); g.moveTo(128, 200); g.bezierCurveTo(20, 120, 60, 40, 128, 90); g.bezierCurveTo(196, 40, 236, 120, 128, 200); g.fill();
      g.strokeStyle = col; g.lineWidth = 10; g.beginPath(); g.moveTo(128, 88); g.lineTo(112, 120); g.lineTo(140, 145); g.lineTo(120, 190); g.stroke();
    } else {
      g.beginPath();
      for (let i = 0; i < 16; i++) { const r = i % 2 ? 45 : 100, a = (i / 16) * Math.PI * 2; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
      g.fill();
      g.fillStyle = col; g.font = 'bold 54px "Russo One", sans-serif'; g.fillText('CB', 128, 132);
    }
    return tex(c, false);
  });
}

export const smokeTexture = () => once('smoke', () => {
  const [c, g] = cv(128, 128);
  for (let i = 0; i < 6; i++) {
    const x = 64 + (Math.random() - 0.5) * 30, y = 64 + (Math.random() - 0.5) * 30, r = 30 + Math.random() * 25;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return tex(c, false);
});

export const glowTexture = () => once('glow', () => {
  const [c, g] = cv(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return tex(c, false);
});

// Circuit tarmac: 14 m wide (512 px), 12 m per tile, white edge lines only.
export const trackTexture = () => once('track', () => {
  const W = 512, H = 512;
  const [c, g] = asphalt(W, H);
  const ppm = W / 14;
  g.fillStyle = '#ecece6';
  g.fillRect(0.3 * ppm, 0, 0.25 * ppm, H);
  g.fillRect(W - 0.55 * ppm, 0, 0.25 * ppm, H);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(W / 2 - 3.5 * ppm, 0, 1.6 * ppm, H);
  g.fillRect(W / 2 + 1.9 * ppm, 0, 1.6 * ppm, H);
  return tex(c);
});

// Kerb: red/white blocks, one tile = 1.2 m wide × 4 m long.
export const kerbTexture = () => once('kerb', () => {
  const [c, g] = cv(64, 128);
  g.fillStyle = '#d8231b'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f2f2ee'; g.fillRect(0, 64, 64, 64);
  speckle(g, 64, 128, 400, ['rgba(0,0,0,0.12)'], 2);
  return tex(c);
});

export const checkerTexture = () => once('checker', () => {
  const [c, g] = cv(128, 32);
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  return tex(c);
});
