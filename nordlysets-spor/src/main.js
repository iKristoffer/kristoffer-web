import * as THREE from 'three';
import * as W from './world.js';
import { createIceMaterial, Snow, Particles, Footprints, PostFX } from './fx.js';
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
scene.add(hemi, sun, sun.target);
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

const snow = new Snow(isTouch ? 2200 : 4500);
const sparks = new Particles(280, true);
const puffs = new Particles(320, false);
const steps = new Footprints(260);
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
const player = W.makePlayer();
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
sled.position.set(0, 0, 0.55);
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
        m: m.group, pos: new THREE.Vector3(s.x, s.h, s.z), home: new THREE.Vector3(s.x, 0, s.z),
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
    const blob = W.makeBlob(2.4, 0.3);
    scene.add(m.group, blob);
    bears.push({
        ...m, blob, pos: new THREE.Vector3(s.x, 0, s.z), home: new THREE.Vector3(s.x, 0, s.z),
        target: new THREE.Vector3(s.x, 0, s.z), flee: 0, atk: 0, wait: 0, yaw: 0, phase: 0, mode: 'wander', alertT: 0,
    });
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
        toastEl.style.opacity = 1;
        toastT = 2.8;
    } else if (toastT <= 0) {
        toastEl.style.opacity = 0;
    }
}

const floaters = [];
const vProj = new THREE.Vector3();
function floatText(text, pos, color = '#fff', emote = false) {
    const el = document.createElement('div');
    el.className = emote ? 'ft emote' : 'ft';
    el.textContent = text;
    el.style.color = color;
    $('floaters').appendChild(el);
    floaters.push({ el, pos: new THREE.Vector3(pos.x, pos.y + (emote ? 1.3 : 2), pos.z), t: 0, life: emote ? 1.6 : 1.4 });
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
        f.pos.y += dt * 0.9;
        toScreen(f.pos, scr);
        f.el.style.transform = `translate(${scr.x}px, ${scr.y}px) translate(-50%, -50%)`;
        f.el.style.opacity = String(1 - Math.max(0, f.t - f.life * 0.5) / (f.life * 0.5));
        if (f.t > f.life) {
            f.el.remove();
            floaters.splice(i, 1);
        }
    }
}

