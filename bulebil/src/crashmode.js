// Crash Mode rules: intro flyby → rev-start countdown → run-up → crash (aftertouch, impact time,
// crashbreaker) → results. Score = (vehicle damage $ + bonus $) × multiplier (½ with Heartbreaker).
import * as THREE from 'three';
import { iconTexture } from './textures.js';
import { BIG_NAMES } from './vehicleModel.js';
import { fmtMoney } from './util.js';
import { loadBest, saveBest, medalFor } from './hud.js';

const ZONE = [0.68, 0.84];
const PICK_COL = { x2: 0xffb000, x4: 0xff6a00, cash: 0x20c45a, heart: 0xe0153f, breaker: 0xff3d00 };

export class CrashMode {
  constructor(s) {
    this.s = s; this.def = s.def;
    this.state = 'intro'; this.stateT = 0;
    this.damageCash = 0; this.bonus = 0; this.mult = 1; this.heart = false; this.cars = 0;
    this.breakerReady = false; this.breakerUsed = false; this.counting = false;
    this.crashT = 0; this.lastWreck = 0; this.rev = 0; this.impactBudget = 2.5;
    this.slowT = 0; this.slowScale = 1; this.runT = 0; this.lastBeep = -1;
    this.best = loadBest(this.def.id);
    this.buildPickups();
    const hud = s.game.hud;
    hud.runStart(this.def, this.best);
    hud.banner(this.def.name, this.def.blurb);
  }

