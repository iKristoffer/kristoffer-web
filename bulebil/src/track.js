// Closed circuit for Testkørsel: a Catmull-Rom loop turned into ground decals (tarmac, kerbs,
// start line) plus a gantry and trees. Exposes s.track (samples + nearest()) and s.surfaceGrip().
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './textures.js';
import { decal, addStaticBox } from './level.js';
import { mulberry32 } from './util.js';

export const TRACK_W = 14;
const KERB_W = 1.2, OFFROAD_GRIP = 0.55;

export function buildTrack(s, def) {
  const curve = new THREE.CatmullRomCurve3(def.track.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const length = curve.getLength();
  const N = Math.round(length / 2.5);
  const pts = curve.getSpacedPoints(N);
  pts.pop();
  const samples = pts.map((p, i) => {
    const t = new THREE.Vector3().subVectors(pts[(i + 1) % N], pts[(i - 1 + N) % N]).normalize();
    return { x: p.x, z: p.z, tx: t.x, tz: t.z, rx: -t.z, rz: t.x };
  });
  const ds = length / N;
  // Rotate so sample 0 (the start/finish line) sits at def.track.startAt, on a straight.
  if (def.track.startAt) {
    const [sx, sz] = def.track.startAt;
    let k = 0, bd = Infinity;
    samples.forEach((p, i) => { const d = (p.x - sx) ** 2 + (p.z - sz) ** 2; if (d < bd) { bd = d; k = i; } });
    samples.push(...samples.splice(0, k));
  }

  // Ribbon between lateral offsets a..b over sample range [i0, i1] (inclusive, may wrap).
  const ribbon = (a, b, vTile, i0 = 0, i1 = N) => {
    const pos = [], uv = [], idx = [];
    const count = ((i1 - i0 + N) % N || N) + 1;
    for (let k = 0; k < count; k++) {
      const sm = samples[(i0 + k) % N];
      const v = (k * ds) / vTile;
      pos.push(sm.x + sm.rx * a, 0, sm.z + sm.rz * a, sm.x + sm.rx * b, 0, sm.z + sm.rz * b);
      uv.push(0, v, 1, v);
      if (k > 0) { const o = (k - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } // counter-clockwise seen from above
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  const addDecal = (geo, map, layer) => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.9 }));
    m.receiveShadow = true;
    s.scene.add(decal(m, layer));
  };

  addDecal(ribbon(-TRACK_W / 2, TRACK_W / 2, 12), TX.trackTexture(), 'road');

  // Kerbs only where the track bends (radius < ~130 m), widened a little either side.
  const bent = samples.map((sm, i) => {
    const n = samples[(i + 2) % N];
    const ang = Math.abs(Math.atan2(sm.tx * n.tz - sm.tz * n.tx, sm.tx * n.tx + sm.tz * n.tz));
    return ang / (2 * ds) > 1 / 130;
  });
  const kerb = bent.map((_, i) => { for (let d = -5; d <= 5; d++) if (bent[(i + d + N) % N]) return true; return false; });
  for (let i = 0; i < N; i++) {
    if (!kerb[i] || kerb[(i - 1 + N) % N]) continue;
    let j = i;
    while (kerb[(j + 1) % N] && (j + 1) % N !== i) j = (j + 1) % N;
    for (const side of [-1, 1]) {
      const a = side * TRACK_W / 2, b = side * (TRACK_W / 2 + KERB_W);
      addDecal(ribbon(Math.min(a, b), Math.max(a, b), 4, i, j), TX.kerbTexture(), 'curb');
    }
  }

  // Start/finish line at sample 0 + gantry
  const s0 = samples[0], rot = Math.atan2(s0.tx, s0.tz);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 1.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: TX.checkerTexture(), roughness: 0.8 }));
  line.position.set(s0.x, 0, s0.z); line.rotation.y = rot;
  s.scene.add(decal(line, 'line'));
  const gantryMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.6 });
  const banner = new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0x3a1200, roughness: 0.6 });
  for (const side of [-1, 1]) {
    const off = side * (TRACK_W / 2 + KERB_W + 1.5);
    addStaticBox(s, { x: s0.x + s0.rx * off, y: 3.5, z: s0.z + s0.rz * off, w: 0.6, h: 7, d: 0.6, rotY: rot, mat: gantryMat });
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(TRACK_W + 2 * KERB_W + 3.6, 1.4, 0.5), banner);
  beam.position.set(s0.x, 6.6, s0.z); beam.rotation.y = rot;
  beam.castShadow = true;
  s.scene.add(beam);

  // Trees outside the run-off (visual only)
  const rnd = mulberry32(5);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of samples) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const trunks = [], leaves = [];
  for (let k = 0; k < 400 && leaves.length < 170; k++) {
    const x = minX - 90 + rnd() * (maxX - minX + 180), z = minZ - 90 + rnd() * (maxZ - minZ + 180);
    let d = Infinity;
    for (const p of samples) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
    if (d < (TRACK_W / 2 + 18) ** 2) continue;
    const h = 5 + rnd() * 4, r = 1.6 + rnd() * 1.2;
    trunks.push(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 6).translate(x, 1.2, z));
    leaves.push(new THREE.ConeGeometry(r, h, 8).translate(x, 2 + h / 2, z));
  }
  for (const [list, color] of [[trunks, 0x5a3b22], [leaves, 0x2f5a26]]) {
    const m = new THREE.Mesh(mergeGeometries(list), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    m.castShadow = true; m.receiveShadow = true;
    s.scene.add(m);
    list.forEach(g => g.dispose());
  }

  // Nearest sample, searching around the previous answer first.
  let hint = 0;
  const nearest = (x, z) => {
    let best = hint, bd = Infinity;
    const scan = (from, to) => {
      for (let k = from; k <= to; k++) {
        const i = (k + N) % N, p = samples[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    };
    scan(hint - 30, hint + 30);
    if (bd > 30 * 30) scan(0, N - 1);
    hint = best;
    return best;
  };
  s.track = { samples, N, length, nearest };
  s.surfaceGrip = (x, z) => {
    const p = samples[nearest(x, z)];
    const lat = Math.abs((x - p.x) * p.rx + (z - p.z) * p.rz);
    return lat <= TRACK_W / 2 + KERB_W + 0.3 ? 1 : OFFROAD_GRIP;
  };
  // Start 25 m before the line so the first crossing starts the clock.
  const st = samples[(N - Math.round(25 / ds)) % N];
  s.trackStart = [st.x, st.z, Math.atan2(st.tx, st.tz)];
  def.focus = [s0.x, s0.z];
}
