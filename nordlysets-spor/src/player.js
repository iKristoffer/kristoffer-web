import * as THREE from 'three';
import { makeSpear } from './world.js';

// ---------------------------------------------------------------------------
// Model: Arnarulunnguaq med led i hofter, knæ, skuldre og albuer
// ---------------------------------------------------------------------------
function mat(color) {
    return new THREE.MeshLambertMaterial({ color, flatShading: true });
}
function mesh(geo, m, x = 0, y = 0, z = 0) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.castShadow = true;
    o.receiveShadow = true;
    return o;
}
function pivot(parent, x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
}

const HIP_Y = 0.67;

export function makePlayerRig() {
    const mats = {
        coat: mat('#8c5a36'),
        fur: mat('#f3ead9'),
        skin: mat('#c8966c'),
        pants: mat('#3b2c22'),
        boots: mat('#4a392b'),
        mitt: mat('#4b3a2c'),
        bead: mat('#c9402a'),
        bead2: mat('#2c86b0'),
        dark: mat('#1a1411'),
        cheek: mat('#c9705e'),
    };
    const group = new THREE.Group();
    const model = pivot(group, 0, 0, 0);
    model.scale.setScalar(1.1);
    const hips = pivot(model, 0, HIP_Y, 0);

    // Anorakkens skørt sidder på hofterne, overkroppen kan bøje over det
    hips.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.3, 12), mats.coat, 0, -0.04, 0));
    const hem = mesh(new THREE.TorusGeometry(0.44, 0.065, 6, 14), mats.fur, 0, -0.18, 0);
    hem.rotation.x = Math.PI / 2;
    hips.add(hem);

    const torso = pivot(hips, 0, 0.08, 0);
    torso.add(mesh(new THREE.CylinderGeometry(0.26, 0.35, 0.52, 12), mats.coat, 0, 0.26, 0));
    // Perlekrave (nuilarmiut-inspireret)
    torso.add(mesh(new THREE.CylinderGeometry(0.27, 0.31, 0.09, 12), mats.bead, 0, 0.5, 0));
    torso.add(mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.04, 12), mats.bead2, 0, 0.44, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.14), mats.coat, 0, 0.28, -0.26));

    const head = pivot(torso, 0, 0.6, 0);
    head.add(mesh(new THREE.SphereGeometry(0.28, 12, 9), mats.coat, 0, 0.12, -0.03));
    head.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), mats.skin, 0, 0.1, 0.15));
    const ruff = mesh(new THREE.TorusGeometry(0.2, 0.075, 6, 14), mats.fur, 0, 0.1, 0.2);
    head.add(ruff);
    head.add(mesh(new THREE.ConeGeometry(0.1, 0.18, 6), mats.coat, 0, 0.38, -0.12));
    const eyeG = new THREE.BoxGeometry(0.045, 0.035, 0.02);
    const eyes = [mesh(eyeG, mats.dark, -0.06, 0.13, 0.31), mesh(eyeG, mats.dark, 0.06, 0.13, 0.31)];
    head.add(...eyes);
    head.add(mesh(new THREE.BoxGeometry(0.035, 0.05, 0.04), mats.skin, 0, 0.08, 0.325));
    head.add(mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), mats.cheek, -0.09, 0.07, 0.29), mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), mats.cheek, 0.09, 0.07, 0.29));

    const arm = (s) => {
        const sh = pivot(torso, 0.31 * s, 0.44, 0);
        sh.add(mesh(new THREE.CylinderGeometry(0.08, 0.072, 0.3, 7).translate(0, -0.15, 0), mats.coat));
        const el = pivot(sh, 0, -0.3, 0);
        el.add(mesh(new THREE.CylinderGeometry(0.072, 0.066, 0.25, 7).translate(0, -0.125, 0), mats.coat));
        const cuff = mesh(new THREE.TorusGeometry(0.07, 0.03, 5, 10), mats.fur, 0, -0.23, 0);
        cuff.rotation.x = Math.PI / 2;
        el.add(cuff);
        el.add(mesh(new THREE.SphereGeometry(0.085, 7, 6), mats.mitt, 0, -0.31, 0.01));
        return { sh, el };
    };
    const L = arm(-1), R = arm(1);

    const leg = (s) => {
        const th = pivot(hips, 0.13 * s, -0.04, 0);
        th.add(mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.3, 7).translate(0, -0.15, 0), mats.pants));
        const kn = pivot(th, 0, -0.3, 0);
        kn.add(mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.26, 7).translate(0, -0.13, 0), mats.boots));
        const top = mesh(new THREE.TorusGeometry(0.09, 0.035, 5, 10), mats.fur, 0, -0.02, 0);
        top.rotation.x = Math.PI / 2;
        kn.add(top);
        kn.add(mesh(new THREE.BoxGeometry(0.16, 0.09, 0.27), mats.boots, 0, -0.28, 0.05));
        return { th, kn };
    };
    const LL = leg(-1), RL = leg(1);

    const harpoon = makeSpear();
    harpoon.position.set(0, -0.3, 0.1);
    harpoon.rotation.x = -0.35;
    harpoon.visible = false;
    R.el.add(harpoon);

    // Silhuet, når figuren står bag bjerge (tegnes før figuren selv)
    const silMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a', depthFunc: THREE.GreaterDepth, depthWrite: false });
    const meshes = [];
    // Benene får ingen silhuet — de skærer let ind i skrånende sne og ville lyse op
    const legSet = new Set();
    [LL.th, RL.th].forEach((l) => l.traverse((o) => legSet.add(o)));
    model.traverse((o) => { if (o.isMesh && !legSet.has(o)) meshes.push(o); });
    for (const m of meshes) {
        const s = new THREE.Mesh(m.geometry, silMat);
        s.renderOrder = 1;
        m.add(s);
        m.renderOrder = 2;
    }

    return {
        group, model, mats, harpoon, eyes,
        j: { hips, torso, head, shL: L.sh, elL: L.el, shR: R.sh, elR: R.el, thL: LL.th, knL: LL.kn, thR: RL.th, knR: RL.kn },
    };
}

