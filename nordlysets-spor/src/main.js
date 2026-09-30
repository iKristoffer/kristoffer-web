import * as THREE from 'three';
import * as W from './world.js';
import { createIceMaterial, Snow, Particles, Footprints, PostFX, Mist } from './fx.js';
import { lightUniforms, flameUniforms } from './shaders.js';
import { makePlayerRig, PlayerAnimator } from './player.js';
import { buildScatter, windUniform } from './scatter.js';
import { Sound } from './audio.js';
import { Dog } from './dog.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const { clamp, smoothstep } = W;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Renderer, kamera, lys
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.75 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);
const post = new PostFX(renderer);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe0ee, 95, 260);
const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 420);
const CAM_OFF = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(90);
const ZOOMS = [15, 21, 29];
let zoomIdx = isTouch && innerWidth < innerHeight ? 0 : 1;
let viewH = 21, pxPerUnit = 30;

const hemi = new THREE.HemisphereLight(0xdfefff, 0x8aa0b8, 0.7);
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
// Køligt modlys, der skiller figurer fra sneen
const rim = new THREE.DirectionalLight(0x9fc4ff, 0.3);
scene.add(hemi, sun, sun.target, rim, rim.target);
const pointLights = [0, 1].map(() => {
    const l = new THREE.PointLight(0xff8a3a, 0, 16, 2);
    scene.add(l);
    return l;
});

// ---------------------------------------------------------------------------
// Verden
// ---------------------------------------------------------------------------
const terrain = W.buildTerrain();
scene.add(terrain);
const iceMat = createIceMaterial();
const ice = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), iceMat);
scene.add(ice);
const world = W.populate(scene);
const { nodes, colliders, cairns, holes, bergs } = world;
buildScatter(scene, nodes, isTouch);

const snow = new Snow(isTouch ? 2200 : 4500);
const bokeh = new Snow(isTouch ? 40 : 70, { box: [46, 18, 46], soft: true });
bokeh.uniforms.uSize.value = 0.42;
const mist = new Mist(isTouch ? 16 : 24);
scene.add(bokeh.points, mist.group);
const sparks = new Particles(280, true);
const puffs = new Particles(320, false);
const steps = new Footprints(420);
scene.add(snow.points, sparks.points, puffs.points, steps.mesh);

// ---------------------------------------------------------------------------
// Tilstand
// ---------------------------------------------------------------------------
const DAY_LEN = 300;
const S = {
    t: 0.66, day: 1, time: 0, paused: true, started: false, over: false, won: false,
    health: 100, warmth: 100, food: 85,
    inv: { wood: 3, stone: 1, bone: 0, snow: 0, hide: 0, meat: 0, cooked: 0, blubber: 0, berries: 1 },
    has: { harpoon: false, knife: false, kamik: false, anorak: false, sled: false },
    storm: 0, snowAmt: 0.12, weather: 'clear', wTimer: 130, nextStorm: false, warned: false,
    windAngle: 0.6, wind: new THREE.Vector3(1, 0, 0),
    aurora: 0.8, auroraTarget: 0.8, auroraRetarget: 10, aTime: 0, burst: 0, burstDone: false,
    night: 0, day01: 1, sheltered: false, lastDamage: 'cold',
    cairnsFound: 0, builtFire: false, igloos: 0,
};

const ITEMS = {
    wood: { name: 'Drivtømmer', icon: '🪵' },
    stone: { name: 'Sten', icon: '🪨' },
    bone: { name: 'Knogler', icon: '🦴' },
    snow: { name: 'Sneblokke', icon: '🧊' },
    hide: { name: 'Skind', icon: '🟫' },
    meat: { name: 'Råt kød', icon: '🥩', food: 18 },
    cooked: { name: 'Kogt kød', icon: '🍖', food: 32, warm: 6 },
    blubber: { name: 'Spæk', icon: '🧈', food: 12, warm: 10 },
    berries: { name: 'Krækbær', icon: '🫐', food: 7 },
};
const EAT_ORDER = ['cooked', 'meat', 'berries', 'blubber'];

const RECIPES = [
    { id: 'fire', name: 'Bål', icon: '🔥', desc: 'Varme og lys. Holder isbjørne væk. Kog kød ved det.', cost: { wood: 3, stone: 3 }, place: true },
    { id: 'knife', name: 'Snekniv', icon: '🔪', desc: 'Af knogle. Skær sneblokke til en iglo.', cost: { bone: 2 }, once: true },
    { id: 'harpoon', name: 'Harpun', icon: '🔱', desc: 'Til fangst af sæl (puisi) og hare. Skræmmer isbjørne.', cost: { wood: 2, bone: 1, stone: 1 }, once: true },
    { id: 'kamik', name: 'Kamikker', icon: '🥾', desc: 'Skindstøvler. Mindre kulde og lettere gang.', cost: { hide: 2 }, once: true },
    { id: 'anorak', name: 'Skindanorak', icon: '🧥', desc: 'Syet med knoglenål. Holder meget mere varme.', cost: { hide: 3, bone: 1 }, once: true },
    { id: 'lamp', name: 'Qulleq (spæklampe)', icon: '🪔', desc: 'Stenlampe med spæk. Svag, men langvarig varme.', cost: { stone: 3, blubber: 2 }, place: true },
    { id: 'igloo', name: 'Iglo', icon: '⛺', desc: 'Ly mod stormen. Stil dig inde i den.', cost: { snow: 12 }, place: true },
    { id: 'sled', name: 'Hundeslæde', icon: '🛷', desc: 'Siku og to hunde mere trækker dig – meget hurtigere.', cost: { wood: 4, hide: 3, bone: 2 }, once: true },
];

const JOURNAL = [
    'Hundene hyler mod vest. Knud siger, at rejsen vil tage år. Jeg har pakket nåle, sener og skind – uden godt tøj overlever ingen derude.',
    'Stormen varede i to døgn. Vi sad i igloen, og jeg syede kamikker ved spæklampens lys, mens sneen begravede slæderne.',
    'Miteq fandt friske spor af nanoq – isbjørnen. I nat holder vi bålet ved lige, og hundene sover uroligt.',
    'Nordlyset spejlede sig i isen i nat, grønt og violet, som om himlen selv rejste med os.',
    'Isen strækker sig uendeligt mod vest. Et sted derude, mange vintre borte, venter Alaska. Vi fortsætter.',
];

const NODE_INFO = {
    wood: { label: 'Saml drivtømmer', icon: '🪵', name: 'drivtømmer' },
    stone: { label: 'Hug sten', icon: '⛏️', name: 'sten' },
    bone: { label: 'Saml knogler', icon: '🦴', name: 'hvalknogler' },
    berries: { label: 'Pluk krækbær', icon: '🫐', name: 'krækbær' },
};

// ---------------------------------------------------------------------------
// Figurer
// ---------------------------------------------------------------------------
const player = makePlayerRig();
const anim = new PlayerAnimator(player);
scene.add(player.group);
const pBlob = W.makeBlob(1.3, 0.35);
scene.add(pBlob);
const P = {
    pos: player.group.position,
    vel: new THREE.Vector3(),
    yaw: Math.PI * 1.25,
    speed: 0,
    idle: 0,
    phase: 0,
    dist: 0,
    side: 1,
    act: 0,
    onIce: false,
};
P.pos.set(W.SPAWN.x, Math.max(0, W.groundHeight(W.SPAWN.x, W.SPAWN.z)), W.SPAWN.z);

const sled = W.makeSled();
sled.position.set(0, 0, 0.95);
sled.visible = false;
player.group.add(sled);

const siku = new Dog(scene, W.SPAWN.x + 2, W.SPAWN.z - 1.5, '#8a8f99', 'Siku');
const teamDogs = [];
const traceGeo = new THREE.BufferGeometry();
traceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
const traces = new THREE.LineSegments(traceGeo, new THREE.LineBasicMaterial({ color: '#2a1f18' }));
traces.frustumCulled = false;
traces.visible = false;
scene.add(traces);

// Harer
const hares = [];
for (let i = 0; i < 8; i++) {
    const s = i < 2 ? world.spot(world.isLand, W.SPAWN.x, W.SPAWN.z, 12, 30, 1, false) : world.spot(world.isLand, 0, 0, 0, 90, 1, false);
    if (!s) continue;
    const m = W.makeHare();
    scene.add(m.group);
    hares.push({
        m: m.group, inner: m.inner, ears: m.ears, alertK: 0, pos: new THREE.Vector3(s.x, s.h, s.z), home: new THREE.Vector3(s.x, 0, s.z),
        target: new THREE.Vector3(s.x, 0, s.z), alive: true, respawn: 0, hop: 0, yaw: 0, wait: 0, scare: 0, scareFrom: null,
    });
}

// Sæler
const seals = holes.map((h, i) => {
    const m = W.makeSeal();
    m.group.position.set(h.x, -1.2, h.z);
    scene.add(m.group);
    return { hole: h, m: m.group, state: 'down', timer: i === 0 ? 6 : 4 + Math.random() * 12, y: -1.2 };
});

// Isbjørne
const bears = [];
for (let i = 0; i < 2; i++) {
    const s = world.spot((h) => h > -2.4, 0, 0, 0, 100, 1, false);
    if (!s || Math.hypot(s.x - W.SPAWN.x, s.z - W.SPAWN.z) < 55) { i--; continue; }
    const m = W.makeBear();
    // Omdrejningspunkt ved hofterne, så bjørnen kan rejse sig på bagbenene
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.7, -0.55);
    while (m.group.children.length) {
        const c = m.group.children[0];
        c.position.y -= 0.7;
        c.position.z += 0.55;
        pivot.add(c);
    }
    m.group.add(pivot);
    const blob = W.makeBlob(2.6, 0.32);
    scene.add(m.group, blob);
    bears.push({
        ...m, pivot, blob, standT: 0, walk: 0, pos: new THREE.Vector3(s.x, 0, s.z), home: new THREE.Vector3(s.x, 0, s.z),
        target: new THREE.Vector3(s.x, 0, s.z), flee: 0, atk: 0, wait: 0, yaw: 0, phase: 0, mode: 'wander', alertT: 0,
    });
}

// Ringe i vandet ved åndehullerne
const ripples = [];
const rippleGeo = new THREE.RingGeometry(0.5, 0.56, 28).rotateX(-Math.PI / 2);
for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: '#cfe9ff', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 4;
    scene.add(m);
    ripples.push({ m, t: 1 });
}
let rippleIdx = 0;
function ripple(x, z, delay = 0) {
    const r = ripples[rippleIdx++ % ripples.length];
    r.t = -delay;
    r.m.position.set(x, 0.03, z);
}
function updateRipples(dt) {
    for (const r of ripples) {
        if (r.t >= 1) { r.m.visible = false; continue; }
        r.t += dt / 1.4;
        if (r.t < 0) continue;
        r.m.visible = true;
        r.m.scale.setScalar(0.6 + r.t * 1.6);
        r.m.material.opacity = (1 - r.t) * 0.55;
    }
}

// Markering under det, du kan interagere med
const hl = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.15)');
    gr.addColorStop(0.8, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 4; i++) {
        g.save();
        g.translate(64, 64);
        g.rotate(i * Math.PI / 2);
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath();
        g.moveTo(0, -63);
        g.lineTo(-5, -52);
        g.lineTo(5, -52);
        g.fill();
        g.restore();
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(cv), color: '#ffbf3a', transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    }));
    m.renderOrder = 4;
    return { m, get: null, r: 1, op: 0, pos: new THREE.Vector3() };
})();
scene.add(hl.m);
const tmpH = new THREE.Vector3();

