// Arcade driving model on top of a single rigid box (no wheel physics):
// we push velocity along the car's forward axis, remove lateral slip up to a grip limit
// (beyond it the car slides) and steer the yaw rate with a speed-capped bicycle model.
import * as CANNON from 'cannon-es';
import { G, DRIVE as D } from './config.js';
import { clamp } from './util.js';

const FWD = new CANNON.Vec3(0, 0, 1), RIGHT = new CANNON.Vec3(-1, 0, 0);
const _f = new CANNON.Vec3(), _r = new CANNON.Vec3(), _F = new CANNON.Vec3(), _w = new CANNON.Vec3();

export class PlayerDriver {
  constructor(s, veh, spec) {
    this.s = s; this.v = veh; this.spec = spec;
    this.boost = 0.5; this.boosting = false; this.grounded = true;
    this.ray = new CANNON.RaycastResult();
    this.from = new CANNON.Vec3(); this.to = new CANNON.Vec3();
    this.steer = 0; this.roll = 0; this.pitch = 0; this.smokeT = 0;
  }

  // mode: 'hold' | 'drive' | 'after' | 'none'
  step(h, inp, mode) {
    const b = this.v.body, spec = this.spec;
    if (mode === 'hold') {
      b.velocity.x = 0; b.velocity.z = 0;
      b.angularVelocity.setZero();
      return;
    }
    b.quaternion.vmult(FWD, _f);
    b.quaternion.vmult(RIGHT, _r);
    if (mode === 'drive') {
      this.from.copy(b.position);
      this.to.set(b.position.x, b.position.y - (this.v.kit.originY + 0.5), b.position.z);
      this.ray.reset();
      this.grounded = this.s.world.raycastClosest(this.from, this.to, { collisionFilterMask: G.STATIC, skipBackfaces: true }, this.ray)
        && this.ray.body.userData?.kind === 'ground' && this.ray.hitNormalWorld.y > 0.8;
      const v = b.velocity;
      const fs = v.dot(_f), ls = v.dot(_r);
      const thr = inp.throttle, brk = inp.brake, hb = inp.handbrake;
      this.boosting = inp.boost && this.boost > 0.01 && thr > 0.1;
      if (this.boosting) this.boost = Math.max(0, this.boost - h * 0.2);

      // Steering wheel: ramps in, returns to centre faster (keyboard is digital ±1).
      const target = inp.steer;
      const back = target === 0 || Math.sign(target) !== Math.sign(this.steer);
      const rate = back ? D.steerOut : D.steerIn;
      this.steer += clamp(target - this.steer, -rate * h, rate * h);

      const sp = Math.abs(fs);
      // Surface: off the tarmac (test track) there is less grip and more drag.
      const surf = this.s.surfaceGrip ? this.s.surfaceGrip(b.position.x, b.position.z) : 1;
      this.lat = ls; this.offroad = surf < 1;
      let acc = 0;
      if (this.grounded) {
        const max = this.boosting ? spec.boostSpeed : spec.maxSpeed;
        if (thr > 0 && fs < max) acc += thr * (spec.accel * D.accelMul * (1 - Math.max(0, fs) / max) + 4);
        if (this.boosting && fs < max) acc += 14;
        if (brk > 0) { if (fs > 0.5) acc -= brk * 30; else if (fs > -14) acc -= brk * 12; }
        if (hb) acc -= clamp(fs * 0.8, -6, 6);
        if (thr === 0 && brk === 0) acc -= clamp(fs * 0.5, -2.5, 2.5);
        if (fs > max + 1) acc -= (fs - max) * 1.2;
        acc -= clamp(Math.abs(ls) * D.slideScrub, 0, 6) * Math.sign(fs); // sliding scrubs speed
        if (surf < 1) acc -= clamp(fs * 0.12, -4, 4);
        v.x += _f.x * acc * h; v.y += _f.y * acc * h; v.z += _f.z * acc * h;

        // Tyre grip: lateral velocity is removed at a limited rate (m/s²). Beyond it, the car slides.
        const grip = (hb ? D.hbGrip : D.grip) * (this.boosting ? 0.9 : 1) * surf;
        const cut = clamp(ls, -grip * h, grip * h);
        v.x -= _r.x * cut; v.y -= _r.y * cut; v.z -= _r.z * cut;

        // Yaw from a bicycle model (wheelbase), capped by what the grip can hold at this speed.
        const wb = this.v.kit.dims.L * 0.6;
        const angle = this.steer * D.maxAngle / (1 + sp / D.angleFalloff);
        let yaw = -fs * Math.tan(angle) / wb;
        const cap = ((hb ? D.hbYawCap : D.yawCap) * D.grip * surf) / Math.max(sp, 4);
        yaw = clamp(yaw, -cap, cap);
        b.angularVelocity.y += (yaw - b.angularVelocity.y) * Math.min(1, (hb ? D.yawResponse * 0.6 : D.yawResponse) * h);
        b.angularVelocity.x *= Math.exp(-4 * h);
        b.angularVelocity.z *= Math.exp(-4 * h);
        v.y -= 8 * h;

        // Tyre smoke while sliding
        this.smokeT -= h;
        if (Math.abs(ls) > 5 && sp > 8 && this.smokeT <= 0) {
          this.smokeT = 0.05;
          for (const sx of [-1, 1]) {
            _w.set(sx * this.v.kit.dims.W * 0.42, 0.25 - this.v.kit.originY, -this.v.kit.dims.L * 0.32);
            b.pointToWorldFrame(_w, _w);
            this.s.fx.smoke(_w, 1, { color: 0xd8d8d8, size: 1.3, life: 1.4, rise: 0.6, jitter: 1.5, opacity: 0.45 });
          }
        }
      } else {
        b.angularVelocity.y *= Math.exp(-h);
      }

      // Visual weight transfer: body rolls out of corners and pitches under throttle/brake.
      const latAcc = this.grounded ? fs * b.angularVelocity.y : 0;
      this.latAcc = latAcc;
      this.roll += (clamp(latAcc * D.roll, -0.065, 0.065) - this.roll) * Math.min(1, 6 * h);
      this.pitch += (clamp(-acc * D.pitch, -0.045, 0.045) - this.pitch) * Math.min(1, 6 * h);
      this.v.model.rotation.set(this.pitch, 0, this.roll);
      this.v.steerVis = -this.steer * 0.5 / (1 + sp / 30);
    } else if (mode === 'after') {
      // Aftertouch: nudge the wreck relative to the camera view.
      const cam = this.s.game.camera;
      const cx = -cam.matrixWorld.elements[8], cz = -cam.matrixWorld.elements[10];
      const cl = Math.hypot(cx, cz) || 1;
      const fx = cx / cl, fz = cz / cl, rx = -fz, rz = fx;
      const st = inp.steer, fb = inp.throttle - inp.brake;
      if ((st || fb) && b.velocity.length() > 1.5) {
        const F = b.mass * 15;
        _F.set((rx * st + fx * fb * 0.5) * F, 0, (rz * st + fz * fb * 0.5) * F);
        b.applyForce(_F);
        b.wakeUp();
      }
      this.boosting = false;
      this.v.model.rotation.set(0, 0, 0);
    }
  }
}
