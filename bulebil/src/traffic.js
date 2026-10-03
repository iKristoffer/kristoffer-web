// Lane-following traffic. Driving cars are velocity-driven (frictionless "driving" material);
// once hit they become free rigid bodies ("wreck") and stop being managed here.
import * as CANNON from 'cannon-es';
import { Vehicle } from './vehicle.js';
import { MODELS } from './vehicleModel.js';
import { TRAFFIC_COLORS } from './config.js';
import { pick } from './util.js';

const Y = new CANNON.Vec3(0, 1, 0);
const DECEL = 7, ACCEL = 3.5, MAX_CARS = 38;

export class Traffic {
  constructor(s, def) {
    this.s = s;
    this.signals = def.signals || null;
    this.phaseT = Math.random() * 5;
    this.lanes = def.lanes.map(l => {
      const [ax, az] = l.A, [bx, bz] = l.B;
      const len = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const q = new CANNON.Quaternion().setFromAxisAngle(Y, Math.atan2(ux, uz));
      return { ...l, ax, az, ux, uz, len, q, cars: [], timer: Math.random() * l.interval };
    });
    this.count = 0;
  }

  // 'green' | 'amber' | 'red'
  light(group) {
    if (!this.signals || group < 0) return 'green';
    const { groups, green, allRed } = this.signals;
    const slot = green + allRed;
    const t = this.phaseT % (slot * groups);
    const idx = Math.floor(t / slot), within = t - idx * slot;
    if (idx !== group || within >= green) return 'red';
    return within > green - 2.2 ? 'amber' : 'green';
  }

  tOf(car, lane) {
    const p = car.body.position;
    return (p.x - lane.ax) * lane.ux + (p.z - lane.az) * lane.uz;
  }

  spawn(lane, t0) {
    const s = this.s;
    const type = pick(lane.types);
    const v = new Vehicle(s, type, pick(TRAFFIC_COLORS));
    v.setPose(lane.ax + lane.ux * t0, lane.az + lane.uz * t0, Math.atan2(lane.ux, lane.uz));
    v.lane = lane;
    v.laneSpeed = lane.speed * (0.9 + Math.random() * 0.2) * (MODELS[type].mass > 5000 ? 0.85 : 1);
    v.curSpeed = v.laneSpeed;
    v.halfL = v.kit.dims.L / 2;
    lane.cars.push(v);
    s.vehicles.push(v);
    this.count++;
    return v;
  }

  detach(v) {
    if (!v.lane) return;
    const i = v.lane.cars.indexOf(v);
    if (i >= 0) v.lane.cars.splice(i, 1);
    v.lane = null;
    this.count--;
  }

  spawnClear(lane) {
    const x = lane.ax, z = lane.az;
    for (const v of this.s.vehicles) {
      if (v.removed) continue;
      const p = v.body.position;
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < 14 * 14) return false;
    }
    return true;
  }

  step(h) {
    this.phaseT += h;
    for (const lane of this.lanes) {
      lane.timer -= h;
      if (lane.timer <= 0) {
        if (this.count < MAX_CARS && this.spawnClear(lane)) {
          this.spawn(lane, 0);
          lane.timer = lane.interval * (0.7 + Math.random() * 0.6);
        } else lane.timer = 0.4;
      }
      let ahead = null, aheadT = 0;
      for (let i = 0; i < lane.cars.length; i++) {
        const v = lane.cars[i];
        const t = this.tOf(v, lane);
        if (t > lane.len) { this.detach(v); this.s.removeVehicle(v); i--; continue; }
        let desired = v.laneSpeed;
        if (lane.stopT != null && t < lane.stopT - 0.3) {
          const st = this.light(lane.group);
          const dist = lane.stopT - (t + v.halfL);
          if (st === 'red' || (st === 'amber' && dist > 14)) desired = Math.min(desired, Math.sqrt(2 * DECEL * Math.max(0, dist - 0.8)));
        }
        if (ahead) {
          const gap = aheadT - t - ahead.halfL - v.halfL - 2.2;
          desired = Math.min(desired, Math.sqrt(2 * DECEL * Math.max(0, gap)) + ahead.curSpeed * 0.9);
        }
        if (desired > v.curSpeed) v.curSpeed = Math.min(desired, v.curSpeed + ACCEL * h);
        else v.curSpeed = Math.max(desired, v.curSpeed - DECEL * 1.6 * h);
        const b = v.body;
        b.velocity.x = lane.ux * v.curSpeed;
        b.velocity.z = lane.uz * v.curSpeed;
        b.quaternion.copy(lane.q);
        b.angularVelocity.setZero();
        ahead = v; aheadT = t;
      }
    }
    // signal lamps
    if (this.s.signalHeads) {
      for (const sh of this.s.signalHeads) {
        const st = this.light(sh.group);
        sh.lamps[0].emissiveIntensity = st === 'red' ? 3 : 0;
        sh.lamps[1].emissiveIntensity = st === 'amber' ? 3 : 0;
        sh.lamps[2].emissiveIntensity = st === 'green' ? 3 : 0;
      }
    }
  }

  // Fill the lanes so the junction is busy at start: spawn along each lane, then run coarse steps.
  prewarm(seconds) {
    const s = this.s;
    for (const lane of this.lanes) {
      const gap = lane.speed * lane.interval;
      const maxT = lane.stopT != null ? lane.stopT - 4 : lane.len - 20;
      for (let t = maxT; t > 10; t -= gap * (0.8 + Math.random() * 0.4)) {
        if (this.count >= MAX_CARS) break;
        this.spawn(lane, t);
      }
      lane.cars.sort((a, b) => this.tOf(b, lane) - this.tOf(a, lane));
    }
    const h = 1 / 30;
    for (let i = 0; i < seconds / h; i++) {
      this.step(h);
      s.world.step(h);
      s.collisions.length = 0;
    }
  }
}
