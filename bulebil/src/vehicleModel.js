// Procedural vehicle models. All geometry is baked in "model space":
// y = 0 at the ground, +z forward, so deformation can work on raw vertex arrays.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PS1 } from './ps1.js';

const S = {};
export function sharedMats() {
  if (S.glass) return S;
  S.glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1318, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 });
  S.broken = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95 });
  S.dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1e, roughness: 0.7, metalness: 0.1 });
  S.chrome = new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.16, metalness: 1 });
  S.tire = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  S.head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1c8, emissiveIntensity: 2.4, roughness: 0.2 });
  S.tail = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1a10, emissiveIntensity: 1.8, roughness: 0.3 });
  S.amber = new THREE.MeshStandardMaterial({ color: 0x442200, emissive: 0xffa21a, emissiveIntensity: 1.6, roughness: 0.3 });
  S.flame = new THREE.MeshBasicMaterial({ color: 0x66b8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const m of Object.values(S)) m.userData.shared = true;
  return S;
}

export function paintMaterial(color, opts = {}) {
  // PS1: no clearcoat gloss, just flat-ish paint
  return new THREE.MeshPhysicalMaterial({
    color, metalness: PS1 ? 0.15 : opts.metalness ?? 0.55, roughness: PS1 ? 0.75 : opts.roughness ?? 0.3,
    clearcoat: PS1 ? 0 : 1, clearcoatRoughness: 0.06, vertexColors: true,
  });
}

// Box with extra segments, then warped vertex-by-vertex. warp(u) gets model-space x/y/z
// plus normalized local tx (-1..1), ty (0 bottom..1 top), tz (-1 back..1 front).
export function shaped(w, h, l, seg, pos, warp) {
  const g = new THREE.BoxGeometry(w, h, l, seg[0], seg[1], seg[2]);
  const p = g.attributes.position;
  const u = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0 };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    u.tx = x / (w / 2); u.ty = (y + h / 2) / h; u.tz = z / (l / 2);
    u.x = x + pos[0]; u.y = y + pos[1]; u.z = z + pos[2];
    if (warp) warp(u);
    p.setXYZ(i, u.x, u.y, u.z);
  }
  g.computeVertexNormals();
  return g;
}

const box = (w, h, l, pos) => new THREE.BoxGeometry(w, h, l).translate(pos[0], pos[1], pos[2]);

function strut(a, b, t) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t * 1.3, 1, 3, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

const wheelGeoCache = new Map();
function wheelGeos(r, w) {
  const key = r + ':' + w;
  if (!wheelGeoCache.has(key)) {
    const tire = new THREE.CylinderGeometry(r, r, w, 26, 1).rotateZ(Math.PI / 2);
    const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 14).rotateZ(Math.PI / 2);
    const hub = mergeGeometries([
      rim,
      new THREE.BoxGeometry(w + 0.04, r * 1.15, r * 0.14),
      new THREE.BoxGeometry(w + 0.04, r * 0.14, r * 1.15),
    ].map(g => g.toNonIndexed()));
    for (const g of [tire, hub]) g.userData.shared = true;
    wheelGeoCache.set(key, { tire, hub });
  }
  return wheelGeoCache.get(key);
}

class Kit {
  constructor() {
    this.model = new THREE.Group();
    this.pieces = [];
    this.wheels = [];
    this.shapes = [];
    this.originY = 0.5;
    this.paint = null;
  }
  // opts: part (detachable name), hp, deform (default true)
  add(geo, mat, opts = {}) {
    const mesh = new THREE.Mesh(geo, mat);
    const deform = opts.deform !== false;
    mesh.castShadow = deform; mesh.receiveShadow = true;
    this.model.add(mesh);
    if (deform) {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    }
    geo.computeBoundingSphere();
    const pc = {
      mesh, deform, orig: deform ? geo.attributes.position.array.slice() : null,
      part: opts.part || null, hp: opts.hp ?? Infinity, dmg: 0,
      center: geo.boundingSphere.center.clone(), radius: geo.boundingSphere.radius,
      detached: false, glass: mat === S.glass, shattered: false,
    };
    this.pieces.push(pc);
    return pc;
  }
  wheel(x, y, z, r, w, front) {
    const g = wheelGeos(r, w);
    const outer = new THREE.Group();
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(g.tire, S.tire);
    const hub = new THREE.Mesh(g.hub, S.chrome);
    tire.castShadow = true;
    spin.add(tire, hub);
    outer.add(spin);
    outer.position.set(x, y, z);
    this.model.add(outer);
    this.wheels.push({ outer, spin, r, w, front, detached: false, hp: 26, dmg: 0, camber: 0, toe: 0 });
  }
  finish(originY, dims) {
    this.originY = originY;
    this.model.position.y = -originY;
    this.dims = dims;
    return this;
  }
}