function gain(key, n, pos) {
    S.inv[key] += n;
    floatText(`+${n} ${ITEMS[key].icon}`, pos || P.pos, '#ffe9a8');
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
    $('btn-fx').style.opacity = post.enabled ? 1 : 0.5;
    toast(post.enabled ? '🎞️ Retro-filter til' : '🎞️ Retro-filter fra');
    resize();
});
bindButton('btn-sound', () => {
    sound.setMuted(!sound.muted);
    $('btn-sound').textContent = sound.muted ? '🔇' : '🔊';
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
    if (!anyPanelOpen() && !S.over) S.paused = false;
}
function togglePanel(id) {
    if (S.over || !S.started) return;
    const el = $(id);
    const open = el.classList.contains('hidden');
    closePanels();
    if (open) {
        el.classList.remove('hidden');
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
        row.className = 'recipe' + (done ? ' done' : '');
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
    const collider = { x, z, r: kind === 'fire' ? 0.55 : 0.35, active: true };
    colliders.push(collider);
    heaters.push({ kind, x, z, y, obj, lit: true, fuel: kind === 'fire' ? 150 : 420, collider });
}

function craft(r) {
    if (!canAfford(r) || (r.once && S.has[r.id])) return;
    for (const [k, v] of Object.entries(r.cost)) S.inv[k] -= v;
    sound.craft();
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
        scene.add(obj.group);
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
        player.model.position.y = 0.2;
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
    projectiles.push({ g, from, to, t: 0, onHit });
    P.yaw = Math.atan2(to.x - from.x, to.z - from.z);
    P.act = 0.35;
    sound.whoosh();
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
    P.act = 0.3;
    switch (it.kind) {
        case 'node': {
            const n = it.n;
            P.yaw = Math.atan2(n.x - P.pos.x, n.z - P.pos.z);
            n.charges--;
            const pos = new THREE.Vector3(n.x, n.y, n.z);
            if (n.type === 'wood') { gain('wood', 2, pos); burst(pos, COL.wood, 6); }
            if (n.type === 'stone') { gain('stone', 1, pos); burst(pos, COL.stone, 8); }
            if (n.type === 'bone') { gain('bone', 1, pos); burst(pos, COL.bone, 6); }
            if (n.type === 'berries') { gain('berries', 2, pos); burst(pos, COL.berry, 5); }
            sound.chop();
            if (n.charges <= 0) {
                n.group.visible = false;
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

    // Animation
    P.act = Math.max(0, P.act - dt);
    P.phase += dt * P.speed * 2.3;
    const walk = S.has.sled ? 0 : Math.min(1, P.speed / 3) * (P.onIce && input < 0.1 ? 0.2 : 1);
    const sw = Math.sin(P.phase) * 0.65 * walk;
    player.legs[0].rotation.x = sw;
    player.legs[1].rotation.x = -sw;
    player.arms[0].rotation.x = -sw * 0.8;
    player.arms[1].rotation.x = sw * 0.8 - (P.act > 0 ? Math.sin(P.act / 0.3 * Math.PI) * 1.8 : 0);
    player.model.position.y = (S.has.sled ? 0.2 : 0) + Math.abs(Math.sin(P.phase)) * 0.05 * walk;
    player.model.rotation.z = P.onIce && P.speed > 1 && input < 0.1 ? Math.sin(S.time * 3) * 0.08 : 0;
    player.body.rotation.y = Math.sin(P.phase) * 0.1 * walk;

    pBlob.position.set(P.pos.x, P.pos.y + 0.03, P.pos.z);
    pBlob.visible = P.onIce;

    // Fodspor / slædespor
    P.dist += P.speed * dt;
    if (P.dist > (S.has.sled ? 0.45 : 0.62)) {
        P.dist = 0;
        const perpX = Math.cos(P.yaw), perpZ = -Math.sin(P.yaw);
        if (!P.onIce) {
            if (S.has.sled) {
                for (const s of [-1, 1]) steps.add(P.pos.x + perpX * 0.38 * s, P.pos.y, P.pos.z + perpZ * 0.38 * s, P.yaw, 0.6);
            } else {
                P.side *= -1;
                steps.add(P.pos.x + perpX * 0.14 * P.side, P.pos.y, P.pos.z + perpZ * 0.14 * P.side, P.yaw);
                sound.step();
            }
        } else if (Math.random() < 0.3) {
            sound.iceStep();
        }
    }

    // Ånde i kulden
    breathT -= dt;
    if (breathT <= 0) {
        breathT = 1.3 + Math.random() * 0.8;
        const f = 0.35;
        for (let i = 0; i < 3; i++) {
            puffs.emit(P.pos.x + Math.sin(P.yaw) * f, P.pos.y + 1.52 + (S.has.sled ? 0.2 : 0), P.pos.z + Math.cos(P.yaw) * f,
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
    const frontX = P.pos.x + fwdX * 1.55, frontZ = P.pos.z + fwdZ * 1.55, fy = P.pos.y + 0.25;
    teamDogs.forEach((d, i) => {
        const s = i === 0 ? -0.6 : 0.6;
        tmpV.set(P.pos.x + fwdX * 2.3 + rX * s, 0, P.pos.z + fwdZ * 2.3 + rZ * s);
        const k = Math.min(1, dt * 8);
        const before = d.pos.clone();
        d.pos.x += (tmpV.x - d.pos.x) * k;
        d.pos.z += (tmpV.z - d.pos.z) * k;
        d.pos.y = Math.max(0, W.groundHeight(d.pos.x, d.pos.z));
        const sp = before.distanceTo(d.pos) / Math.max(dt, 1e-4);
        d.yaw = angleLerp(d.yaw, P.yaw, k);
        d.phase += dt * sp * 2.6;
        const sw = Math.sin(d.phase) * 0.7 * Math.min(1, sp / 2.5);
        d.parts.legs[0].rotation.x = sw;
        d.parts.legs[1].rotation.x = -sw;
        const sitK = P.speed < 0.5 ? 1 : 0;
        d.sit += (sitK - d.sit) * Math.min(1, dt * 4);
        d.parts.legs[2].rotation.x = -sw + d.sit * 1.3;
        d.parts.legs[3].rotation.x = sw + d.sit * 1.3;
        d.inner.rotation.x = -d.sit * 0.35;
        d.parts.tail.rotation.y = Math.sin(S.time * 7 + i) * 0.4;
        d.root.position.copy(d.pos);
        d.root.rotation.y = d.yaw;
        d.blob.position.set(d.pos.x, d.pos.y + 0.03, d.pos.z);
        d.blob.visible = d.pos.y < 0.05;
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
        h.m.position.set(h.pos.x, h.pos.y + Math.abs(Math.sin(h.hop)) * 0.28, h.pos.z);
        h.m.rotation.y = h.yaw;
    }
}

function updateSeals(dt) {
    for (const s of seals) {
        s.timer -= dt;
        if (s.state === 'down' && s.timer <= 0) {
            s.state = 'up';
            s.timer = 7 + Math.random() * 3;
            if (dist2(P.pos, s.hole.x, s.hole.z) < 30) splash(s.hole);
        } else if (s.state === 'up' && s.timer <= 0) {
            s.state = 'down';
            s.timer = 8 + Math.random() * 10;
        } else if (s.state === 'gone' && s.timer <= 0) {
            s.state = 'down';
            s.timer = 5;
        }
        const ty = s.state === 'up' ? -0.05 : -1.3;
        s.y += (ty - s.y) * Math.min(1, dt * 3);
        s.m.position.set(s.hole.x, s.y + Math.sin(S.time * 2 + s.hole.x) * 0.03, s.hole.z);
        s.m.rotation.y = Math.atan2(P.pos.x - s.hole.x, P.pos.z - s.hole.z) * 0.6 + Math.sin(S.time * 0.7) * 0.4;
        s.m.visible = s.y > -1.2;
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
            sound.growl();
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
        b.phase += dt * moved * 1.6;
        const sw = Math.sin(b.phase) * 0.5 * Math.min(1, moved / 2);
        b.legs[0].rotation.x = sw; b.legs[1].rotation.x = -sw; b.legs[2].rotation.x = -sw; b.legs[3].rotation.x = sw;
        b.head.rotation.y = mode === 'wander' && spd === 0 ? Math.sin(S.time * 0.8) * 0.4 : 0;
        b.group.position.copy(b.pos);
        b.group.position.y += Math.abs(Math.sin(b.phase)) * 0.04;
        b.group.rotation.y = b.yaw;
        b.blob.position.set(b.pos.x, b.pos.y + 0.03, b.pos.z);
        b.blob.visible = b.pos.y < 0.05;

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
        if (n.charges > 0) continue;
        n.respawn -= dt;
        if (n.respawn <= 0 && dist2(P.pos, n.x, n.z) > 12) {
            n.charges = n.max;
            n.group.visible = true;
            if (n.collider) n.collider.active = true;
        }
    }
}

function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const pr = projectiles[i];
        pr.t += dt / 0.28;
        const t = Math.min(1, pr.t);
        pr.g.position.lerpVectors(pr.from, pr.to, t);
        pr.g.position.y += Math.sin(t * Math.PI) * 0.8;
        if (t >= 1) {
            scene.remove(pr.g);
            projectiles.splice(i, 1);
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
        toast(`☀️ Dag ${S.day} på isen`);
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
let shake = 0;
const c1 = new THREE.Color(), c2 = new THREE.Color(), c3 = new THREE.Color();
const K = {
    sunDay: C('#fff1dc'), sunDusk: C('#ffab6b'), moon: C('#9fb6ff'),
    skyDay: C('#d6e8ff'), skyDusk: C('#f0c4ae'), skyNight: C('#2a3f66'),
    gndDay: C('#7d93ad'), gndNight: C('#0b1424'),
    fogDay: C('#cfe0ee'), fogDusk: C('#e2bba8'), fogNight: C('#0b1628'),
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
    sunDir.set(Math.cos(az), 0.28 + 0.6 * Math.max(0, sunH), Math.sin(az)).normalize();
    moonDir.set(-0.45, 0.8, 0.4).normalize();
    const dir = c3; // genbrug ikke — kun for læsbarhed
    void dir;
    const lightDir = sunDir.clone().lerp(moonDir, S.night).normalize();

    c1.copy(K.sunDay).lerp(K.sunDusk, dusk);
    sun.color.copy(K.moon).lerp(c1, day);
    sun.intensity = (0.55 + 0.78 * day) * (1 - S.storm * 0.55);
    c2.copy(K.skyDay).lerp(K.skyDusk, dusk);
    hemi.color.copy(K.skyNight).lerp(c2, day);
    hemi.color.lerp(K.auroraG, auroraNow * 0.14);
    hemi.groundColor.copy(K.gndNight).lerp(K.gndDay, day);
    hemi.intensity = (0.75 + 0.15 * day) * (1 - S.storm * 0.15) + S.storm * 0.2;

    c1.copy(K.fogDay).lerp(K.fogDusk, dusk);
    const fog = scene.fog;
    fog.color.copy(K.fogNight).lerp(c1, day);
    c2.copy(K.stormNight).lerp(K.stormDay, day);
    fog.color.lerp(c2, S.storm * 0.9);
    fog.color.lerp(K.auroraG, auroraNow * 0.03);
    fog.near = 95 - S.storm * 18;
    fog.far = 260 - S.storm * 128;
    renderer.setClearColor(fog.color);

    // Kamera
    camTarget.lerp(P.pos, 1 - Math.exp(-5 * dt));
    shake = Math.max(0, shake - dt * 1.5);
    const sh = shake * 0.35 + S.storm * 0.05;
    camera.position.copy(camTarget).add(CAM_OFF);
    camera.position.x += (Math.random() - 0.5) * sh;
    camera.position.y += (Math.random() - 0.5) * sh;
    camera.lookAt(camTarget);
    sun.position.copy(camTarget).addScaledVector(lightDir, 70);
    sun.target.position.copy(camTarget);

    // Punktlys til de nærmeste flammer
    const lit = heaters.filter((h) => h.lit).sort((a, b) => dist2(a, P.pos.x, P.pos.z) - dist2(b, P.pos.x, P.pos.z));
    pointLights.forEach((l, i) => {
        const h = lit[i];
        if (!h) { l.intensity = 0; return; }
        const fk = 1 + Math.sin(S.time * 17 + i) * 0.1 + Math.sin(S.time * 29 + h.x) * 0.08;
        l.position.set(h.x, h.y + (h.kind === 'fire' ? 1 : 0.6), h.z);
        l.intensity = (h.kind === 'fire' ? 14 : 5) * fk * (0.6 + S.night * 0.6);
        l.color.set(h.kind === 'fire' ? '#ff8a3a' : '#ffb766');
    });

    // Glimmer i sneen
    W.glitterUniforms.uTime.value = S.time;
    W.glitterUniforms.uCamPos.value.copy(camTarget);
    c1.copy(K.sunDay).multiplyScalar(0.9);
    c2.copy(K.auroraG).multiplyScalar(auroraNow * 0.45).add(c3.copy(K.moon).multiplyScalar(0.3));
    W.glitterUniforms.uGlint.value.copy(c2).lerp(c1, day).multiplyScalar(1 - S.storm);

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
    el.querySelector('i').style.width = v.toFixed(1) + '%';
    el.classList.toggle('low', v < 25);
}
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
    $('objective').textContent = objective();
    const chips = Object.entries(S.inv).filter(([, v]) => v > 0).map(([k, v]) => `<span class="chip">${ITEMS[k].icon} ${v}</span>`).join('');
    const strip = $('inv-strip');
    if (strip.innerHTML !== chips) strip.innerHTML = chips;
    $('btn-eat').style.opacity = EAT_ORDER.some((k) => S.inv[k] > 0) ? 1 : 0.4;

    const it = getInteraction();
    const key = it.icon + it.label + !!it.disabled;
    if (key !== lastAction) {
        lastAction = key;
        actionEl.querySelector('.ic').textContent = it.icon;
        actionEl.querySelector('.lbl').textContent = it.label;
        actionEl.classList.toggle('disabled', !!it.disabled);
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
function resize() {
    const w = innerWidth, h = innerHeight, a = w / h;
    renderer.setSize(w, h);
    const base = ZOOMS[zoomIdx];
    viewH = a < 1 ? (base * 0.95) / a : base;
    const viewW = viewH * a;
    camera.left = -viewW / 2;
    camera.right = viewW / 2;
    camera.top = viewH / 2;
    camera.bottom = -viewH / 2;
    camera.updateProjectionMatrix();
    const ih = post.setSize(w, h);
    pxPerUnit = (post.enabled ? ih : renderer.domElement.height) / viewH;
    snow.uniforms.uScale.value = pxPerUnit;
    sparks.uniforms.uScale.value = pxPerUnit;
    puffs.uniforms.uScale.value = pxPerUnit;
    ghostJoy();
}
addEventListener('resize', resize);
resize();

$('btn-start').addEventListener('click', () => {
    sound.init();
    S.started = true;
    S.paused = false;
    $('screen-start').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('buttons').classList.remove('hidden');
    ghostJoy();
    toast('Solen går ned. Saml tømmer og sten – og byg et bål før natten.');
    setTimeout(() => toast('🐕 Siku følger dig. Hun snuser ting op og advarer mod isbjørne.'), 3200);
});

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
        }
        updateTeam(dt);
        updateHares(dt);
        updateSeals(dt);
        updateBears(dt);
        updateHeaters(dt);
        updateNodes(dt);
        updateProjectiles(dt);
        if (!S.over) updateSurvival(dt);
    } else if (!S.started) {
        S.time += dt;
        S.aTime += dt;
        updateTeam(dt);
    }
    updateVisuals(dt);
    updateFloaters(dt);
    updateToast(dt);
    if (S.started) updateHUD(dt);
    post.render(scene, camera);
}
loop();

window.__game = { S, P, siku, scene, camera, getInteraction, doAction, craft, RECIPES, nodes, seals, bears, heaters };
