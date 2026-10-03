// One run of one level: owns scene, physics world, vehicles, effects and the game mode.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Sky } from 'three/addons/objects/Sky.js';
import { GRAVITY } from './config.js';
import { buildLevel } from './level.js';
import { Traffic } from './traffic.js';
import { Vehicle } from './vehicle.js';
import { PlayerDriver } from './player.js';
import { FX } from './fx.js';
import { Debris } from './debris.js';
import { CamRig } from './camera.js';
import { CrashMode } from './crashmode.js';
import { TRAFFIC_COLORS } from './config.js';
import { pick } from './util.js';
import { PS1 } from './ps1.js';

const STEP = 1 / 120;
const _p = new THREE.Vector3();

export class Session {
  constructor(game, def, carSpec) {
    this.game = game; this.def = def; this.carSpec = carSpec;
    this.clockT = 0; this.timeScale = 1;
    this.collisions = []; this.vehicles = []; this.props = [];
    this.setupScene();
    this.setupWorld();
    this.fx = new FX(this);
    this.debris = new Debris(this);
    buildLevel(this, def);
    this.traffic = new Traffic(this, def);

    this.player = new Vehicle(this, carSpec.model, carSpec.color, { mass: carSpec.mass, isPlayer: true });
    this.player.setPose(def.start[0], def.start[1], def.start[2]);
    this.driver = new PlayerDriver(this, this.player, carSpec);

    for (const p of def.parked || []) {
      const v = new Vehicle(this, p.type, pick(TRAFFIC_COLORS));
      v.setPose(p.x, p.z, p.h || 0);
      v.park();
      this.vehicles.push(v);
    }
    this.traffic.prewarm(def.prewarm ?? 15);
    for (const v of this.vehicles) if (v.state === 'parked') v.body.sleep();

    this.cam = new CamRig(game.camera);
    this.mode = new CrashMode(this);
  }

