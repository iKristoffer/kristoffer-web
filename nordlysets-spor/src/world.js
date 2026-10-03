import * as THREE from 'three';
import { makeSnowMaterial, makeFlame } from './shaders.js';

// ---------------------------------------------------------------------------
// Tilfældighed og støj
// ---------------------------------------------------------------------------
export function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const perm = new Uint8Array(512);
{
    const r = mulberry32(1921);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const hash2 = (ix, iz) => perm[perm[ix & 255] + (iz & 255)] / 255;

export function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

export function fbm(x, z, oct = 4) {
    let s = 0, a = 1, n = 0;
    for (let i = 0; i < oct; i++) {
        s += a * vnoise(x, z);
        n += a;
        a *= 0.5;
        x = x * 2.03 + 17.1;
        z = z * 2.03 - 7.3;
    }
    return s / n;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Terræn
// ---------------------------------------------------------------------------
export const SPAWN = { x: 44, z: 44 };
export const WORLD_RADIUS = 105;

const PONDS = [
    [37, 51, 5.5], [53, 34, 4.2], [12, 22, 8], [-28, 42, 7], [-46, -18, 9], [22, -38, 6.5],
    [-8, -58, 5], [58, -8, 5.5], [-60, 20, 6], [0, 60, 6], [-20, 5, 5], [30, 8, 4.5],
];

export function heightAt(x, z) {
    const r = Math.hypot(x, z);
    const coast = r + fbm(x * 0.03 + 7.3, z * 0.03 - 2.1, 3) * 16;
    const land = 1 - smoothstep(70, 96, coast);
    let h = 1.1 + fbm(x * 0.02, z * 0.02, 4) * 3.0;
    const m = fbm(x * 0.012 + 31.7, z * 0.012 + 11.3, 4) - 0.08;
    if (m > 0) h += m * m * 55 * smoothstep(16, 42, Math.hypot(x - SPAWN.x, z - SPAWN.z));
    for (const [px, pz, pr] of PONDS) {
        const d = Math.hypot(x - px, z - pz);
        if (d < pr * 1.6) {
            const edge = pr * (1 + vnoise(x * 0.35 + px, z * 0.35) * 0.28);
            const k = 1 - smoothstep(pr * 0.15, edge * 1.15, d);
            h = h * (1 - k) - 1.2 * k;
        }
    }
    return h * land - 2.5 * (1 - land);
}

export const WORLD = 240, SEG = 150, HALF = WORLD / 2, CELL = WORLD / SEG;
const grid = new Float32Array((SEG + 1) * (SEG + 1));

/** Højde på den faktisk renderede trekant-mesh. */
export function groundHeight(x, z) {
    const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return -2.5;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const i = iz * (SEG + 1) + ix;
    const a = grid[i], d = grid[i + 1], b = grid[i + SEG + 1], c = grid[i + SEG + 2];
    if (fx + fz < 1) return a + (d - a) * fx + (b - a) * fz;
    return c + (b - c) * (1 - fx) + (d - c) * (1 - fz);
}

export function slopeAt(x, z) {
    const dx = groundHeight(x + 0.6, z) - groundHeight(x - 0.6, z);
    const dz = groundHeight(x, z + 0.6) - groundHeight(x, z - 0.6);
    return Math.hypot(dx, dz) / 1.2;
}

/**
 * Biomer pr. zone: farver terrænets hjørner om til zonens udtryk, med en blød overgang ud over ringen.
 * Kaldes efter at zonerne er placeret (terrænet bygges før).
 */
export const BIOMES = {
    thin: { name: 'Tyndisen', base: '#273449', alt: '#3e5878', fleck: '#0c121c', freq: 0.5 },      // sort, revnet is
    bird: { name: 'Fuglefjeldet', base: '#55575f', alt: '#7d7f86', fleck: '#f2eee2', lichen: '#d0832e', freq: 0.35 }, // gråt fjeld med fuglegødning og laver
    pass: { name: 'Gletsjerpasset', base: '#6fb0e4', alt: '#b9defa', fleck: '#3f7fc0', freq: 0.28 }, // blå gletsjeris
    peak: { name: 'Nordlysbjerget', base: '#3a3858', alt: '#524f78', fleck: '#2f9a74', freq: 0.22 },    // violet sten med grøn mos
};
export function applyBiomes(mesh, zones) {
    const geo = mesh.geometry, p = geo.attributes.position, col = geo.attributes.color;
    const c = new THREE.Color(), b = new THREE.Color(), t = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        for (const zn of zones) {
            const bio = BIOMES[zn.id];
            if (!bio) continue;
            const d = Math.hypot(x - zn.x, z - zn.z);
            const wgt = 1 - smoothstep(zn.R - 1, zn.R + 11, d);
            if (wgt <= 0.01) continue;
            const n1 = vnoise(x * bio.freq + 11, z * bio.freq - 4) * 0.5 + 0.5;
            const n2 = vnoise(x * bio.freq * 3.1 - 7, z * bio.freq * 3.1 + 2) * 0.5 + 0.5;
            b.set(bio.base).lerp(t.set(bio.alt), n1);
            // Pletter: sprækker/guano/spalter/mos efter zonen
            const fleckK = smoothstep(0.5, 0.7, n2);
            if (fleckK > 0) b.lerp(t.set(bio.fleck), fleckK * (zn.id === 'thin' ? 0.85 : 0.7));
            if (bio.lichen) b.lerp(t.set(bio.lichen), smoothstep(0.72, 0.9, vnoise(x * 0.9 + 3, z * 0.9 + 8) * 0.5 + 0.5) * 0.55);
            if (zn.id === 'thin') {
                // Revner: smalle mørke linjer, hvor to støjfelter krydser nul
                const cr = Math.abs(vnoise(x * 0.9, z * 0.9));
                if (cr < 0.05) b.lerp(t.set('#05080e'), 1 - cr / 0.05);
            }
            c.fromBufferAttribute(col, i);
            c.lerp(b, Math.min(1, wgt * 1.15));
            col.setXYZ(i, c.r, c.g, c.b);
        }
    }
    col.needsUpdate = true;
}

export function buildTerrain() {
    for (let iz = 0; iz <= SEG; iz++) {
        for (let ix = 0; ix <= SEG; ix++) {
            grid[iz * (SEG + 1) + ix] = heightAt(-HALF + ix * CELL, -HALF + iz * CELL);
        }
    }
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, grid[i]);
    geo.computeVertexNormals();

    const n = geo.attributes.normal;
    const cols = new Float32Array(p.count * 3);
    const cSnow = new THREE.Color('#f1f6fc'), cSnow2 = new THREE.Color('#cddcec');
    const cRock = new THREE.Color('#6a6d76'), cRock2 = new THREE.Color('#4f525b');
    const cShore = new THREE.Color('#bccddf');
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const ny = n.getY(i);
        const v = vnoise(x * 0.25, z * 0.25) * 0.5 + 0.5;
        tmp.copy(cSnow).lerp(cSnow2, clamp(v * 0.45 + (1 - ny) * 1.5, 0, 1));
        let rock = smoothstep(0.22, 0.38, 1 - ny);
        if (y > 3) rock += smoothstep(0.66, 0.78, vnoise(x * 0.09 + 40, z * 0.09)) * 0.5;
        if (rock > 0) tmp.lerp(v > 0.5 ? cRock : cRock2, Math.min(1, rock));
        if (y < 0.35) tmp.lerp(cShore, 0.55 * clamp(1 - y / 0.35, 0, 1));
        cols[i * 3] = tmp.r;
        cols[i * 3 + 1] = tmp.g;
        cols[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mesh = new THREE.Mesh(geo, makeSnowMaterial());
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
}

// ---------------------------------------------------------------------------
// Materialer og hjælpere
// ---------------------------------------------------------------------------
const matCache = new Map();
export function lam(color, extra) {
    const key = color + (extra ? JSON.stringify(extra) : '');
    if (!matCache.has(key)) {
        matCache.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra }));
    }
    return matCache.get(key);
}