// ---------- Passenger cars ----------
export const CAR_PARAMS = {
  sedan: { L: 4.6, W: 1.85, clear: 0.2, bodyH: 0.62, cabH: 0.52, cabL: 2.5, cabZ: -0.25, cabW: 1.62, topX: 0.16, rakeF: 0.42, rakeB: 0.36, nose: 0.12, tail: 0.06, wR: 0.34, wZf: 1.42, wZr: -1.45, doors: 2 },
  taxi: { L: 4.6, W: 1.85, clear: 0.2, bodyH: 0.62, cabH: 0.52, cabL: 2.5, cabZ: -0.25, cabW: 1.62, topX: 0.16, rakeF: 0.42, rakeB: 0.36, nose: 0.12, tail: 0.06, wR: 0.34, wZf: 1.42, wZr: -1.45, doors: 2, taxi: true },
  hatch: { L: 3.95, W: 1.75, clear: 0.19, bodyH: 0.6, cabH: 0.56, cabL: 2.3, cabZ: -0.45, cabW: 1.56, topX: 0.14, rakeF: 0.45, rakeB: 0.08, nose: 0.12, tail: 0, wR: 0.32, wZf: 1.25, wZr: -1.25, doors: 1, trunk: false },
  sports: { L: 4.35, W: 1.98, clear: 0.15, bodyH: 0.5, cabH: 0.44, cabL: 2.05, cabZ: -0.3, cabW: 1.6, topX: 0.2, rakeF: 0.55, rakeB: 0.5, nose: 0.17, tail: 0.04, wR: 0.35, wZf: 1.38, wZr: -1.38, doors: 1, spoiler: true, bumperPaint: true },
  muscle: { L: 4.85, W: 1.95, clear: 0.18, bodyH: 0.62, cabH: 0.46, cabL: 2.0, cabZ: -0.5, cabW: 1.64, topX: 0.15, rakeF: 0.5, rakeB: 0.55, nose: 0.04, tail: 0.02, wR: 0.37, wZf: 1.55, wZr: -1.55, doors: 1, scoop: true },
  suv: { L: 4.7, W: 1.95, clear: 0.32, bodyH: 0.72, cabH: 0.68, cabL: 2.9, cabZ: -0.35, cabW: 1.76, topX: 0.1, rakeF: 0.35, rakeB: 0.06, nose: 0.14, tail: 0, wR: 0.4, wZf: 1.5, wZr: -1.45, doors: 2, trunk: false, bullbar: true },
  van: { L: 4.9, W: 1.95, clear: 0.25, bodyH: 0.85, cabH: 1.0, cabL: 3.9, cabZ: -0.45, cabW: 1.86, topX: 0.05, rakeF: 0.28, rakeB: 0.02, nose: 0.25, tail: 0, wR: 0.36, wZf: 1.65, wZr: -1.6, doors: 1, trunk: false, glassSplit: 0.32 },
};