  setupScene() {
    const scene = this.scene = new THREE.Scene();
    scene.environment = this.game.env;
    if (PS1) {
      // Short draw distance into flat fog, like the hardware had to.
      scene.background = new THREE.Color(0x6f8fb8);
      scene.fog = new THREE.Fog(0x6f8fb8, 90, 480);
      scene.environmentIntensity = 0.35;
    } else {
      scene.fog = new THREE.Fog(0xc4d2e0, 260, 1600);
      this.addSky(scene);
    }
    scene.add(new THREE.HemisphereLight(0xc4dcff, 0x5b4c3a, PS1 ? 1.0 : 0.9));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, PS1 ? 2.2 : 3.2);
    sun.castShadow = !PS1;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
  }

  addSky(scene) {
    const sky = new Sky();
    sky.scale.setScalar(4500);
    sky.renderOrder = -200; // before the ground decals, which write no depth
    const u = sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.game.sunDir);
    scene.add(sky);
  }

  setupWorld() {
    const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 12;
    w.defaultContactMaterial.friction = 0.4;
    const m = this.mats = {
      ground: new CANNON.Material('ground'), driving: new CANNON.Material('driving'),
      car: new CANNON.Material('car'), debris: new CANNON.Material('debris'),
    };
    const cm = (a, b, friction, restitution) => w.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
    cm(m.ground, m.driving, 0, 0);
    cm(m.ground, m.car, 0.55, 0.05);
    cm(m.ground, m.debris, 0.6, 0.25);
    cm(m.car, m.car, 0.35, 0.08);
    cm(m.driving, m.car, 0.25, 0.05);
    cm(m.driving, m.driving, 0.1, 0.05);
    cm(m.car, m.debris, 0.4, 0.2);
    cm(m.driving, m.debris, 0.3, 0.2);
  }

  // Called from cannon's 'collide' event (only on first contact of a pair). Copy data: contacts are pooled.
  onCollide(veh, e) {
    const c = e.contact, other = e.body;
    const kind = other.userData?.kind || 'static';
    const v = Math.abs(c.getImpactVelocityAlongNormal());
    if (v < 1.5) return;
    if (kind === 'ground' && v < 5) return;
    const selfI = c.bi === veh.body;
    const n = c.ni;
    const sgn = selfI ? -1 : 1;
    const p = selfI ? c.bi.position.vadd(c.ri) : c.bj.position.vadd(c.rj);
    const om = other.mass, sm = veh.body.mass;
    const mf = om === 0 ? 1.3 : Math.min(1.6, Math.max(0.12, (2 * om) / (om + sm)));
    this.collisions.push({ veh, kind, v, s: v * mf, p: [p.x, p.y, p.z], n: [n.x * sgn, n.y * sgn, n.z * sgn] });
  }

  processCollisions() {
    if (!this.collisions.length) return;
    const evs = this.collisions;
    this.collisions = [];
    for (const ev of evs) {
      if (ev.veh === this.player && this.mode.state === 'runup' && (ev.kind === 'car' || ev.kind === 'static') && ev.v > 5) this.mode.startCrash();
    }
    for (const ev of evs) {
      const veh = ev.veh;
      if (veh.removed) continue;
      if (ev.kind === 'ground') { veh.hitAt(ev.p, ev.n, ev.s * 0.5); continue; }
      if (ev.s > 2) {
        veh.hitAt(ev.p, ev.n, ev.s);
        _p.set(ev.p[0], ev.p[1], ev.p[2]);
        this.fx.sparks(_p, Math.min(70, ev.s * 2.2), 4 + ev.s * 0.25, veh.body.velocity);
        if (ev.s > 8) this.fx.smoke(_p, 2, { color: 0x8a8580, size: 1.8, life: 1.5, rise: 1 });
        this.sound('crash', _p, ev.s);
        const d = _p.distanceTo(this.game.camera.position);
        this.cam.shake = Math.min(1.2, this.cam.shake + ev.s * 0.02 / (1 + d / 20));
      }
      if (!veh.isPlayer && veh.state !== 'wreck' && ev.s > 2.5 && (ev.kind === 'car' || ev.kind === 'static' || (ev.kind === 'debris' && ev.s > 6))) this.wreckVehicle(veh);
    }
  }

  wreckVehicle(v) {
    v.wreck();
    this.traffic.detach(v);
    this.mode.onWreck(v);
  }

  removeVehicle(v) {
    v.dispose();
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  sound(type, p, s = 0) {
    const au = this.game.audio;
    const d = p.distanceTo(this.game.camera.position);
    if (type === 'crash') au.crash(s, d);
    else if (type === 'glass') au.glass(d);
    else if (type === 'boom') au.explosion(d);
  }

  // Radial blast: impulses to every dynamic body in range, damage + wreck vehicles.
  blast(c, R, power, src) {
    for (const b of this.world.bodies) {
      if (b.mass === 0 || (src && b === src.body)) continue;
      const dx = b.position.x - c.x, dy = b.position.y - c.y, dz = b.position.z - c.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > R) continue;
      const f = 1 - dist / R;
      const dir = new CANNON.Vec3(dx, dy + 2, dz);
      dir.normalize();
      const dv = power * f * Math.min(1, 3000 / b.mass);
      b.wakeUp();
      b.applyImpulse(dir.scale(dv * b.mass));
      b.angularVelocity.x += (Math.random() - 0.5) * dv * 0.4;
      b.angularVelocity.z += (Math.random() - 0.5) * dv * 0.4;
      const veh = b.userData?.vehicle;
      if (veh && veh !== src) {
        const hp = [b.position.x - dir.x * 1.2, b.position.y - dir.y * 0.6, b.position.z - dir.z * 1.2];
        veh.hitAt(hp, [dir.x, dir.y, dir.z], power * f * 1.6);
        if (!veh.isPlayer && f > 0.1 && veh.state !== 'wreck') this.wreckVehicle(veh);
      }
    }
  }

  crashbreaker() {
    const pl = this.player, b = pl.body;
    const c = new THREE.Vector3().copy(b.position);
    this.fx.explosion(c, 1.6);
    this.sound('boom', c);
    this.cam.shake = 2;
    this.blast(b.position, 24, 20, pl);
    b.wakeUp();
    b.velocity.y += 11;
    b.angularVelocity.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5);
    pl.blowUp(18, true);
  }

  explodeTanker(v) {
    const c = new THREE.Vector3().copy(v.body.position);
    this.fx.explosion(c, 1.3);
    this.sound('boom', c);
    this.cam.shake = Math.max(this.cam.shake, 1.2);
    this.blast(v.body.position, 18, 14, v);
    v.body.wakeUp();
    v.body.velocity.y += 7;
    v.blowUp(14, true);
    if (this.mode.counting) this.mode.addBonus(25000, 'TANKVOGN BOOM! +$25.000');
  }

  update(dt) {
    const inp = this.game.input;
    this.clockT += dt;
    this.mode.frame(dt, inp);
    const simDt = dt * this.timeScale;
    if (simDt > 0) {
      const n = Math.max(1, Math.ceil(simDt / STEP - 1e-6));
      const h = simDt / n;
      const dm = this.mode.driveMode();
      for (let i = 0; i < n; i++) {
        this.traffic.step(h);
        this.driver.step(h, inp, dm);
        const v0 = this.player.body.velocity.length();
        this.world.step(h);
        // Fallback crash trigger: a sudden loss of speed means we hit something hard.
        if (this.mode.state === 'runup' && v0 - this.player.body.velocity.length() > 9) this.mode.startCrash();
        this.processCollisions();
      }
    }
    for (const v of this.vehicles) {
      v.sync(simDt);
      if (v.explosive && !v.exploded) {
        if (v.explodeT < 0 && v.damage > v.tough * 0.45) v.explodeT = 0.5;
        if (v.explodeT >= 0) { v.explodeT -= simDt; if (v.explodeT < 0) { v.exploded = true; this.explodeTanker(v); } }
      }
    }
    this.player.sync(simDt);
    if (this.player.flames) {
      const on = this.driver.boosting;
      for (const f of this.player.flames) { f.visible = on; if (on) f.scale.set(1, 1, 0.7 + Math.random() * 0.6); }
    }
    for (const pr of this.props) {
      if (pr.b.sleepState === CANNON.Body.SLEEPING) continue;
      pr.obj.position.copy(pr.b.position); pr.obj.quaternion.copy(pr.b.quaternion);
    }
    this.debris.sync();
    this.fx.update(simDt);
    this.cam.update(dt, this);
    const P = this.player.root.position;
    this.sun.position.copy(P).addScaledVector(this.game.sunDir, 150);
    this.sun.target.position.copy(P);
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) if (!m.userData.shared) m.dispose();
    });
  }
}