  buildPickups() {
    this.pickups = this.def.pickups.map(p => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.09, 10, 40), new THREE.MeshBasicMaterial({ color: PICK_COL[p.type], toneMapped: false }));
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexture(p.type), toneMapped: false, transparent: true }));
      icon.scale.setScalar(1.7);
      g.add(ring, icon);
      g.position.set(p.x, p.y ?? 1.4, p.z);
      this.s.scene.add(g);
      return { ...p, g, ring, baseY: g.position.y, taken: false };
    });
  }

  setState(st) { this.state = st; this.stateT = 0; }

  driveMode() {
    if (this.state === 'runup') return 'drive';
    if (this.state === 'crash' || this.state === 'prompt') return 'after';
    if (this.state === 'intro' || this.state === 'countdown') return 'hold';
    return 'none';
  }

  frame(dt, inp) {
    const s = this.s, hud = s.game.hud, au = s.game.audio;
    this.stateT += dt;
    let ts = 1;

    if (this.state === 'intro') {
      s.cam.setMode('intro', s);
      if (this.stateT > 4.2 || (this.stateT > 0.3 && (inp.pressed('Space') || inp.pressed('Enter') || inp.throttle > 0.5))) {
        hud.banner(null);
        this.setState('countdown');
        s.cam.mode = 'chase'; s.cam.snap = true;
      }
    } else if (this.state === 'countdown') {
      const n = 3 - Math.floor(this.stateT);
      if (n !== this.lastBeep && n > 0) { this.lastBeep = n; au.beep(false); }
      if (inp.throttle > 0.1) this.rev = Math.min(1.1, this.rev + dt * (0.45 + 0.6 * Math.sin(this.stateT * 7) ** 2));
      else this.rev = Math.max(0, this.rev - dt * 1.3);
      hud.countdown(n > 0 ? String(n) : 'KØR!', this.rev, ZONE);
      au.engine(this.rev, inp.throttle, true);
      if (this.rev > 0.5 && Math.random() < dt * 8) this.rearSmoke(1);
      if (this.stateT >= 3) this.go();
    } else if (this.state === 'runup') {
      this.runT += dt;
      if (this.runT < 0.7) hud.countdown('KØR!', this.rev, ZONE); else hud.countdown(null);
      if (this.runT > (this.def.runLimit || 45)) this.startCrash();
    } else if (this.state === 'crash' || this.state === 'prompt') {
      this.crashT += dt * s.timeScale;
      if (inp.boost && this.impactBudget > 0 && this.crashT > 0.4) { ts = Math.min(ts, 0.3); this.impactBudget = Math.max(0, this.impactBudget - dt); }
      if (inp.pressed('Space') && this.breakerReady && !this.breakerUsed) this.crashbreaker();
      const speed = s.player.body.velocity.length();
      if (this.state === 'crash') {
        const settled = this.crashT > 4 && this.crashT - this.lastWreck > 3.5 && speed < 2;
        if (settled || this.crashT > 30) {
          if (this.breakerReady && !this.breakerUsed) { this.setState('prompt'); hud.prompt('CRASHBREAKER! TRYK MELLEMRUM'); }
          else this.finish();
        }
      } else if (this.stateT > 5) this.finish();
    } else if (this.state === 'results') {
      if (inp.pressed('Enter')) this.s.game.restart();
    }

    if (this.slowT > 0) { this.slowT -= dt; ts = Math.min(ts, this.slowScale); }
    s.timeScale += (ts - s.timeScale) * Math.min(1, dt * 10);
    au.slowmo(s.timeScale < 0.6);

    // engine audio during the run
    if (this.state === 'runup') {
      const sp = Math.max(0, s.player.speedFwd());
      const gearPos = (sp / s.driver.spec.maxSpeed) * 4;
      const rpm = 0.25 + (gearPos % 1) * 0.6 + Math.min(gearPos, 4) * 0.04;
      au.engine(rpm, inp.throttle, true);
    } else if (this.state !== 'countdown') au.engine(0, 0, false);

    // pickups
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      pk.ring.rotation.y += dt * 2.2;
      pk.g.position.y = pk.baseY + Math.sin(this.s.clockT * 2.5 + pk.x) * 0.15;
      if (this.state === 'runup' || this.state === 'crash' || this.state === 'prompt') {
        if (pk.g.position.distanceTo(s.player.root.position) < 3.0) this.collect(pk);
      }
    }

    // live damage tally
    let sum = 0;
    for (const v of s.vehicles) if (v.involved) sum += v.earned();
    this.damageCash = sum;
    if (this.state !== 'results') hud.update(dt, this);
  }

  rearSmoke(n) {
    const v = this.s.player;
    const p = new THREE.Vector3(0, 0.3, -v.kit.dims.L / 2);
    v.root.localToWorld(p);
    this.s.fx.smoke(p, n, { color: 0xdddddd, size: 1.6, life: 1.6, rise: 0.8, jitter: 2.5, opacity: 0.6 });
  }

  go() {
    const s = this.s, hud = s.game.hud, au = s.game.audio;
    const f = s.player.forward();
    let v0;
    if (this.rev >= ZONE[0] && this.rev <= ZONE[1]) {
      v0 = 15; s.driver.boost = 1;
      hud.msg('PERFEKT START!', 'gold'); au.boost();
    } else if (this.rev > 0.95) {
      v0 = 4; hud.msg('HJULSPIN!', 'red'); this.rearSmoke(12);
    } else v0 = this.rev * 8;
    s.player.body.velocity.set(f.x * v0, 0, f.z * v0);
    au.beep(true);
    this.setState('runup');
  }

  startCrash() {
    if (this.state !== 'runup') return;
    const s = this.s;
    this.setState('crash');
    this.counting = true;
    this.crashT = 0; this.lastWreck = 0;
    this.slowT = 1.0; this.slowScale = 0.22;
    s.player.wreck();
    s.player.steerVis = 0;
    s.game.hud.countdown(null);
    s.game.hud.msg('CRASH!', 'big');
    s.cam.setMode('crash', s);
    s.driver.boosting = false;
  }

  onWreck(v) {
    if (!this.counting || v.involved || v.isPlayer) return;
    v.involved = true;
    this.cars++;
    this.lastWreck = this.crashT;
    const hud = this.s.game.hud;
    if (BIG_NAMES[v.type]) hud.msg(BIG_NAMES[v.type], 'small');
    if (!this.breakerUsed && !this.breakerReady && this.cars >= this.def.breakerCars) {
      this.breakerReady = true;
      hud.msg('CRASHBREAKER KLAR!', 'gold');
      this.s.game.audio.pickup(true);
    }
  }

  addBonus(amount, label) {
    this.bonus += amount;
    this.s.game.hud.msg(label || '+' + fmtMoney(amount), 'gold');
  }

  collect(pk) {
    pk.taken = true;
    this.s.scene.remove(pk.g);
    const hud = this.s.game.hud, au = this.s.game.audio;
    this.s.fx.sparks(pk.g.position, 60, 10);
    switch (pk.type) {
      case 'x2': this.mult *= 2; hud.msg('×2 MULTIPLIKATOR', 'gold'); au.pickup(true); break;
      case 'x4': this.mult *= 4; hud.msg('×4 MULTIPLIKATOR', 'gold'); au.pickup(true); break;
      case 'cash': this.addBonus(pk.amount); au.pickup(true); break;
      case 'heart': this.heart = true; hud.msg('HEARTBREAKER! ½', 'red'); au.pickup(false); break;
      case 'breaker':
        if (!this.breakerUsed) { this.breakerReady = true; hud.msg('CRASHBREAKER KLAR!', 'gold'); }
        au.pickup(true);
        break;
    }
  }

  crashbreaker() {
    const s = this.s;
    this.breakerUsed = true; this.breakerReady = false;
    s.crashbreaker();
    this.slowT = 1.4; this.slowScale = 0.3;
    this.lastWreck = this.crashT;
    s.game.hud.msg('CRASHBREAKER!', 'huge');
    s.game.hud.prompt(null);
    s.cam.setMode('breaker', s);
    if (this.state === 'prompt') this.setState('crash');
  }

  finish() {
    const s = this.s;
    this.setState('results');
    s.cam.setMode('results', s);
    const total = Math.round((this.damageCash + this.bonus) * this.mult * (this.heart ? 0.5 : 1));
    const medal = medalFor(total, this.def.medals);
    const newBest = !this.best || total > this.best.score;
    if (newBest) saveBest(this.def.id, { score: total, medal: Math.max(medal, this.best?.medal ?? -1) });
    else if (medal > (this.best.medal ?? -1)) saveBest(this.def.id, { ...this.best, medal });
    s.game.hud.results({ cars: this.cars, damage: this.damageCash, bonus: this.bonus, mult: this.mult, heart: this.heart, total, medal, newBest });
  }
}