export function buildCar(p, color) {
  sharedMats();
  const k = new Kit();
  const paint = k.paint = paintMaterial(color);
  const { L, W, clear, bodyH, cabH, cabL, cabZ, cabW, topX, rakeF, rakeB, nose, tail, wR } = p;
  const hl = L / 2, bodyTop = clear + bodyH;
  const drop = z => {
    const t = z / hl;
    let d = 0;
    if (t > 0.32) d += nose * Math.min(1, (t - 0.32) / 0.68);
    if (t < -0.6) d += tail * Math.min(1, (-t - 0.6) / 0.4);
    return d;
  };
  const plan = z => 1 - 0.13 * Math.pow(Math.min(1, Math.abs(z / hl)), 5);

  // Lower body
  k.add(shaped(W, bodyH, L, [8, 4, 20], [0, clear + bodyH / 2, 0], u => {
    u.x *= plan(u.z);
    if (u.ty > 0.7) u.x *= 1 - 0.08 * ((u.ty - 0.7) / 0.3) ** 2;
    if (u.ty < 0.2) u.x *= 1 - 0.05 * ((0.2 - u.ty) / 0.2);
    u.y -= drop(u.z) * u.ty;
  }), paint);

  // Hood + trunk lids follow the body's top line
  const hoodL = L * 0.3, hoodZ = hl - hoodL / 2 - 0.06;
  k.add(shaped(W * 0.86, 0.05, hoodL, [6, 1, 8], [0, bodyTop + 0.01, hoodZ], u => { u.x *= plan(u.z); u.y -= drop(u.z); }), paint, { part: 'hood', hp: 20 });
  if (p.scoop) k.add(shaped(0.6, 0.12, 0.9, [2, 1, 3], [0, bodyTop + 0.07, hoodZ - 0.1], u => { if (u.tz > 0) u.y -= 0.08 * u.tz * u.ty; }), S.dark, { part: 'scoop', hp: 10 });
  if (p.trunk !== false) {
    const tl = L * 0.2, tz = -hl + tl / 2 + 0.06;
    k.add(shaped(W * 0.86, 0.05, tl, [6, 1, 5], [0, bodyTop + 0.01, tz], u => { u.x *= plan(u.z); u.y -= drop(u.z); }), paint, { part: 'trunk', hp: 20 });
  }

  // Greenhouse (glass) — optionally split so vans get a paint cargo section
  const cy = bodyTop + cabH / 2 - 0.03;
  const cabWarp = (zc, totalHalf) => u => {
    u.x *= 1 - topX * u.ty;
    const dz = u.z - cabZ;
    u.z = cabZ + dz * (1 - (dz > 0 ? rakeF : rakeB) * u.ty);
  };
  if (p.glassSplit) {
    const gl = cabL * p.glassSplit, rl = cabL - gl;
    k.add(shaped(cabW, cabH, gl, [6, 3, 4], [0, cy, cabZ + cabL / 2 - gl / 2], cabWarp()), S.glass);
    k.add(shaped(cabW, cabH, rl, [6, 3, 8], [0, cy, cabZ - cabL / 2 + rl / 2], cabWarp()), paint);
  } else {
    k.add(shaped(cabW, cabH, cabL, [6, 3, 8], [0, cy, cabZ], cabWarp()), S.glass);
  }
  const fz = cabZ + (cabL / 2) * (1 - rakeF), bz = cabZ - (cabL / 2) * (1 - rakeB);
  const rw = cabW * (1 - topX) + 0.03, roofY = bodyTop + cabH - 0.03 + 0.03;
  k.add(shaped(rw, 0.07, fz - bz + 0.06, [4, 1, 6], [0, roofY, (fz + bz) / 2], u => { if (u.ty > 0.5) u.x *= 0.95; }), paint);
  // Pillars
  const pil = [];
  for (const s of [-1, 1]) {
    const bx = s * (cabW / 2 - 0.02), tx = s * (rw / 2 - 0.02);
    pil.push(strut(new THREE.Vector3(bx, bodyTop - 0.02, cabZ + cabL / 2 - 0.02), new THREE.Vector3(tx, roofY, fz), 0.07));
    pil.push(strut(new THREE.Vector3(bx, bodyTop - 0.02, cabZ - cabL / 2 + 0.02), new THREE.Vector3(tx, roofY, bz), 0.09));
    if (p.doors === 2) pil.push(strut(new THREE.Vector3(s * (cabW / 2 - 0.01), bodyTop - 0.02, cabZ + cabL * 0.02), new THREE.Vector3(s * (cabW / 2 * (1 - topX) + 0.0), roofY, cabZ + cabL * 0.02 * (1 - rakeF)), 0.08));
  }
  k.add(mergeGeometries(pil), paint);
  if (p.taxi) k.add(box(0.7, 0.18, 0.3, [0, roofY + 0.12, (fz + bz) / 2]), S.amber, { part: 'sign', hp: 5, deform: false });

  // Doors
  const doorH = bodyH * 0.72, doorY = clear + bodyH * 0.47;
  const doors = p.doors === 1 ? [[cabZ - 0.05 + cabL * 0.08, cabL * 0.6]] : [[cabZ + cabL * 0.22, cabL * 0.46], [cabZ - cabL * 0.26, cabL * 0.44]];
  for (const s of [-1, 1]) {
    for (const [dz, dl] of doors) {
      const x = s * ((W / 2) * plan(dz) + 0.012);
      k.add(shaped(0.035, doorH, dl, [1, 3, 5], [x, doorY, dz]), paint, { part: 'door', hp: 26 });
    }
  }

  // Bumpers, grille, lights, mirrors
  const bm = p.bumperPaint ? paint : S.dark;
  const bump = z => shaped(W * 0.97, 0.24, 0.24, [6, 2, 2], [0, clear + 0.1, z], u => { u.x *= 1 - 0.12 * Math.pow(Math.abs(u.tx), 6); });
  k.add(bump(hl - 0.04), bm, { part: 'bumperF', hp: 16 });
  k.add(bump(-hl + 0.04), bm, { part: 'bumperR', hp: 16 });
  if (p.bullbar) k.add(mergeGeometries([box(W * 0.7, 0.07, 0.07, [0, clear + 0.55, hl + 0.16]), box(W * 0.7, 0.07, 0.07, [0, clear + 0.3, hl + 0.16]), box(0.07, 0.4, 0.07, [-0.4, clear + 0.42, hl + 0.16]), box(0.07, 0.4, 0.07, [0.4, clear + 0.42, hl + 0.16])]), S.chrome, { part: 'bullbar', hp: 30, deform: false });
  const fy0 = clear + 0.23, fy1 = bodyTop - nose;
  const fmid = (fy0 + fy1) / 2, fh = Math.max(0.08, (fy1 - fy0) * 0.55);
  k.add(box(W * 0.4, fh, 0.04, [0, fmid, hl + 0.005]), S.dark, { part: 'grille', hp: 12, deform: false });
  for (const s of [-1, 1]) {
    k.add(box(W * 0.2, fh, 0.05, [s * W * 0.32, fmid, hl - 0.0]), S.head, { part: 'light', hp: 4, deform: false });
    const ry1 = bodyTop - tail, rmid = (fy0 + ry1) / 2, rh = Math.max(0.08, (ry1 - fy0) * 0.5);
    k.add(box(W * 0.22, rh, 0.05, [s * W * 0.33, rmid, -hl + 0.0]), S.tail, { part: 'light', hp: 4, deform: false });
    k.add(box(0.1, 0.09, 0.16, [s * (W / 2 + 0.05), bodyTop + 0.1, cabZ + (cabL / 2) * 0.75]), paint, { part: 'mirror', hp: 4, deform: false });
  }
  if (p.spoiler) {
    const sy = bodyTop - tail + 0.26, sz = -hl + 0.24;
    k.add(mergeGeometries([box(W * 0.9, 0.04, 0.3, [0, sy, sz]), box(0.06, 0.24, 0.12, [-0.5, sy - 0.12, sz]), box(0.06, 0.24, 0.12, [0.5, sy - 0.12, sz])]), S.dark, { part: 'spoiler', hp: 10, deform: false });
  }

  // Wheels
  const wx = W / 2 - 0.12;
  for (const [z, front] of [[p.wZf, true], [p.wZr, false]]) for (const s of [-1, 1]) k.wheel(s * wx, wR, z, wR, 0.24, front);

  // Physics: full-width lower box (reaches the ground: no wheel physics) + narrower cabin box
  k.shapes.push({ half: [W / 2, bodyTop / 2, hl], offset: [0, 0, 0] });
  k.shapes.push({ half: [cabW / 2 * 0.9, cabH / 2, cabL / 2 * 0.75], offset: [0, bodyTop / 2 + cabH / 2, cabZ] });
  k.exhaust = { y: clear + 0.15, z: -hl - 0.05, x: 0.35 };
  return k.finish(bodyTop / 2, { L, W, H: bodyTop + cabH });
}

