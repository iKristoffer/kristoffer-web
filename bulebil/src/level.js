// Builds the static world for a level definition: ground, roads, city, props, ramps, signals.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from './config.js';
import * as TX from './textures.js';
import { mulberry32, distToSeg } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LW = TX.LANE_W;
// Ground-level surfaces are drawn as layered decals: fixed draw order, no depth writes, so they
// can never z-fight (PS1 vertex snapping shifts depth by more than any height gap we could use).
// Everything else is drawn after them and simply covers them. Heights are kept as a small extra.
const Y = { pad: 0.006, sidewalk: 0.012, junction: 0.024, curb: 0.03, line: 0.036 };
const LAYER = { ground: 0, road: 1, pad: 2, sidewalk: 3, junction: 4, curb: 5, line: 6 };
function decal(mesh, layer) {
  mesh.renderOrder = -100 + LAYER[layer];
  mesh.material.depthWrite = false;
  mesh.castShadow = false;
  return mesh;
}
const mats = {};
function M() {
  if (mats.road) return mats;
  mats.ground = new THREE.MeshStandardMaterial({ map: TX.grassTexture(), roughness: 1 });
  mats.ground.map.repeat.set(500, 500);
  mats.asphalt = new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mats.concrete = new THREE.MeshStandardMaterial({ map: TX.concreteTexture(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  mats.concreteSolid = new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.85 });
  mats.wall = new THREE.MeshStandardMaterial({ color: 0x6f7f74, roughness: 0.8 });
  mats.rail = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.8 });
  mats.hazard = new THREE.MeshStandardMaterial({ map: TX.hazardTexture(), roughness: 0.6 });
  mats.line = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mats.pole = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.5, metalness: 0.7 });
  mats.lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 0.6 });
  mats.roof = new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.95 });
  mats.cone = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6 });
  mats.barrel = new THREE.MeshStandardMaterial({ color: 0xe05a00, roughness: 0.5, metalness: 0.3 });
  mats.facades = Array.from({ length: 8 }, (_, i) => new THREE.MeshStandardMaterial({ map: TX.facadeTexture(i), roughness: i % 4 === 3 ? 0.25 : 0.85, metalness: i % 4 === 3 ? 0.5 : 0 }));
  for (const m of Object.values(mats)) if (m.isMaterial) m.userData.shared = true;
  for (const m of mats.facades) m.userData.shared = true;
  return mats;
}

// Flat decals are subdivided (~10 m cells) so no triangle is huge — matters for PS1 vertex snapping.
function flat(w, l, mat, x, y, z, rotY = 0) {
  const g = new THREE.PlaneGeometry(w, l, Math.max(1, Math.ceil(w / 10)), Math.max(1, Math.ceil(l / 10))).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z); m.rotation.y = rotY;
  m.receiveShadow = true;
  return m;
}

export function addStaticBox(s, { x, y, z, w, h, d, rotY = 0, kind = 'static', mat, matArr, visible = true }) {
  if (visible) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matArr || mat);
    mesh.position.set(x, y, z); mesh.rotation.y = rotY;
    mesh.castShadow = true; mesh.receiveShadow = true;
    s.scene.add(mesh);
  }
  const b = new CANNON.Body({ mass: 0, material: s.mats.ground, collisionFilterGroup: G.STATIC, collisionFilterMask: G.ALL });
  b.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
  b.position.set(x, y, z);
  b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotY);
  b.userData = { kind };
  s.world.addBody(b);
  return b;
}

function addProp(s, obj, shape, pos, mass, kind = 'prop') {
  const b = new CANNON.Body({ mass, material: s.mats.car, collisionFilterGroup: G.PROP, collisionFilterMask: G.ALL, linearDamping: 0.05, angularDamping: 0.1 });
  b.addShape(shape);
  b.position.set(pos.x, pos.y, pos.z);
  if (pos.rotY) b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), pos.rotY);
  b.allowSleep = true; b.sleepSpeedLimit = 0.3; b.sleepTimeLimit = 0.5;
  b.userData = { kind };
  s.world.addBody(b);
  b.sleep();
  obj.position.copy(b.position); obj.quaternion.copy(b.quaternion);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  s.scene.add(obj);
  s.props.push({ obj, b });
  return b;
}

