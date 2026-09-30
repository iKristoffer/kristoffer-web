import * as THREE from 'three';

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

export const glitterUniforms = {
    uTime: { value: 0 },
    uGlint: { value: new THREE.Color(1, 1, 1) },
    uCamPos: { value: new THREE.Vector3() },
};

function injectGlitter(mat) {
    mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, glitterUniforms);
        sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
        );
        sh.fragmentShader = [
            'uniform float uTime;',
            'uniform vec3 uGlint;',
            'uniform vec3 uCamPos;',
            'varying vec3 vWPos;',
            'float ghash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
            '',
        ].join('\n') + sh.fragmentShader.replace('#include <opaque_fragment>', `
    vec3 gcell = floor(vWPos * 9.0);
    float gh = ghash(gcell);
    float tw = sin(uTime * 2.0 + gh * 60.0 + dot(uCamPos.xz, vec2(1.7, 2.3)) * (0.5 + gh));
    outgoingLight += uGlint * step(0.99, gh) * pow(max(tw, 0.0), 12.0);
    #include <opaque_fragment>`);
    };
}

export function buildTerrain() {
    for (let iz = 0; iz <= SEG; iz++) {
        for (let ix = 0; ix <= SEG; ix++) {
            grid[iz * (SEG + 1) + ix] = heightAt(-HALF + ix * CELL, -HALF + iz * CELL);
        }
    }
    let geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos0 = geo.attributes.position;
    for (let i = 0; i < pos0.count; i++) pos0.setY(i, grid[i]);
    geo = geo.toNonIndexed();
    geo.computeVertexNormals();

    const p = geo.attributes.position, n = geo.attributes.normal;
    const cols = new Float32Array(p.count * 3);
    const cSnow = new THREE.Color('#eef4fb'), cSnow2 = new THREE.Color('#c9d9ea');
    const cRock = new THREE.Color('#6a6d76'), cRock2 = new THREE.Color('#555861');
    const cShore = new THREE.Color('#b9cadb');
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
        const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
        const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
        const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
        const ny = n.getY(i);
        const v = vnoise(cx * 0.25, cz * 0.25) * 0.5 + 0.5;
        tmp.copy(cSnow).lerp(cSnow2, clamp(v * 0.5 + (1 - ny) * 1.6, 0, 1));
        let rock = smoothstep(0.24, 0.4, 1 - ny);
        if (cy > 3) rock += smoothstep(0.66, 0.78, vnoise(cx * 0.09 + 40, cz * 0.09)) * 0.5;
        if (rock > 0) tmp.lerp(v > 0.5 ? cRock : cRock2, Math.min(1, rock));
        if (cy < 0.35) tmp.lerp(cShore, 0.6 * clamp(1 - cy / 0.35, 0, 1));
        for (let k = 0; k < 3; k++) {
            cols[(i + k) * 3] = tmp.r;
            cols[(i + k) * 3 + 1] = tmp.g;
            cols[(i + k) * 3 + 2] = tmp.b;
        }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    injectGlitter(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
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
        new THREE.MeshBasicMaterial({ map: softTex, color: 0x000000, transparent: true, opacity, depthWrite: false })
    );
    m.renderOrder = 3;
    return m;
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
export function makePlayer() {
    const group = new THREE.Group();
    const model = new THREE.Group();
    group.add(model);
    const mats = {
        coat: new THREE.MeshLambertMaterial({ color: '#7a5236', flatShading: true }),
        fur: new THREE.MeshLambertMaterial({ color: '#eadfcb', flatShading: true }),
        skin: new THREE.MeshLambertMaterial({ color: '#c8966c', flatShading: true }),
        pants: new THREE.MeshLambertMaterial({ color: '#3b2c22', flatShading: true }),
        boots: new THREE.MeshLambertMaterial({ color: '#4a392b', flatShading: true }),
    };
    const body = mk(new THREE.CylinderGeometry(0.3, 0.44, 0.8, 8), mats.coat, 0, 0.98, 0);
    const hem = mk(new THREE.TorusGeometry(0.42, 0.07, 5, 10), mats.fur, 0, 0.6, 0);
    hem.rotation.x = Math.PI / 2;
    const hood = mk(new THREE.SphereGeometry(0.3, 10, 8), mats.coat, 0, 1.55, -0.03);
    const face = mk(new THREE.SphereGeometry(0.19, 8, 6), mats.skin, 0, 1.55, 0.13);
    const ruff = mk(new THREE.TorusGeometry(0.2, 0.07, 5, 10), mats.fur, 0, 1.55, 0.19);
    const eyeG = new THREE.BoxGeometry(0.045, 0.035, 0.02);
    const eyeL = mk(eyeG, '#1a1a1a', -0.07, 1.58, 0.315);
    const eyeR = mk(eyeG, '#1a1a1a', 0.07, 1.58, 0.315);
    model.add(body, hem, hood, face, ruff, eyeL, eyeR);

    const legG = new THREE.BoxGeometry(0.17, 0.5, 0.2).translate(0, -0.25, 0);
    const bootG = new THREE.BoxGeometry(0.2, 0.18, 0.28).translate(0, -0.5, 0.03);
    const legs = [-1, 1].map((s) => {
        const piv = new THREE.Group();
        piv.position.set(0.13 * s, 0.6, 0);
        piv.add(mk(legG, mats.pants), mk(bootG, mats.boots));
        model.add(piv);
        return piv;
    });
    const armG = new THREE.BoxGeometry(0.14, 0.5, 0.15).translate(0, -0.25, 0);
    const mitG = new THREE.SphereGeometry(0.09, 6, 5).translate(0, -0.53, 0);
    const arms = [-1, 1].map((s) => {
        const piv = new THREE.Group();
        piv.position.set(0.37 * s, 1.3, 0);
        piv.rotation.z = 0.12 * s;
        piv.add(mk(armG, mats.coat), mk(mitG, mats.fur));
        model.add(piv);
        return piv;
    });
    const harpoon = makeSpear();
    harpoon.position.set(0, -0.5, 0.25);
    harpoon.rotation.x = -0.25;
    harpoon.visible = false;
    arms[1].add(harpoon);

    // Silhuet, når figuren står bag bjerge (tegnes før selve figuren)
    const silMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a', depthFunc: THREE.GreaterDepth, depthWrite: false });
    const meshes = [];
    model.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
        const s = new THREE.Mesh(m.geometry, silMat);
        s.renderOrder = 1;
        m.add(s);
        m.renderOrder = 2;
    }
    return { group, model, legs, arms, body, mats, harpoon };
}

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
    const white = '#eceae4';
    const body = mk(new THREE.BoxGeometry(0.34, 0.32, 0.75), fur, 0, 0.45, 0);
    const belly = mk(new THREE.BoxGeometry(0.3, 0.1, 0.6), white, 0, 0.3, 0);
    const chest = mk(new THREE.BoxGeometry(0.3, 0.3, 0.12), white, 0, 0.45, 0.36);
    g.add(body, belly, chest);
    const head = new THREE.Group();
    head.position.set(0, 0.64, 0.42);
    head.add(
        mk(new THREE.BoxGeometry(0.28, 0.26, 0.28), fur),
        mk(new THREE.BoxGeometry(0.16, 0.13, 0.18), white, 0, -0.05, 0.19),
        mk(new THREE.BoxGeometry(0.06, 0.05, 0.04), '#151515', 0, -0.01, 0.29),
        mk(new THREE.BoxGeometry(0.04, 0.035, 0.02), '#151515', -0.07, 0.05, 0.145),
        mk(new THREE.BoxGeometry(0.04, 0.035, 0.02), '#151515', 0.07, 0.05, 0.145),
    );
    for (const s of [-1, 1]) {
        const ear = mk(new THREE.ConeGeometry(0.06, 0.15, 4), fur, 0.08 * s, 0.19, -0.03);
        head.add(ear);
    }
    g.add(head);
    const tail = new THREE.Group();
    tail.position.set(0, 0.58, -0.36);
    const tailM = mk(new THREE.TorusGeometry(0.12, 0.045, 5, 8, Math.PI * 1.3), white, 0, 0.1, 0);
    tailM.rotation.y = Math.PI / 2;
    tail.add(tailM);
    g.add(tail);
    const legG = new THREE.BoxGeometry(0.09, 0.3, 0.09).translate(0, -0.15, 0);
    const legs = [[-0.11, 0.25], [0.11, 0.25], [-0.11, -0.25], [0.11, -0.25]].map(([x, z]) => {
        const piv = new THREE.Group();
        piv.position.set(x, 0.32, z);
        piv.add(mk(legG, fur));
        g.add(piv);
        return piv;
    });
    return { group: g, legs, tail, head, body };
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
    g.add(body, head, e1, e2, tips, mk(new THREE.BoxGeometry(0.03, 0.03, 0.02), '#222', 0.07, 0.37, 0.3));
    return { group: g };
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