// ---------------------------------------------------------------------------
// Procedurel animation
// ---------------------------------------------------------------------------
const KEYS = [
    'hipsY', 'hipsX', 'hipsZ', 'hipsYaw', 'torsoX', 'torsoY', 'torsoZ', 'headX', 'headY', 'headZ',
    'shLX', 'shLZ', 'elL', 'shRX', 'shRZ', 'elR', 'thLX', 'thLZ', 'knL', 'thRX', 'thRZ', 'knR',
];
const DUR = {
    chop: 0.6, gather: 0.7, cut: 0.8, throw: 0.55, pet: 1.1, eat: 0.9, tend: 0.7, hurt: 0.45, craft: 1.0, read: 1.2,
};
const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

function zero(o) {
    for (const k of KEYS) o[k] = 0;
    return o;
}

export class PlayerAnimator {
    constructor(rig) {
        this.rig = rig;
        this.cur = zero({});
        this.P = zero({});
        this.A = zero({});
        this.phase = 0;
        this.t = 0;
        this.action = null;
        this.lookT = 3;
        this.lookYaw = 0;
        this.lookTarget = 0;
        this.blinkT = 2;
        this.dead = 0;
        this.walkAmt = 0;
    }

    play(type) {
        this.action = { type, t: 0, dur: DUR[type] || 0.6 };
    }

    /** Hvor langt i en handling vi er (0..1), eller -1. */
    actionProgress(type) {
        const a = this.action;
        return a && a.type === type ? a.t / a.dur : -1;
    }

