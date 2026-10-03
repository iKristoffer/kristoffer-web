// Pooled visual effects: sparks (points), glass shards (instanced), smoke & fire (sprites), flash light.
import * as THREE from 'three';
import { smokeTexture, glowTexture } from './textures.js';

const _m = new THREE.Matrix4(), _o = new THREE.Object3D(), _c = new THREE.Color();

export class FX {
  constructor(s) {
    this.s = s;
    const scene = s.scene;

    // Sparks
    const N = this.nSpark = 1600;
    this.sp = { pos: new Float32Array(N * 3), col: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), i: 0 };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sp.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.sp.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.22, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Glass shards
    const NS = this.nShard = 1200;
    this.sh = { pos: new Float32Array(NS * 3), vel: new Float32Array(NS * 3), rot: new Float32Array(NS * 3), rv: new Float32Array(NS * 3), life: new Float32Array(NS), i: 0 };
    this.shardMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 0.012, 0.07),
      new THREE.MeshPhysicalMaterial({ color: 0xa8d4e6, metalness: 0.6, roughness: 0.05, clearcoat: 1, envMapIntensity: 2 }),
      NS);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < NS; i++) this.shardMesh.setMatrixAt(i, _m);
    scene.add(this.shardMesh);

    // Sprites
    this.smokes = this.makePool(160, smokeTexture(), THREE.NormalBlending);
    this.fires = this.makePool(120, glowTexture(), THREE.AdditiveBlending);

    this.flash = new THREE.PointLight(0xffa040, 0, 60, 1.2);
    scene.add(this.flash);
    this.flashI = 0;
  }

  makePool(n, map, blending) {
    const pool = { items: [], i: 0 };
    for (let k = 0; k < n; k++) {
      const mat = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending, opacity: 0, toneMapped: blending !== THREE.AdditiveBlending });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      this.s.scene.add(spr);
      pool.items.push({ spr, vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grow: 1, op: 1 });
    }
    return pool;
  }

  sparks(p, n, speed = 9, base) {
    const S = this.sp;
    n = Math.min(n | 0, 200);
    for (let k = 0; k < n; k++) {
      const i = S.i; S.i = (S.i + 1) % this.nSpark;
      S.pos[i * 3] = p.x; S.pos[i * 3 + 1] = p.y; S.pos[i * 3 + 2] = p.z;
      const v = speed * (0.3 + Math.random());
      S.vel[i * 3] = (Math.random() - 0.5) * v + (base ? base.x * 0.5 : 0);
      S.vel[i * 3 + 1] = Math.random() * v * 0.8 + 1;
      S.vel[i * 3 + 2] = (Math.random() - 0.5) * v + (base ? base.z * 0.5 : 0);
      S.max[i] = S.life[i] = 0.3 + Math.random() * 0.6;
    }
  }

  shards(p, n, base) {
    const S = this.sh;
    for (let k = 0; k < n; k++) {
      const i = S.i; S.i = (S.i + 1) % this.nShard;
      S.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.8; S.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.3; S.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.8;
      S.vel[i * 3] = (base?.x || 0) * 0.7 + (Math.random() - 0.5) * 7;
      S.vel[i * 3 + 1] = Math.random() * 5 + 1;
      S.vel[i * 3 + 2] = (base?.z || 0) * 0.7 + (Math.random() - 0.5) * 7;
      for (let j = 0; j < 3; j++) { S.rot[i * 3 + j] = Math.random() * 6; S.rv[i * 3 + j] = (Math.random() - 0.5) * 25; }
      S.life[i] = 5 + Math.random() * 3;
    }
  }

  emit(pool, p, n, o) {
    for (let k = 0; k < n; k++) {
      const it = pool.items[pool.i]; pool.i = (pool.i + 1) % pool.items.length;
      it.spr.position.set(p.x + (Math.random() - 0.5) * (o.spread || 0.5), p.y + (Math.random() - 0.5) * (o.spread || 0.5), p.z + (Math.random() - 0.5) * (o.spread || 0.5));
      it.vel.set((Math.random() - 0.5) * (o.jitter ?? 1.5), (o.rise ?? 1.5) * (0.6 + Math.random() * 0.6), (Math.random() - 0.5) * (o.jitter ?? 1.5));
      if (o.vel) it.vel.add(o.vel);
      it.max = it.life = (o.life ?? 2) * (0.7 + Math.random() * 0.6);
      it.size = (o.size ?? 1.5) * (0.7 + Math.random() * 0.6);
      it.grow = o.grow ?? 1.8;
      it.op = o.opacity ?? 0.8;
      it.spr.material.color.set(o.color ?? 0xffffff);
      it.spr.material.rotation = Math.random() * 6.28;
      it.spr.visible = true;
    }
  }
  smoke(p, n, o = {}) { this.emit(this.smokes, p, n, { color: 0x666666, ...o }); }
  fire(p, n, size = 2) { this.emit(this.fires, p, n, { color: 0xff7a1a, size, life: 0.6, rise: 3, grow: 0.6, opacity: 1, spread: 1 }); }

  explosion(p, scale = 1) {
    this.emit(this.fires, p, 26 * scale, { color: 0xffa040, size: 4 * scale, life: 0.8, rise: 5, jitter: 10 * scale, grow: 1.2, opacity: 1, spread: 2 * scale });
    this.emit(this.fires, p, 10, { color: 0xfff0c0, size: 6 * scale, life: 0.25, rise: 0, jitter: 2, grow: 2, opacity: 1, spread: 1 });
    this.smoke(p, 22 * scale, { color: 0x222222, size: 5 * scale, life: 4, rise: 4, jitter: 6 * scale, grow: 1.6, opacity: 0.85, spread: 3 * scale });
    this.sparks(p, 180, 22 * scale);
    this.flash.position.copy(p).y += 2;
    this.flashI = 400 * scale;
  }

  update(dt) {
    if (dt <= 0) return;
    // sparks
    const S = this.sp;
    for (let i = 0; i < this.nSpark; i++) {
      if (S.life[i] <= 0) { S.col[i * 3] = S.col[i * 3 + 1] = S.col[i * 3 + 2] = 0; continue; }
      S.life[i] -= dt;
      const j = i * 3;
      S.vel[j + 1] -= 16 * dt;
      S.pos[j] += S.vel[j] * dt; S.pos[j + 1] += S.vel[j + 1] * dt; S.pos[j + 2] += S.vel[j + 2] * dt;
      if (S.pos[j + 1] < 0.03) { S.pos[j + 1] = 0.03; S.vel[j + 1] *= -0.35; S.vel[j] *= 0.6; S.vel[j + 2] *= 0.6; }
      const t = Math.max(0, S.life[i] / S.max[i]);
      S.col[j] = 3 * t; S.col[j + 1] = 1.6 * t * t; S.col[j + 2] = 0.4 * t * t * t;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // shards
    const H = this.sh;
    let any = false;
    for (let i = 0; i < this.nShard; i++) {
      if (H.life[i] <= 0) continue;
      any = true;
      H.life[i] -= dt;
      const j = i * 3;
      const grounded = H.pos[j + 1] <= 0.03;
      if (!grounded) {
        H.vel[j + 1] -= 16 * dt;
        H.pos[j] += H.vel[j] * dt; H.pos[j + 1] += H.vel[j + 1] * dt; H.pos[j + 2] += H.vel[j + 2] * dt;
        H.rot[j] += H.rv[j] * dt; H.rot[j + 1] += H.rv[j + 1] * dt; H.rot[j + 2] += H.rv[j + 2] * dt;
        if (H.pos[j + 1] < 0.03) {
          H.pos[j + 1] = 0.03;
          if (Math.abs(H.vel[j + 1]) > 2) { H.vel[j + 1] *= -0.25; H.vel[j] *= 0.5; H.vel[j + 2] *= 0.5; H.pos[j + 1] = 0.031; }
          else { H.rot[j] = 0; H.rot[j + 2] = 0; }
        }
      }
      const sc = H.life[i] > 0 ? Math.min(1, H.life[i]) : 0;
      _o.position.set(H.pos[j], H.pos[j + 1], H.pos[j + 2]);
      _o.rotation.set(H.rot[j], H.rot[j + 1], H.rot[j + 2]);
      _o.scale.setScalar(sc);
      _o.updateMatrix();
      this.shardMesh.setMatrixAt(i, _o.matrix);
    }
    if (any) this.shardMesh.instanceMatrix.needsUpdate = true;

    for (const pool of [this.smokes, this.fires]) {
      for (const it of pool.items) {
        if (!it.spr.visible) continue;
        it.life -= dt;
        if (it.life <= 0) { it.spr.visible = false; continue; }
        const t = 1 - it.life / it.max;
        it.spr.position.addScaledVector(it.vel, dt);
        it.vel.multiplyScalar(Math.exp(-1.5 * dt));
        it.spr.scale.setScalar(it.size * (1 + it.grow * t));
        it.spr.material.opacity = it.op * Math.min(1, t * 8) * (1 - t);
      }
    }

    this.flashI *= Math.exp(-7 * dt);
    this.flash.intensity = this.flashI;
  }
}