export function makeRock(rng) {
    const g = new THREE.Group();
    const n = 1 + Math.floor(rng() * 3);
    const cols = ['#6b6f78', '#5a5e67', '#7a7d84'];
    for (let i = 0; i < n; i++) {
        const s = 0.35 + rng() * 0.45;
        const m = mk(new THREE.DodecahedronGeometry(s, 0), cols[i % 3], (rng() - 0.5) * 0.9, s * 0.4, (rng() - 0.5) * 0.9);
        m.scale.set(1, 0.6 + rng() * 0.5, 1);
        m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        g.add(m);
    }
    const cap = mk(new THREE.SphereGeometry(0.4, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), '#eef4fb', 0, 0.45, 0);
    cap.scale.set(1, 0.35, 1);
    g.add(cap);
    return g;
}

export function makeDriftwood(rng) {
    const g = new THREE.Group();
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
        const len = 1.2 + rng() * 1.2;
        const m = mk(new THREE.CylinderGeometry(0.09 + rng() * 0.05, 0.12, len, 6), i % 2 ? '#7c5f43' : '#9a8468',
            (rng() - 0.5) * 0.6, 0.1 + i * 0.12, (rng() - 0.5) * 0.6);
        m.rotation.z = Math.PI / 2;
        m.rotation.y = rng() * Math.PI;
        g.add(m);
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
export function makeBush(rng) {
    const g = new THREE.Group();
    const b = mk(new THREE.IcosahedronGeometry(0.42, 0), '#4d5b3c', 0, 0.12, 0);
    b.scale.set(1.2, 0.45, 1);
    g.add(b);
    for (let i = 0; i < 7; i++) {
        const a = rng() * Math.PI * 2, r = rng() * 0.35;
        g.add(mk(berryGeo, '#2b1d3d', Math.cos(a) * r, 0.25, Math.sin(a) * r));
    }
    return g;
}

export function makeCairn() {
    const g = new THREE.Group();
    let y = 0;
    [0.7, 0.58, 0.48, 0.38, 0.3, 0.22].forEach((s, i) => {
        const m = mk(new THREE.DodecahedronGeometry(s, 0), i % 2 ? '#6c7079' : '#81858d', (i % 2 - 0.5) * 0.08, y + s * 0.5, 0);
        m.scale.y = 0.7;
        m.rotation.y = i;
        g.add(m);
        y += s * 0.85;
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
    for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2;
        g.add(mk(stoneG, '#6b6f78', Math.cos(a) * 0.5, 0.07, Math.sin(a) * 0.5));
    }
    for (let i = 0; i < 3; i++) {
        const l = mk(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 5), '#4a3322', 0, 0.12, 0);
        l.rotation.z = Math.PI / 2;
        l.rotation.y = i * Math.PI / 3;
        g.add(l);
    }
    const flames = new THREE.Group();
    const f1 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 7), new THREE.MeshBasicMaterial({ color: '#ff7a1f', transparent: true, opacity: 0.9 }));
    f1.position.y = 0.5;
    const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), new THREE.MeshBasicMaterial({ color: '#ffe27a' }));
    f2.position.y = 0.4;
    flames.add(f1, f2);
    const halo = makeGlow('#ff8a3a', 3.2, 0.55);
    halo.position.y = 0.6;
    flames.add(halo);
    const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: softTex, color: '#ff7a2a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    glow.position.y = 0.06;
    g.add(flames, glow);
    return { group: g, flames, glow, halo };
}