// ---------- Trucks (box truck + tanker) ----------
export function buildTruck(color, tanker) {
  sharedMats();
  const k = new Kit();
  const paint = k.paint = paintMaterial(color);
  const L = 8.6, W = 2.4, hl = L / 2, clear = 0.5;
  const cabL = 2.3, cabZ = hl - cabL / 2;
  const plan = z => 1 - 0.08 * Math.pow(Math.min(1, Math.max(0, (z - (hl - 0.6)) / 0.6)), 2);
  k.add(shaped(W, 1.25, cabL, [6, 4, 6], [0, clear + 0.625, cabZ], u => { u.x *= plan(u.z); }), paint);
  const gz = cabZ - 0.05;
  k.add(shaped(W * 0.97, 0.85, cabL - 0.1, [4, 2, 4], [0, clear + 1.25 + 0.42, gz], u => {
    u.x *= 1 - 0.06 * u.ty;
    const dz = u.z - gz;
    if (dz > 0) u.z -= dz * 0.14 * u.ty;
  }), S.glass);
  k.add(shaped(W * 0.95, 0.14, cabL - 0.3, [4, 1, 4], [0, clear + 2.17, cabZ - 0.15]), paint);
  k.add(box(W * 0.6, 0.5, 0.06, [0, clear + 0.75, hl + 0.01]), S.chrome, { part: 'grille', hp: 26, deform: false });
  k.add(shaped(W, 0.3, 0.25, [4, 1, 1], [0, clear + 0.05, hl + 0.06]), S.dark, { part: 'bumperF', hp: 34 });
  k.add(box(W * 0.8, 0.35, L - 0.6, [0, clear + 0.02, -0.1]), S.dark, { deform: false });
  for (const s of [-1, 1]) {
    k.add(box(0.36, 0.22, 0.05, [s * W * 0.36, clear + 0.4, hl + 0.01]), S.head, { part: 'light', hp: 4, deform: false });
    k.add(box(0.3, 0.18, 0.05, [s * W * 0.38, clear + 0.3, -hl - 0.01]), S.tail, { part: 'light', hp: 4, deform: false });
    k.add(box(0.08, 0.45, 0.2, [s * (W / 2 + 0.12), clear + 1.6, hl - 0.3]), S.dark, { part: 'mirror', hp: 6, deform: false });
  }
  const restL = L - cabL - 0.35;
  const restZ = -hl + restL / 2 + 0.05;
  let topY;
  if (tanker) {
    const tank = new THREE.CylinderGeometry(1.15, 1.15, restL, 24, 12).rotateX(Math.PI / 2).translate(0, clear + 0.3 + 1.15, restZ);
    k.add(tank, paintMaterial(0xd0d3d8, { metalness: 0.9, roughness: 0.22 }));
    k.add(box(0.5, 0.35, 0.03, [0, clear + 1.1, -hl - 0.02]), new THREE.MeshStandardMaterial({ color: 0xff7a00 }), { part: 'sign', hp: 6, deform: false });
    topY = clear + 0.3 + 2.3;
  } else {
    k.add(shaped(W * 1.04, 2.7, restL, [6, 6, 12], [0, clear + 0.25 + 1.35, restZ]), paintMaterial(0xf0f0ee, { metalness: 0.1, roughness: 0.45 }));
    topY = clear + 0.25 + 2.7;
  }
  const wx = W / 2 - 0.22;
  for (const [z, front] of [[hl - 1.25, true], [-hl + 1.3, false], [-hl + 2.45, false]]) for (const s of [-1, 1]) k.wheel(s * wx, 0.52, z, 0.52, 0.34, front);
  const oy = 1.3;
  k.shapes.push({ half: [W / 2, (clear + 2.25) / 2, cabL / 2], offset: [0, (clear + 2.25) / 2 - oy, cabZ] });
  k.shapes.push({ half: [W / 2, topY / 2, restL / 2], offset: [0, topY / 2 - oy, restZ] });
  return k.finish(oy, { L, W, H: topY });
}