function mk(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, typeof mat === 'string' ? lam(mat) : mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function makeSoftTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr;
    cx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
}
export const softTex = makeSoftTexture();

export function makeBlob(size, opacity = 0.35) {
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
            map: softTex, color: '#0a1424', transparent: true, opacity, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        })
    );
    m.renderOrder = 3;
    return m;
}

/** Blød kontaktskygge som barn af et objekt, der står på jorden. */
export function contactShadow(parent, w, d = w, opacity = 0.32) {
    const b = makeBlob(1, opacity);
    b.scale.set(w, 1, d);
    b.position.y = 0.03;
    parent.add(b);
    return b;
}

/** Blød additiv glorie — giver det “pre-renderede” lys-look. */
export function makeGlow(color, size, opacity = 0.6) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.scale.set(size, size, 1);
    return s;
}

// ---------------------------------------------------------------------------
// Figurer
// ---------------------------------------------------------------------------
export function makeSpear() {
    const g = new THREE.Group();
    const shaft = mk(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), '#8a6644');
    shaft.rotation.x = Math.PI / 2;
    const tip = mk(new THREE.ConeGeometry(0.05, 0.22, 5), '#e4dac4', 0, 0, 0.85);
    tip.rotation.x = Math.PI / 2;
    g.add(shaft, tip);
    return g;
}

