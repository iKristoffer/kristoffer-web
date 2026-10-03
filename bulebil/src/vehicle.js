import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from './config.js';
import { MODELS, sharedMats } from './vehicleModel.js';
import { hash3, clamp } from './util.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
const FWD = new CANNON.Vec3(0, 0, 1), _cv = new CANNON.Vec3();
const MAX_DENT = 0.85;

export class Vehicle {
  constructor(s, type, color, opts = {}) {
    this.s = s; this.type = type;
    const M = this.M = MODELS[type];
    this.kit = M.build(color);
    this.model = this.kit.model;
    this.root = new THREE.Group();
    this.root.add(this.model);
    s.scene.add(this.root);
    this.isPlayer = !!opts.isPlayer;
    this.value = M.value; this.tough = M.tough; this.explosive = !!M.explosive;
    const b = this.body = new CANNON.Body({
      mass: opts.mass ?? M.mass, material: s.mats.driving,
      collisionFilterGroup: G.CAR, collisionFilterMask: G.ALL,
      linearDamping: 0.01, angularDamping: 0.04,
    });
    for (const sh of this.kit.shapes) b.addShape(new CANNON.Box(new CANNON.Vec3(...sh.half)), new CANNON.Vec3(...sh.offset));
    b.allowSleep = false;
    b.userData = { kind: 'car', vehicle: this };
    s.world.addBody(b);
    b.addEventListener('collide', e => s.onCollide(this, e));
    this.state = 'drive';
    this.damage = 0; this.involved = false; this.removed = false;
    this.wheelRot = 0; this.steerVis = 0;
    this.exploded = false; this.explodeT = -1; this.smokeT = 0; this.burnT = 0;
    if (opts.isPlayer) this.addFlames();
  }