function highlightFor(it) {
    const at = (x, y, z) => () => tmpH.set(x, y, z);
    switch (it.kind) {
        case 'node': return [at(it.n.x, it.n.y, it.n.z), it.n.r + 0.5];
        case 'cook': case 'fuel': case 'relight': case 'refill': return [at(it.h.x, it.h.y, it.h.z), 1];
        case 'cairn': return [at(it.c.x, W.groundHeight(it.c.x, it.c.z), it.c.z), 1.1];
        case 'seal': return [at(it.s.hole.x, 0, it.s.hole.z), 1];
        case 'hare': return [() => tmpH.copy(it.h.pos), 0.6];
        case 'bear': return [() => tmpH.copy(it.b.pos), 1.5];
        case 'pet': case 'feed': return [() => tmpH.copy(siku.pos), 0.75];
        case 'snow': return [() => tmpH.set(P.pos.x + Math.sin(P.yaw) * 0.9, P.pos.y, P.pos.z + Math.cos(P.yaw) * 0.9), 0.55];
    }
    return null;
}

function updateHighlight(dt) {
    const want = hl.get && !S.paused && S.started && !S.over ? 1 : 0;
    hl.op += (want - hl.op) * Math.min(1, dt * 8);
    if (hl.get) {
        hl.get();
        // Læg ringen oven på det højeste punkt under den, så den ikke forsvinder i skråninger
        const rr = hl.r * 0.9;
        tmpH.y = Math.max(0, W.groundHeight(tmpH.x, tmpH.z), W.groundHeight(tmpH.x + rr, tmpH.z), W.groundHeight(tmpH.x - rr, tmpH.z),
            W.groundHeight(tmpH.x, tmpH.z + rr), W.groundHeight(tmpH.x, tmpH.z - rr));
        if (hl.op < 0.05) hl.pos.copy(tmpH);
        hl.pos.lerp(tmpH, 1 - Math.exp(-14 * dt));
    }
    const pulse = 1 + Math.sin(S.time * 5) * 0.06;
    hl.m.position.set(hl.pos.x, hl.pos.y + 0.06, hl.pos.z);
    hl.m.scale.setScalar(hl.r * 2.2 * pulse * (0.8 + hl.op * 0.2));
    hl.m.rotation.y = S.time * 0.6;
    hl.m.material.opacity = hl.op * (0.8 + Math.sin(S.time * 5) * 0.15);
    hl.m.visible = hl.op > 0.01;
}

const heaters = []; // bål + lamper
const igloos = [];
const projectiles = [];

// ---------------------------------------------------------------------------
// Hjælpere
// ---------------------------------------------------------------------------
function angleLerp(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return a + d * t;
}

function collide(p, r) {
    for (const c of colliders) {
        if (!c.active) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        const d2 = dx * dx + dz * dz, R = r + c.r;
        if (d2 < R * R && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            p.x = c.x + dx / d * R;
            p.z = c.z + dz / d * R;
        }
    }
}

const dist2 = (a, x, z) => Math.hypot(a.x - x, a.z - z);
const C = (hex) => new THREE.Color(hex);
const COL = {
    ember: C('#ff9a3c'), smoke: C('#6b6f78'), breath: C('#e8f0ff'), snow: C('#f4f8fc'),
    wood: C('#8a6644'), stone: C('#8c9098'), bone: C('#e4dac4'), berry: C('#4b2d6b'), splash: C('#bfe6ff'),
    heart: C('#ff7a9a'), gold: C('#ffd36b'),
};

function burst(pos, color, n, spread = 1.5, up = 2) {
    for (let i = 0; i < n; i++) {
        puffs.emit(pos.x, pos.y + 0.4, pos.z, (Math.random() - 0.5) * spread, Math.random() * up + 0.5, (Math.random() - 0.5) * spread,
            color, 0.14 + Math.random() * 0.1, 0.6 + Math.random() * 0.4, { grav: -6 });
    }
}

// ---------------------------------------------------------------------------
// UI: toast, svævende tekst, emotes
// ---------------------------------------------------------------------------
const toastEl = $('toast');
const toastQ = [];
let toastT = 0;
function toast(msg) {
    if (toastQ[toastQ.length - 1] === msg) return;
    toastQ.push(msg);
}
function updateToast(dt) {
    toastT -= dt;
    if (toastT <= 0 && toastQ.length) {
        toastEl.textContent = toastQ.shift();
        toastEl.classList.remove('show');
        void toastEl.offsetWidth;
        toastEl.classList.add('show');
        toastT = 2.8;
    } else if (toastT <= 0) {
        toastEl.classList.remove('show');
    }
}

const floaters = [];
const vProj = new THREE.Vector3();
function floatText(text, pos, color = '#fff', emote = false, fly = null) {
    const el = document.createElement('div');
    el.className = emote ? 'ft emote' : 'ft';
    el.textContent = text;
    el.style.color = color;
    $('floaters').appendChild(el);
    floaters.push({ el, pos: new THREE.Vector3(pos.x, pos.y + (emote ? 1.3 : 2), pos.z), t: 0, life: emote ? 1.6 : 1.4, fly });
}
function toScreen(p, out) {
    vProj.copy(p).project(camera);
    out.x = (vProj.x * 0.5 + 0.5) * innerWidth;
    out.y = (-vProj.y * 0.5 + 0.5) * innerHeight;
    return out;
}
const scr = { x: 0, y: 0 };
function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.t += dt;
        // Indsamlede ting flyver op i tasken
        if (f.fly && f.t > 0.5) {
            if (!f.from) {
                toScreen(f.pos, scr);
                f.from = { x: scr.x, y: scr.y };
                const chip = document.querySelector(`.chip[data-k="${f.fly}"]`) || $('inv-strip');
                const r = chip.getBoundingClientRect();
                f.to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                f.chip = chip;
            }
            const k = Math.min(1, (f.t - 0.5) / 0.55), e = k * k * (3 - 2 * k);
            const x = f.from.x + (f.to.x - f.from.x) * e, y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(e * Math.PI) * 60;
            f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 - e * 0.45})`;
            f.el.style.opacity = String(1 - Math.max(0, k - 0.85) / 0.15);
            if (k >= 1) {
                if (f.chip.classList.contains('chip')) {
                    f.chip.classList.remove('bump');
                    void f.chip.offsetWidth;
                    f.chip.classList.add('bump');
                }
                f.el.remove();
                floaters.splice(i, 1);
            }
            continue;
        }
        f.pos.y += dt * (f.fly ? 1.8 * Math.max(0, 1 - f.t * 2) : 0.9);
        toScreen(f.pos, scr);
        const pop = f.t < 0.15 ? 0.6 + f.t / 0.15 * 0.6 : Math.max(1, 1.2 - (f.t - 0.15) * 1.5);
        f.el.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -50%) scale(${pop})`;
        f.el.style.opacity = f.fly ? '1' : String(1 - Math.max(0, f.t - f.life * 0.5) / (f.life * 0.5));
        if (f.t > f.life) {
            f.el.remove();
            floaters.splice(i, 1);
        }
    }
}

function gain(key, n, pos) {
    S.inv[key] += n;
    floatText(`+${n} ${ITEMS[key].icon}`, pos || P.pos, '#ffe9a8', false, key);
}

// ---------------------------------------------------------------------------
// Kontekst til hundens AI
// ---------------------------------------------------------------------------
const G = {
    S, player: P, bears, hares, nodes, heaters, sound: null, collide,
    emote: (pos, t) => floatText(t, pos, '#fff', true),
    toast,
    nodeName: (type) => NODE_INFO[type].name,
    killHare: (h) => killHare(h),
    fx: {
        snow: (pos, spread, n, up) => {
            for (let i = 0; i < n; i++) {
                puffs.emit(pos.x + (Math.random() - 0.5) * spread, pos.y + 0.45, pos.z + (Math.random() - 0.5) * spread,
                    (Math.random() - 0.5) * up, Math.random() * up * 0.5, (Math.random() - 0.5) * up,
                    COL.snow, 0.07 + Math.random() * 0.05, 0.5, { grav: -6, alpha: 0.85 });
            }
        },
        kick: (x, y, z, vx, vz) => {
            puffs.emit(x, y, z, vx + (Math.random() - 0.5), 1.5 + Math.random() * 1.5, vz + (Math.random() - 0.5),
                COL.snow, 0.09, 0.55, { grav: -8, alpha: 0.9 });
        },
        print: (x, y, z, yaw, size) => steps.add(x, y, z, yaw, size),
        breath: (x, y, z, yaw, size) => {
            puffs.emit(x, y, z, Math.sin(yaw) * 0.4 + S.wind.x * 0.08, 0.15, Math.cos(yaw) * 0.4 + S.wind.z * 0.08,
                COL.breath, size, 1, { alpha: 0.22 * (0.5 + S.night * 0.7), grow: 2.2, drag: 1.2 });
        },
    },
    dogGift: () => {
        gain('meat', 1, siku.pos);
        gain('hide', 1, siku.pos);
        toast('🐕 Siku kom med en hare til dig!');
        sound.bark();
    },
};
const sound = new Sound();
G.sound = sound;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = new Set();
addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (!S.started) return;
    if (e.code === 'KeyE' || e.code === 'Space') { actionHeld = true; e.preventDefault(); }
    if (e.code === 'KeyC') togglePanel('panel-craft');
    if (e.code === 'KeyI' || e.code === 'Tab') { togglePanel('panel-inv'); e.preventDefault(); }
    if (e.code === 'KeyF') eatBest();
    if (e.code === 'Escape') closePanels();
});
addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyE' || e.code === 'Space') actionHeld = false;
});

const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const joyEl = $('joy'), knobEl = $('joy-knob');
const JOY_R = 55;
function ghostJoy() {
    if (!isTouch || !S.started) return;
    joyEl.className = 'ghost';
    joyEl.style.left = '90px';
    joyEl.style.top = (innerHeight - 110) + 'px';
    knobEl.style.transform = '';
}
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
    sound.init();
    if (joy.id !== null || S.paused) return;
    joy.id = e.pointerId;
    joy.ox = e.clientX;
    joy.oy = e.clientY;
    joy.x = joy.y = 0;
    joyEl.className = 'on';
    joyEl.style.left = e.clientX + 'px';
    joyEl.style.top = e.clientY + 'px';
    knobEl.style.transform = '';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* syntetiske events */ }
});
canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const l = Math.hypot(dx, dy);
    if (l > JOY_R) { dx *= JOY_R / l; dy *= JOY_R / l; }
    joy.x = dx / JOY_R;
    joy.y = -dy / JOY_R;
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
});
const joyEnd = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.id = null;
    joy.x = joy.y = 0;
    ghostJoy();
};
canvas.addEventListener('pointerup', joyEnd);
canvas.addEventListener('pointercancel', joyEnd);
canvas.addEventListener('wheel', (e) => {
    zoomIdx = clamp(zoomIdx + (e.deltaY > 0 ? 1 : -1), 0, ZOOMS.length - 1);
    resize();
}, { passive: true });

const mv = { x: 0, y: 0 };
function moveInput() {
    if (joy.id !== null) {
        const l = Math.hypot(joy.x, joy.y);
        if (l < 0.15) { mv.x = mv.y = 0; } else { mv.x = joy.x; mv.y = joy.y; }
        return mv;
    }
    mv.x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    mv.y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(mv.x, mv.y);
    if (l > 1) { mv.x /= l; mv.y /= l; }
    return mv;
}

let actionHeld = false, actionCD = 0;
function bindButton(id, fn, hold) {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        sound.init();
        el.classList.add('pressed');
        if (hold) actionHeld = true; else fn();
    });
    const up = () => {
        el.classList.remove('pressed');
        if (hold) actionHeld = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
}
bindButton('btn-action', null, true);
bindButton('btn-craft', () => togglePanel('panel-craft'));
bindButton('btn-inv', () => togglePanel('panel-inv'));
bindButton('btn-eat', () => eatBest());
bindButton('btn-zoom', () => { zoomIdx = (zoomIdx + 1) % ZOOMS.length; resize(); });
bindButton('btn-fx', () => {
    post.enabled = !post.enabled;
    $('btn-fx').classList.toggle('off', !post.enabled);
    toast(post.enabled ? '🎞️ Retro-filter til' : '🎞️ Retro-filter fra');
    resize();
});
bindButton('btn-sound', () => {
    sound.setMuted(!sound.muted);
    $('btn-sound').classList.toggle('muted', sound.muted);
});
document.querySelectorAll('.panel .close').forEach((b) => b.addEventListener('click', closePanels));

