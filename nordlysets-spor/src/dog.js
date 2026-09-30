import * as THREE from 'three';
import { makeDog, makeBlob, groundHeight, WORLD_RADIUS } from './world.js';

const MOOD = {
    follow: 'følger dig',
    explore: 'snuser rundt',
    point: 'har fundet noget',
    hunt: 'jager en hare',
    fetch: 'kommer med bytte',
    guard: 'vogter mod isbjørn',
    rest: 'hviler',
    warm: 'varmer dig',
    beg: 'er sulten',
    harness: 'trækker slæden',
    happy: 'logrer',
};

const tmp = new THREE.Vector3();

function angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

/**
 * Siku – slædehunden med sin egen lille hjerne.
 * Tilstande: follow, explore, point, hunt, fetch, guard, rest, warm, beg, harness, happy.
 */
export class Dog {
    constructor(scene, x, z, fur, name = 'Siku') {
        this.name = name;
        this.root = new THREE.Group();
        const parts = makeDog(fur);
        this.inner = parts.group;
        this.parts = parts;
        this.root.add(this.inner);
        const prey = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.13, 0.13), new THREE.MeshLambertMaterial({ color: '#f2f0ea' }));
        prey.position.set(0, -0.12, 0.3);
        prey.visible = false;
        parts.head.add(prey);
        parts.head.userData.prey = prey;
        this.pause = 0;
        this.blob = makeBlob(1.1, 0.3);
        scene.add(this.root, this.blob);
        this.pos = new THREE.Vector3(x, groundHeight(x, z), z);
        this.vel = new THREE.Vector3();
        this.yaw = 0;
        this.phase = 0;
        this.state = 'follow';
        this.stateT = 0;
        this.think = 0;
        this.target = new THREE.Vector3(x, 0, z);
        this.hunger = 90;
        this.energy = 100;
        this.love = 50;
        this.lie = 0;
        this.sit = 0;
        this.sniff = 0;
        this.wag = 0;
        this.barkT = 0;
        this.whineT = 10;
        this.prey = null;
        this.pointNode = null;
        this.pointed = new Map();
        this.carrying = false;
        this.happyT = 0;
    }

    get mood() {
        return MOOD[this.state] || '';
    }

    setState(s) {
        if (this.state === s) return;
        this.state = s;
        this.stateT = 0;
    }

    bark(G, emote = '❗') {
        if (this.barkT > 0) return;
        this.barkT = 1.2;
        G.sound.bark();
        G.emote(this.pos, emote);
    }

    pet(G) {
        this.love = Math.min(100, this.love + 15);
        this.happyT = 2.5;
        this.setState('happy');
        G.emote(this.pos, '❤️');
    }

    feed(G) {
        this.hunger = Math.min(100, this.hunger + 45);
        this.love = Math.min(100, this.love + 10);
        this.happyT = 2;
        this.setState('happy');
        G.emote(this.pos, '😋');
    }

    /** Hvor hunden skal stå i spandet, når slæden kører. */
    harnessSpot(G, out) {
        const p = G.player.pos, yaw = G.player.yaw;
        return out.set(p.x + Math.sin(yaw) * 3.9, 0, p.z + Math.cos(yaw) * 3.9);
    }

    decide(G) {
        const p = G.player.pos;
        const dP = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
        const moving = G.player.speed > 0.8;

        // 1. Fare går forud for alt
        let bear = null, bd = 22;
        for (const b of G.bears) {
            const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
            if (d < bd && b.flee <= 0) { bd = d; bear = b; }
        }
        if (bear) {
            this.prey = bear;
            this.setState('guard');
            return;
        }
        if (this.state === 'hunt' || this.state === 'fetch' || this.state === 'happy') return;

        // 2. Slæden
        if (G.S.has.sled && moving) { this.setState('harness'); return; }

        // 3. For langt væk -> tilbage
        if (dP > 16) { this.setState('follow'); return; }

        // 4. Sult
        if (this.hunger < 30 && (G.S.inv.meat > 0 || G.S.inv.cooked > 0) && dP < 12) { this.setState('beg'); return; }

        // 5. Storm / kulde: kryb ind til Arnarulunnguaq
        if (!moving && (G.S.storm > 0.5 || G.S.warmth < 35) && G.player.idle > 1.5) { this.setState('warm'); return; }

        // 6. Hvile ved bålet eller når hun står stille længe
        const nearFire = G.heaters.find((h) => h.lit && Math.hypot(h.x - p.x, h.z - p.z) < 6);
        if (!moving && ((nearFire && G.player.idle > 2) || G.player.idle > 14 || this.energy < 20)) {
            this.fire = nearFire || null;
            this.setState('rest');
            return;
        }

        // 7. Jagtinstinkt: harer
        if (this.hunger < 85 || Math.random() < 0.5) {
            let hare = null, hd = 15;
            for (const h of G.hares) {
                if (!h.alive) continue;
                const d = this.pos.distanceTo(h.pos);
                if (d < hd) { hd = d; hare = h; }
            }
            if (hare && Math.random() < 0.45) {
                this.prey = hare;
                this.setState('hunt');
                G.emote(this.pos, '❗');
                return;
            }
        }

        // 8. Snuse ressourcer op, som spilleren ikke har set
        if (Math.random() < 0.35) {
            let best = null, bnd = 16;
            for (const n of G.nodes) {
                if (n.charges <= 0) continue;
                const dn = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
                const dnp = Math.hypot(n.x - p.x, n.z - p.z);
                const last = this.pointed.get(n) || -999;
                if (dn < bnd && dnp > 7 && G.S.time - last > 90) { bnd = dn; best = n; }
            }
            if (best) {
                this.pointNode = best;
                this.pointed.set(best, G.S.time);
                this.setState('point');
                return;
            }
        }

        // 9. Ellers: følg med eller udforsk
        if (moving || dP > 7) this.setState('follow');
        else this.setState('explore');
    }

    update(dt, G) {
        const p = G.player.pos;
        this.stateT += dt;
        this.barkT -= dt;
        this.think -= dt;
        this.whineT -= dt;
        this.hunger = Math.max(0, this.hunger - dt * 0.16);
        const weak = this.hunger <= 0 ? 0.6 : 1;

        if (this.think <= 0) {
            this.think = 0.5 + Math.random() * 0.4;
            this.decide(G);
        }

        let speed = 0, sit = 0, lie = 0, sniff = 0;
        let tx = this.pos.x, tz = this.pos.z;
        const dP = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
        let lookAt = null;

        switch (this.state) {
            case 'follow': {
                const back = G.player.yaw + Math.PI + 0.6;
                tx = p.x + Math.sin(back) * 2.2;
                tz = p.z + Math.cos(back) * 2.2;
                const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                speed = d > 0.4 ? Math.min(8.5, 1.5 + d * 1.6) : 0;
                if (speed === 0) { sit = 1; lookAt = p; }
                break;
            }
            case 'explore': {
                if (this.stateT < 0.1 || Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 0.5) {
                    if (this.stateT > 0.1) this.pause = 1 + Math.random() * 2.5;
                    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
                    this.target.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
                }
                if (this.pause > 0) { this.pause -= dt; sniff = 1; break; }
                tx = this.target.x; tz = this.target.z;
                speed = 2.2;
                sniff = 0.6;
                break;
            }
            case 'point': {
                const n = this.pointNode;
                if (!n || n.charges <= 0 || Math.hypot(n.x - p.x, n.z - p.z) < 3.5 || this.stateT > 18) {
                    this.pointNode = null;
                    this.setState('follow');
                    break;
                }
                const a = Math.atan2(p.x - n.x, p.z - n.z);
                tx = n.x + Math.sin(a) * (n.r + 0.7);
                tz = n.z + Math.cos(a) * (n.r + 0.7);
                const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                speed = d > 0.4 ? 5.5 : 0;
                if (speed === 0) {
                    sit = 1;
                    lookAt = p;
                    if (this.barkT <= -2.5) this.bark(G, '🐾');
                    if (!this.announced) {
                        this.announced = true;
                        this.bark(G, '🐾');
                        G.toast(`🐕 ${this.name} har fundet ${G.nodeName(n.type)}!`);
                    }
                } else {
                    this.announced = false;
                }
                break;
            }
            case 'hunt': {
                const h = this.prey;
                if (!h || !h.alive || this.stateT > 7) {
                    if (h && h.alive) G.emote(this.pos, '💨');
                    this.prey = null;
                    this.setState('follow');
                    break;
                }
                tx = h.pos.x; tz = h.pos.z;
                speed = 7.2 * weak;
                h.scare = Math.max(h.scare, 0.5);
                h.scareFrom = this.pos;
                if (this.pos.distanceTo(h.pos) < 0.9) {
                    if (Math.random() < 0.55) {
                        G.killHare(h);
                        if (this.hunger < 40) {
                            this.hunger = Math.min(100, this.hunger + 55);
                            G.emote(this.pos, '😋');
                            G.toast(`🐕 ${this.name} fangede en hare og spiste den selv.`);
                            this.setState('follow');
                        } else {
                            this.carrying = true;
                            this.parts.head.userData.prey.visible = true;
                            this.setState('fetch');
                        }
                    } else {
                        G.emote(this.pos, '💨');
                        this.prey = null;
                        this.setState('follow');
                    }
                }
                break;
            }
            case 'fetch': {
                tx = p.x; tz = p.z;
                speed = dP > 1.3 ? 6 : 0;
                if (speed === 0) {
                    this.carrying = false;
                    this.parts.head.userData.prey.visible = false;
                    G.dogGift();
                    this.happyT = 2;
                    this.setState('happy');
                }
                break;
            }
            case 'guard': {
                const b = this.prey;
                if (!b || b.flee > 0) { this.setState('follow'); break; }
                const dx = b.pos.x - p.x, dz = b.pos.z - p.z;
                const d = Math.hypot(dx, dz) || 1;
                const k = Math.min(d * 0.55, 4.5);
                tx = p.x + dx / d * k;
                tz = p.z + dz / d * k;
                const dd = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                speed = dd > 0.3 ? 8 * weak : 0;
                lookAt = b.pos;
                if (this.pos.distanceTo(b.pos) < 9 && this.barkT <= 0) {
                    this.bark(G, '‼️');
                    if (Math.random() < 0.18 * weak) {
                        b.flee = 9;
                        G.toast(`🐕 ${this.name} gør isbjørnen skræmt!`);
                    }
                }
                break;
            }
            case 'rest': {
                const f = this.fire;
                if (f) {
                    const a = Math.atan2(this.pos.x - f.x, this.pos.z - f.z);
                    tx = f.x + Math.sin(a) * 1.7;
                    tz = f.z + Math.cos(a) * 1.7;
                } else {
                    tx = p.x + 1.2; tz = p.z + 0.6;
                }
                const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                speed = d > 0.4 ? 2.5 : 0;
                if (speed === 0) {
                    lie = 1;
                    this.energy = Math.min(100, this.energy + dt * 6);
                    if (Math.random() < dt * 0.15) G.emote(this.pos, '💤');
                    if (f) lookAt = f;
                }
                if (G.player.speed > 0.8) this.think = 0;
                break;
            }
            case 'warm': {
                tx = p.x + Math.sin(G.player.yaw + 1.6) * 0.8;
                tz = p.z + Math.cos(G.player.yaw + 1.6) * 0.8;
                const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                speed = d > 0.3 ? 4 : 0;
                if (speed === 0) lie = 1;
                if (G.player.speed > 0.8) this.think = 0;
                break;
            }
            case 'beg': {
                tx = p.x + Math.sin(G.player.yaw) * 1.3;
                tz = p.z + Math.cos(G.player.yaw) * 1.3;
                const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                speed = d > 0.4 ? 4 : 0;
                if (speed === 0) {
                    sit = 1;
                    lookAt = p;
                    if (this.whineT <= 0) {
                        this.whineT = 5;
                        G.sound.whine();
                        G.emote(this.pos, '🍖');
                    }
                }
                break;
            }
            case 'harness': {
                this.harnessSpot(G, tmp);
                tx = tmp.x; tz = tmp.z;
                const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
                this.pos.x += (tx - this.pos.x) * Math.min(1, dt * 7);
                this.pos.z += (tz - this.pos.z) * Math.min(1, dt * 7);
                speed = 0;
                this.yaw = angleLerp(this.yaw, G.player.yaw, Math.min(1, dt * 8));
                this.harnessSpeed = G.player.speed + d;
                if (G.player.speed < 0.5) this.think = 0;
                break;
            }
            case 'happy': {
                this.happyT -= dt;
                lookAt = p;
                sit = 0.3;
                if (this.happyT <= 0) this.setState('follow');
                break;
            }
        }

        // Bevægelse
        let moveSpeed = 0;
        if (speed > 0) {
            const dx = tx - this.pos.x, dz = tz - this.pos.z;
            const d = Math.hypot(dx, dz);
            if (d > 0.01) {
                const s = Math.min(speed, d / dt);
                this.pos.x += dx / d * s * dt;
                this.pos.z += dz / d * s * dt;
                this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 9));
                moveSpeed = s;
                this.energy = Math.max(0, this.energy - dt * (s > 5 ? 1.2 : 0.3));
            }
            G.collide(this.pos, 0.35);
        } else if (this.state === 'harness') {
            moveSpeed = this.harnessSpeed || 0;
        }
        if (lookAt && moveSpeed < 0.1) {
            this.yaw = angleLerp(this.yaw, Math.atan2(lookAt.x - this.pos.x, lookAt.z - this.pos.z), Math.min(1, dt * 5));
        }
        const r = Math.hypot(this.pos.x, this.pos.z);
        if (r > WORLD_RADIUS) this.pos.multiplyScalar(WORLD_RADIUS / r);
        const gh = groundHeight(this.pos.x, this.pos.z);
        this.pos.y = Math.max(gh, 0);

        // Ryster sneen af sig efter stormen eller når hun rejser sig fra sneen
        if (this.prevStorm > 0.6 && G.S.storm < 0.35) this.shakeT = 1;
        this.prevStorm = G.S.storm;
        if (this.lie > 0.8 && lie === 0 && Math.random() < 0.35) this.shakeT = 1;
        if (this.state === 'point' && this.announced && !this.dug) { this.dug = true; this.digT = 1.3; }
        if (this.state !== 'point') this.dug = false;
        const pant = moveSpeed > 4 || this.energy < 40 || this.state === 'beg' || this.state === 'happy';
        this.animate(dt, moveSpeed, G, { lie, sit, sniff, pant, alert: this.state === 'guard' || this.state === 'point' ? 1 : 0 });

        this.root.position.copy(this.pos);
        this.root.rotation.y = this.yaw;
        this.blob.position.set(this.pos.x, this.pos.y + 0.03, this.pos.z);
        this.blob.material.opacity = gh < 0.05 ? 0.36 : 0.2;

        // Poteaftryk i sneen
        this.printD = (this.printD || 0) + moveSpeed * dt;
        if (this.printD > 0.45 && gh > 0.05 && G.fx) {
            this.printD = 0;
            this.printSide = -(this.printSide || 1);
            const px = Math.cos(this.yaw) * 0.1 * this.printSide, pz = -Math.sin(this.yaw) * 0.1 * this.printSide;
            G.fx.print(this.pos.x + px, this.pos.y, this.pos.z + pz, this.yaw, 0.55);
        }

        // Små lyde
        if (moveSpeed > 1 && Math.sin(this.phase) > 0.95 && gh > 0.05 && Math.random() < 0.2) G.sound.step();
    }

    /** Fælles animation for Siku og spandets hunde. */
    animate(dt, speed, G, o = {}) {
        const p = this.parts, t = G.S.time;
        const k = Math.min(1, dt * 6);
        this.lie += ((o.lie || 0) - this.lie) * k;
        this.sit += ((o.sit || 0) - this.sit) * k;
        this.sniff += ((o.sniff || 0) - this.sniff) * k;
        this.alert = (this.alert || 0) + ((o.alert || 0) - (this.alert || 0)) * k;
        this.gal = (this.gal || 0) + ((speed > 4.6 ? 1 : 0) - (this.gal || 0)) * Math.min(1, dt * 4);
        const gal = this.gal, amp = Math.min(1, speed / 2.2);
        this.phase += dt * speed * (Math.PI * 2 / (0.95 + gal * 0.6));
        const ph = this.phase;

        this.shakeT = Math.max(0, (this.shakeT || 0) - dt);
        const shake = this.shakeT > 0 ? Math.sin((1 - this.shakeT) * Math.PI) : 0;
        this.digT = Math.max(0, (this.digT || 0) - dt);
        const dig = this.digT > 0 ? Math.min(1, this.digT * 3) * Math.min(1, (1.3 - this.digT) * 4) : 0;
        if (shake > 0.3 && Math.random() < dt * 40 && G.fx) G.fx.snow(this.pos, 0.55, 1, 3.5);
        if (dig > 0.3 && Math.random() < dt * 30 && G.fx) {
            const bx = -Math.sin(this.yaw) * 0.4, bz = -Math.cos(this.yaw) * 0.4;
            G.fx.kick(this.pos.x + Math.sin(this.yaw) * 0.45, this.pos.y + 0.1, this.pos.z + Math.cos(this.yaw) * 0.45, bx * 5, bz * 5);
        }

        // Ben: trav (diagonale par) glider over i galop (parvis, med rygbøjning)
        const trot = [-1, 1, 1, -1];
        const gOff = [0, 0.35, 2.4, 2.75];
        const lieUp = [-1.45, -1.45, -1.1, -1.1], lieLo = [0.1, 0.1, 1.9, 1.9];
        for (let i = 0; i < 4; i++) {
            const ts = Math.sin(ph) * trot[i], tc = Math.cos(ph) * trot[i];
            const gs = Math.sin(ph + gOff[i]), gc = Math.cos(ph + gOff[i]);
            const swing = (-ts * 0.55 * (1 - gal) - gs * 0.85 * gal) * amp;
            const bend = (Math.max(0, -tc) * (1 - gal) + Math.max(0, gc) * gal) * amp;
            let up = swing + lieUp[i] * this.lie;
            let lo = (i < 2 ? 1 : -1) * bend * 0.9 + lieLo[i] * this.lie;
            if (i >= 2) { up += -0.9 * this.sit; lo += 1.6 * this.sit; }
            if (i < 2 && dig > 0) { up += (-0.6 + Math.sin(t * 24 + i * Math.PI) * 0.8) * dig; lo += 0.6 * dig; }
            p.legs[i].rotation.x = up;
            p.lower[i].rotation.x = lo;
        }
        p.front.rotation.x = Math.sin(ph) * 0.1 * gal * amp + 0.25 * dig;
        p.rear.rotation.x = -Math.sin(ph) * 0.12 * gal * amp;
        const bounce = (Math.abs(Math.sin(ph)) * 0.03 * (1 - gal) + Math.max(0, Math.sin(ph)) * 0.08 * gal) * amp;
        this.inner.position.y = -this.lie * 0.26 - this.sit * 0.05 + bounce;
        this.inner.rotation.x = -this.sit * 0.38 + dig * 0.12;
        this.inner.rotation.z = Math.sin(t * 42) * 0.45 * shake;

        // Hoved, ører, tunge
        const breathe = Math.sin(t * (o.pant ? 9 : 2)) * (o.pant ? 0.03 : 0.015);
        p.head.rotation.x = this.sniff * (0.6 + Math.sin(t * 9) * 0.1) - this.sit * 0.15 + this.lie * 0.4
            - this.alert * 0.15 + Math.sin(ph * 2) * 0.08 * amp + breathe + dig * 0.4;
        p.head.rotation.z = Math.sin(t * 38) * 0.3 * shake;
        this.twitchT = (this.twitchT || 2) - dt;
        const twitch = this.twitchT < 0.15 ? 0.5 : 0;
        if (this.twitchT < 0) this.twitchT = 1.5 + Math.random() * 4;
        p.ears.forEach((e, i) => {
            e.rotation.x = -0.55 * amp * (0.5 + gal * 0.5) + this.alert * 0.2 + Math.sin(ph * 2 + i) * 0.12 * amp - this.lie * 0.3;
            e.rotation.z = (i ? -1 : 1) * (0.1 + (i === 1 ? twitch : 0) + shake * Math.sin(t * 40) * 0.4);
        });
        p.tongue.visible = !!o.pant && this.lie < 0.5;
        p.tongue.position.y = -0.12 - Math.abs(Math.sin(t * 9)) * 0.015;

        // Hale med fjeder-efterslæb
        const happy = this.state === 'happy' || this.state === 'beg';
        const wagSpeed = happy ? 16 : this.state === 'guard' ? 0 : 6;
        const wagAmp = happy ? 0.7 : this.state === 'guard' ? 0 : 0.35 * (1 - this.lie);
        const target = Math.sin(t * wagSpeed) * wagAmp;
        this.tailV = (this.tailV || 0) + ((target - (this.tailA || 0)) * 120 - (this.tailV || 0) * 14) * dt;
        this.tailA = (this.tailA || 0) + this.tailV * dt;
        p.tail.rotation.y = this.tailA;
        p.tail2.rotation.y = this.tailA * 0.8 - this.tailV * 0.02;
        p.tail.rotation.x = this.state === 'guard' ? -1.3 : -0.9 + gal * 0.45 + this.lie * 0.5;

        // Blink / sover
        this.blinkT = (this.blinkT ?? 3) - dt;
        const closed = (this.state === 'rest' && this.lie > 0.8) || this.blinkT < 0.12;
        if (this.blinkT < 0) this.blinkT = 2 + Math.random() * 4;
        for (const e of p.eyes) e.scale.y = closed ? 0.15 : 1;

        // Ånde i kulden
        this.breathT = (this.breathT ?? 1) - dt;
        if (this.breathT <= 0 && G.fx) {
            this.breathT = o.pant ? 0.5 : 1.6;
            G.fx.breath(this.pos.x + Math.sin(this.yaw) * 0.75, this.pos.y + 0.55 - this.lie * 0.2, this.pos.z + Math.cos(this.yaw) * 0.75, this.yaw, 0.12);
        }
    }
}
