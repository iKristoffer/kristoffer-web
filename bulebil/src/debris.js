// Detached car parts as real rigid bodies.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { G } from './config.js';
import { clamp } from './util.js';

const _wv = new CANNON.Vec3();

export class Debris {
  constructor(s) {
    this.s = s;
    this.items = [];
    this.max = 160;
  }

  add(obj, shape, shapeQ, pos, quat, mass, vel, ang) {
    const s = this.s;
    const b = new CANNON.Body({
      mass, material: s.mats.debris,
      collisionFilterGroup: G.DEBRIS, collisionFilterMask: G.STATIC | G.CAR | G.PROP,
      linearDamping: 0.05, angularDamping: 0.12,
    });
    b.addShape(shape, new CANNON.Vec3(), shapeQ || undefined);
    b.position.set(pos.x, pos.y, pos.z);
    b.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    b.velocity.copy(vel);
    b.angularVelocity.copy(ang);
    b.allowSleep = true; b.sleepSpeedLimit = 0.3; b.sleepTimeLimit = 0.7;
    b.userData = { kind: 'debris' };
    s.world.addBody(b);
    obj.position.copy(pos); obj.quaternion.copy(quat);
    s.scene.add(obj);
    this.items.push({ obj, b });
    if (this.items.length > this.max) this.remove(this.items.shift());
  }

  remove(it) {
    this.s.world.removeBody(it.b);
    this.s.scene.remove(it.obj);
    it.obj.traverse(o => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); });
  }

  launchVel(veh, wp, s) {
    veh.body.getVelocityAtWorldPoint(new CANNON.Vec3(wp.x, wp.y, wp.z), _wv);
    const k = Math.min(s, 40) * 0.13;
    return new CANNON.Vec3(_wv.x * 0.9 + (Math.random() - 0.5) * k * 2, _wv.y + 1.5 + Math.random() * k, _wv.z * 0.9 + (Math.random() - 0.5) * k * 2);
  }
  randAng(s) {
    const k = 3 + Math.min(s, 40) * 0.3;
    return new CANNON.Vec3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
  }

  fromPiece(veh, pc, s) {
    if (pc.detached) return;
    pc.detached = true;
    const g = pc.mesh.geometry;
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    const size = g.boundingBox.getSize(new THREE.Vector3());
    const g2 = g.clone();
    g2.translate(-c.x, -c.y, -c.z);
    const mesh = new THREE.Mesh(g2, pc.mesh.material);
    mesh.castShadow = true;
    veh.model.remove(pc.mesh);
    g.dispose();
    veh.root.updateMatrixWorld(true);
    const wp = veh.model.localToWorld(c.clone());
    const wq = veh.root.quaternion.clone();
    const half = new CANNON.Vec3(Math.max(0.04, size.x / 2), Math.max(0.04, size.y / 2), Math.max(0.04, size.z / 2));
    const mass = clamp(size.x * size.y * size.z * 120 + 3, 3, 40);
    this.add(mesh, new CANNON.Box(half), null, wp, wq, mass, this.launchVel(veh, wp, s), this.randAng(s));
    if (s > 4) this.s.fx.sparks(wp, 12, 6);
  }

  fromWheel(veh, w, s) {
    if (w.detached) return;
    w.detached = true;
    veh.root.updateMatrixWorld(true);
    const obj = w.outer;
    const wp = obj.getWorldPosition(new THREE.Vector3());
    const wq = obj.getWorldQuaternion(new THREE.Quaternion());
    veh.model.remove(obj);
    const shapeQ = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI / 2);
    this.add(obj, new CANNON.Cylinder(w.r, w.r, w.w, 14), shapeQ, wp, wq, 20, this.launchVel(veh, wp, s), this.randAng(s));
    this.s.fx.sparks(wp, 20, 7);
  }

  sync() {
    for (const it of this.items) {
      if (it.b.sleepState === CANNON.Body.SLEEPING) continue;
      it.obj.position.copy(it.b.position);
      it.obj.quaternion.copy(it.b.quaternion);
    }
  }
}