// ---------------------------------------------------------------------------
// Paneler
// ---------------------------------------------------------------------------
function anyPanelOpen() {
    return ['panel-craft', 'panel-inv', 'panel-journal'].some((id) => !$(id).classList.contains('hidden'));
}
function closePanels() {
    ['panel-craft', 'panel-inv'].forEach((id) => $(id).classList.add('hidden'));
    if (!anyPanelOpen()) $('backdrop').classList.add('hidden');
    if (!anyPanelOpen() && !S.over) S.paused = false;
}
function togglePanel(id) {
    if (S.over || !S.started) return;
    const el = $(id);
    const open = el.classList.contains('hidden');
    closePanels();
    if (open) {
        el.classList.remove('hidden');
        $('backdrop').classList.remove('hidden');
        S.paused = true;
        actionHeld = false;
        if (id === 'panel-craft') renderCraft();
        if (id === 'panel-inv') renderInv();
    }
}

function canAfford(r) {
    return Object.entries(r.cost).every(([k, v]) => S.inv[k] >= v);
}
function renderCraft() {
    const box = $('recipes');
    box.innerHTML = '';
    for (const r of RECIPES) {
        const done = r.once && S.has[r.id];
        const row = document.createElement('div');
        row.className = 'recipe' + (done ? ' done' : canAfford(r) ? ' ready' : '');
        const cost = Object.entries(r.cost).map(([k, v]) =>
            `<span class="${S.inv[k] >= v ? '' : 'miss'}">${ITEMS[k].icon} ${S.inv[k]}/${v}</span>`).join(' · ');
        row.innerHTML = `<div class="ic">${r.icon}</div><div class="txt"><div class="nm">${r.name}</div>` +
            `<div class="ds">${r.desc}</div><div class="cost">${cost}</div></div>`;
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = done ? '✓ Har' : 'Lav';
        b.disabled = done || !canAfford(r);
        b.addEventListener('click', () => { craft(r); renderCraft(); });
        row.appendChild(b);
        box.appendChild(row);
    }
}
function renderInv() {
    const box = $('inv-list');
    box.innerHTML = '';
    for (const [k, it] of Object.entries(ITEMS)) {
        const row = document.createElement('div');
        row.className = 'invrow';
        row.innerHTML = `<div class="ic">${it.icon}</div><div class="nm">${it.name}</div><b>${S.inv[k]}</b>`;
        if (it.food) {
            const b = document.createElement('button');
            b.className = 'btn';
            b.textContent = 'Spis';
            b.disabled = S.inv[k] <= 0;
            b.addEventListener('click', () => { eat(k); renderInv(); });
            row.appendChild(b);
        }
        if (k === 'meat' || k === 'cooked') {
            const b = document.createElement('button');
            b.className = 'btn';
            b.textContent = 'Giv Siku';
            b.disabled = S.inv[k] <= 0;
            b.addEventListener('click', () => { S.inv[k]--; siku.feed(G); renderInv(); });
            row.appendChild(b);
        }
        box.appendChild(row);
    }
    const g = [];
    if (S.has.harpoon) g.push('🔱 Harpun');
    if (S.has.knife) g.push('🔪 Snekniv');
    if (S.has.kamik) g.push('🥾 Kamikker');
    if (S.has.anorak) g.push('🧥 Skindanorak');
    if (S.has.sled) g.push('🛷 Hundeslæde');
    const gear = document.createElement('div');
    gear.className = 'gear';
    gear.innerHTML = `<b>Udstyr:</b> ${g.length ? g.join(' · ') : 'intet endnu'}<br>` +
        `<b>Siku:</b> ${siku.mood} · mæthed ${Math.round(siku.hunger)}% · tillid ${Math.round(siku.love)}%`;
    box.appendChild(gear);
}

function eat(k) {
    const it = ITEMS[k];
    if (!it.food || S.inv[k] <= 0) return;
    S.inv[k]--;
    S.food = Math.min(100, S.food + it.food);
    if (it.warm) S.warmth = Math.min(100, S.warmth + it.warm);
    sound.eat();
    anim.play('eat');
    floatText(`${it.icon} +${it.food}`, P.pos, '#c6e38a');
}
function eatBest() {
    if (!S.started || S.over) return;
    const k = EAT_ORDER.find((x) => S.inv[x] > 0);
    if (!k) { toast('Du har intet at spise.'); return; }
    if (S.food > 92) { toast('Du er mæt.'); return; }
    eat(k);
}

// ---------------------------------------------------------------------------
// Byg / sy
// ---------------------------------------------------------------------------
function frontSpot(d) {
    return new THREE.Vector3(P.pos.x + Math.sin(P.yaw) * d, 0, P.pos.z + Math.cos(P.yaw) * d);
}

function placeHeater(kind, x, z) {
    const obj = kind === 'fire' ? W.makeFire() : W.makeQulliq();
    const y = Math.max(0, W.groundHeight(x, z));
    obj.group.position.set(x, y, z);
    scene.add(obj.group);
    popIn(obj.group);
    const collider = { x, z, r: kind === 'fire' ? 0.55 : 0.35, active: true };
    colliders.push(collider);
    heaters.push({ kind, x, z, y, obj, lit: true, fuel: kind === 'fire' ? 150 : 420, collider });
}

function craft(r) {
    if (!canAfford(r) || (r.once && S.has[r.id])) return;
    for (const [k, v] of Object.entries(r.cost)) S.inv[k] -= v;
    sound.craft();
    anim.play('craft');
    if (r.id === 'fire') {
        const s = frontSpot(1.7);
        placeHeater('fire', s.x, s.z);
        S.builtFire = true;
        toast('🔥 Bålet knitrer. Bliv tæt på det for at holde varmen.');
    } else if (r.id === 'lamp') {
        const s = frontSpot(1.3);
        placeHeater('lamp', s.x, s.z);
        toast('🪔 Qulleq-lampen brænder roligt på spæk.');
    } else if (r.id === 'igloo') {
        const s = frontSpot(3.6);
        const obj = W.makeIgloo();
        const y = Math.max(0, W.groundHeight(s.x, s.z)) - 0.05;
        obj.group.position.set(s.x, y, s.z);
        obj.group.rotation.y = P.yaw + Math.PI;
        W.contactShadow(obj.group, 5.6, 5.6, 0.35);
        scene.add(obj.group);
        popIn(obj.group, 0.8);
        burst(new THREE.Vector3(s.x, y, s.z), COL.snow, 30, 5, 3);
        igloos.push({ x: s.x, z: s.z, obj });
        S.igloos++;
        toast('⛺ Igloen står klar. Gå ind i den for at søge ly.');
    } else {
        S.has[r.id] = true;
        applyGear();
        const msg = {
            knife: '🔪 Med sneknivene kan du skære sneblokke.',
            harpoon: '🔱 Harpunen er klar. Find sæler ved åndehullerne på havisen.',
            kamik: '🥾 Varme kamikker på fødderne.',
            anorak: '🧥 Den nye skindanorak holder kulden ude.',
            sled: '🛷 Hundeslæden er klar! Siku fører spandet.',
        };
        toast(msg[r.id]);
    }
    floatText(r.icon, P.pos, '#fff', true);
}

function applyGear() {
    player.harpoon.visible = S.has.harpoon;
    if (S.has.kamik) player.mats.boots.color.set('#efe6d4');
    if (S.has.anorak) {
        player.mats.coat.color.set('#a0764c');
        player.mats.pants.color.set('#e9e2d2');
    }
    if (S.has.sled && !sled.visible) {
        sled.visible = true;
        popIn(sled);
        for (const fur of ['#3d3a38', '#c9c3b8']) {
            const d = new Dog(scene, P.pos.x + 2, P.pos.z + 2, fur, 'hund');
            d.setState('harness');
            teamDogs.push(d);
        }
        traces.visible = true;
    }
}

// ---------------------------------------------------------------------------
// Handling
// ---------------------------------------------------------------------------
function getInteraction() {
    const p = P.pos;
    let best = null, bestD = 1e9;
    const consider = (d, o) => { if (d < bestD) { bestD = d; best = o; } };
    if (S.has.harpoon) {
        for (const b of bears) { const d = dist2(b.pos, p.x, p.z); if (d < 7) consider(d - 4, { kind: 'bear', b, label: 'Skræm isbjørnen', icon: '🔱' }); }
        for (const s of seals) { if (s.state === 'up') { const d = dist2(s.hole, p.x, p.z); if (d < 6.5) consider(d, { kind: 'seal', s, label: 'Harpunér sælen', icon: '🔱' }); } }
        for (const h of hares) { if (h.alive) { const d = dist2(h.pos, p.x, p.z); if (d < 7) consider(d, { kind: 'hare', h, label: 'Harpunér haren', icon: '🔱' }); } }
        if (best) return best;
    }
    for (const n of nodes) {
        if (n.charges <= 0) continue;
        const d = dist2(n, p.x, p.z) - n.r;
        if (d < 1.4) consider(d, { kind: 'node', n, label: NODE_INFO[n.type].label, icon: NODE_INFO[n.type].icon });
    }
    for (const h of heaters) {
        const d = dist2(h, p.x, p.z);
        if (d > 2.4) continue;
        if (h.kind === 'fire') {
            if (!h.lit && S.inv.wood > 0) consider(d, { kind: 'relight', h, label: 'Tænd bålet (1 🪵)', icon: '🔥' });
            else if (h.lit && S.inv.meat > 0) consider(d, { kind: 'cook', h, label: 'Kog kød', icon: '🍖' });
            else if (h.lit && S.inv.wood > 0 && h.fuel < 200) consider(d + 0.5, { kind: 'fuel', h, label: 'Læg brænde på', icon: '🔥' });
        } else if (S.inv.blubber > 0 && h.fuel < 300) {
            consider(d, { kind: 'refill', h, label: 'Fyld spæk i lampen', icon: '🧈' });
        }
    }
    for (const c of cairns) {
        if (c.found) continue;
        const d = dist2(c, p.x, p.z);
        if (d < 3) consider(d - 1, { kind: 'cairn', c, label: 'Undersøg varden', icon: '📜' });
    }
    if (best) return best;
    const dd = dist2(siku.pos, p.x, p.z);
    if (dd < 2 && siku.hunger < 60 && (S.inv.meat > 0 || S.inv.cooked > 0)) return { kind: 'feed', label: 'Giv Siku kød', icon: '🦴' };
    if (dd < 1.8 && siku.state !== 'harness') return { kind: 'pet', label: 'Klap Siku', icon: '🐕' };
    if (!P.onIce && S.has.knife) return { kind: 'snow', label: 'Skær sneblok', icon: '🧊' };
    if (!S.has.harpoon) {
        const animal = seals.some((s) => s.state === 'up' && dist2(s.hole, p.x, p.z) < 7) ||
            hares.some((h) => h.alive && dist2(h.pos, p.x, p.z) < 6);
        if (animal) return { kind: 'none', label: 'Kræver harpun', icon: '🔱', disabled: true };
    }
    return { kind: 'none', label: '—', icon: '✋', disabled: true };
}

function throwSpear(target, onHit) {
    const g = W.makeSpear();
    const from = P.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
    const to = target.clone().add(new THREE.Vector3(0, 0.3, 0));
    g.position.copy(from);
    g.lookAt(to);
    scene.add(g);
    g.visible = false;
    projectiles.push({ g, from, to, t: -0.8, onHit });
    P.yaw = Math.atan2(to.x - from.x, to.z - from.z);
    anim.play('throw');
    setTimeout(() => sound.whoosh(), 200);
}

function killHare(h) {
    h.alive = false;
    h.m.visible = false;
    h.respawn = 50 + Math.random() * 30;
    burst(h.pos, COL.snow, 8);
}