export function makeDog(fur = '#8a8f99') {
    const g = new THREE.Group();
    const white = '#eceae4', dark = '#151515';
    const piv = (parent, x, y, z) => {
        const o = new THREE.Group();
        o.position.set(x, y, z);
        parent.add(o);
        return o;
    };
    // Forparti og bagparti bøjer hver for sig (rygbøjning i galop)
    const front = piv(g, 0, 0.45, 0.1);
    front.add(mk(new THREE.BoxGeometry(0.34, 0.34, 0.44), fur, 0, 0, 0.06));
    front.add(mk(new THREE.BoxGeometry(0.3, 0.3, 0.12), white, 0, -0.02, 0.28));
    front.add(mk(new THREE.BoxGeometry(0.38, 0.2, 0.2), fur, 0, 0.1, 0.22));
    const rear = piv(g, 0, 0.45, -0.1);
    rear.add(mk(new THREE.BoxGeometry(0.32, 0.3, 0.42), fur, 0, 0, -0.1));
    rear.add(mk(new THREE.BoxGeometry(0.28, 0.1, 0.5), white, 0, -0.15, 0.02));

    const head = piv(front, 0, 0.2, 0.34);
    head.add(
        mk(new THREE.BoxGeometry(0.28, 0.25, 0.27), fur),
        mk(new THREE.BoxGeometry(0.3, 0.12, 0.12), white, 0, -0.07, 0.06),
        mk(new THREE.BoxGeometry(0.15, 0.12, 0.19), white, 0, -0.05, 0.2),
        mk(new THREE.BoxGeometry(0.07, 0.05, 0.04), dark, 0, -0.005, 0.3),
    );
    const eyes = [-1, 1].map((s) => {
        const e = mk(new THREE.BoxGeometry(0.045, 0.035, 0.02), dark, 0.07 * s, 0.05, 0.14);
        head.add(e);
        return e;
    });
    const ears = [-1, 1].map((s) => {
        const ep = piv(head, 0.08 * s, 0.12, -0.03);
        ep.add(mk(new THREE.ConeGeometry(0.06, 0.16, 4).translate(0, 0.08, 0), fur));
        return ep;
    });
    const tongue = mk(new THREE.BoxGeometry(0.06, 0.02, 0.12), '#d4687a', 0, -0.12, 0.25);
    tongue.rotation.x = 0.5;
    tongue.visible = false;
    head.add(tongue);

    const legG = new THREE.BoxGeometry(0.09, 0.18, 0.1).translate(0, -0.09, 0);
    const lowG = new THREE.BoxGeometry(0.075, 0.16, 0.08).translate(0, -0.08, 0);
    const pawG = new THREE.BoxGeometry(0.09, 0.04, 0.12).translate(0, -0.17, 0.02);
    const legs = [], lower = [];
    for (const [parent, x, z] of [[front, -0.11, 0.18], [front, 0.11, 0.18], [rear, -0.11, -0.22], [rear, 0.11, -0.22]]) {
        const up = piv(parent, x, -0.12, z);
        up.add(mk(legG, fur));
        const lo = piv(up, 0, -0.17, 0);
        lo.add(mk(lowG, fur), mk(pawG, white));
        legs.push(up);
        lower.push(lo);
    }
    const tail = piv(rear, 0, 0.12, -0.32);
    tail.add(mk(new THREE.BoxGeometry(0.08, 0.08, 0.2).translate(0, 0, -0.1), fur));
    tail.rotation.x = -0.9;
    const tail2 = piv(tail, 0, 0, -0.19);
    tail2.add(mk(new THREE.BoxGeometry(0.07, 0.07, 0.18).translate(0, 0, -0.09), white));
    tail2.rotation.x = -0.9;
    return { group: g, legs, lower, tail, tail2, head, front, rear, ears, eyes, tongue, body: front };
}