    update(dt, c) {
        const P = zero(this.P);
        this.t += dt;
        const t = this.t;
        const s = c.speed;
        const w = c.sled ? 0 : Math.min(1, s / 4.3);
        this.walkAmt += (w - this.walkAmt) * Math.min(1, dt * 8);
        const wa = this.walkAmt;
        const idle = 1 - wa;
        this.phase += dt * s * Math.PI * (c.onIce ? 1.15 : 1);
        const ph = this.phase;
        const sw = Math.sin(ph), cw = Math.cos(ph);

        // --- Gang
        const stride = c.onIce ? 0.4 : 0.62;
        P.thLX = -sw * stride * wa;
        P.thRX = sw * stride * wa;
        P.knL = (0.1 + Math.max(0, cw) * 0.95) * wa;
        P.knR = (0.1 + Math.max(0, -cw) * 0.95) * wa;
        P.hipsY = (0.025 - Math.abs(sw) * 0.05) * wa;
        P.hipsZ = sw * 0.04 * wa;
        P.hipsYaw = sw * 0.12 * wa;
        P.torsoY = -sw * 0.16 * wa;
        P.torsoX = 0.09 * wa;
        const armSw = c.cold > 0.5 ? 0.25 : 0.5;
        P.shLX = sw * armSw * wa;
        P.shRX = -sw * armSw * wa;
        P.elL = -(0.2 + 0.45 * Math.max(0, -sw)) * wa;
        P.elR = -(0.2 + 0.45 * Math.max(0, sw)) * wa;
        P.shLZ = -0.1 - (c.onIce ? 0.3 * wa : 0);
        P.shRZ = 0.1 + (c.onIce ? 0.3 * wa : 0);

        // --- Hvile: vejrtrækning, vægtskift, kigger sig omkring
        const br = Math.sin(t * 1.8);
        P.torsoX += br * 0.02 * idle;
        P.shLZ -= br * 0.02 * idle;
        P.shRZ += br * 0.02 * idle;
        P.hipsY += br * 0.004 * idle;
        const shift = Math.sin(t * 0.35);
        P.hipsZ += shift * 0.035 * idle;
        P.knL += (0.05 + Math.max(0, shift) * 0.12) * idle;
        P.knR += (0.05 + Math.max(0, -shift) * 0.12) * idle;
        this.lookT -= dt;
        if (this.lookT <= 0) {
            this.lookT = 2.5 + Math.random() * 4;
            this.lookTarget = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.6;
        }
        this.lookYaw += ((c.idle > 1.2 ? this.lookTarget : 0) - this.lookYaw) * Math.min(1, dt * 3);
        P.headY += this.lookYaw * idle;
        P.headX -= P.torsoX * 0.7;
        P.headY -= P.torsoY * 0.6;

        // --- Kulde: krammer sig selv og ryster
        const cold = c.cold * idle * (1 - c.fire);
        if (cold > 0.01) {
            this.mix(P, {
                shLX: -0.7, shLZ: 0.45, elL: -1.7, shRX: -0.7, shRZ: -0.45, elR: -1.7, torsoX: 0.14, headX: 0.12,
            }, cold);
            P.torsoZ += Math.sin(t * 38) * 0.018 * cold;
            P.headZ += Math.sin(t * 41 + 1) * 0.02 * cold;
        }
        // Ryster også lidt, når hun går og fryser
        P.torsoZ += Math.sin(t * 40) * 0.01 * c.cold * wa;

        // --- Varmer hænderne ved bålet
        const fire = c.fire * idle;
        if (fire > 0.01) {
            this.mix(P, {
                shLX: -1.15, shRX: -1.15, elL: -0.35, elR: -0.35, shLZ: 0.18, shRZ: -0.18, torsoX: 0.12,
                knL: 0.25, knR: 0.25, hipsY: -0.03,
            }, fire);
            P.shLZ += Math.sin(t * 6) * 0.06 * fire;
            P.shRZ -= Math.sin(t * 6) * 0.06 * fire;
        }

        // --- Storm: læner sig ind i vinden og skærmer ansigtet
        if (c.storm > 0.05) {
            const st = c.storm * wa;
            P.torsoX += 0.22 * st;
            this.mix(P, { shRX: -1.9, elR: -1.7, shRZ: -0.25 }, st * 0.9);
            P.torsoZ += c.windSide * 0.12 * c.storm;
        }

        // --- Glider på isen: armene ud for balancen
        if (c.sliding > 0.01) {
            const sl = c.sliding;
            this.mix(P, {
                shLZ: -1.2, shRZ: 1.2, shLX: -0.3, shRX: -0.3, elL: -0.2, elR: -0.2,
                thLZ: -0.18, thRZ: 0.18, knL: 0.35, knR: 0.35, hipsY: -0.05, thLX: -0.15, thRX: 0.1,
            }, sl);
            P.torsoZ += Math.sin(t * 5) * 0.09 * sl;
            P.shLZ += Math.sin(t * 5 + 1) * 0.15 * sl;
            P.shRZ += Math.sin(t * 5 + 1) * 0.15 * sl;
        }

        // --- På slæden: i knæ, hænderne på opstanderne
        if (c.sled) {
            const bump = Math.sin(t * 13) * 0.015 * Math.min(1, s / 5);
            this.mix(P, {
                thLX: -0.35, thRX: -0.2, knL: 0.55, knR: 0.45, hipsY: -0.07 + bump, torsoX: 0.28,
                shLX: -0.95, shRX: -0.95, elL: -0.55, elR: -0.55, shLZ: 0.08, shRZ: -0.08, headX: -0.2,
            }, 1);
            P.torsoZ += c.turn * 0.15;
            P.hipsZ += c.turn * 0.1;
        }

        // --- Handlinger lægges ovenpå
        const a = this.action;
        if (a) {
            a.t += dt;
            const k = a.t / a.dur;
            const env = ss(0, 0.12, a.t) * (1 - ss(a.dur - 0.16, a.dur, a.t));
            this.mix(P, this.actionPose(a.type, k, a.t), env);
            if (a.t >= a.dur) this.action = null;
        }

        // --- Død
        if (c.dead) this.dead = Math.min(1, this.dead + dt * 1.6);

        // Udglat mod målet
        const rate = 1 - Math.exp(-dt * 16);
        const cur = this.cur;
        for (const key of KEYS) cur[key] += (P[key] - cur[key]) * rate;

        const j = this.rig.j;
        j.hips.position.y = HIP_Y + cur.hipsY;
        j.hips.rotation.set(cur.hipsX, cur.hipsYaw, cur.hipsZ);
        j.torso.rotation.set(cur.torsoX, cur.torsoY, cur.torsoZ);
        j.head.rotation.set(cur.headX, cur.headY, cur.headZ);
        j.shL.rotation.set(cur.shLX, 0, cur.shLZ);
        j.shR.rotation.set(cur.shRX, 0, cur.shRZ);
        j.elL.rotation.x = cur.elL;
        j.elR.rotation.x = cur.elR;
        j.thL.rotation.set(cur.thLX, 0, cur.thLZ);
        j.thR.rotation.set(cur.thRX, 0, cur.thRZ);
        j.knL.rotation.x = cur.knL;
        j.knR.rotation.x = cur.knR;

        const m = this.rig.model;
        m.position.y = (c.sled ? 0.2 : 0) - this.dead * 0.45;
        m.rotation.x = -this.dead * 1.45;

        // Blink
        this.blinkT -= dt;
        const blink = this.blinkT < 0.12;
        if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3.5;
        for (const e of this.rig.eyes) e.scale.y = blink || c.dead ? 0.15 : 1;
    }