function doAction(it) {
    if (it.disabled) return;
    actionCD = 0.4;
    const ANIM = { cook: 'tend', fuel: 'tend', relight: 'tend', refill: 'tend', cairn: 'read', snow: 'cut', pet: 'pet', feed: 'pet' };
    if (ANIM[it.kind]) anim.play(ANIM[it.kind]);
    if (it.kind === 'pet' || it.kind === 'feed') P.yaw = Math.atan2(siku.pos.x - P.pos.x, siku.pos.z - P.pos.z);
    switch (it.kind) {
        case 'node': {
            const n = it.n;
            P.yaw = Math.atan2(n.x - P.pos.x, n.z - P.pos.z);
            n.charges--;
            n.shake = 0.35;
            anim.play(n.type === 'stone' ? 'chop' : 'gather');
            actionCD = n.type === 'stone' ? 0.6 : 0.7;
            const pos = new THREE.Vector3(n.x, n.y, n.z);
            if (n.type === 'wood') { gain('wood', 2, pos); burst(pos, COL.wood, 6); }
            if (n.type === 'stone') { gain('stone', 1, pos); burst(pos, COL.stone, 8); }
            if (n.type === 'bone') { gain('bone', 1, pos); burst(pos, COL.bone, 6); }
            if (n.type === 'berries') { gain('berries', 2, pos); burst(pos, COL.berry, 5); }
            sound.chop();
            if (n.charges <= 0) {
                n.dying = true;
                if (n.collider) n.collider.active = false;
                n.respawn = 110 + Math.random() * 60;
            }
            break;
        }
        case 'cook':
            S.inv.meat--;
            S.inv.cooked++;
            sound.crackle();
            floatText('🍖', P.pos, '#fff', true);
            break;
        case 'fuel':
            S.inv.wood--;
            it.h.fuel = Math.min(260, it.h.fuel + 70);
            burst(new THREE.Vector3(it.h.x, it.h.y, it.h.z), COL.ember, 8);
            break;
        case 'relight':
            S.inv.wood--;
            it.h.lit = true;
            it.h.fuel = 90;
            it.h.obj.flames.visible = true;
            break;
        case 'refill':
            S.inv.blubber--;
            it.h.lit = true;
            it.h.fuel = Math.min(500, it.h.fuel + 220);
            it.h.obj.flames.visible = true;
            break;
        case 'cairn': openJournal(it.c); break;
        case 'snow':
            actionCD = 0.6;
            gain('snow', 2);
            burst(P.pos, COL.snow, 10);
            sound.chop();
            break;
        case 'pet':
            siku.pet(G);
            S.warmth = Math.min(100, S.warmth + 2);
            break;
        case 'feed':
            if (S.inv.meat > 0) S.inv.meat--; else S.inv.cooked--;
            siku.feed(G);
            break;
        case 'seal': {
            const s = it.s;
            actionCD = 0.8;
            throwSpear(new THREE.Vector3(s.hole.x, 0, s.hole.z), () => {
                if (s.state === 'up' && Math.random() < 0.85) {
                    s.state = 'gone';
                    s.timer = 45;
                    const pos = new THREE.Vector3(s.hole.x, 0, s.hole.z);
                    gain('meat', 2, pos);
                    setTimeout(() => gain('blubber', 2, pos), 250);
                    setTimeout(() => gain('hide', 1, pos), 500);
                    toast('Fangst! En sæl – kød, spæk og skind.');
                } else {
                    s.state = 'down';
                    s.timer = 8 + Math.random() * 8;
                    toast('Sælen dykkede i sidste øjeblik.');
                }
                splash(s.hole);
            });
            break;
        }
        case 'hare': {
            const h = it.h;
            actionCD = 0.8;
            throwSpear(h.pos.clone(), () => {
                if (h.alive && Math.random() < 0.75 && dist2(h.pos, P.pos.x, P.pos.z) < 8.5) {
                    killHare(h);
                    gain('meat', 1, h.pos);
                    setTimeout(() => gain('hide', 1, h.pos), 250);
                } else {
                    h.scare = 2;
                    h.scareFrom = P.pos;
                    toast('Haren slap væk.');
                }
            });
            break;
        }
        case 'bear': {
            const b = it.b;
            actionCD = 1;
            throwSpear(b.pos.clone(), () => {
                b.flee = 20;
                sound.growl();
                toast('Nanoq brøler og trækker sig tilbage.');
            });
            break;
        }
    }
}

function splash(h) {
    sound.splash();
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * TAU;
        puffs.emit(h.x, 0.1, h.z, Math.cos(a) * 1.5, 2 + Math.random() * 2, Math.sin(a) * 1.5, COL.splash, 0.12, 0.7, { grav: -9 });
    }
}

// ---------------------------------------------------------------------------
// Varde / dagbog / afslutning
// ---------------------------------------------------------------------------
function openJournal(c) {
    c.found = true;
    c.ring.visible = false;
    c.beam.visible = false;
    c.glow.visible = false;
    const idx = S.cairnsFound;
    S.cairnsFound++;
    sound.chime();
    $('j-title').textContent = `📜 Varde ${S.cairnsFound} af ${cairns.length}`;
    $('j-text').textContent = '“' + JOURNAL[idx % JOURNAL.length] + '”';
    closePanels();
    $('panel-journal').classList.remove('hidden');
    S.paused = true;
    actionHeld = false;
}
$('j-ok').addEventListener('click', () => {
    $('panel-journal').classList.add('hidden');
    S.paused = false;
    if (S.cairnsFound >= cairns.length && !S.won) {
        S.won = true;
        showEnd(true);
    }
});

function showEnd(win) {
    S.paused = true;
    const el = $('end-content');
    if (win) {
        el.innerHTML = `<h1>Ruten er fundet</h1><div class="sub">Alle varder er besøgt</div>` +
            `<p class="intro">Du og Siku har fulgt ekspeditionens spor over isen og overlevet ${S.day} døgn. ` +
            `Et sted mod vest venter Alaska.</p>` +
            `<button class="primary" id="end-go">Bliv på isen</button> <button class="primary" id="end-new">Ny rejse</button>`;
    } else {
        S.over = true;
        const why = { cold: 'Kulden tog dig.', food: 'Sulten tog dig.', bear: 'Nanoq var for stærk.' }[S.lastDamage];
        el.innerHTML = `<h1>Rejsen endte</h1><div class="sub">${why}</div>` +
            `<p class="intro">Du overlevede ${S.day} døgn og fandt ${S.cairnsFound} af ${cairns.length} varder.</p>` +
            `<button class="primary" id="end-new">Prøv igen</button>`;
    }
    $('screen-end').classList.remove('hidden');
    $('end-new').addEventListener('click', () => location.reload());
    const go = $('end-go');
    if (go) go.addEventListener('click', () => { $('screen-end').classList.add('hidden'); S.paused = false; });
}

function hurt(dmg, why) {
    S.health = Math.max(0, S.health - dmg);
    S.lastDamage = why;
    sound.hurt();
    anim.play('hurt');
    const o = $('ov-hurt');
    o.style.opacity = 1;
    setTimeout(() => { o.style.opacity = 0; }, 180);
    shake = 0.6;
}

// ---------------------------------------------------------------------------
// Opdateringer
// ---------------------------------------------------------------------------
const camRight = new THREE.Vector3(1, 0, -1).normalize();
const camUp = new THREE.Vector3(-1, 0, -1).normalize();
const wish = new THREE.Vector3();
let breathT = 1;

function updatePlayer(dt) {
    const m = moveInput();
    wish.set(0, 0, 0).addScaledVector(camRight, m.x).addScaledVector(camUp, m.y);
    const input = wish.length();
    const gh = W.groundHeight(P.pos.x, P.pos.z);
    P.onIce = gh < 0.05;
    let spd = 4.3 * (S.has.kamik ? 1.1 : 1) * (S.has.sled ? 1.75 : 1);
    if (S.health < 25) spd *= 0.8;
    if (input > 0.01) {
        const head = -wish.dot(S.wind) / (S.wind.length() + 1e-6) / input;
        spd *= 1 - S.storm * 0.35 * Math.max(0, head);
    }
    const accel = P.onIce && !S.has.sled ? 1.7 : 11;
    const k = 1 - Math.exp(-accel * dt);
    P.vel.x += (wish.x * spd - P.vel.x) * k;
    P.vel.z += (wish.z * spd - P.vel.z) * k;
    P.pos.x += (P.vel.x + S.wind.x * S.storm * 0.06) * dt;
    P.pos.z += (P.vel.z + S.wind.z * S.storm * 0.06) * dt;
    collide(P.pos, 0.42);
    const r = Math.hypot(P.pos.x, P.pos.z);
    if (r > W.WORLD_RADIUS) {
        P.pos.x *= W.WORLD_RADIUS / r;
        P.pos.z *= W.WORLD_RADIUS / r;
        if (!S.edgeWarn) { toast('Den åbne havisen er for tynd herude.'); S.edgeWarn = true; }
    }
    P.pos.y = Math.max(0, W.groundHeight(P.pos.x, P.pos.z));
    P.speed = Math.hypot(P.vel.x, P.vel.z);
    P.idle = input > 0.1 ? 0 : P.idle + dt;
    if (input > 0.1) P.yaw = angleLerp(P.yaw, Math.atan2(wish.x, wish.z), 1 - Math.exp(-12 * dt));
    player.group.rotation.y = P.yaw;

    // Vend dig mod bålet, når du står stille ved det
    let fireAmt = 0, fireH = null;
    for (const h of heaters) {
        if (!h.lit) continue;
        const d = dist2(h, P.pos.x, P.pos.z);
        if (d < 4.2) { fireAmt = Math.max(fireAmt, 1 - Math.max(0, d - 2) / 2.2); fireH = h; }
    }
    if (fireH && input < 0.1 && P.idle > 0.6 && !anim.action) {
        P.yaw = angleLerp(P.yaw, Math.atan2(fireH.x - P.pos.x, fireH.z - P.pos.z), 1 - Math.exp(-3 * dt));
    }
    const yawVel = angleLerp(0, P.yaw - (P.lastYaw ?? P.yaw), 1) / Math.max(dt, 1e-4);
    P.lastYaw = P.yaw;
    player.group.rotation.y = P.yaw;

    // Animation
    const slideTarget = P.onIce && !S.has.sled && P.speed > 1.3 && (input < 0.1 || wish.dot(P.vel) / (input * P.speed) < 0.6) ? 1 : 0;
    P.slide = (P.slide || 0) + (slideTarget - (P.slide || 0)) * Math.min(1, dt * 6);
    const wl = S.wind.length() + 1e-6;
    anim.update(dt, {
        speed: S.has.sled ? P.speed : P.speed * (1 - P.slide * 0.8),
        onIce: P.onIce,
        sled: S.has.sled,
        idle: P.idle,
        cold: clamp((40 - S.warmth) / 30, 0, 1),
        fire: input < 0.1 ? fireAmt : 0,
        storm: S.sheltered ? 0 : S.storm,
        windSide: (S.wind.x * Math.cos(P.yaw) - S.wind.z * Math.sin(P.yaw)) / wl,
        sliding: P.slide,
        turn: clamp(-yawVel * 0.15, -1, 1),
        dead: S.over,
    });

    pBlob.position.set(P.pos.x, P.pos.y + 0.03, P.pos.z);
    pBlob.material.opacity = P.onIce ? 0.4 : 0.22;

    // Fodspor i takt med skridtene + sne der sparkes op
    const perpX = Math.cos(P.yaw), perpZ = -Math.sin(P.yaw);
    const stepIdx = Math.floor(anim.phase / Math.PI);
    if (!S.has.sled && stepIdx !== P.lastStep && P.speed > 0.6 && P.slide < 0.5) {
        P.lastStep = stepIdx;
        P.side = stepIdx % 2 ? 1 : -1;
        const fx = P.pos.x + perpX * 0.13 * P.side + Math.sin(P.yaw) * 0.25;
        const fz = P.pos.z + perpZ * 0.13 * P.side + Math.cos(P.yaw) * 0.25;
        if (!P.onIce) {
            steps.add(fx, P.pos.y, fz, P.yaw);
            sound.step();
            for (let i = 0; i < 3; i++) {
                puffs.emit(fx, P.pos.y + 0.08, fz, (Math.random() - 0.5) * 0.8 - Math.sin(P.yaw) * 0.6, 0.6 + Math.random() * 0.6,
                    (Math.random() - 0.5) * 0.8 - Math.cos(P.yaw) * 0.6, COL.snow, 0.09 + Math.random() * 0.06, 0.45, { grav: -5, alpha: 0.8 });
            }
        } else if (Math.random() < 0.4) {
            sound.iceStep();
        }
    }
    if (S.has.sled && P.speed > 0.8) {
        P.dist += P.speed * dt;
        if (P.dist > 0.45 && !P.onIce) {
            P.dist = 0;
            for (const s of [-1, 1]) steps.add(P.pos.x + perpX * 0.38 * s, P.pos.y, P.pos.z + perpZ * 0.38 * s, P.yaw, 0.6);
        }
        if (!P.onIce && P.speed > 3) {
            for (const s of [-1, 1]) {
                if (Math.random() > dt * 30) continue;
                puffs.emit(P.pos.x + perpX * 0.4 * s, P.pos.y + 0.1, P.pos.z + perpZ * 0.4 * s,
                    -P.vel.x * 0.25 + perpX * s * 0.8, 0.8 + Math.random(), -P.vel.z * 0.25 + perpZ * s * 0.8,
                    COL.snow, 0.14, 0.6, { grav: -4, alpha: 0.7, grow: 1.5 });
            }
        }
    }

    // Ånde i kulden
    breathT -= dt;
    if (breathT <= 0) {
        breathT = 1.3 + Math.random() * 0.8;
        const f = 0.35;
        for (let i = 0; i < 3; i++) {
            puffs.emit(P.pos.x + Math.sin(P.yaw) * f, P.pos.y + 1.5 + (S.has.sled ? 0.12 : 0), P.pos.z + Math.cos(P.yaw) * f,
                Math.sin(P.yaw) * 0.5 + S.wind.x * 0.08 + (Math.random() - 0.5) * 0.2, 0.25,
                Math.cos(P.yaw) * 0.5 + S.wind.z * 0.08 + (Math.random() - 0.5) * 0.2,
                COL.breath, 0.2, 1.3, { alpha: 0.28 * (0.5 + S.night * 0.7), grow: 2.5, drag: 1.2 });
        }
    }
}

