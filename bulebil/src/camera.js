import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from './config.js';

const _ray = new CANNON.RaycastResult(), _a = new CANNON.Vec3(), _b = new CANNON.Vec3();

const _v = new THREE.Vector3(), _f = new THREE.Vector3();

export class CamRig {
  constructor(cam) {
    this.cam = cam;
    this.pos = new THREE.Vector3(0, 20, -40);
    this.look = new THREE.Vector3();
    this.mode = 'intro';
    this.angle = 0; this.shake = 0; this.snap = true;
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.dist = 13;
  }

  setMode(mode, s) {
    if (mode === this.mode) return;
    const P = s.player.root.position;
    if (mode === 'crash' || mode === 'breaker' || mode === 'results') this.angle = Math.atan2(this.pos.x - P.x, this.pos.z - P.z);
    this.mode = mode;
  }

  update(dt, s) {
    const P = s.player.root.position;
    const cam = this.cam;
    let fovT = 62, kPos = 1 - Math.exp(-9 * dt), kLook = 1 - Math.exp(-12 * dt);
    const desired = _v;
    if (this.mode === 'intro') {
      const [fx, fz] = s.def.focus;
      const t = s.mode.stateT;
      this.angle += dt * 0.3;
      const R = 75 - t * 7;
      desired.set(fx + Math.cos(this.angle) * R, 30 - t * 4, fz + Math.sin(this.angle) * R);
      this.look.set(fx, 2, fz);
      kPos = 1 - Math.exp(-3 * dt);
    } else if (this.mode === 'chase') {
      _f.set(0, 0, 1).applyQuaternion(s.player.root.quaternion);
      _f.y = 0;
      if (_f.lengthSq() > 0.01) this.fwd.lerp(_f.normalize(), 1 - Math.exp(-6 * dt)).normalize();
      const spd = s.player.body.velocity.length();
      desired.copy(P).addScaledVector(this.fwd, -7.4 - spd * 0.02).add(_f.set(0, 2.5, 0));
      const lookT = _f.copy(P).addScaledVector(this.fwd, 4).add(_v.clone().set(0, 0.9, 0));
      desired.set(desired.x, Math.max(desired.y, P.y + 1.6), desired.z);
      this.look.lerp(lookT, this.snap ? 1 : kLook);
      fovT = 62 + Math.min(10, spd * 0.15) + (s.driver.boosting ? 5 : 0);
      kPos = 1 - Math.exp(-14 * dt);
    } else {
      const far = this.mode === 'breaker' ? 1.8 : this.mode === 'results' ? 1.6 : 1;
      this.angle += dt * (this.mode === 'results' ? 0.18 : 0.28);
      const R = 12 * far, H = 5 * far;
      desired.set(P.x + Math.sin(this.angle) * R, P.y + H, P.z + Math.cos(this.angle) * R);
      this.look.lerp(P, kLook);
      kPos = 1 - Math.exp(-2.5 * dt);
      fovT = 60;
    }
    // Keep the camera on our side of walls/buildings in the orbit modes.
    if (this.mode !== 'chase' && this.mode !== 'intro') {
      const T = this.mode === 'intro' ? this.look : P;
      _a.set(T.x, T.y + 1, T.z); _b.set(desired.x, desired.y, desired.z);
      _ray.reset();
      if (s.world.raycastClosest(_a, _b, { collisionFilterMask: G.STATIC, skipBackfaces: true }, _ray) && _ray.body.userData?.kind !== 'ground') {
        const hp = _ray.hitPointWorld;
        desired.set(hp.x, hp.y, hp.z).lerp(_f.set(T.x, T.y + 1, T.z), 0.15);
        desired.y += 1.5;
        kPos = 1 - Math.exp(-8 * dt);
      }
    }
    if (this.snap) { this.pos.copy(desired); this.snap = false; } else this.pos.lerp(desired, kPos);
    this.pos.y = Math.max(this.pos.y, 0.7);
    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-6 * dt);
    }
    cam.lookAt(this.look);
    cam.fov += (fovT - cam.fov) * (1 - Math.exp(-4 * dt));
    cam.updateProjectionMatrix();
  }
}