const lampGeo = () => {
  if (mats.lampGeo) return mats.lampGeo;
  const pole = new THREE.CylinderGeometry(0.08, 0.13, 7, 8).translate(0, 0, 0);
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.8).translate(0, 3.4, 0.85);
  mats.lampGeo = { pole: mergeGeometries([pole, arm]), head: new THREE.BoxGeometry(0.35, 0.12, 0.6).translate(0, 3.33, 1.7) };
  mats.lampGeo.pole.userData.shared = mats.lampGeo.head.userData.shared = true;
  return mats.lampGeo;
};

export function buildLevel(s, def) {
  const m = M();
  const scene = s.scene;

  // Ground (visual sits slightly below physics plane to keep road decals clean)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 100, 100), m.ground);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true;
  scene.add(decal(ground, 'ground'));
  const gb = new CANNON.Body({ mass: 0, material: s.mats.ground, collisionFilterGroup: G.STATIC, collisionFilterMask: G.ALL });
  gb.addShape(new CANNON.Plane());
  gb.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  gb.userData = { kind: 'ground' };
  s.world.addBody(gb);

  // Roads
  s.roads = def.roads.map(r => {
    const [ax, az] = r.a, [bx, bz] = r.b;
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    const width = r.perDir * 2 * LW + 2;
    const geo = new THREE.PlaneGeometry(width, len, 1, Math.ceil(len / 10)).rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len / 12);
    const mat = new THREE.MeshStandardMaterial({ map: TX.roadTexture(r.perDir), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((ax + bx) / 2, 0.0, (az + bz) / 2);
    mesh.rotation.y = Math.atan2(ux, uz);
    mesh.receiveShadow = true;
    scene.add(decal(mesh, 'road'));
    return { ax, az, bx, bz, ux, uz, len, width, half: width / 2, perDir: r.perDir };
  });

  for (const j of def.junctions) scene.add(decal(flat(j.size + 0.4, j.size + 0.4, Object.assign(m.asphalt.clone(), { polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), j.x, Y.junction, j.z), 'junction'));
  for (const p of def.pads || []) {
    const pm = flat(p.w, p.d, m.concrete, p.x, Y.pad, p.z);
    const uv = pm.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * p.w / 8, uv.getY(i) * p.d / 8);
    scene.add(decal(pm, 'pad'));
  }

  // Sidewalks + street lamps, cut around junctions
  const SW = 4;
  for (const r of s.roads) {
    const cuts = [];
    for (const j of def.junctions) {
      const t = (j.x - r.ax) * r.ux + (j.z - r.az) * r.uz;
      const perp = Math.abs((j.x - r.ax) * -r.uz + (j.z - r.az) * r.ux);
      if (perp < r.half + 1) cuts.push([t - j.size / 2 - SW, t + j.size / 2 + SW]);
    }
    if (def.ramps) for (const rp of def.ramps) {
      const t = (rp.x - r.ax) * r.ux + (rp.z - r.az) * r.uz;
      const perp = Math.abs((rp.x - r.ax) * -r.uz + (rp.z - r.az) * r.ux);
      if (perp < 30) cuts.push([t - 30, t + 30]);
    }
    cuts.sort((a, b) => a[0] - b[0]);
    const segs = [];
    let t0 = 0;
    for (const [c0, c1] of cuts) { if (c0 > t0) segs.push([t0, c0]); t0 = Math.max(t0, c1); }
    if (t0 < r.len) segs.push([t0, r.len]);
    const rotY = Math.atan2(r.ux, r.uz);
    for (const [a, b] of segs) {
      const L = b - a;
      if (L < 2) continue;
      for (const side of [-1, 1]) {
        const off = side * (r.half + SW / 2);
        const cx = r.ax + r.ux * (a + L / 2) - r.uz * off, cz = r.az + r.uz * (a + L / 2) + r.ux * off;
        const sw = flat(SW, L, m.concrete, cx, Y.sidewalk, cz, rotY);
        const uv = sw.geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * SW / 4, uv.getY(i) * L / 4);
        scene.add(decal(sw, 'sidewalk'));
        // curb strip
        const ck = flat(0.25, L, m.concreteSolid, r.ax + r.ux * (a + L / 2) - r.uz * side * (r.half + 0.12), Y.curb, r.az + r.uz * (a + L / 2) + r.ux * side * (r.half + 0.12), rotY);
        ck.material = m.line;
        scene.add(decal(ck, 'curb'));
        // lamps
        const lg = lampGeo();
        for (let t = a + 12; t < b - 6; t += 34) {
          if (Math.abs(t - r.len / 2) > 400) continue;
          const px = r.ax + r.ux * t - r.uz * side * (r.half + 0.9), pz = r.az + r.uz * t + r.ux * side * (r.half + 0.9);
          const obj = new THREE.Group();
          obj.add(new THREE.Mesh(lg.pole, m.pole), new THREE.Mesh(lg.head, m.lamp));
          const inner = obj; // arm points along local +z → rotate so it points towards the road
          addProp(s, inner, new CANNON.Box(new CANNON.Vec3(0.13, 3.5, 0.13)), { x: px, y: 3.5, z: pz, rotY: Math.atan2(r.uz * side, -r.ux * side) }, 60);
        }
      }
    }
  }

  // Stop lines + traffic signals
  s.signalHeads = [];
  for (const ln of def.lanes) {
    if (ln.stopT == null) continue;
    const [ax, az] = ln.A, [bx, bz] = ln.B;
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    const rotY = Math.atan2(ux, uz);
    scene.add(decal(flat(LW, 0.5, m.line, ax + ux * (ln.stopT + 0.5), Y.line, az + uz * (ln.stopT + 0.5), rotY), 'line'));
    if (ln.pole) {
      const roadOff = LW * (ln.laneIdx + 0.5);
      const edge = ln.perDir * LW + 1.6;
      const cx = ax - -uz * roadOff + -uz * edge, cz = az - ux * roadOff + ux * edge;
      const px = cx + ux * (ln.stopT + 1.5), pz = cz + uz * (ln.stopT + 1.5);
      s.signalHeads.push(makeSignal(s, px, pz, rotY + Math.PI, ln.group));
    }
  }

  // City blocks
  if (def.city) buildCity(s, def);

  // Static extras
  for (const st of def.statics || []) {
    const mat = { concrete: m.concreteSolid, wall: m.wall, rail: m.rail, hazard: m.hazard }[st.mat] || m.concreteSolid;
    addStaticBox(s, { x: st.x, y: st.h / 2, z: st.z, w: st.w, h: st.h, d: st.d, rotY: st.rotY || 0, mat });
  }

  // Ramps: thick tilted boxes, low edge buried just under the ground
  for (const rp of def.ramps || []) {
    const a = THREE.MathUtils.degToRad(rp.angle), hy = 3, hz = rp.len / 2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-a, rp.heading, 0, 'YXZ'));
    const startTop = new THREE.Vector3(rp.x, -0.06, rp.z);
    const c = startTop.clone().sub(new THREE.Vector3(0, hy, -hz).applyQuaternion(q));
    // Visual: a wedge that stays above ground (the ground decal no longer hides buried geometry).
    const H = rp.len * Math.sin(a) - 0.06, run = rp.len * Math.cos(a);
    const wg = new THREE.BoxGeometry(rp.width, 1, 1, 1, 1, 1);
    const wp = wg.attributes.position;
    for (let i = 0; i < wp.count; i++) {
      const t = wp.getZ(i) + 0.5;
      wp.setXYZ(i, wp.getX(i), wp.getY(i) > 0 ? -0.06 + t * (H + 0.06) + 0.02 : 0, t * run);
    }
    wg.computeVertexNormals();
    const rampTop = new THREE.MeshStandardMaterial({ map: TX.asphaltTexture(), roughness: 0.9 });
    const mesh = new THREE.Mesh(wg, [m.hazard, m.hazard, rampTop, m.concreteSolid, m.hazard, m.hazard]);
    mesh.position.set(rp.x, 0, rp.z); mesh.rotation.y = rp.heading;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const b = new CANNON.Body({ mass: 0, material: s.mats.ground, collisionFilterGroup: G.STATIC, collisionFilterMask: G.ALL });
    b.addShape(new CANNON.Box(new CANNON.Vec3(rp.width / 2, hy, hz)));
    b.position.set(c.x, c.y, c.z); b.quaternion.set(q.x, q.y, q.z, q.w);
    b.userData = { kind: 'ground' };
    s.world.addBody(b);
  }

  // Loose props
  for (const p of def.props || []) {
    for (let i = 0; i < p.n; i++) {
      const x = p.x + (i % 3) * 1.4 - 1.4, z = p.z + Math.floor(i / 3) * 1.4;
      if (p.type === 'cones') {
        const o = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.75, 12), m.cone);
        addProp(s, o, new CANNON.Cylinder(0.05, 0.25, 0.75, 8), { x, y: 0.38, z }, 4);
      } else {
        const o = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 14), m.barrel);
        addProp(s, o, new CANNON.Cylinder(0.32, 0.32, 0.95, 10), { x, y: 0.48, z }, 25);
      }
    }
  }
}