export function makeBear() {
    const g = new THREE.Group();
    const c = '#efe8d6';
    g.add(mk(new THREE.BoxGeometry(0.95, 0.85, 1.7), c, 0, 1.0, 0));
    g.add(mk(new THREE.BoxGeometry(0.8, 0.7, 0.6), c, 0, 1.15, -0.3));
    const head = new THREE.Group();
    head.position.set(0, 1.0, 1.05);
    head.add(
        mk(new THREE.BoxGeometry(0.5, 0.45, 0.55), c),
        mk(new THREE.BoxGeometry(0.3, 0.25, 0.3), c, 0, -0.08, 0.35),
        mk(new THREE.BoxGeometry(0.12, 0.09, 0.06), '#141414', 0, -0.02, 0.5),
        mk(new THREE.BoxGeometry(0.1, 0.1, 0.08), c, -0.18, 0.25, -0.1),
        mk(new THREE.BoxGeometry(0.1, 0.1, 0.08), c, 0.18, 0.25, -0.1),
        mk(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#141414', -0.12, 0.08, 0.28),
        mk(new THREE.BoxGeometry(0.05, 0.05, 0.02), '#141414', 0.12, 0.08, 0.28),
    );
    g.add(head);
    const legG = new THREE.BoxGeometry(0.3, 0.7, 0.32).translate(0, -0.35, 0);
    const legs = [[-0.3, 0.55], [0.3, 0.55], [-0.3, -0.55], [0.3, -0.55]].map(([x, z]) => {
        const piv = new THREE.Group();
        piv.position.set(x, 0.7, z);
        piv.add(mk(legG, c));
        g.add(piv);
        return piv;
    });
    return { group: g, legs, head };
}

export function makeHare() {
    const g = new THREE.Group();
    const c = '#f7f7f2';
    const body = mk(new THREE.SphereGeometry(0.2, 7, 5), c, 0, 0.2, 0);
    body.scale.set(1, 0.85, 1.3);
    const head = mk(new THREE.SphereGeometry(0.12, 7, 5), c, 0, 0.34, 0.2);
    const earG = new THREE.BoxGeometry(0.04, 0.22, 0.07).translate(0, 0.11, 0);
    const e1 = mk(earG, c, -0.05, 0.42, 0.17), e2 = mk(earG, c, 0.05, 0.42, 0.17);
    e1.rotation.x = e2.rotation.x = -0.4;
    const tips = mk(new THREE.BoxGeometry(0.15, 0.04, 0.05), '#222', 0, 0.62, 0.1);
    tips.visible = false;
    e1.add(mk(new THREE.BoxGeometry(0.045, 0.05, 0.075), '#222', 0, 0.2, 0));
    e2.add(mk(new THREE.BoxGeometry(0.045, 0.05, 0.075), '#222', 0, 0.2, 0));
    g.add(body, head, e1, e2, tips, mk(new THREE.BoxGeometry(0.03, 0.03, 0.02), '#222', 0.07, 0.37, 0.3));
    const tail = mk(new THREE.SphereGeometry(0.07, 5, 4), c, 0, 0.24, -0.25);
    g.add(tail);
    const inner = new THREE.Group();
    while (g.children.length) inner.add(g.children[0]);
    g.add(inner);
    contactShadow(g, 0.8, 0.9, 0.3);
    return { group: g, inner, ears: [e1, e2] };
}

export function makeSeal() {
    const g = new THREE.Group();
    const c = '#4d5159';
    const body = mk(new THREE.CapsuleGeometry(0.27, 0.55, 4, 8), c, 0, -0.1, 0);
    const head = mk(new THREE.SphereGeometry(0.22, 8, 6), '#5a5f68', 0, 0.35, 0.04);
    const snout = mk(new THREE.SphereGeometry(0.1, 6, 5), '#6b707a', 0, 0.3, 0.2);
    const e1 = mk(new THREE.SphereGeometry(0.04, 5, 4), '#0c0c0c', -0.09, 0.42, 0.18);
    const e2 = mk(new THREE.SphereGeometry(0.04, 5, 4), '#0c0c0c', 0.09, 0.42, 0.18);
    g.add(body, head, snout, e1, e2);
    return { group: g };
}

// Sten: forvredet icosaeder med snehætte på de opadvendte flader og spredt lav
const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const RC = {
    rock: [new THREE.Color('#7d818a'), new THREE.Color('#6b6f78'), new THREE.Color('#8b8d92')],
    dark: new THREE.Color('#4c4f57'), snow: new THREE.Color('#eef4fb'), snow2: new THREE.Color('#d9e5f2'),
    lichen: new THREE.Color('#b08a3e'), lichen2: new THREE.Color('#8a9a5a'),
};
export function makeRockMesh(rng, s, snowy = 0.55) {
    const geo = new THREE.IcosahedronGeometry(s, 1);
    const p = geo.attributes.position;
    const sx = 0.8 + rng() * 0.5, sz = 0.8 + rng() * 0.5, sy = 0.55 + rng() * 0.35;
    const seed = rng() * 100;
    // Samme hjørne skal flyttes ens (geometrien er ikke-indekseret)
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const j = 1 + vnoise(x * 2.1 + seed, z * 2.1 + y * 1.7) * 0.22;
        p.setXYZ(i, x * sx * j, Math.max(-s * 0.25, y * sy * j), z * sz * j);
    }
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const n = g.attributes.normal, pp = g.attributes.position;
    const cols = new Float32Array(pp.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pp.count; i += 3) {
        const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3;
        const cy = (pp.getY(i) + pp.getY(i + 1) + pp.getY(i + 2)) / 3;
        const r = rng();
        if (ny > 1 - snowy && cy > -s * 0.05) c.copy(r < 0.5 ? RC.snow : RC.snow2);
        else if (r < 0.08) c.copy(r < 0.04 ? RC.lichen : RC.lichen2);
        else c.copy(RC.rock[Math.floor(r * 3)]).lerp(RC.dark, clamp(-cy / s * 1.2 + 0.1, 0, 0.7));
        for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const m = new THREE.Mesh(g, rockMat);
    m.castShadow = m.receiveShadow = true;
    return m;
}

export function makeRock(rng) {
    const g = new THREE.Group();
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
        const s = (i === 0 ? 0.55 : 0.3) + rng() * 0.35;
        const m = makeRockMesh(rng, s);
        m.position.set(i === 0 ? 0 : (rng() - 0.5) * 1.1, s * 0.3, i === 0 ? 0 : (rng() - 0.5) * 1.1);
        m.rotation.y = rng() * 6;
        g.add(m);
    }
    return g;
}