    mix(P, pose, w) {
        for (const k in pose) P[k] += (pose[k] - P[k]) * w;
    }

    actionPose(type, k, t) {
        switch (type) {
            case 'chop': {
                // Løft begge arme over hovedet og slå ned
                const up = ss(0, 0.45, k), down = ss(0.45, 0.62, k);
                const sh = -2.6 * up + 2.0 * down;
                return {
                    shLX: sh, shRX: sh, elL: -0.4 * up + 0.2 * down, elR: -0.4 * up + 0.2 * down,
                    shLZ: 0.2, shRZ: -0.2, torsoX: -0.12 * up + 0.5 * down, knL: 0.25, knR: 0.25, hipsY: -0.04 * down,
                    headX: 0.1 * down, thLX: -0.2, thRX: 0.15,
                };
            }
            case 'gather':
            case 'tend':
                // Bøjer sig ned og samler op
                return {
                    thLX: -0.95, thRX: -0.7, knL: 1.25, knR: 1.1, hipsY: -0.15, torsoX: 0.65,
                    shRX: -0.95 + Math.sin(k * Math.PI * 2) * 0.2, elR: -0.2, shLX: type === 'tend' ? -0.9 : -0.45,
                    elL: type === 'tend' ? -0.3 : -0.9, headX: 0.2,
                };
            case 'cut':
                // Knæler og saver sneblokken ud
                return {
                    thLX: -1.35, knL: 1.95, thRX: -0.3, knR: 1.55, hipsY: -0.26, torsoX: 0.5,
                    shRX: -0.85 + Math.sin(t * 20) * 0.35, elR: -0.6, shLX: -0.7, elL: -0.9, headX: 0.25,
                };
            case 'throw': {
                const wind = ss(0, 0.4, k), rel = ss(0.4, 0.55, k);
                return {
                    shRX: -2.5 * wind + 1.7 * rel, elR: -0.9 * wind + 0.8 * rel, shRZ: -0.2,
                    torsoY: 0.45 * wind - 0.8 * rel, torsoX: -0.15 * wind + 0.35 * rel,
                    shLX: -0.6 * wind, shLZ: -0.4, thLX: -0.45 * rel - 0.1, thRX: 0.3, knR: 0.3 * rel,
                    hipsYaw: 0.2 * wind - 0.3 * rel,
                };
            }
            case 'pet':
                return {
                    thLX: -0.9, knL: 1.2, thRX: -0.5, knR: 1.3, hipsY: -0.18, torsoX: 0.45, torsoY: 0.3,
                    shRX: -0.75 + Math.sin(t * 9) * 0.18, elR: -0.3, shRZ: 0.25, headX: 0.25, headY: 0.4,
                };
            case 'eat':
                return {
                    shRX: -1.25, elR: -2.05, shRZ: -0.2, headX: -0.1 + Math.sin(t * 18) * 0.04, torsoX: -0.03,
                    shLX: -0.5, elL: -1.2,
                };
            case 'craft':
                return {
                    thLX: -1.3, knL: 1.9, thRX: -1.3, knR: 1.9, hipsY: -0.3, torsoX: 0.4,
                    shLX: -0.9 + Math.sin(t * 11) * 0.2, shRX: -0.9 - Math.sin(t * 11) * 0.2, elL: -0.8, elR: -0.8, headX: 0.35,
                };
            case 'read':
                return { torsoX: 0.25, headX: 0.35, shRX: -1.0, elR: -0.7, shLX: -1.0, elL: -0.7, knL: 0.2, knR: 0.2 };
            case 'hurt':
                return { torsoX: -0.4, headX: -0.25, shLZ: -0.7, shRZ: 0.7, shLX: -0.4, shRX: -0.4, hipsY: -0.05, knL: 0.3, knR: 0.3 };
        }
        return {};
    }
}