// ---------- Bus ----------
export function buildBus(color) {
  sharedMats();
  const k = new Kit();
  const paint = k.paint = paintMaterial(color);
  const L = 11.8, W = 2.5, hl = L / 2, clear = 0.32;
  const round = u => { u.x *= 1 - 0.05 * Math.pow(Math.abs(u.tz), 8); };
  k.add(shaped(W, 1.1, L, [8, 4, 26], [0, clear + 0.55, 0], round), paint);
  k.add(shaped(W * 0.98, 1.05, L * 0.985, [6, 2, 24], [0, clear + 1.1 + 0.52, -0.05], round), S.glass);
  k.add(shaped(W, 0.42, L, [6, 2, 26], [0, clear + 2.15 + 0.21, 0], u => { round(u); u.x *= 1 - 0.06 * u.ty * u.ty; }), paintMaterial(0xf2f2f0, { metalness: 0.2 }));
  const posts = [];
  for (let z = -hl + 0.9; z < hl - 2; z += 1.7) for (const s of [-1, 1]) posts.push(box(0.05, 1.05, 0.12, [s * (W * 0.49 + 0.01), clear + 1.62, z]));
  k.add(mergeGeometries(posts), paint);
  k.add(box(W * 0.7, 0.22, 0.04, [0, clear + 2.3, hl + 0.01]), S.amber, { part: 'sign', hp: 8, deform: false });
  k.add(shaped(W, 0.3, 0.22, [4, 1, 1], [0, clear + 0.05, hl + 0.04]), S.dark, { part: 'bumperF', hp: 30 });
  k.add(shaped(W, 0.3, 0.22, [4, 1, 1], [0, clear + 0.05, -hl - 0.04]), S.dark, { part: 'bumperR', hp: 30 });
  for (const s of [-1, 1]) {
    k.add(box(0.36, 0.2, 0.05, [s * W * 0.36, clear + 0.45, hl + 0.01]), S.head, { part: 'light', hp: 4, deform: false });
    k.add(box(0.25, 0.4, 0.05, [s * W * 0.4, clear + 0.6, -hl - 0.01]), S.tail, { part: 'light', hp: 4, deform: false });
    k.add(box(0.08, 0.45, 0.2, [s * (W / 2 + 0.12), clear + 1.9, hl - 0.3]), S.dark, { part: 'mirror', hp: 6, deform: false });
  }
  const wx = W / 2 - 0.25;
  for (const [z, front] of [[hl - 2.4, true], [-hl + 2.9, false]]) for (const s of [-1, 1]) k.wheel(s * wx, 0.5, z, 0.5, 0.3, front);
  const top = clear + 2.57, oy = 1.4;
  k.shapes.push({ half: [W / 2, top / 2, hl], offset: [0, top / 2 - oy, 0] });
  return k.finish(oy, { L, W, H: top });
}