// Drivtømmer: tykke, sølvgrå stammer med lyse snitflader og sne ovenpå
const woodMats = [lam('#8a6a4c'), lam('#a8987e'), lam('#6e5440')];
const woodEnd = lam('#d8c8a6');
const woodSnow = lam('#eef4fb');
export function makeDriftwood(rng) {
    const g = new THREE.Group();
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
        const len = 1.4 + rng() * 1.4, r = 0.12 + rng() * 0.07;
        const log = new THREE.Group();
        const body = mk(new THREE.CylinderGeometry(r * 0.85, r, len, 7), woodMats[i % 3]);
        body.rotation.z = Math.PI / 2;
        const e1 = mk(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.02, 7), woodEnd, len / 2, 0, 0);
        e1.rotation.z = Math.PI / 2;
        const e2 = mk(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.02, 7), woodEnd, -len / 2, 0, 0);
        e2.rotation.z = Math.PI / 2;
        const cap = mk(new THREE.BoxGeometry(len * 0.8, 0.05, r * 1.3), woodSnow, 0, r * 0.95, 0);
        log.add(body, e1, e2, cap);
        if (rng() < 0.6) {
            const stub = mk(new THREE.CylinderGeometry(0.03, 0.05, 0.35, 5), woodMats[(i + 1) % 3], (rng() - 0.5) * len * 0.6, r + 0.1, 0);
            stub.rotation.z = (rng() - 0.5) * 1.2;
            log.add(stub);
        }
        log.position.set((rng() - 0.5) * 0.6, r * 0.8 + i * r * 1.4, (rng() - 0.5) * 0.7);
        log.rotation.y = rng() * Math.PI;
        g.add(log);
    }
    return g;
}

export function makeWhale() {
    const g = new THREE.Group();
    const bone = '#e4dac4';
    for (let i = 0; i < 9; i++) {
        const v = mk(new THREE.BoxGeometry(0.28, 0.22, 0.3), bone, 0, 0.12, -2.2 + i * 0.55);
        v.rotation.y = (i % 2) * 0.2;
        g.add(v);
    }
    for (let i = 0; i < 6; i++) {
        const s = 1.1 - Math.abs(i - 2) * 0.12;
        const rib = mk(new THREE.TorusGeometry(s, 0.07, 4, 10, Math.PI), bone, 0, -0.1, -1.5 + i * 0.55);
        rib.rotation.z = (i % 3 - 1) * 0.12;
        g.add(rib);
    }
    const skull = mk(new THREE.BoxGeometry(0.9, 0.35, 1.6), bone, 0, 0.18, 2.6);
    skull.rotation.x = 0.1;
    const jaw = mk(new THREE.CylinderGeometry(0.06, 0.1, 2.4, 5), bone, 0.7, 0.1, 2.2);
    jaw.rotation.x = Math.PI / 2;
    jaw.rotation.z = 0.2;
    g.add(skull, jaw);
    return g;
}

const berryGeo = new THREE.SphereGeometry(0.06, 5, 4);
// Krækling: lave, mørkegrønne tuer med sorte bær og lidt sne
export function makeBush(rng) {
    const g = new THREE.Group();
    const greens = ['#3f5a3a', '#4f6b44', '#5d6f45'];
    for (let i = 0; i < 4; i++) {
        const a = rng() * Math.PI * 2, r = i ? 0.2 + rng() * 0.15 : 0;
        const s = 0.22 + rng() * 0.12;
        const tuft = mk(new THREE.IcosahedronGeometry(s, 1), greens[i % 3], Math.cos(a) * r, s * 0.35, Math.sin(a) * r);
        tuft.scale.set(1.3, 0.55, 1.2);
        g.add(tuft);
    }
    const dust = mk(new THREE.SphereGeometry(0.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#eef4fb', 0.05, 0.14, -0.05);
    dust.scale.set(1.4, 0.35, 1.1);
    g.add(dust);
    for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2, r = rng() * 0.38;
        g.add(mk(berryGeo, i % 4 ? '#1d1428' : '#6a1f2e', Math.cos(a) * r, 0.2 + rng() * 0.06, Math.sin(a) * r));
    }
    return g;
}

let cairnSeed = 0;
export function makeCairn() {
    const g = new THREE.Group();
    const r = mulberry32(777 + cairnSeed++);
    let y = 0;
    [0.72, 0.6, 0.5, 0.4, 0.32, 0.24].forEach((sz, i) => {
        const m = makeRockMesh(r, sz, 0.35);
        m.scale.y = 0.75;
        m.position.set((r() - 0.5) * 0.1, y + sz * 0.35, (r() - 0.5) * 0.1);
        m.rotation.y = i * 1.3;
        g.add(m);
        y += sz * 0.72;
    });
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 1.8, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0.6, depthWrite: false })
    );
    ring.position.y = 0.25;
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.4, 18, 8, 1, true),
        new THREE.MeshBasicMaterial({
            color: '#ffd36b', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.DoubleSide,
        })
    );
    beam.position.y = 9;
    const glow = makeGlow('#ffd36b', 3.5, 0.5);
    glow.position.y = y + 0.3;
    g.add(ring, beam, glow);
    return { group: g, ring, beam, glow };
}