function handleAction(dt) {
    actionCD -= dt;
    if (actionHeld && actionCD <= 0) doAction(getInteraction());
}

const tmpV = new THREE.Vector3();
function updateTeam(dt) {
    const G2 = G;
    siku.update(dt, G2);
    if (!teamDogs.length) return;
    const fwdX = Math.sin(P.yaw), fwdZ = Math.cos(P.yaw), rX = Math.cos(P.yaw), rZ = -Math.sin(P.yaw);
    const arr = traces.geometry.attributes.position.array;
    const frontX = P.pos.x + fwdX * 2.05, frontZ = P.pos.z + fwdZ * 2.05, fy = P.pos.y + 0.25;
    teamDogs.forEach((d, i) => {
        const s = i === 0 ? -0.6 : 0.6;
        tmpV.set(P.pos.x + fwdX * 2.95 + rX * s, 0, P.pos.z + fwdZ * 2.95 + rZ * s);
        const k = Math.min(1, dt * 8);
        const before = d.pos.clone();
        d.pos.x += (tmpV.x - d.pos.x) * k;
        d.pos.z += (tmpV.z - d.pos.z) * k;
        d.pos.y = Math.max(0, W.groundHeight(d.pos.x, d.pos.z));
        const sp = before.distanceTo(d.pos) / Math.max(dt, 1e-4);
        d.yaw = angleLerp(d.yaw, P.yaw, k);
        d.animate(dt, sp, G, { sit: P.speed < 0.5 ? 1 : 0, pant: sp > 3 });
        d.root.position.copy(d.pos);
        d.root.rotation.y = d.yaw;
        d.blob.position.set(d.pos.x, d.pos.y + 0.03, d.pos.z);
        d.blob.material.opacity = d.pos.y < 0.05 ? 0.36 : 0.2;
        arr.set([frontX, fy, frontZ, d.pos.x, d.pos.y + 0.4, d.pos.z], i * 6);
    });
    const lead = siku.state === 'harness';
    arr.set([frontX, fy, frontZ, lead ? siku.pos.x : frontX, lead ? siku.pos.y + 0.4 : fy, lead ? siku.pos.z : frontZ], 12);
    traces.geometry.attributes.position.needsUpdate = true;
}

function updateHares(dt) {
    for (const h of hares) {
        if (!h.alive) {
            h.respawn -= dt;
            if (h.respawn <= 0) {
                const s = world.spot(world.isLand, 0, 0, 0, 90, 1, false);
                if (s && dist2(P.pos, s.x, s.z) > 25) {
                    h.pos.set(s.x, s.h, s.z);
                    h.home.set(s.x, 0, s.z);
                    h.target.copy(h.home);
                    h.alive = true;
                    h.m.visible = true;
                }
            }
            continue;
        }
        const dp = dist2(P.pos, h.pos.x, h.pos.z);
        h.scare -= dt;
        let spd = 0;
        if (dp < 5.5 && !(h.scare > 0)) { h.scare = 1.6; h.scareFrom = P.pos; }
        if (h.scare > 0 && h.scareFrom) {
            const dx = h.pos.x - h.scareFrom.x, dz = h.pos.z - h.scareFrom.z;
            const d = Math.hypot(dx, dz) || 1;
            h.target.set(h.pos.x + dx / d * 6, 0, h.pos.z + dz / d * 6);
            spd = 6.4;
        } else {
            h.wait -= dt;
            if (h.wait <= 0 && dist2(h.target, h.pos.x, h.pos.z) < 0.3) {
                const a = Math.random() * TAU, r = Math.random() * 6;
                h.target.set(h.home.x + Math.cos(a) * r, 0, h.home.z + Math.sin(a) * r);
                h.wait = 1 + Math.random() * 4;
            }
            if (h.wait <= 0) spd = 1.4;
        }
        if (W.groundHeight(h.target.x, h.target.z) < 0.2) h.target.lerp(h.home, 0.5);
        const dx = h.target.x - h.pos.x, dz = h.target.z - h.pos.z;
        const d = Math.hypot(dx, dz);
        if (spd > 0 && d > 0.05) {
            const s = Math.min(spd * dt, d);
            h.pos.x += dx / d * s;
            h.pos.z += dz / d * s;
            h.yaw = angleLerp(h.yaw, Math.atan2(dx, dz), Math.min(1, dt * 10));
            h.hop += dt * spd * 3;
        } else {
            h.hop = 0;
        }
        collide(h.pos, 0.2);
        h.pos.y = Math.max(0, W.groundHeight(h.pos.x, h.pos.z));
        // Sætter sig op og lytter, når du nærmer dig; squash-and-stretch i hoppet
        const alert = dp < 11 && spd === 0 ? 1 : 0;
        h.alertK += (alert - h.alertK) * Math.min(1, dt * 6);
        const hs = Math.sin(h.hop);
        h.m.position.set(h.pos.x, h.pos.y + Math.abs(hs) * 0.28, h.pos.z);
        h.m.rotation.y = h.alertK > 0.5 && spd === 0 ? angleLerp(h.yaw, Math.atan2(P.pos.x - h.pos.x, P.pos.z - h.pos.z), 0.6) : h.yaw;
        h.inner.rotation.x = -0.55 * h.alertK + (spd > 0 ? Math.cos(h.hop) * 0.25 : 0);
        h.inner.position.y = 0.06 * h.alertK;
        h.inner.scale.set(1, 1 + (spd > 0 ? hs * hs * 0.18 - 0.06 : 0), 1);
        h.ears.forEach((e, i) => {
            e.rotation.x = -0.4 + h.alertK * 0.35 - (spd > 0 ? 0.5 : 0);
            e.rotation.z = (i ? -1 : 1) * 0.12 + Math.sin(S.time * 11 + i * 2) * 0.06 * h.alertK;
        });
    }
}

function updateSeals(dt) {
    for (const s of seals) {
        s.timer -= dt;
        if (s.state === 'down' && s.timer <= 0) {
            s.state = 'up';
            s.timer = 7 + Math.random() * 3;
            if (dist2(P.pos, s.hole.x, s.hole.z) < 30) splash(s.hole);
            ripple(s.hole.x, s.hole.z);
            ripple(s.hole.x, s.hole.z, 0.35);
        } else if (s.state === 'up' && s.timer <= 0) {
            s.state = 'down';
            s.timer = 8 + Math.random() * 10;
            ripple(s.hole.x, s.hole.z);
        } else if (s.state === 'gone' && s.timer <= 0) {
            s.state = 'down';
            s.timer = 5;
        }
        const ty = s.state === 'up' ? -0.05 : -1.3;
        s.y += (ty - s.y) * Math.min(1, dt * 3);
        s.m.position.set(s.hole.x, s.y + Math.sin(S.time * 2 + s.hole.x) * 0.03, s.hole.z);
        s.m.rotation.y = Math.atan2(P.pos.x - s.hole.x, P.pos.z - s.hole.z) * 0.6 + Math.sin(S.time * 0.7) * 0.4;
        s.m.visible = s.y > -1.2;
        if (s.state === 'up' && Math.random() < dt * 0.6) ripple(s.hole.x, s.hole.z);
    }
}