// mass in kg, value = $ at 100% wrecked, tough = accumulated impact strength for 100%
export const MODELS = {
  sedan: { build: c => buildCar(CAR_PARAMS.sedan, c), mass: 1400, value: 9000, tough: 55 },
  taxi: { build: () => buildCar(CAR_PARAMS.taxi, 0xf2c200), mass: 1400, value: 11000, tough: 55, fixedColor: true },
  hatch: { build: c => buildCar(CAR_PARAMS.hatch, c), mass: 1100, value: 7000, tough: 45 },
  sports: { build: c => buildCar(CAR_PARAMS.sports, c), mass: 1350, value: 30000, tough: 50 },
  muscle: { build: c => buildCar(CAR_PARAMS.muscle, c), mass: 1700, value: 22000, tough: 60 },
  suv: { build: c => buildCar(CAR_PARAMS.suv, c), mass: 2100, value: 15000, tough: 70 },
  van: { build: c => buildCar(CAR_PARAMS.van, c), mass: 2300, value: 16000, tough: 75 },
  truck: { build: c => buildTruck(c, false), mass: 7500, value: 40000, tough: 140 },
  tanker: { build: c => buildTruck(c, true), mass: 9000, value: 50000, tough: 110, explosive: true },
  bus: { build: c => buildBus(c), mass: 11000, value: 60000, tough: 160 },
};

export const BIG_NAMES = { bus: 'BUS!', truck: 'LASTBIL!', tanker: 'TANKVOGN!' };