export function makeQulliq() {
    const g = new THREE.Group();
    g.add(mk(new THREE.CylinderGeometry(0.3, 0.35, 0.25, 7), '#6b6f78', 0, 0.12, 0));
    g.add(mk(new THREE.CylinderGeometry(0.42, 0.34, 0.12, 14, 1, false, 0, Math.PI), '#7d8a78', 0, 0.3, 0));
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.78), new THREE.MeshBasicMaterial({ color: '#ffc766' }));
    flame.position.set(0.03, 0.39, 0);
    const halo = makeGlow('#ffb45a', 2.2, 0.5);
    halo.position.y = 0.5;
    const flames = new THREE.Group();
    flames.add(flame, halo);
    g.add(flames);
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

export function makeSled() {
    const g = new THREE.Group();
    const wood = '#8a6644', dark = '#5a3f28';
    for (const x of [-0.38, 0.38]) {
        g.add(mk(new THREE.BoxGeometry(0.07, 0.1, 2.0), dark, x, 0.05, 0));
        const tip = mk(new THREE.BoxGeometry(0.07, 0.1, 0.35), dark, x, 0.15, 1.05);
        tip.rotation.x = -0.6;
        const up = mk(new THREE.BoxGeometry(0.06, 0.7, 0.06), dark, x, 0.45, -0.9);
        up.rotation.x = -0.2;
        g.add(tip, up);
    }
    for (let i = 0; i < 6; i++) g.add(mk(new THREE.BoxGeometry(0.9, 0.05, 0.16), wood, 0, 0.13, -0.75 + i * 0.3));
    g.add(mk(new THREE.BoxGeometry(0.7, 0.35, 0.8), '#7a5a3c', 0, 0.33, 0.4));
    g.add(mk(new THREE.BoxGeometry(0.72, 0.06, 0.82), '#3b2c22', 0, 0.52, 0.4));
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
        const y = Math.max(s.h, 0);
        group.position.set(s.x, y, s.z);
        group.rotation.y = rng() * Math.PI * 2;
        scene.add(group);
        const node = { type, x: s.x, z: s.z, y, r, charges, max: charges, group, respawn: 0, collider: null };
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