export function makeFire() {
    const g = new THREE.Group();
    const stoneG = new THREE.DodecahedronGeometry(0.14, 0);
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const st = mk(stoneG, i % 2 ? '#6b6f78' : '#5b5f68', Math.cos(a) * 0.52, 0.07, Math.sin(a) * 0.52);
        st.rotation.set(i, i * 2, 0);
        g.add(st);
    }
    const logMat = lam('#3f2c1d', { emissive: '#2a0a02' });
    for (let i = 0; i < 4; i++) {
        const l = mk(new THREE.CylinderGeometry(0.055, 0.07, 0.85, 6), logMat, 0, 0.16, 0);
        l.rotation.z = Math.PI / 2 - 0.45;
        l.rotation.y = i * Math.PI / 2 + 0.3;
        l.position.set(Math.cos(i * Math.PI / 2 + 0.3) * 0.12, 0.2, -Math.sin(i * Math.PI / 2 + 0.3) * 0.12);
        g.add(l);
    }
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.34, 12).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ff5a14' }));
    coals.position.y = 0.05;
    const flames = new THREE.Group();
    flames.add(makeFlame(1.05, 1.55, 0.0), makeFlame(0.8, 1.2, 3.1), makeFlame(0.5, 0.85, 7.3));
    flames.children[1].position.x = 0.08;
    flames.children[2].material.uniforms.uPower.value = 1.25;
    flames.position.y = 0.08;
    const halo = makeGlow('#ff8a3a', 3.4, 0.5);
    halo.position.y = 0.7;
    flames.add(halo, coals);
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: softTex, color: '#ff7a2a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.y = 0.06;
    g.add(flames, glow);
    contactShadow(g, 1.9, 1.9, 0.4);
    return { group: g, flames, glow, halo };
}

/** Fakkel: en stav med en tjæret brand i toppen. Lyser i mørket, men brænder ud (se heaters i main.js). */
export function makeTorch() {
    const g = new THREE.Group();
    const pole = mk(new THREE.CylinderGeometry(0.04, 0.06, 1.7, 6), '#6b4c2e', 0, 0.85, 0);
    pole.rotation.z = 0.05;
    const head = mk(new THREE.CylinderGeometry(0.1, 0.065, 0.24, 7), '#3a2515', 0, 1.7, 0);
    const wrap = mk(new THREE.TorusGeometry(0.075, 0.018, 5, 10), '#b89a68', 0, 1.62, 0);
    wrap.rotation.x = Math.PI / 2;
    const flames = new THREE.Group();
    flames.add(makeFlame(0.42, 0.72, 0.0, 0.4), makeFlame(0.3, 0.52, 4.7, 0.4));
    flames.children[1].position.x = 0.03;
    flames.position.y = 1.76;
    const halo = makeGlow('#ffb45a', 2.4, 0.55);
    halo.position.y = 0.3;
    flames.add(halo);
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: softTex, color: '#ff8a30', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.y = 0.06;
    g.add(pole, head, wrap, flames, glow);
    contactShadow(g, 0.9, 0.9, 0.3);
    return { group: g, flames, glow, halo, head };
}

export function makeQulliq() {
    const g = new THREE.Group();
    g.add(mk(new THREE.CylinderGeometry(0.3, 0.35, 0.25, 7), '#6b6f78', 0, 0.12, 0));
    g.add(mk(new THREE.CylinderGeometry(0.42, 0.34, 0.12, 14, 1, false, 0, Math.PI), '#7d8a78', 0, 0.3, 0));
    const flames = new THREE.Group();
    for (let i = 0; i < 5; i++) {
        const f = makeFlame(0.2, 0.3, i * 1.7, 1);
        f.position.set(0.04, 0.34, -0.3 + i * 0.15);
        flames.add(f);
    }
    const halo = makeGlow('#ffb45a', 2.2, 0.5);
    halo.position.y = 0.5;
    flames.add(halo);
    g.add(flames);
    contactShadow(g, 1.2, 1.2, 0.35);
    return { group: g, flames, halo };
}