function updateBears(dt) {
    for (const b of bears) {
        b.flee = Math.max(0, b.flee - dt);
        b.atk -= dt;
        b.alertT -= dt;
        const d = dist2(P.pos, b.pos.x, b.pos.z);
        let fire = null;
        for (const h of heaters) if (h.lit && h.kind === 'fire' && dist2(h, b.pos.x, b.pos.z) < 8) fire = h;
        const safe = S.sheltered || heaters.some((h) => h.lit && h.kind === 'fire' && dist2(h, P.pos.x, P.pos.z) < 6);
        let mode = 'wander';
        if (b.flee > 0 || fire) mode = 'flee';
        else if (!safe && !S.over && d < (S.night > 0.5 ? 16 : 9)) mode = 'chase';
        if (mode === 'chase' && b.mode !== 'chase' && b.alertT <= 0) {
            b.alertT = 25;
            b.standT = 1.6;
            sound.growl();
            if (d < 20) shake = Math.max(shake, 0.25);
            toast('⚠️ Nanoq – en isbjørn har fået færten af dig!');
        }
        b.mode = mode;
        let spd;
        if (mode === 'chase') {
            b.target.set(P.pos.x, 0, P.pos.z);
            spd = 3.6;
        } else if (mode === 'flee') {
            const src = fire || P.pos;
            const dx = b.pos.x - src.x, dz = b.pos.z - src.z;
            const l = Math.hypot(dx, dz) || 1;
            b.target.set(b.pos.x + dx / l * 8, 0, b.pos.z + dz / l * 8);
            spd = 5;
        } else {
            b.wait -= dt;
            if (dist2(b.target, b.pos.x, b.pos.z) < 1 && b.wait <= 0) {
                const a = Math.random() * TAU, r = Math.random() * 22;
                b.target.set(b.home.x + Math.cos(a) * r, 0, b.home.z + Math.sin(a) * r);
                b.wait = 3 + Math.random() * 6;
            }
            spd = b.wait > 0 ? 0 : 1.3;
        }
        b.standT = Math.max(0, b.standT - dt);
        if (b.standT > 0) spd = 0;
        const dx = b.target.x - b.pos.x, dz = b.target.z - b.pos.z;
        const l = Math.hypot(dx, dz);
        let moved = 0;
        if (spd > 0 && l > 0.1) {
            const s = Math.min(spd * dt, l);
            b.pos.x += dx / l * s;
            b.pos.z += dz / l * s;
            b.yaw = angleLerp(b.yaw, Math.atan2(dx, dz), Math.min(1, dt * 5));
            moved = s / dt;
        }
        collide(b.pos, 0.9);
        const r = Math.hypot(b.pos.x, b.pos.z);
        if (r > W.WORLD_RADIUS) b.pos.multiplyScalar(W.WORLD_RADIUS / r);
        b.pos.y = Math.max(0, W.groundHeight(b.pos.x, b.pos.z));
        // Tung, rullende gang; rejser sig og brøler ved alarm
        b.phase += dt * moved * 1.7;
        b.walk += (Math.min(1, moved / 2) - b.walk) * Math.min(1, dt * 5);
        const st = b.standT > 0 ? Math.sin(Math.min(1, (1.6 - b.standT) / 1.6) * Math.PI) : 0;
        const bs = Math.sin(b.phase), bw = b.walk;
        b.legs[0].rotation.x = bs * 0.5 * bw - 0.7 * st + Math.sin(S.time * 7) * 0.35 * st;
        b.legs[1].rotation.x = -bs * 0.5 * bw - 0.7 * st - Math.sin(S.time * 7) * 0.35 * st;
        b.legs[2].rotation.x = -bs * 0.5 * bw + 1.05 * st;
        b.legs[3].rotation.x = bs * 0.5 * bw + 1.05 * st;
        b.pivot.rotation.x = -1.05 * st;
        b.pivot.rotation.z = Math.sin(b.phase) * 0.06 * bw;
        b.head.rotation.y = (mode === 'wander' && spd === 0 ? Math.sin(S.time * 0.8) * 0.45 : Math.sin(b.phase * 0.5) * 0.18 * bw);
        b.head.rotation.x = 0.2 * bw - 0.5 * st + (mode === 'wander' && spd === 0 ? 0.35 + Math.sin(S.time * 3) * 0.05 : 0);
        if (st > 0.6 && Math.random() < dt * 25) {
            b.head.getWorldPosition(tmpV);
            puffs.emit(tmpV.x, tmpV.y, tmpV.z, Math.sin(b.yaw) * 1.5, 0.6, Math.cos(b.yaw) * 1.5, COL.breath, 0.3, 1, { alpha: 0.35, grow: 3, drag: 1.5 });
        }
        b.group.position.copy(b.pos);
        b.group.position.y += Math.abs(Math.sin(b.phase)) * 0.05 * bw;
        // Store poteaftryk
        b.printD = (b.printD || 0) + moved * dt;
        if (b.printD > 0.9 && b.pos.y > 0.05) {
            b.printD = 0;
            b.printSide = -(b.printSide || 1);
            const px = Math.cos(b.yaw) * 0.3 * b.printSide, pz = -Math.sin(b.yaw) * 0.3 * b.printSide;
            steps.add(b.pos.x + px, b.pos.y, b.pos.z + pz, b.yaw, 1.6);
        }
        b.group.rotation.y = b.yaw;
        b.blob.position.set(b.pos.x, b.pos.y + 0.03, b.pos.z);
        b.blob.material.opacity = b.pos.y < 0.05 ? 0.4 : 0.24;

        if (mode === 'chase' && d < 1.9 && b.atk <= 0) {
            b.atk = 1.4;
            hurt(14, 'bear');
            const kx = (P.pos.x - b.pos.x) / (d || 1), kz = (P.pos.z - b.pos.z) / (d || 1);
            P.vel.x += kx * 7;
            P.vel.z += kz * 7;
            toast('Isbjørnen angriber! Flygt til bålet eller brug harpunen.');
        }
    }
}

function updateHeaters(dt) {
    for (const h of heaters) {
        if (!h.lit) continue;
        h.fuel -= dt;
        const fl = h.obj.flames;
        if (h.fuel <= 0) {
            h.lit = false;
            fl.visible = false;
            if (h.obj.glow) h.obj.glow.visible = false;
            if (dist2(h, P.pos.x, P.pos.z) < 20) toast(h.kind === 'fire' ? 'Bålet er gået ud.' : 'Lampen er brændt ud.');
            continue;
        }
        if (h.obj.glow) h.obj.glow.visible = true;
        const low = h.kind === 'fire' ? clamp(h.fuel / 40, 0.4, 1) : 1;
        const fk = 1 + Math.sin(S.time * 13 + h.x) * 0.12 + Math.sin(S.time * 23 + h.z) * 0.08;
        fl.scale.set(low, fk * low, low);
        const near = dist2(h, P.pos.x, P.pos.z) < 30;
        if (h.kind === 'fire' && near) {
            if (Math.random() < dt * 14) {
                sparks.emit(h.x + (Math.random() - 0.5) * 0.3, h.y + 0.5, h.z + (Math.random() - 0.5) * 0.3,
                    (Math.random() - 0.5) * 0.6 + S.wind.x * 0.1, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6 + S.wind.z * 0.1,
                    COL.ember, 0.1 + Math.random() * 0.06, 1 + Math.random(), { drag: 0.6 });
            }
            if (Math.random() < dt * 3) {
                puffs.emit(h.x, h.y + 1, h.z, S.wind.x * 0.15, 0.8, S.wind.z * 0.15, COL.smoke, 0.35, 3, { alpha: 0.22, grow: 3, drag: 0.3 });
            }
            if (Math.random() < dt * 5) sound.crackle();
        }
    }
}

function updateNodes(dt) {
    for (const n of nodes) {
        const g = n.group;
        if (n.shake > 0) {
            n.shake = Math.max(0, n.shake - dt);
            const k = n.shake / 0.35;
            g.rotation.z = Math.sin(n.shake * 60) * 0.12 * k;
            g.rotation.y = n.baseRot + Math.sin(n.shake * 45) * 0.08 * k;
            g.scale.setScalar(n.grow * (1 - 0.12 * Math.sin(k * Math.PI)));
        }
        if (n.dying) {
            n.grow = Math.max(0, n.grow - dt * 3.5);
            g.scale.set(n.grow * (1 + (1 - n.grow) * 0.3), n.grow, n.grow * (1 + (1 - n.grow) * 0.3));
            if (n.grow <= 0) {
                n.dying = false;
                g.visible = false;
                n.respawn = 110 + Math.random() * 60;
            }
            continue;
        }
        if (n.charges > 0) {
            if (n.grow < 1) {
                n.grow = Math.min(1, n.grow + dt * 1.5);
                const e = 1 - Math.pow(1 - n.grow, 3);
                g.scale.setScalar(e * (1 + Math.sin(n.grow * Math.PI) * 0.12));
            }
            continue;
        }
        n.respawn -= dt;
        if (n.respawn <= 0 && dist2(P.pos, n.x, n.z) > 12) {
            n.charges = n.max;
            n.grow = 0;
            g.scale.setScalar(0.001);
            g.visible = true;
            if (n.collider) n.collider.active = true;
        }
    }
}

const pops = [];
function popIn(obj, dur = 0.55) {
    obj.scale.setScalar(0.001);
    pops.push({ obj, t: 0, dur });
}
function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.t += dt;
        const k = Math.min(1, p.t / p.dur);
        // Elastisk overshoot
        const e = k === 1 ? 1 : 1 - Math.pow(2, -9 * k) * Math.cos(k * 9.5);
        p.obj.scale.set(e, Math.min(1.25, e * (1 + (1 - k) * 0.2)), e);
        if (k >= 1) { p.obj.scale.setScalar(1); pops.splice(i, 1); }
    }
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const pr = projectiles[i];
        pr.t += dt / 0.28;
        if (pr.t < 0) {
            // Følger hånden under optrækket
            pr.from.copy(P.pos).y += 1.5;
            continue;
        }
        pr.g.visible = true;
        const t = Math.min(1, pr.t);
        pr.g.position.lerpVectors(pr.from, pr.to, t);
        pr.g.position.y += Math.sin(t * Math.PI) * 0.8;
        tmpV.lerpVectors(pr.from, pr.to, Math.min(1, t + 0.05));
        tmpV.y += Math.sin(Math.min(1, t + 0.05) * Math.PI) * 0.8;
        pr.g.lookAt(tmpV);
        puffs.emit(pr.g.position.x, pr.g.position.y, pr.g.position.z, 0, 0.1, 0, COL.breath, 0.1, 0.35, { alpha: 0.4, grow: 1 });
        if (t >= 1) {
            scene.remove(pr.g);
            projectiles.splice(i, 1);
            burst(pr.to, COL.snow, 10, 2.5, 2.5);
            pr.onHit();
        }
    }
}

function updateSurvival(dt) {
    let heat = 0;
    for (const h of heaters) {
        if (!h.lit) continue;
        const d = dist2(h, P.pos.x, P.pos.z);
        const R = h.kind === 'fire' ? 6 : 4.5;
        if (d < R) heat += (1 - d / R) * (h.kind === 'fire' ? 9 : 5);
    }
    S.sheltered = igloos.some((i) => dist2(i, P.pos.x, P.pos.z) < 2.0);
    const dogWarm = siku.state === 'warm' && siku.lie > 0.7 ? 0.5 : 0;
    const cold = 0.3 + S.night * 0.42 + S.storm * 1.4 * (S.sheltered ? 0 : 1) + (P.onIce ? 0.1 : 0);
    const insul = 1 - (S.has.anorak ? 0.4 : 0) - (S.has.kamik ? 0.18 : 0);
    const dW = -cold * insul + heat + (S.sheltered ? 2 : 0) + dogWarm;
    S.warmth = clamp(S.warmth + dW * dt, 0, 100);
    S.food = clamp(S.food - dt * (0.2 + (S.warmth < 30 ? 0.1 : 0)), 0, 100);
    let dH = 0;
    if (S.warmth <= 0) { dH -= 2.2; S.lastDamage = 'cold'; }
    if (S.food <= 0) { dH -= 1.2; if (S.warmth > 0) S.lastDamage = 'food'; }
    if (S.warmth > 40 && S.food > 30) dH += 0.6;
    S.health = clamp(S.health + dH * dt, 0, 100);
    if (S.health <= 0 && !S.over) showEnd(false);

    if (S.warmth < 25 && !S.coldWarn) { S.coldWarn = true; toast('🥶 Du fryser! Find et bål, en iglo – eller Siku.'); }
    if (S.warmth > 45) S.coldWarn = false;
    if (S.food < 20 && !S.foodWarn) { S.foodWarn = true; toast('Du er sulten. Spis noget (🍖).'); }
    if (S.food > 35) S.foodWarn = false;
}

// ---------------------------------------------------------------------------
// Vejr, døgn, nordlys
// ---------------------------------------------------------------------------
function updateWeather(dt) {
    S.wTimer -= dt;
    if (S.weather === 'snow' && S.nextStorm && S.wTimer < 8 && !S.warned) {
        S.warned = true;
        toast('🌬️ Vinden tager til – en snestorm er på vej!');
    }
    if (S.wTimer <= 0) {
        if (S.weather === 'clear') {
            S.weather = 'snow';
            S.nextStorm = Math.random() < 0.6 || S.firstStorm !== true;
            S.wTimer = 35 + Math.random() * 25;
            S.warned = false;
        } else if (S.weather === 'snow') {
            if (S.nextStorm) {
                S.weather = 'storm';
                S.firstStorm = true;
                S.wTimer = 40 + Math.random() * 25;
                toast('❄️ Snestorm! Søg ly i en iglo eller ved et bål.');
            } else {
                S.weather = 'clear';
                S.wTimer = 80 + Math.random() * 60;
            }
        } else {
            S.weather = 'snow';
            S.nextStorm = false;
            S.wTimer = 25 + Math.random() * 15;
            toast('Stormen løjer af.');
        }
    }
    const tStorm = S.weather === 'storm' ? 1 : S.weather === 'snow' ? 0.18 : 0;
    const tSnow = S.weather === 'storm' ? 1 : S.weather === 'snow' ? 0.5 : 0.12;
    S.storm += (tStorm - S.storm) * Math.min(1, dt * 0.25);
    S.snowAmt += (tSnow - S.snowAmt) * Math.min(1, dt * 0.3);
    S.windAngle += dt * 0.02 * Math.sin(S.time * 0.05);
    const ws = 1.5 + S.storm * 17;
    S.wind.set(Math.cos(S.windAngle) * ws, 0, Math.sin(S.windAngle) * ws);
}