function makeSignal(s, x, z, rotY, group) {
  const m = M();
  const obj = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.6, 8), m.pole);
  obj.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.15, 0.3), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }));
  head.position.set(0, 1.6, 0.05);
  obj.add(head);
  const lamps = [0xff2a1a, 0xffb000, 0x22ff66].map((c, i) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0 });
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), mat);
    l.position.set(0, 1.95 - i * 0.35, 0.2);
    obj.add(l);
    return mat;
  });
  addProp(s, obj, new CANNON.Box(new CANNON.Vec3(0.15, 2.3, 0.15)), { x, y: 2.3, z, rotY }, 120);
  return { group, lamps };
}

function buildCity(s, def) {
  const m = M();
  const c = def.city, rnd = mulberry32(c.seed);
  const cell = 24;
  const statics = [];
  const byMat = Array.from({ length: 8 }, () => []);
  for (let x = -c.extent; x <= c.extent; x += cell) {
    for (let z = -c.extent; z <= c.extent + 100; z += cell) {
      if (rnd() > c.density) continue;
      const w = 12 + rnd() * 9, d = 12 + rnd() * 9, h = 8 + Math.pow(rnd(), 2) * 46;
      const cx = x + (rnd() - 0.5) * 3, cz = z + (rnd() - 0.5) * 3;
      const rad = Math.max(w, d) / 2 + 2;
      let ok = true;
      for (const r of s.roads) if (distToSeg(cx, cz, r.ax, r.az, r.bx, r.bz) < r.half + 4 + rad) { ok = false; break; }
      for (const [x0, z0, x1, z1] of c.clear || []) if (cx > x0 - rad && cx < x1 + rad && cz > z0 - rad && cz < z1 + rad) ok = false;
      if (def.ramps) for (const rp of def.ramps) if (Math.hypot(cx - rp.x, cz - rp.z) < 40) ok = false;
      if (!ok) continue;
      const fi = (rnd() * 8) | 0;
      const geo = new THREE.BoxGeometry(w, h, d);
      const uv = geo.attributes.uv;
      // faces: px, nx, py, ny, pz, nz — 4 verts each; roofs sample the plain wall strip (v = 0)
      for (let f = 0; f < 6; f++) {
        const fw = f < 2 ? d : w, fh = f === 2 || f === 3 ? 0 : h;
        for (let v = 0; v < 4; v++) {
          const i = f * 4 + v;
          uv.setXY(i, uv.getX(i) * fw / 3, fh ? uv.getY(i) * fh / 3.5 : 0.02);
        }
      }
      geo.translate(cx, h / 2 - 0.05, cz);
      byMat[fi].push(geo);
      statics.push({ x: cx, y: h / 2, z: cz, w, h, d });
    }
  }
  // One draw call per facade variant
  byMat.forEach((list, fi) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list), m.facades[fi]);
    list.forEach(g => g.dispose());
    mesh.castShadow = true; mesh.receiveShadow = true;
    s.scene.add(mesh);
  });
  for (const b of statics) addStaticBox(s, { ...b, visible: false });
}