export const doorMat = new THREE.MeshBasicMaterial({ color: '#1d2838' });
export function makeIgloo() {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(2.1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
    const cnt = geo.attributes.position.count;
    const cols = new Float32Array(cnt * 3);
    const c = new THREE.Color();
    for (let i = 0; i < cnt; i += 6) {
        c.set('#eef4fb').offsetHSL(0, 0, -Math.random() * 0.1);
        for (let k = i; k < Math.min(cnt, i + 6); k++) cols.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const dome = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    dome.castShadow = dome.receiveShadow = true;
    const tunnel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.8, 1.5, 10, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2),
        lam('#e6eef8', { side: THREE.DoubleSide })
    );
    tunnel.position.set(0, 0, 2.0);
    tunnel.castShadow = true;
    const door = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12, 0, Math.PI), doorMat);
    door.position.set(0, 0.01, 2.76);
    const halo = makeGlow('#ffb060', 2.6, 0);
    halo.position.set(0, 0.4, 2.9);
    g.add(dome, tunnel, door, halo);
    return { group: g, halo };
}

/** Slæden: føreren står bag på meierne, med opstanderne foran sig. */
export function makeSled() {
    const g = new THREE.Group();
    const wood = '#8a6644', dark = '#5a3f28';
    for (const x of [-0.38, 0.38]) {
        g.add(mk(new THREE.BoxGeometry(0.07, 0.1, 2.1), dark, x, 0.05, 0));
        const tip = mk(new THREE.BoxGeometry(0.07, 0.1, 0.35), dark, x, 0.15, 1.1);
        tip.rotation.x = -0.6;
        const up = mk(new THREE.BoxGeometry(0.06, 0.85, 0.06), dark, x, 0.5, -0.62);
        up.rotation.x = -0.35;
        g.add(tip, up);
    }
    g.add(mk(new THREE.BoxGeometry(0.84, 0.05, 0.05), dark, 0, 0.9, -0.77));
    for (let i = 0; i < 6; i++) g.add(mk(new THREE.BoxGeometry(0.9, 0.05, 0.16), wood, 0, 0.13, -0.55 + i * 0.3));
    g.add(mk(new THREE.BoxGeometry(0.7, 0.35, 0.8), '#7a5a3c', 0, 0.33, 0.45));
    g.add(mk(new THREE.BoxGeometry(0.72, 0.06, 0.82), '#3b2c22', 0, 0.52, 0.45));
    g.add(mk(new THREE.BoxGeometry(0.4, 0.2, 0.3), '#a07a55', 0.1, 0.65, 0.35));
    contactShadow(g, 1.4, 2.8, 0.3);
    return g;
}

export function makeIceberg(rng, size) {
    const geo = new THREE.IcosahedronGeometry(size, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        p.setXYZ(i, p.getX(i) * (0.8 + rng() * 0.4), Math.max(-size * 0.3, p.getY(i) * (0.7 + rng() * 0.8)), p.getZ(i) * (0.8 + rng() * 0.4));
    }
    geo.computeVertexNormals();
    const m = mk(geo, lam('#dff2fb', { emissive: '#12303c' }));
    return m;
}

export function makeHole() {
    const g = new THREE.Group();
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.6, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0b1c2a' }));
    water.position.y = 0.015;
    const rim = mk(new THREE.TorusGeometry(0.66, 0.12, 4, 14), '#eef4fb', 0, 0.03, 0);
    rim.rotation.x = Math.PI / 2;
    rim.scale.z = 0.5;
    g.add(water, rim);
    return g;
}