function updateClock(dt) {
    const before = S.t;
    S.t = (S.t + dt / DAY_LEN) % 1;
    if (before > 0.5 && S.t <= 0.5 && S.t > 0.4) { /* middag */ }
    if (before > S.t) {
        S.day++;
        S.burstDone = false;
        dayCard(`Dag ${S.day}`, 'Morgenen gryr over isen');
    }
    if (S.night > 0.6 && S.nightCardDay !== S.day && S.started) {
        S.nightCardDay = S.day;
        dayCard('Natten falder på', 'Hold varmen – og se efter nordlyset', `Dag ${S.day}`);
    }
    // Nordlys
    S.auroraRetarget -= dt;
    if (S.auroraRetarget <= 0) {
        S.auroraRetarget = 15 + Math.random() * 10;
        S.auroraTarget = 0.45 + Math.random() * 0.65;
    }
    S.burst = Math.max(0, S.burst - dt);
    if (S.night > 0.8 && !S.burstDone && S.storm < 0.3 && Math.random() < dt / 35) {
        S.burstDone = true;
        S.burst = 22;
        toast('✨ Nordlyset danser – se det spejle sig i isen!');
    }
    const target = S.burst > 0 ? 2 : S.auroraTarget;
    S.aurora += (target - S.aurora) * Math.min(1, dt * 0.4);
    S.aTime += dt * (1 + (S.burst > 0 ? 1.4 : 0));
}

// ---------------------------------------------------------------------------
// Visuelt (kører også på titelskærmen)
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3().copy(P.pos);
const camGoal = new THREE.Vector3();
const CAM_DIR = CAM_OFF.clone().normalize();
let zoomMul = 1;
post.uniforms.uFade.value = 1;
let shake = 0;
const c1 = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();
const K = {
    sunDay: C('#ffe6c6'), sunDusk: C('#ff9656'), moon: C('#9fb6ff'),
    skyDay: C('#a9c6ea'), skyDusk: C('#c9a6b8'), skyNight: C('#2a3f66'),
    gndDay: C('#7d93ad'), gndNight: C('#0b1424'),
    fogDay: C('#d3e2f0'), fogDusk: C('#e6b9a0'), fogNight: C('#0b1628'),
    stormDay: C('#d9e2ea'), stormNight: C('#27313f'),
    auroraG: C('#2cff9a'), snowNight: C('#7d8fb0'), white: C('#ffffff'),
};
const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
const shoot = { t: -1, x: 0, y: 0, a: 0 };

function updateVisuals(dt) {
    // Døgnlys
    const sunH = -Math.cos(TAU * S.t);
    const day = smoothstep(-0.25, 0.15, sunH);
    S.day01 = day;
    S.night = 1 - day;
    const dusk = Math.max(0, 1 - Math.abs(sunH - 0.02) / 0.32) * day;
    const auroraNow = Math.pow(S.night, 1.5) * Math.pow(1 - S.storm, 2) * S.aurora;
    const az = TAU * S.t;
    // Arktisk lav sol: lange skygger hele dagen
    sunDir.set(Math.cos(az), 0.2 + 0.32 * Math.max(0, sunH), Math.sin(az)).normalize();
    moonDir.set(-0.45, 0.8, 0.4).normalize();
    const dir = c3; // genbrug ikke — kun for læsbarhed
    void dir;
    const lightDir = sunDir.clone().lerp(moonDir, S.night).normalize();

    c1.copy(K.sunDay).lerp(K.sunDusk, dusk);
    sun.color.copy(K.moon).lerp(c1, day);
    sun.intensity = (0.55 + 1.15 * day) * (1 - S.storm * 0.6);
    c2.copy(K.skyDay).lerp(K.skyDusk, dusk);
    hemi.color.copy(K.skyNight).lerp(c2, day);
    hemi.color.lerp(K.auroraG, auroraNow * 0.14);
    hemi.groundColor.copy(K.gndNight).lerp(K.gndDay, day);
    hemi.intensity = (0.75 - 0.18 * day) * (1 - S.storm * 0.15) + S.storm * 0.25;

    c1.copy(K.fogDay).lerp(K.fogDusk, dusk);
    const fog = scene.fog;
    fog.color.copy(K.fogNight).lerp(c1, day);
    c2.copy(K.stormNight).lerp(K.stormDay, day);
    fog.color.lerp(c2, S.storm * 0.9);
    fog.color.lerp(K.auroraG, auroraNow * 0.03);
    fog.near = 78 - S.storm * 8;
    fog.far = 230 - S.storm * 100;
    renderer.setClearColor(fog.color);

    // Kamera: kigger lidt frem i bevægelsesretningen, zoomer ud på slæden,
    // og glider langsomt hen over landskabet på titelskærmen
    if (!S.started) {
        const a = S.time * 0.035;
        camGoal.set(W.SPAWN.x + Math.cos(a) * 10 - 6, P.pos.y, W.SPAWN.z + Math.sin(a) * 10 - 6);
        camTarget.lerp(camGoal, 1 - Math.exp(-0.8 * dt));
    } else {
        const la = S.has.sled ? 0.55 : 0.35;
        camGoal.set(P.pos.x + clamp(P.vel.x * la, -3, 3), P.pos.y, P.pos.z + clamp(P.vel.z * la, -3, 3));
        S.camBlend = Math.min(1, (S.camBlend || 0) + dt * 0.5);
        camTarget.lerp(camGoal, 1 - Math.exp(-(1 + S.camBlend * 3) * dt));
    }
    const zoomGoal = S.has.sled && P.speed > 3 ? 1.15 : 1;
    zoomMul += (zoomGoal - zoomMul) * Math.min(1, dt * 1.2);
    applyFrustum();
    shake = Math.max(0, shake - dt * 1.5);
    const sh = shake * 0.35 + S.storm * 0.05;
    camera.position.copy(camTarget).add(CAM_OFF);
    camera.position.x += (Math.random() - 0.5) * sh + Math.sin(S.time * 0.4) * 0.05;
    camera.position.y += (Math.random() - 0.5) * sh + Math.sin(S.time * 0.31) * 0.04;
    camera.lookAt(camTarget);
    sun.position.copy(camTarget).addScaledVector(lightDir, 70);
    sun.target.position.copy(camTarget);
    rim.position.set(camTarget.x - lightDir.x * 50, camTarget.y + 25, camTarget.z - lightDir.z * 50);
    rim.target.position.copy(camTarget);
    rim.intensity = (0.22 + S.night * 0.18) * (1 - S.storm * 0.6);

    // Punktlys til de nærmeste flammer (+ flammeglimt i sneen)
    const lit = heaters.filter((h) => h.lit).sort((a, b) => dist2(a, P.pos.x, P.pos.z) - dist2(b, P.pos.x, P.pos.z));
    let warmK = 0;
    pointLights.forEach((l, i) => {
        const h = lit[i];
        const fu = i === 0 ? lightUniforms.uFire0.value : lightUniforms.uFire1.value;
        if (!h) { l.intensity = 0; fu.w = 0; return; }
        const fk = 1 + Math.sin(S.time * 17 + i) * 0.1 + Math.sin(S.time * 29 + h.x) * 0.08 + Math.sin(S.time * 7.3 + i) * 0.06;
        const low = h.kind === 'fire' ? clamp(h.fuel / 40, 0.35, 1) : 1;
        l.position.set(h.x, h.y + (h.kind === 'fire' ? 1 : 0.6), h.z);
        l.intensity = (h.kind === 'fire' ? 14 : 5) * fk * low * (0.6 + S.night * 0.6);
        l.color.set(h.kind === 'fire' ? '#ff8a3a' : '#ffb766');
        fu.set(h.x, h.y + 0.8, h.z, (h.kind === 'fire' ? 3 : 1.2) * fk * low);
        warmK = Math.max(warmK, clamp(1 - dist2(h, camTarget.x, camTarget.z) / 9, 0, 1) * (h.kind === 'fire' ? 1 : 0.5));
    });

    // Fælles lys til sne og is
    const L = lightUniforms;
    L.uTime.value = S.time;
    L.uLightDir.value.copy(lightDir);
    L.uLightCol.value.copy(sun.color).multiplyScalar(sun.intensity * (0.35 + 0.65 * day));
    L.uLightCol.value.lerp(K.auroraG, auroraNow * 0.25 * S.night);
    L.uEye.value.copy(camTarget).addScaledVector(CAM_DIR, 30);
    L.uPx.value = 1 / pxPerUnit;
    L.uGlint.value = (1 - S.storm) * (0.3 + 0.7 * day);
    L.uShadowTint.value = 0.5 + 0.5 * day;
    flameUniforms.uTime.value = S.time;
    windUniform.value.copy(S.wind);
    for (const h of heaters) {
        if (!h.lit) continue;
        h.obj.flames.traverse((o) => {
            if (!o.userData.billboard) return;
            o.quaternion.copy(camera.quaternion);
            o.material.uniforms.uPower.value = (o.userData.basePower ??= o.material.uniforms.uPower.value) *
                (h.kind === 'fire' ? clamp(h.fuel / 40, 0.45, 1) : 1) * (1 - S.storm * 0.2 * (S.sheltered ? 0 : 1));
        });
    }

    // Isen
    const u = iceMat.uniforms;
    u.uTime.value = S.time;
    u.uATime.value = S.aTime;
    u.uNight.value = S.night;
    u.uAurora.value = auroraNow;
    u.uStorm.value = S.storm;
    u.uCam.value.copy(camTarget);
    u.uSky.value.copy(fog.color).convertLinearToSRGB();
    // Stjerneskud
    if (shoot.t < 0 && S.night > 0.7 && S.storm < 0.3 && Math.random() < dt / 10) {
        const cq0 = (camTarget.x - camTarget.z) * Math.SQRT1_2, cq1 = -(camTarget.x + camTarget.z) * Math.SQRT1_2;
        shoot.t = 0;
        shoot.x = cq0 * 0.05 + (Math.random() - 0.5) * 16;
        shoot.y = cq1 * 0.05 + (Math.random() - 0.5) * 12;
        shoot.a = Math.random() * TAU;
    }
    if (shoot.t >= 0) {
        shoot.t += dt / 0.9;
        if (shoot.t > 1) shoot.t = -1;
    }
    u.uShoot.value.set(shoot.x, shoot.y, shoot.a, shoot.t);

    // Isbjerge vugger
    for (const b of bergs) {
        if (!b.bob) continue;
        b.mesh.position.y = Math.sin(S.time * 0.5 + b.ph) * 0.15 - 0.2;
        b.mesh.rotation.z = Math.sin(S.time * 0.35 + b.ph) * 0.02;
    }

    // Varder pulserer
    for (const c of cairns) {
        if (c.found) continue;
        c.ring.material.opacity = 0.35 + Math.sin(S.time * 3) * 0.25;
        c.ring.scale.setScalar(1 + Math.sin(S.time * 3) * 0.05);
        c.beam.material.opacity = 0.1 + S.night * 0.12;
    }
    // Iglodøre gløder om natten
    c1.set('#1d2838');
    c2.set('#e09a55');
    W.doorMat.color.copy(c1).lerp(c2, S.night * 0.85);
    for (const ig of igloos) ig.obj.halo.material.opacity = S.night * 0.45;

    // Sne
    c1.copy(K.snowNight).lerp(K.white, day);
    snow.uniforms.uColor.value.copy(c1);
    snow.uniforms.uSize.value = 0.07 + S.storm * 0.08;
    snow.uniforms.uOpacity.value = 0.55 + S.snowAmt * 0.35;
    snow.uniforms.uSparkle.value = clamp(1 - S.snowAmt * 2.5, 0, 1);
    snow.update(dt, camTarget, S.wind, S.snowAmt, S.time);
    // Store, uskarpe fnug tæt på kameraet giver dybde
    bokeh.uniforms.uColor.value.copy(c1);
    bokeh.uniforms.uOpacity.value = (0.18 + S.snowAmt * 0.3) * (S.started ? 1 : 0.7);
    tmpV.copy(camTarget).addScaledVector(CAM_DIR, 32);
    bokeh.update(dt, tmpV, S.wind, 0.4 + S.snowAmt * 0.6, S.time);
    // Lav tåge i lavningerne — mest ved skumring, nat og storm
    c2.copy(fog.color).lerp(K.white, 0.25 * day);
    mist.update(dt, camTarget, S.wind, 0.05 + dusk * 0.12 + S.night * 0.06 + S.storm * 0.22, c2, S.time);

    // Fygning langs jorden i stormen
    if (S.storm > 0.3) {
        const n = S.storm * 60 * dt;
        for (let i = 0; i < n; i++) {
            const x = P.pos.x + (Math.random() - 0.5) * 30, z = P.pos.z + (Math.random() - 0.5) * 30;
            const y = Math.max(0, W.groundHeight(x, z)) + 0.2;
            puffs.emit(x, y, z, S.wind.x * 0.7, 0.2, S.wind.z * 0.7, c1, 0.8, 1.4, { alpha: 0.18 * S.storm, grow: 2.5 });
        }
    }
    sparks.update(dt);
    puffs.update(dt);
    steps.update(dt, S.storm);

    // Overlays
    $('ov-storm').style.opacity = (S.storm * (0.55 - S.night * 0.3)).toFixed(3);
    $('ov-frost').style.opacity = S.started ? clamp((45 - S.warmth) / 40, 0, 1).toFixed(3) : 0;
    post.uniforms.uTime.value = S.time;
    post.uniforms.uNight.value = S.night;
    post.uniforms.uStorm.value = S.storm;
    post.uniforms.uWarm.value += (warmK * (0.4 + S.night * 0.6) - post.uniforms.uWarm.value) * Math.min(1, dt * 2);
    post.uniforms.uWind.value.set(S.wind.x * camRight.x + S.wind.z * camRight.z, S.wind.x * camUp.x + S.wind.z * camUp.z);
    post.uniforms.uFade.value = Math.max(0, post.uniforms.uFade.value - dt * 0.7);

    sound.wind(Math.max(S.storm, S.snowAmt * 0.3) * (S.sheltered ? 0.4 : 1));
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
let hudT = 0;
const barEls = {
    health: $('st-health'), warm: $('st-warm'), food: $('st-food'), dog: $('st-dog'),
};
function setBar(el, v) {
    const w = v.toFixed(1) + '%';
    const i = el.querySelector('i'), b = el.querySelector('b');
    if (i.style.width === w) return;
    // Det lyse spor (b) har forsinket transition og hænger derfor lidt efter, når værdien falder
    i.style.width = w;
    b.style.width = w;
    el.classList.toggle('low', v < 25);
}

let dayCardT = null;
function dayCard(main, sub, top = '') {
    const el = $('daycard');
    el.querySelector('.dc-top').textContent = top;
    el.querySelector('.dc-main').textContent = main;
    el.querySelector('.dc-sub').textContent = sub;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(dayCardT);
    dayCardT = setTimeout(() => el.classList.remove('show'), 3700);
}

// Procedurel rim-tekstur til kulde-overlayet
(function makeFrost() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    g.strokeStyle = 'rgba(230,245,255,0.55)';
    g.shadowColor = 'rgba(200,235,255,0.9)';
    g.shadowBlur = 4;
    const branch = (x, y, a, len, depth) => {
        if (depth <= 0 || len < 3) return;
        const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        g.lineWidth = depth * 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x2, y2);
        g.stroke();
        branch(x2, y2, a + (Math.random() - 0.5) * 0.5, len * 0.8, depth - 1);
        if (Math.random() < 0.7) branch(x2, y2, a + 0.9 + Math.random() * 0.4, len * 0.55, depth - 1);
        if (Math.random() < 0.7) branch(x2, y2, a - 0.9 - Math.random() * 0.4, len * 0.55, depth - 1);
    };
    for (let i = 0; i < 70; i++) {
        const side = i % 4, t = Math.random() * 512;
        const [x, y, a] = side === 0 ? [t, 0, Math.PI / 2] : side === 1 ? [512, t, Math.PI] : side === 2 ? [t, 512, -Math.PI / 2] : [0, t, 0];
        branch(x, y, a + (Math.random() - 0.5) * 0.8, 18 + Math.random() * 26, 6);
    }
    const grd = g.createRadialGradient(256, 256, 120, 256, 256, 380);
    grd.addColorStop(0, 'rgba(200,230,255,0)');
    grd.addColorStop(1, 'rgba(220,240,255,0.45)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    $('ov-frost').style.backgroundImage = `url(${cv.toDataURL()})`;
})();
function objective() {
    const I = S.inv, H = S.has;
    if (!S.builtFire) {
        if (I.wood < 3 || I.stone < 3) return 'Saml 3 drivtømmer og 3 sten – natten nærmer sig';
        return 'Byg et bål (🔨 Byg) og hold varmen';
    }
    if (!H.harpoon) {
        if (I.bone < 1) return 'Find knogler ved hvalskelettet på stranden';
        if (I.wood < 2 || I.stone < 1) return 'Saml mere tømmer og sten til en harpun';
        return 'Lav en harpun (🔨 Byg)';
    }
    if (!H.kamik) return I.hide < 2 ? 'Fang sæler ved åndehullerne på havisen – eller harer' : 'Sy kamikker af skind';
    if (!H.anorak) return 'Sy en skindanorak (3 skind, 1 knogle)';
    if (!H.knife) return 'Lav en snekniv af 2 knogler';
    if (S.igloos === 0) return 'Skær 12 sneblokke og byg en iglo';
    if (!H.sled) return 'Byg en hundeslæde – ekspeditionen venter';
    if (S.cairnsFound < cairns.length) return `Find varderne (${S.cairnsFound}/${cairns.length}) – følg den gule pil`;
    return 'Ruten er fuldført. Overlev så længe du kan!';
}
const actionEl = $('btn-action');
let lastAction = '';
function updateHUD(dt) {
    hudT -= dt;
    if (hudT > 0) return;
    hudT = 0.15;
    setBar(barEls.health, S.health);
    setBar(barEls.warm, S.warmth);
    setBar(barEls.food, S.food);
    setBar(barEls.dog, siku.hunger);
    $('dog-mood').textContent = 'Siku ' + siku.mood;
    const icon = S.night > 0.6 ? '🌙' : S.night > 0.25 ? '🌅' : '☀️';
    $('day').textContent = `Dag ${S.day} ${icon}`;
    $('weather').textContent = S.weather === 'storm' ? '❄️ Snestorm' : S.weather === 'snow' ? '🌨️ Snefald' : (S.night > 0.6 ? '✨ Klart' : '☁️ Klart');
    $('cairns').textContent = `⛰️ Varder ${S.cairnsFound}/${cairns.length}` + (S.sheltered ? ' · ⛺ i ly' : '');
    const obj = objective();
    const objEl = $('objective');
    if (objEl.textContent !== obj) {
        if (objEl.textContent) { objEl.classList.remove('flash'); void objEl.offsetWidth; objEl.classList.add('flash'); }
        objEl.textContent = obj;
    }
    const chips = Object.entries(S.inv).filter(([, v]) => v > 0).map(([k, v]) => `<span class="chip" data-k="${k}">${ITEMS[k].icon} ${v}</span>`).join('');
    const strip = $('inv-strip');
    if (strip.innerHTML !== chips) strip.innerHTML = chips;
    $('btn-eat').style.opacity = EAT_ORDER.some((k) => S.inv[k] > 0) ? 1 : 0.4;

    const it = getInteraction();
    const hf = highlightFor(it);
    hl.get = hf ? hf[0] : null;
    if (hf) hl.r = hf[1];
    const key = it.icon + it.label + !!it.disabled;
    if (key !== lastAction) {
        lastAction = key;
        actionEl.querySelector('.ic').textContent = it.icon;
        actionEl.querySelector('.lbl').textContent = it.label;
        actionEl.classList.toggle('disabled', !!it.disabled);
        actionEl.classList.add('swap');
        setTimeout(() => actionEl.classList.remove('swap'), 180);
    }

    // Kompas mod nærmeste varde
    let best = null, bd = 1e9;
    for (const c of cairns) {
        if (c.found) continue;
        const d = dist2(c, P.pos.x, P.pos.z);
        if (d < bd) { bd = d; best = c; }
    }
    const comp = $('compass');
    if (best) {
        comp.style.display = '';
        const a = toScreen(P.pos, { x: 0, y: 0 });
        const b = toScreen(new THREE.Vector3(best.x, 0, best.z), { x: 0, y: 0 });
        $('arrow').style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
        $('cdist').textContent = `varde ${Math.round(bd)} m`;
    } else {
        comp.style.display = 'none';
    }
}