  addFlames() {
    const ex = this.kit.exhaust;
    if (!ex) return;
    const S = sharedMats();
    this.flames = [];
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.8, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.4), S.flame);
      m.position.set(sx * ex.x, ex.y, ex.z);
      m.visible = false;
      this.model.add(m);
      this.flames.push(m);
    }
  }

  setPose(x, z, heading) {
    const b = this.body;
    b.position.set(x, this.kit.originY + 0.03, z);
    b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), heading);
    b.velocity.setZero(); b.angularVelocity.setZero();
    this.syncRoot();
  }

  forward(out = new CANNON.Vec3()) { return this.body.quaternion.vmult(FWD, out); }
  speedFwd() { return this.body.velocity.dot(this.body.quaternion.vmult(FWD, _cv)); }
  earned() { return this.value * Math.min(1, this.damage / this.tough); }

  // Hand the body over to free physics (real friction, can sleep).
  wreck() {
    if (this.state === 'wreck') return;
    this.state = 'wreck';
    const b = this.body;
    b.material = this.s.mats.car;
    b.linearDamping = 0.04; b.angularDamping = 0.06;
    b.allowSleep = true; b.sleepSpeedLimit = 0.5; b.sleepTimeLimit = 1;
    b.wakeUp();
  }
  park() {
    this.state = 'parked';
    const b = this.body;
    b.material = this.s.mats.car;
    b.allowSleep = true; b.sleepSpeedLimit = 0.5; b.sleepTimeLimit = 1;
  }

  syncRoot() {
    this.root.position.copy(this.body.position);
    this.root.quaternion.copy(this.body.quaternion);
  }

  sync(dt) {
    this.syncRoot();
    this.root.visible = this.root.position.distanceToSquared(this.s.game.camera.position) < 340 * 340;
    if (!this.root.visible) return;
    const sp = this.speedFwd();
    const r = this.kit.wheels[0]?.r || 0.35;
    this.wheelRot += (sp / r) * dt;
    for (const w of this.kit.wheels) {
      if (w.detached) continue;
      w.spin.rotation.x = this.wheelRot;
      w.outer.rotation.y = (w.front ? this.steerVis : 0) + w.toe;
      w.outer.rotation.z = w.camber;
    }
    if (this.state === 'wreck' && this.damage > this.tough * 0.6) {
      this.smokeT -= dt;
      if (this.smokeT < 0) {
        this.smokeT = 0.18 + Math.random() * 0.15;
        _p.set(0, this.kit.dims.H * 0.75, this.kit.dims.L * 0.3);
        this.model.localToWorld(_p);
        this.s.fx.smoke(_p, 1, { color: this.burnT > 0 ? 0x1a1a1a : 0x555555, size: 2.2, life: 2.6, rise: 2.2 });
      }
    }
    if (this.burnT > 0) {
      this.burnT -= dt;
      _p.set((Math.random() - 0.5) * this.kit.dims.W, this.kit.dims.H * 0.6, (Math.random() - 0.5) * this.kit.dims.L * 0.7);
      this.model.localToWorld(_p);
      this.s.fx.fire(_p, 1, 1.6);
    }
  }

  // pw: world contact point, nw: world direction pointing INTO this car, s: impact strength (~m/s)
  hitAt(pw, nw, s) {
    if (this.removed) return;
    this.damage += s;
    this.root.updateMatrixWorld(true);
    _p.set(pw[0], pw[1], pw[2]);
    this.model.worldToLocal(_p);
    _q.copy(this.root.quaternion).invert();
    _d.set(nw[0], nw[1], nw[2]).applyQuaternion(_q).normalize();
    const depth = Math.min(0.7, s * 0.02), radius = Math.min(1.9, 0.6 + s * 0.035);
    if (depth > 0.025) this.deform(_p, _d, depth, radius);
    const p = _p.clone();
    for (const pc of this.kit.pieces) {
      if (pc.detached) continue;
      const dist = Math.max(0, pc.center.distanceTo(p) - pc.radius * 0.6);
      if (dist > radius + 0.4) continue;
      const f = 1 - dist / (radius + 0.4);
      if (pc.glass && !pc.shattered && s * f > 6) this.shatter(pc);
      if (pc.part) {
        pc.dmg += s * f;
        if (pc.dmg > pc.hp) this.s.debris.fromPiece(this, pc, s);
      }
    }
    for (const w of this.kit.wheels) {
      if (w.detached) continue;
      const dist = w.outer.position.distanceTo(p);
      if (dist > radius + 0.5) continue;
      const f = 1 - dist / (radius + 0.5);
      w.dmg += s * f;
      w.camber = clamp(w.camber + (Math.random() - 0.5) * 0.025 * s * f, -0.5, 0.5);
      w.toe = clamp(w.toe + (Math.random() - 0.5) * 0.02 * s * f, -0.4, 0.4);
      if (w.dmg > w.hp) this.s.debris.fromWheel(this, w, s);
    }
  }

  deform(p, d, depth, radius) {
    const r2 = radius * radius;
    for (const pc of this.kit.pieces) {
      if (!pc.deform || pc.detached) continue;
      if (pc.center.distanceTo(p) > pc.radius + radius) continue;
      const g = pc.mesh.geometry, pos = g.attributes.position, a = pos.array, o = pc.orig;
      const col = g.attributes.color ? g.attributes.color.array : null;
      let hit = false;
      for (let i = 0; i < a.length; i += 3) {
        const dx = a[i] - p.x, dy = a[i + 1] - p.y, dz = a[i + 2] - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        let f = 1 - Math.sqrt(d2) / radius;
        f = f * f * (3 - 2 * f);
        const ox = o[i], oy = o[i + 1], oz = o[i + 2];
        const h1 = hash3(ox, oy, oz), h2 = hash3(oz + 1.3, ox, oy), h3 = hash3(oy, oz + 2.1, ox);
        const amt = depth * f * (0.6 + 0.8 * h1);
        let nx = a[i] + d.x * amt + (h2 - 0.5) * amt * 0.7;
        let ny = a[i + 1] + d.y * amt + (h3 - 0.5) * amt * 0.7;
        let nz = a[i + 2] + d.z * amt + (h1 - 0.5) * amt * 0.7;
        let ex = nx - ox, ey = ny - oy, ez = nz - oz;
        const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (el > MAX_DENT) { const k = MAX_DENT / el; nx = ox + ex * k; ny = oy + ey * k; nz = oz + ez * k; }
        a[i] = nx; a[i + 1] = Math.max(0.02, ny); a[i + 2] = nz;
        if (col) {
          const c = 1 - Math.min(0.6, el * 1.3);
          col[i] = Math.min(col[i], c); col[i + 1] = Math.min(col[i + 1], c * 0.97); col[i + 2] = Math.min(col[i + 2], c * 0.93);
        }
        hit = true;
      }
      if (hit) {
        pos.needsUpdate = true;
        if (col) g.attributes.color.needsUpdate = true;
        g.computeVertexNormals();
      }
    }
  }

  shatter(pc) {
    pc.shattered = true;
    pc.mesh.material = sharedMats().broken;
    const wc = this.model.localToWorld(pc.center.clone());
    this.s.fx.shards(wc, 60, this.body.velocity);
    this.s.sound('glass', wc);
  }

  // Big mangling: crashbreaker / tanker explosion.
  blowUp(power, char) {
    this.root.updateMatrixWorld(true);
    const { L, W, H } = this.kit.dims;
    for (let i = 0; i < 9; i++) {
      const lp = new THREE.Vector3((Math.random() - 0.5) * W, Math.random() * H, (Math.random() - 0.5) * L);
      const dir = new THREE.Vector3(-lp.x, H * 0.4 - lp.y, -lp.z).normalize();
      this.deform(lp, dir, 0.25 + power * 0.02, 1.4);
    }
    for (const pc of this.kit.pieces) {
      if (pc.glass && !pc.shattered) this.shatter(pc);
      if (pc.part && !pc.detached && Math.random() < 0.75) this.s.debris.fromPiece(this, pc, power * 2);
    }
    for (const w of this.kit.wheels) if (!w.detached && Math.random() < 0.5) this.s.debris.fromWheel(this, w, power * 2);
    if (char && this.kit.paint) {
      this.kit.paint.color.multiplyScalar(0.12);
      this.kit.paint.roughness = 0.85; this.kit.paint.clearcoat = 0;
      this.burnT = 8;
    }
    this.damage += power * 3;
  }

  dispose() {
    if (this.removed) return;
    this.removed = true;
    this.s.world.removeBody(this.body);
    this.s.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    if (this.kit.paint) this.kit.paint.dispose();
  }
}