// ---------------------------------------------------------------------------
// Udlægning af verden
// ---------------------------------------------------------------------------
export function populate(scene) {
    const rng = mulberry32(4242);
    const occupied = [{ x: SPAWN.x, z: SPAWN.z, r: 2.5 }];
    const free = (x, z, r) => {
        for (const o of occupied) {
            const dx = o.x - x, dz = o.z - z;
            if (dx * dx + dz * dz < (o.r + r) ** 2) return false;
        }
        return true;
    };
    function spot(cond, cx, cz, rMin, rMax, r = 1.2, reserve = true) {
        for (let i = 0; i < 800; i++) {
            const a = rng() * Math.PI * 2, d = rMin + (rMax - rMin) * Math.sqrt(rng());
            const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
            if (Math.hypot(x, z) > WORLD_RADIUS - 2) continue;
            const h = groundHeight(x, z);
            if (cond(h, x, z) && free(x, z, r)) {
                if (reserve) occupied.push({ x, z, r });
                return { x, z, h };
            }
        }
        return null;
    }
    const isLand = (h, x, z) => h > 0.35 && slopeAt(x, z) < 0.45;
    const isShore = (h) => h > -0.4 && h < 0.8;
    const isSea = (h, x, z) => h < -1.2 && Math.hypot(x, z) < WORLD_RADIUS - 4;
    const anyWalk = (h) => h > -2.4;

    const nodes = [], colliders = [];
    function addNode(type, s) {
        if (!s) return;
        let group, r = 0.8, charges = 1, collR = 0;
        if (type === 'wood') { group = makeDriftwood(rng); charges = 1; r = 1.0; }
        if (type === 'stone') { group = makeRock(rng); charges = 3; r = 0.9; collR = 0.75; }
        if (type === 'bone') { group = makeWhale(); charges = 4; r = 1.8; collR = 1.1; }
        if (type === 'berries') { group = makeBush(rng); charges = 2; r = 0.6; }
        const shade = { wood: [2.4, 1.6], stone: [2.3, 2.3], bone: [3.2, 7], berries: [1.4, 1.4] }[type];
        contactShadow(group, shade[0], shade[1], 0.3);
        const y = Math.max(s.h, 0);
        group.position.set(s.x, y, s.z);
        group.rotation.y = rng() * Math.PI * 2;
        scene.add(group);
        const node = { type, x: s.x, z: s.z, y, r, charges, max: charges, group, respawn: 0, collider: null, shake: 0, grow: 1, baseRot: group.rotation.y };
        if (collR) {
            node.collider = { x: s.x, z: s.z, r: collR, active: true };
            colliders.push(node.collider);
        }
        nodes.push(node);
    }
    const near = (cond, fallback, rMax, r) =>
        spot(cond, SPAWN.x, SPAWN.z, 4, rMax, r) || spot(fallback, SPAWN.x, SPAWN.z, 4, rMax, r);

    // Garanteret startudstyr tæt på start
    for (let i = 0; i < 3; i++) addNode('wood', near(isShore, isLand, 26, 1.2));
    for (let i = 0; i < 3; i++) addNode('stone', near(isLand, anyWalk, 16, 1.2));
    addNode('bone', near(isShore, isLand, 38, 3));
    for (let i = 0; i < 2; i++) addNode('berries', near(isLand, anyWalk, 18, 1));

    for (let i = 0; i < 26; i++) addNode('wood', spot(isShore, 0, 0, 50, 104, 1.5));
    for (let i = 0; i < 34; i++) addNode('stone', spot(isLand, 0, 0, 0, 95, 2));
    for (let i = 0; i < 4; i++) addNode('bone', spot(isShore, 0, 0, 55, 104, 4));
    for (let i = 0; i < 22; i++) addNode('berries', spot(isLand, 0, 0, 0, 90, 2));

    // Varder
    const cairns = [];
    const base = Math.atan2(SPAWN.z, SPAWN.x);
    const cairnSpots = [spot(isLand, SPAWN.x, SPAWN.z, 20, 32, 3)];
    for (let i = 1; i < 5; i++) {
        const a = base + i * (Math.PI * 2 / 5);
        cairnSpots.push(spot(isLand, Math.cos(a) * 48, Math.sin(a) * 48, 0, 22, 3) || spot(isLand, 0, 0, 10, 90, 3));
    }
    for (const s of cairnSpots) {
        if (!s) continue;
        const c = makeCairn();
        contactShadow(c.group, 2.2, 2.2, 0.4);
        c.group.position.set(s.x, s.h, s.z);
        scene.add(c.group);
        const collider = { x: s.x, z: s.z, r: 0.8, active: true };
        colliders.push(collider);
        cairns.push({ x: s.x, z: s.z, ...c, found: false });
    }

    // Åndehuller på havisen
    const holes = [];
    const holeSpots = [spot(isSea, SPAWN.x, SPAWN.z, 10, 45, 3)];
    for (let i = 0; i < 7; i++) holeSpots.push(spot(isSea, 0, 0, 75, 102, 4));
    for (const s of holeSpots) {
        if (!s) continue;
        const g = makeHole();
        g.position.set(s.x, 0, s.z);
        scene.add(g);
        holes.push({ x: s.x, z: s.z, group: g });
    }

    // Isbjerge – nogle frosset fast i havisen, andre i åbent vand
    const bergs = [];
    for (let i = 0; i < 6; i++) {
        const s = spot(isSea, 0, 0, 85, 102, 5);
        if (!s) continue;
        const size = 1.8 + rng() * 2.2;
        const m = makeIceberg(rng, size);
        m.position.set(s.x, 0, s.z);
        m.rotation.y = rng() * 6;
        scene.add(m);
        colliders.push({ x: s.x, z: s.z, r: size * 0.9, active: true });
        bergs.push({ mesh: m, bob: false, ph: rng() * 6 });
    }
    for (let i = 0; i < 18; i++) {
        const a = rng() * Math.PI * 2, r = 116 + rng() * 55;
        const size = 2 + rng() * 5;
        const m = makeIceberg(rng, size);
        m.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        m.rotation.y = rng() * 6;
        scene.add(m);
        bergs.push({ mesh: m, bob: true, ph: rng() * 6 });
    }

    return { nodes, colliders, cairns, holes, bergs, spot, isLand, isSea, rng };
}