// ---------------------------------------------------------------------------
// Løkke
// ---------------------------------------------------------------------------
let internalH = 540;
function applyFrustum() {
    const a = innerWidth / innerHeight;
    const base = ZOOMS[zoomIdx] * zoomMul;
    viewH = a < 1 ? (base * 0.95) / a : base;
    const viewW = viewH * a;
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
    pxPerUnit = (post.enabled ? internalH : renderer.domElement.height) / viewH;
    snow.uniforms.uScale.value = pxPerUnit;
    bokeh.uniforms.uScale.value = pxPerUnit;
    sparks.uniforms.uScale.value = pxPerUnit;
    puffs.uniforms.uScale.value = pxPerUnit;
}
function resize() {
    renderer.setSize(innerWidth, innerHeight);
    internalH = post.setSize(innerWidth, innerHeight);
    applyFrustum();
    ghostJoy();
}
addEventListener('resize', resize);
resize();

$('btn-start').addEventListener('click', () => {
    sound.init();
    sound.startMusic();
    S.started = true;
    S.paused = false;
    const scr0 = $('screen-start');
    scr0.classList.add('leaving');
    setTimeout(() => scr0.classList.add('hidden'), 800);
    $('hud').classList.remove('hidden');
    $('buttons').classList.remove('hidden');
    ghostJoy();
    dayCard('Dag 1', 'Solen går ned over isen', 'Nordlysets Spor');
    setTimeout(() => toast('Saml tømmer og sten – og byg et bål før natten.'), 3000);
    setTimeout(() => toast('🐕 Siku følger dig. Hun snuser ting op og advarer mod isbjørne.'), 6200);
});

const IDLE_CTX = { speed: 0, onIce: false, sled: false, idle: 5, cold: 0, fire: 0, storm: 0, windSide: 0, sliding: 0, turn: 0, dead: false };
Object.defineProperty(IDLE_CTX, 'dead', { get: () => S.over });
const clock = new THREE.Clock();
function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!S.paused) {
        S.time += dt;
        updateClock(dt);
        updateWeather(dt);
        if (!S.over) {
            updatePlayer(dt);
            handleAction(dt);
        } else {
            anim.update(dt, IDLE_CTX);
        }
        updateTeam(dt);
        updateHares(dt);
        updateSeals(dt);
        updateBears(dt);
        updateHeaters(dt);
        updateNodes(dt);
        updateProjectiles(dt);
        updatePops(dt);
        updateRipples(dt);
        if (!S.over) updateSurvival(dt);
    } else if (!S.started) {
        S.time += dt;
        S.aTime += dt;
        updateTeam(dt);
        anim.update(dt, IDLE_CTX);
    }
    updateVisuals(dt);
    updateFloaters(dt);
    updateHighlight(dt);
    updateToast(dt);
    sound.musicUpdate(dt, S.night, S.storm);
    if (S.started) updateHUD(dt);
    post.render(scene, camera);
}
loop();
{
    const sb = $('btn-start');
    sb.disabled = false;
    sb.textContent = 'Begynd rejsen';
}

window.__game = { S, P, siku, scene, camera, post, anim, lightUniforms, getInteraction, doAction, craft, RECIPES, nodes, seals, bears, heaters };
