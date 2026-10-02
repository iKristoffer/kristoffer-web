import * as THREE from 'three';
import * as W from './world.js';
import { createIceMaterial, Snow, Particles, Footprints, PostFX, Mist } from './fx.js';
import { lightUniforms, flameUniforms } from './shaders.js';
import { makePlayerRig, PlayerAnimator } from './player.js';
import { buildScatter, windUniform } from './scatter.js';
import { Sound } from './audio.js';
import { Dog } from './dog.js';
import { NPC_DEFS, POIS, RECIPE_HINTS, goalText, talk, targetNpc } from './story.js';
import { ExploreMap } from './map.js';
import { buildDressing } from './dressing.js';
import { buildHome } from './home.js';

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
// Den nærmeste ild/fakkel kaster rigtige skygger (kun på computer; seks ekstra tegnerunder pr. billede er for dyrt på mobil)
const FIRE_SHADOWS = !isTouch;
pointLights[0].shadow.mapSize.set(512, 512);
pointLights[0].shadow.camera.near = 0.4;
pointLights[0].shadow.camera.far = 16;
pointLights[0].shadow.bias = -0.003;
pointLights[0].shadow.normalBias = 0.06;
pointLights[0].shadow.radius = 3;

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
    inv: { wood: 3, stone: 1, bone: 0, snow: 0, hide: 0, sinew: 0, brand: 0, meat: 0, cooked: 0, blubber: 0, berries: 1 },
    has: { harpoon: false, knife: false, kamik: false, anorak: false, sled: false, axe: false, cleats: false }, // virker lige nu (ikke itu)
    owned: {}, dur: {}, equip: {}, // lavet engang / holdbarhed tilbage / hvilken variant pr. slot                                                               // lavet engang / holdbarhed tilbage
    known: new Set(['fire', 'torch', 'tinder', 'knife', 'harpoon', 'igloo', 'sled']), // kendte opskrifter (resten læres: se src/story.js)
    q: { map: 0, needle: 0, ittu: 0, nuka: 0, pavia: 0, qillaq: 0 }, stats: { seals: 0, hares: 0 }, flags: {}, found: {}, hasMap: false, control: 'player',
    home: false, homeIgloo: null, chest: {}, bench: false,                                                // quest-linjer: trin pr. linje
    storm: 0, snowAmt: 0.12, weather: 'clear', wTimer: 130, nextStorm: false, warned: false,
    windAngle: 0.6, wind: new THREE.Vector3(1, 0, 0),
    aurora: 0, auroraTarget: 0.8, auroraRetarget: 10, aTime: 0, burst: 0, burstDone: false, auroraNight: false, dryNights: 0,
    night: 0, day01: 1, sheltered: false, lastDamage: 'cold',
    cairnsFound: 0, builtFire: false, igloos: 0,
};

const ITEMS = {
    wood: { name: 'Drivtømmer', icon: '🪵' },
    stone: { name: 'Sten', icon: '🪨' },
    bone: { name: 'Knogler', icon: '🦴' },
    snow: { name: 'Sneblokke', icon: '🧊' },
    hide: { name: 'Skind', icon: '🟫' },
    sinew: { name: 'Sener', icon: '🧵' },
    brand: { name: 'Fakkelbrand', icon: '🕯️' },
    meat: { name: 'Råt kød', icon: '🥩', food: 18 },
    cooked: { name: 'Kogt kød', icon: '🍖', food: 32, warm: 6 },
    blubber: { name: 'Spæk', icon: '🧈', food: 12, warm: 10 },
    berries: { name: 'Krækbær', icon: '🫐', food: 7 },
};
// Udstyr med holdbarhed. dur tæller ned (kast, skæringer eller sekunder) og udstyret går i stykker ved 0.
const GEAR = {
    harpoon: { unit: 'kast', fix: { bone: 1, sinew: 1 } },
    knife: { unit: 'skæringer', fix: { bone: 1 } },
    kamik: { unit: 's gang', fix: { hide: 1, sinew: 1 } },
    anorak: { unit: 's i storm', fix: { hide: 1, sinew: 2 } },
    sled: { unit: 's kørsel', fix: { wood: 2, sinew: 1 } },
    axe: { unit: 'slag', fix: { stone: 1, bone: 1, sinew: 1 } },
    cleats: { unit: 's på is', fix: { bone: 1, sinew: 1 } },
};
const EAT_ORDER = ['cooked', 'meat', 'berries', 'blubber'];

// Gear-opskrifter har slot + tier + stats (st). At lave en højere tier i samme slot erstatter den gamle.
// st: max=holdbarhed, insul=kuldeværn, speed=fartfaktor, hit=+fangstchance, range=rækkefaktor, power=slag pr. hug, storm=modvind-værn.
const RECIPES = [
    { id: 'fire', name: 'Bål', icon: '🔥', desc: 'Varme og lys. Holder isbjørne væk. Kog kød ved det.', cost: { wood: 3, stone: 3 }, place: true },
    { id: 'tinder', name: 'Fakkelbrand', icon: '🕯️', desc: 'Spækdrænket træ. Giver 2 brande: til nye fakler – eller til at tænde en udbrændt fakkel igen.', cost: { wood: 1, blubber: 1 }, makes: { brand: 2 } },
    { id: 'torch', name: 'Fakkel', icon: '🏮', desc: 'Sæt den, hvor du vil have lys i mørket. Brænder ud efter et stykke tid – en ny brand får den i gang igen.', cost: { wood: 1, brand: 1 }, place: true },
    { id: 'knife', slot: 'knife', tier: 1, name: 'Snekniv', icon: '🔪', desc: 'Af knogle. Skær sneblokke til en iglo.', cost: { bone: 2 }, st: { max: 30 } },
    { id: 'harpoon', slot: 'harpoon', tier: 1, name: 'Træharpun', icon: '🔱', desc: 'Til fangst af sæl (puisi) og hare. Skræmmer isbjørne.', cost: { wood: 2, bone: 1, stone: 1 }, st: { max: 20 } },
    { id: 'harpoon2', slot: 'harpoon', tier: 2, name: 'Knogleharpun', icon: '🔱', desc: 'Knoglespids og senebinding: længere kast, færre forbier.', cost: { wood: 1, bone: 3, sinew: 2 }, st: { max: 32, hit: 0.07, range: 1.15 } },
    { id: 'harpoon3', slot: 'harpoon', tier: 3, name: 'Hvaltandsharpun', icon: '🔱', desc: 'Spids af hvaltand, spækglat skaft. Rammer næsten altid.', cost: { wood: 1, bone: 4, sinew: 3, blubber: 1 }, st: { max: 45, hit: 0.12, range: 1.3 } },
    { id: 'kamik', slot: 'kamik', tier: 1, name: 'Kamikker', icon: '🥾', desc: 'Skindstøvler. Mindre kulde og lettere gang.', cost: { hide: 2 }, st: { max: 240, insul: 0.18, speed: 1.1 } },
    { id: 'kamik2', slot: 'kamik', tier: 2, name: 'Dobbeltsålede kamikker', icon: '🥾', desc: 'Dobbelt skind og spæk i sømmene. Varmere og hurtigere.', cost: { hide: 3, sinew: 2, blubber: 1 }, st: { max: 360, insul: 0.26, speed: 1.14 } },
    { id: 'anorak', slot: 'anorak', tier: 1, name: 'Skindanorak', icon: '🧥', desc: 'Syet med knoglenål. Holder meget mere varme.', cost: { hide: 3, bone: 1 }, st: { max: 180, insul: 0.4 } },
    { id: 'anorak2', slot: 'anorak', tier: 2, name: 'Dobbeltpels-anorak', icon: '🧥', desc: 'Pels ind og pels ud. Meget varm, og stormen får mindre fat.', cost: { hide: 5, sinew: 4, bone: 1 }, st: { max: 300, insul: 0.55, storm: 0.4 } },
    { id: 'lamp', name: 'Qulleq (spæklampe)', icon: '🪔', desc: 'Stenlampe med spæk. Svag, men langvarig varme.', cost: { stone: 3, blubber: 2 }, place: true },
    { id: 'igloo', name: 'Iglo', icon: '⛺', desc: 'Ly mod stormen. Stil dig inde i den.', cost: { snow: 12 }, place: true },
    { id: 'sled', slot: 'sled', tier: 1, name: 'Hundeslæde', icon: '🛷', desc: 'Siku og to hunde mere trækker dig – meget hurtigere.', cost: { wood: 4, hide: 3, bone: 2 }, st: { max: 300, speed: 1.75 } },
    { id: 'sled2', slot: 'sled', tier: 2, name: 'Forstærket slæde', icon: '🛷', desc: 'Knoglemeiere og sene-bindinger. Hurtigere og holder længere.', cost: { wood: 5, bone: 3, sinew: 3 }, st: { max: 480, speed: 2.0 } },
    { id: 'axe', slot: 'axe', tier: 1, name: 'Stenøkse', icon: '🪓', desc: 'Hugger i is og snedriver.', cost: { stone: 2, wood: 2, bone: 1, sinew: 1 }, st: { max: 25, power: 1 } },
    { id: 'axe2', slot: 'axe', tier: 2, name: 'Isøkse med knoglekant', icon: '🪓', desc: 'Skarp kant af knogle. Halv tid ved en isvæg.', cost: { stone: 2, wood: 1, bone: 3, sinew: 2 }, st: { max: 40, power: 2 } },
    { id: 'cleats', slot: 'cleats', tier: 1, name: 'Isbrodder', icon: '🦶', desc: 'Knogletænder under sålen. Giver fodfæste på stejl is og klippe.', cost: { bone: 3, sinew: 2, hide: 1 }, st: { max: 200 } },
];
const RBY = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
const cur = (slot) => RBY[S.equip[slot]];
/** Stat fra det udstyr, man har på lige nu (0/standard hvis intet eller itu). */
const stat = (slot, key, dflt = 0) => (S.has[slot] ? cur(slot).st[key] ?? dflt : dflt);
const STAT_LABEL = (st) => [
    st.max && `⏱ ${st.max}`, st.insul && `🔥 −${Math.round(st.insul * 100)}% kulde`, st.speed && `⚡ ×${st.speed}`,
    st.hit && `🎯 +${Math.round(st.hit * 100)}%`, st.range && `↔ ×${st.range}`, st.power && `⛏ ${st.power}/slag`,
    st.storm && `🌬 −${Math.round(st.storm * 100)}% modvind`,
].filter(Boolean).join(' · ');

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
        case 'cook': case 'fuel': case 'relight': case 'refill': case 'torchfuel': case 'torchpick': return [at(it.h.x, it.h.y, it.h.z), 1];
        case 'talk': return [at(it.n.x, 0, it.n.z), 1.3];
        case 'enter': { const d = iglooDoor(it.ig); return [at(d.x, W.groundHeight(d.x, d.z), d.z), 1.3]; }
        case 'exit': return [at(home.door.x, 0, home.door.z), 1.2];
        case 'sleep': return [at(home.bench.x, 0.3, home.bench.z), 1.7];
        case 'bench': return [at(home.work.x, 0.2, home.work.z), 1.3];
        case 'chest': return [at(home.chest.x, 0.2, home.chest.z), 1.2];
        case 'dig': return [at(it.c.x, W.groundHeight(it.c.x, it.c.z), it.c.z), 1];
        case 'pull': return [at(rope.x, W.groundHeight(rope.x, rope.z), rope.z), 1.2];
        case 'gate': return [at(it.z.gx, W.groundHeight(it.z.gx, it.z.gz), it.z.gz), 1.8];
        case 'poi': return [at(it.p.x, W.groundHeight(it.p.x, it.p.z), it.p.z), 1.3];
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

const heaters = []; // bål + lamper + fakler
const TORCH_FUEL = 210;   // sekunder en fakkel brænder (en nat og lidt til)
const igloos = [];

// Lejren: Ukaleq ved et bål, der aldrig går ud, ved siden af en iglo
const npcs = [];
{
    const s = world.spot(world.isLand, W.SPAWN.x, W.SPAWN.z, 16, 28, 5) || world.spot(world.isLand, W.SPAWN.x, W.SPAWN.z, 8, 40, 5);
    if (s) {
        const ig = W.makeIgloo();
        ig.group.position.set(s.x - 3.4, Math.max(0, W.groundHeight(s.x - 3.4, s.z)) - 0.05, s.z + 0.6);
        ig.group.rotation.y = Math.PI * 0.62;
        W.contactShadow(ig.group, 5.6, 5.6, 0.35);
        scene.add(ig.group);
        colliders.push({ x: s.x - 3.4, z: s.z + 0.6, r: 2.0, active: true });
        const fire = W.makeFire();
        const fy = Math.max(0, W.groundHeight(s.x, s.z));
        fire.group.position.set(s.x, fy, s.z);
        scene.add(fire.group);
        const col = { x: s.x, z: s.z, r: 0.55, active: true };
        colliders.push(col);
        heaters.push({ kind: 'fire', x: s.x, z: s.z, y: fy, obj: fire, lit: true, fuel: 1e9, collider: col, camp: true });
        world.camp = { x: s.x, z: s.z };
        spawnNpc('ukaleq', NPC_DEFS.ukaleq, s.x + 1.6, s.z - 1.3, s);
    }
}
/** En NPC ved et bål: egen model i egne farver, vender sig mod ilden — eller mod spilleren, når man kommer tæt på. */
function spawnNpc(id, def, nx, nz, fireAt) {
    const rig = makePlayerRig();
    for (const [k, v] of Object.entries(def.colors)) rig.mats[k].color.set(v);
    rig.harpoon.visible = false;
    rig.group.position.set(nx, Math.max(0, W.groundHeight(nx, nz)), nz);
    scene.add(rig.group);
    const blob = W.makeBlob(1.3, 0.25);
    blob.position.set(nx, rig.group.position.y + 0.03, nz);
    scene.add(blob);
    npcs.push({ id, def, rig, anim: new PlayerAnimator(rig), x: nx, z: nz, yaw: 0, fireAt });
}
/** Et bål, der aldrig går ud (leje for en NPC). */
function campFire(x, z) {
    const fire = W.makeFire();
    const fy = Math.max(0, W.groundHeight(x, z));
    fire.group.position.set(x, fy, z);
    scene.add(fire.group);
    const col = { x, z, r: 0.55, active: true };
    colliders.push(col);
    heaters.push({ kind: 'fire', x, z, y: fy, obj: fire, lit: true, fuel: 1e9, collider: col, camp: true });
}
const projectiles = [];

// ---------------------------------------------------------------------------
// Grænser: pakis om hele verden og et snævert startområde, der åbnes af intro-opgaven
// ---------------------------------------------------------------------------
const ridgeGeo = new THREE.IcosahedronGeometry(0.62, 0);
const ridgeMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
const dummy = new THREE.Object3D();
/** Rækker af isblokke langs punkterne. big=true giver høj pakis, ellers en lav trykryg. */
function ridgeLine(points, big, rng) {
    const m = new THREE.InstancedMesh(ridgeGeo, ridgeMat, points.length);
    m.castShadow = m.receiveShadow = true;
    const col = new THREE.Color();
    points.forEach((p, i) => {
        const sx = (big ? 1.9 : 1.3) * (0.8 + rng() * 0.9), sy = (big ? 2.2 : 1.3) * (0.7 + rng() * 1.1);
        const y = Math.max(0, W.groundHeight(p.x, p.z));
        dummy.position.set(p.x, y + sy * 0.28, p.z);
        dummy.rotation.set((rng() - 0.5) * 0.4, rng() * TAU, (rng() - 0.5) * 0.4);
        dummy.scale.set(sx, sy, sx * (0.8 + rng() * 0.5));
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        col.set('#e4eef8').offsetHSL(0, 0, -rng() * 0.12 + (big ? 0 : 0.03));
        if (big) col.lerp(new THREE.Color('#aecbe6'), rng() * 0.5);
        m.setColorAt(i, col);
    });
    scene.add(m);
    return m;
}
const frng = W.mulberry32(9001);

// Ydre grænse: dobbelt række pakis, der lukker verden — og forklarer det
{
    const pts = [];
    for (const [r, step] of [[W.WORLD_RADIUS + 1.5, 2.2], [W.WORLD_RADIUS + 4.5, 2.6]]) {
        const n = Math.ceil(TAU * r / step);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU + frng() * 0.02;
            pts.push({ x: Math.cos(a) * (r + frng() * 1.5), z: Math.sin(a) * (r + frng() * 1.5) });
        }
    }
    ridgeLine(pts, true, frng);
}

// Startområdet: en ring af trykryg om bugten med én port, som en snedrive lukker
const FUN = { x: W.SPAWN.x, z: W.SPAWN.z, R: 46, open: false, gate: null, drift: null, cols: [], t: -1, warnT: 0, melt: 0 };
{
    const ga = Math.atan2(-FUN.z, -FUN.x);               // mod øens midte
    const half = 3.4 / FUN.R;                            // portens halvbredde i radianer
    const pts = [];
    const n = Math.ceil(TAU * FUN.R / 1.5);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        let da = Math.abs(a - ga);
        if (da > Math.PI) da = TAU - da;
        const x = FUN.x + Math.cos(a) * FUN.R, z = FUN.z + Math.sin(a) * FUN.R;
        if (Math.hypot(x, z) > W.WORLD_RADIUS - 1) continue;   // pakisen tager over
        if (da < half) continue;                               // porten
        pts.push({ x, z });
        colliders.push({ x, z, r: 0.95, active: true });
    }
    ridgeLine(pts, false, frng);
    // Porten: en snedrive af tre klatter + kollidere, som forsvinder, når intro-opgaven er klaret
    const gx = FUN.x + Math.cos(ga) * FUN.R, gz = FUN.z + Math.sin(ga) * FUN.R;
    FUN.gate = { x: gx, z: gz };
    const drift = new THREE.Group();
    const tx = -Math.sin(ga), tz = Math.cos(ga);
    for (let k = -2; k <= 2; k++) {
        const x = gx + tx * k * 1.5, z = gz + tz * k * 1.5;
        const c = { x, z, r: 0.95, active: true };
        colliders.push(c);
        FUN.cols.push(c);
        const lump = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshLambertMaterial({ color: '#f4f8fc', flatShading: true }));
        lump.scale.set(1.15, 0.9 + (k === 0 ? 0.5 : 0), 1.15);
        lump.position.set(x, Math.max(0, W.groundHeight(x, z)) + 0.55, z);
        lump.castShadow = lump.receiveShadow = true;
        drift.add(lump);
    }
    scene.add(drift);
    FUN.drift = drift;
}
function openFunnel() {
    FUN.open = true;
    FUN.t = 0;
    S.q.map = Math.max(S.q.map, 4);
    for (const c of FUN.cols) c.active = false;
    for (let i = 0; i < 40; i++) burst(new THREE.Vector3(FUN.gate.x + (Math.random() - 0.5) * 6, 1, FUN.gate.z + (Math.random() - 0.5) * 6), COL.snow, 1, 4, 3);
    sound.chime();
    toast('💧 Snedriven er smeltet. Vejen ud af bugten er åben – fortæl Ukaleq.');
}
const MELT_TIME = 16;
function updateFunnel(dt) {
    if (!FUN.open) {
        // Et tændt bål helt tæt på driven smelter den — men først når Ukaleq har forklaret hvordan
        let heat = false;
        for (const h of heaters) if (h.kind === 'fire' && h.lit && !h.camp && dist2(h, FUN.gate.x, FUN.gate.z) < 7.5) heat = true;
        if (heat && S.q.map >= 3) {
            FUN.melt += dt;
            if (Math.random() < dt * 10) puffs.emit(FUN.gate.x + (Math.random() - 0.5) * 5, 1.2, FUN.gate.z + (Math.random() - 0.5) * 5, 0, 0.8, 0, COL.breath, 0.4, 1.6, { alpha: 0.3, grow: 2 });
            if (FUN.melt > MELT_TIME * 0.5 && !FUN.half) { FUN.half = true; toast('Driven drypper. Hold bålet i gang.'); }
            if (FUN.melt > MELT_TIME) openFunnel();
        } else if (heat && !FUN.hinted) {
            FUN.hinted = true;
            toast('Bålet gør ingenting ved driven endnu. Tal med Ukaleq først.');
        } else if (!heat) {
            FUN.melt = Math.max(0, FUN.melt - dt * 0.4);
        }
        FUN.drift.scale.y = 1 - 0.45 * Math.min(1, FUN.melt / MELT_TIME);
    }
    if (FUN.open && FUN.t >= 0 && FUN.t < 2.5) {
        FUN.t += dt;
        const k = 1 - Math.min(1, FUN.t / 2);
        FUN.drift.scale.y = Math.max(0.001, k * 0.55);
        FUN.drift.position.y = -(1 - k) * 0.6;
        if (FUN.t >= 2.5) scene.remove(FUN.drift);
    }
    FUN.warnT -= dt;
    if (!FUN.open && FUN.warnT <= 0 && dist2(FUN.gate, P.pos.x, P.pos.z) < 4.5 && P.speed > 0.8) {
        FUN.warnT = 9;
        toast('❄️ En høj snedrive spærrer passet. Den er hård som sten – måske kan varme noget.');
    }
}
/** Ittus gemmer: fremdrift følger fundene, uanset rækkefølge. */
function updateQuests() {
    if (S.q.ittu >= 1 && S.q.ittu < 3) {
        const a = S.found.cache_axe, b = S.found.cache_cleats;
        const to = a && b ? 3 : a ? 2 : 1;
        if (to > S.q.ittu) {
            S.q.ittu = to;
            toast(to === 3 ? '📋 Begge gemmer er fundet. Fortæl Ukaleq.' : '📋 Første gemme fundet. Den næste ligger ved Fuglefjeldet.');
        }
    }
}

// Fund i landskabet: spor efter andre og mærkelige ting. Vises først på kortet, når du har undersøgt dem.
const pois = [];
{
    const stone = new THREE.MeshLambertMaterial({ color: '#8a8f99', flatShading: true });
    const bone = new THREE.MeshLambertMaterial({ color: '#e6dcc6' });
    const coal = new THREE.MeshLambertMaterial({ color: '#1d1a17' });
    for (const def of POIS) {
        const s = def.zone === 'start'
            ? world.spot(world.isLand, W.SPAWN.x, W.SPAWN.z, 9, 38, 2.2, false)
            : world.spot(world.isLand, 0, 0, 12, 92, 2.5, false);
        if (!s) continue;
        const g = new THREE.Group();
        if (def.kind === 'trace') {
            const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 12).rotateX(-Math.PI / 2), coal);
            disc.position.y = 0.05;
            g.add(disc);
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * TAU, m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2 + frng() * 0.1, 0), stone);
                m.position.set(Math.cos(a) * 0.95, 0.12, Math.sin(a) * 0.95);
                m.rotation.set(frng(), frng(), frng());
                g.add(m);
            }
            const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.1, 5), new THREE.MeshLambertMaterial({ color: '#6b4c2e' }));
            stick.position.set(1.4, 0.5, 0.2);
            stick.rotation.z = 0.25;
            g.add(stick);
        } else {
            const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.7, 0.16), bone), a2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), bone);
            a1.position.set(-0.7, 0.85, 0);
            a2.position.set(0.7, 0.75, 0);
            a1.rotation.z = -0.18;
            a2.rotation.z = 0.2;
            const top = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 5, 10, Math.PI), bone);
            top.position.set(0, 1.55, 0);
            g.add(a1, a2, top);
        }
        W.contactShadow(g, 2.2, 2.2, 0.3);
        g.position.set(s.x, Math.max(0, s.h), s.z);
        g.rotation.y = frng() * TAU;
        scene.add(g);
        pois.push({ def, x: s.x, z: s.z, g, found: false });
    }
}

const exploreMap = new ExploreMap(W.groundHeight, W.WORLD_RADIUS + 3, 2.5);

// ---------------------------------------------------------------------------
// Zoner med låse: hver zone er en ring af trykryg med én port. Portens lås bestemmer, hvad der skal til.
//   crack  – en sprække kun Siku kan passe igennem
//   rope   – en snedrive, som et reb inde i en anden zone løsner (Siku trækker)
//   axe    – en isvæg, der skal hugges ned
//   cleats – en stejl skrænt, der kræver isbrodder
// ---------------------------------------------------------------------------
const ZONE_DEFS = [
    { id: 'thin', name: 'Tyndisen', icon: '❄️', gate: 'crack', R: 8, hint: 'En sprække i trykryggen – for smal til dig.' },
    { id: 'bird', name: 'Fuglefjeldet', icon: '🪨', gate: 'rope', R: 8, hint: 'En snedrive spærrer. Noget skal løsne den fra den anden side.' },
    { id: 'pass', name: 'Gletsjerpasset', icon: '🧊', gate: 'axe', R: 8, hint: 'En tyk isvæg. Du skal bruge en økse.' },
    { id: 'peak', name: 'Nordlysbjerget', icon: '⛰️', gate: 'cleats', R: 8, hint: 'Stejl is. Uden isbrodder glider du tilbage.' },
];
const zones = [];
const caches = [];   // nedgravede opskrifter, som kun Siku kan grave frem
let rope = null;     // rebet i Tyndisen
{
    const far = (h, x, z) => world.isLand(h, x, z) && Math.hypot(x - W.SPAWN.x, z - W.SPAWN.z) > 58;
    const mat = {
        rope: new THREE.MeshLambertMaterial({ color: '#f4f8fc', flatShading: true }),
        axe: new THREE.MeshLambertMaterial({ color: '#9cc6e6', flatShading: true, transparent: true, opacity: 0.92 }),
        cleats: new THREE.MeshLambertMaterial({ color: '#5d6672', flatShading: true }),
        crack: new THREE.MeshBasicMaterial({ color: '#0b1018' }),
    };
    for (const def of ZONE_DEFS) {
        const sp = world.spot(far, 0, 0, 0, 85, def.R + 3);
        if (!sp) continue;
        const z = { ...def, x: sp.x, z: sp.z, open: false, t: -1, hits: 0, cols: [], gx: 0, gz: 0, drift: null, warnT: 0 };
        const ga = Math.atan2(W.SPAWN.z - z.z, W.SPAWN.x - z.x);   // porten vender mod startområdet
        const half = (def.gate === 'crack' ? 2.2 : 3.6) / def.R;
        const pts = [];
        const n = Math.ceil(TAU * def.R / 1.5);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * TAU;
            let da = Math.abs(a - ga);
            if (da > Math.PI) da = TAU - da;
            if (da < half) continue;
            const x = z.x + Math.cos(a) * def.R, zz = z.z + Math.sin(a) * def.R;
            if (Math.hypot(x, zz) > W.WORLD_RADIUS - 1) continue;
            pts.push({ x, z: zz });
            colliders.push({ x, z: zz, r: 0.95, active: true });
        }
        ridgeLine(pts, false, frng);
        z.gx = z.x + Math.cos(ga) * def.R;
        z.gz = z.z + Math.sin(ga) * def.R;
        const tx = -Math.sin(ga), tz = Math.cos(ga);
        const gy = Math.max(0, W.groundHeight(z.gx, z.gz));
        if (def.gate === 'crack') {
            // To store sten med en 0,6 enheders sprække imellem: Siku (r 0,25) passer, Arnarulunnguaq (r 0,42) gør ikke
            for (const sgn of [-1, 1]) {
                const x = z.gx + tx * sgn * 1.06, zz = z.gz + tz * sgn * 1.06;
                colliders.push({ x, z: zz, r: 0.75, active: true });
                const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), new THREE.MeshLambertMaterial({ color: '#c9d6e2', flatShading: true }));
                rock.position.set(x, Math.max(0, W.groundHeight(x, zz)) + 0.4, zz);
                rock.scale.set(1, 0.9 + frng() * 0.4, 1);
                rock.castShadow = true;
                scene.add(rock);
            }
            colliders.push({ x: z.gx, z: z.gz, r: 0.9, active: true, minR: 0.35 });   // Arnarulunnguaq (0,42) stoppes, Siku (0,25) glider forbi
            const dark = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.4).rotateX(-Math.PI / 2), mat.crack);
            dark.position.set(z.gx, gy + 0.04, z.gz);
            dark.rotation.y = ga;
            scene.add(dark);
        } else {
            const g = new THREE.Group();
            for (let k = -2; k <= 2; k++) {
                const x = z.gx + tx * k * 1.5, zz = z.gz + tz * k * 1.5;
                const c = { x, z: zz, r: 0.95, active: true };
                colliders.push(c);
                z.cols.push(c);
                const y = Math.max(0, W.groundHeight(x, zz));
                let m;
                if (def.gate === 'rope') {
                    m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), mat.rope);
                    m.scale.set(1.15, 1 + (k === 0 ? 0.5 : 0), 1.15);
                    m.position.set(x, y + 0.6, zz);
                } else {
                    m = new THREE.Mesh(new THREE.BoxGeometry(1.7, def.gate === 'axe' ? 3 : 3.4, 1.5), mat[def.gate]);
                    m.rotation.y = ga + (frng() - 0.5) * 0.12;
                    m.position.set(x, y + 1.4, zz);
                }
                m.castShadow = m.receiveShadow = true;
                g.add(m);
            }
            scene.add(g);
            z.drift = g;
        }
        zones.push(z);
    }
    const byId = (id) => zones.find((q) => q.id === id);

    // Tyndisen: reb + nedgravet økse-opskrift. Fuglefjeldet: nedgravet brodder-opskrift.
    const thin = byId('thin'), bird = byId('bird');
    const stick = new THREE.MeshLambertMaterial({ color: '#6b4c2e' });
    if (thin) {
        const g = new THREE.Group();
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 6), stick);
        post.position.y = 1.1;
        const rp = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 6, 14), new THREE.MeshLambertMaterial({ color: '#b89a68' }));
        rp.position.set(0, 1.9, 0);
        rp.rotation.x = Math.PI / 2;
        g.add(post, rp);
        W.contactShadow(g, 1.6, 1.6, 0.3);
        const rx = thin.x + 3, rz = thin.z - 1;
        g.position.set(rx, Math.max(0, W.groundHeight(rx, rz)), rz);
        scene.add(g);
        rope = { x: rx, z: rz, g, pulled: false };
        caches.push({ id: 'cache_axe', zone: thin, x: thin.x - 2.5, z: thin.z + 2, recipe: 'axe', found: false, title: '🪓 Et gammelt depot',
            text: 'Under sneen: en pakke af sælskind, bundet med sene. Indeni ligger en tegning i sod af en økse med stenhoved og knoglekile – og en kold hånd har skrevet “til den, der kommer efter”.', reward: { stone: 1, sinew: 1 } });
    }
    if (bird) {
        caches.push({ id: 'cache_cleats', zone: bird, x: bird.x + 1.5, z: bird.z - 2.5, recipe: 'cleats', found: false, title: '🦶 Et gemt fangstdepot',
            text: 'Siku graver en skindpose frem. Tænder af hvalros, bundet i en rem – og et tegnet mønster for, hvordan de sættes under en kamik. Fuglefjeldet er ikke til dem, der glider.', reward: { bone: 1, hide: 1 } });
    }
    for (const c of caches) {
        const g = new THREE.Group();
        const mound = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 6, 0, TAU, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#f1f6fb', flatShading: true }));
        mound.scale.set(1, 0.4, 1);
        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.9, 5), new THREE.MeshLambertMaterial({ color: '#e6dcc6' }));
        bone.position.set(0.35, 0.4, 0.1);
        bone.rotation.z = -0.3;
        g.add(mound, bone);
        g.position.set(c.x, Math.max(0, W.groundHeight(c.x, c.z)), c.z);
        scene.add(g);
        c.g = g;
    }
    // Varde 4 og 5 flytter ind i Gletsjerpasset og Nordlysbjerget — så zonerne har et mål
    [['pass', 3], ['peak', 4]].forEach(([id, ci]) => {
        const zz = byId(id), c = cairns[ci];
        if (!zz || !c) return;
        const col = colliders.find((q) => q.x === c.x && q.z === c.z);
        c.x = zz.x; c.z = zz.z;
        c.group.position.set(zz.x, Math.max(0, W.groundHeight(zz.x, zz.z)), zz.z);
        if (col) { col.x = zz.x; col.z = zz.z; }
    });
}

const home = buildHome();
const dressing = buildDressing({ scene, W, world, colliders, rng: W.mulberry32(5150), zones, camp: world.camp, isTouch });

// De tre andre NPC'er bor uden for startområdet — man møder dem, når man har fundet vej ud
const outposts = {};
{
    const outside = (h, x, z) => world.isLand(h, x, z) && h < 4 && Math.hypot(x - W.SPAWN.x, z - W.SPAWN.z) > 62 && !zones.some((q) => Math.hypot(x - q.x, z - q.z) < 16);
    const place = (id, extra) => {
        const def = NPC_DEFS[id];
        let sp;
        if (def.place === 'bird') {
            const bz = zones.find((q) => q.id === 'bird');
            if (!bz) return;
            sp = { x: bz.x - 2.8, z: bz.z + 1.2 };
        } else {
            sp = world.spot(outside, 0, 0, 20, 85, 6);
            if (!sp) return;
        }
        campFire(sp.x, sp.z);
        spawnNpc(id, def, sp.x + 1.5, sp.z - 1.1, sp);
        outposts[id] = { x: sp.x, z: sp.z };
        extra(sp);
    };
    const rngO = W.mulberry32(3131);
    const wood = new THREE.MeshLambertMaterial({ color: '#6b4c2e', flatShading: true });
    // Nuka: et læskur af trykryg og en vraget slæde
    place('nuka', (sp) => {
        const sl = W.makeSled();
        sl.position.set(sp.x - 3, Math.max(0, W.groundHeight(sp.x - 3, sp.z + 1)), sp.z + 1);
        sl.rotation.y = 0.7; sl.rotation.z = 0.12;
        scene.add(sl);
        colliders.push({ x: sp.x - 3, z: sp.z + 1, r: 1.0, active: true });
        const pts = []; for (let i = 0; i < 9; i++) { const a = 2.4 + i * 0.28; pts.push({ x: sp.x + Math.cos(a) * 3.4, z: sp.z + Math.sin(a) * 3.4 }); }
        ridgeLine(pts, false, rngO);
        for (const q of pts) colliders.push({ x: q.x, z: q.z, r: 0.8, active: true });
    });
    // Pavia: hundepæle i en rundkreds og en slæde under udbedring
    place('pavia', (sp) => {
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU + 0.4, x = sp.x + Math.cos(a) * 3.8, z = sp.z + Math.sin(a) * 3.8;
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.9, 5), wood);
            post.position.set(x, Math.max(0, W.groundHeight(x, z)) + 0.45, z);
            scene.add(post);
        }
        const sl = W.makeSled();
        sl.position.set(sp.x + 3.2, Math.max(0, W.groundHeight(sp.x + 3.2, sp.z - 1.5)), sp.z - 1.5);
        sl.rotation.y = -0.5;
        scene.add(sl);
        colliders.push({ x: sp.x + 3.2, z: sp.z - 1.5, r: 1.0, active: true });
    });
    // Qillaq: en lille iglo inde i Fuglefjeldet
    place('qillaq', (sp) => {
        const ig = W.makeIgloo();
        ig.group.position.set(sp.x - 2.4, Math.max(0, W.groundHeight(sp.x - 2.4, sp.z - 1)) - 0.05, sp.z - 1);
        ig.group.rotation.y = 0.9;
        ig.group.scale.setScalar(0.85);
        scene.add(ig.group);
        colliders.push({ x: sp.x - 2.4, z: sp.z - 1, r: 1.8, active: true });
    });
}
world.outposts = outposts;

function openZone(z) {
    if (z.open) return;
    z.open = true;
    z.t = 0;
    for (const c of z.cols) c.active = false;
    for (let i = 0; i < 36; i++) burst(new THREE.Vector3(z.gx + (Math.random() - 0.5) * 5, 1, z.gz + (Math.random() - 0.5) * 5), COL.snow, 1, 4, 3);
    sound.chime();
    toast(`${z.icon} ${z.name} er åben.`);
}
function updateZones(dt) {
    for (const z of zones) {
        if (z.open && z.t >= 0 && z.t < 2.5 && z.drift) {
            z.t += dt;
            const k = 1 - Math.min(1, z.t / 2);
            z.drift.scale.y = Math.max(0.001, k);
            z.drift.position.y = -(1 - k) * 1.2;
            if (z.t >= 2.5) scene.remove(z.drift);
        }
        z.warnT -= dt;
        if (!z.open && z.warnT <= 0 && dist2({ x: z.gx, z: z.gz }, P.pos.x, P.pos.z) < 4 && S.control === 'player') {
            z.warnT = 10;
            toast(`${z.icon} ${z.name}: ${z.hint}`);
        }
    }
}
const GATE_NEED = { axe: 6 };   // hug (summeret med økse-power) før isvæggen falder

function toggleControl() {
    if (!S.started || S.over || S.paused || S.home) return;
    if (S.control === 'player') {
        S.control = 'dog';
        if (S.has.sled) siku.setState('follow');
        siku.vel.set(0, 0, 0);
        toast('🐕 Du styrer Siku. Tryk Q (eller 🐕) for at skifte tilbage. Arnarulunnguaq venter og fryser videre.');
    } else {
        S.control = 'player';
        siku.setState(S.has.sled ? 'harness' : 'follow');
    }
    document.body.classList.toggle('dogmode', S.control === 'dog');
    $('btn-dog').classList.toggle('on', S.control === 'dog');
}
bindButton('btn-dog', toggleControl);

const dogVel = new THREE.Vector3();
function controlDog(dt) {
    const m = moveInput();
    wish.set(0, 0, 0).addScaledVector(camRight, m.x).addScaledVector(camUp, m.y);
    const input = Math.min(1, wish.length());
    const spd = 7.4;
    const k = 1 - Math.exp(-10 * dt);
    dogVel.x += (wish.x * spd - dogVel.x) * k;
    dogVel.z += (wish.z * spd - dogVel.z) * k;
    siku.pos.x += dogVel.x * dt;
    siku.pos.z += dogVel.z * dt;
    collide(siku.pos, 0.25);
    const r = Math.hypot(siku.pos.x, siku.pos.z);
    if (r > W.WORLD_RADIUS) { siku.pos.x *= W.WORLD_RADIUS / r; siku.pos.z *= W.WORLD_RADIUS / r; }
    siku.pos.y = Math.max(0, W.groundHeight(siku.pos.x, siku.pos.z));
    const sp = Math.hypot(dogVel.x, dogVel.z);
    if (input > 0.1) siku.yaw = angleLerp(siku.yaw, Math.atan2(wish.x, wish.z), 1 - Math.exp(-14 * dt));
    siku.barkT -= dt;
    siku.stateT += dt;
    siku.hunger = Math.max(0, siku.hunger - dt * 0.16);
    siku.animate(dt, sp, G, { pant: sp > 3.5, sniff: 0 });
    siku.root.position.copy(siku.pos);
    siku.root.rotation.y = siku.yaw;
    siku.blob.position.set(siku.pos.x, siku.pos.y + 0.03, siku.pos.z);
    exploreMap.reveal(siku.pos.x, siku.pos.z, 12);
}

function dogInteraction() {
    const p = siku.pos;
    let best = null, bd = 1e9;
    for (const c of caches) {
        if (c.found) continue;
        const d = dist2(c, p.x, p.z);
        if (d < 2.4 && d < bd) { bd = d; best = { kind: 'dig', c, label: 'Grav', icon: '🐾' }; }
    }
    if (rope && !rope.pulled && dist2(rope, p.x, p.z) < 2.2) return { kind: 'pull', label: 'Træk i rebet', icon: '🪢' };
    if (best) return best;
    return { kind: 'bark', label: 'Gø', icon: '📢' };
}

function openZoneGateFor(z) {
    if (z.gate === 'axe') {
        z.hits += stat('axe', 'power', 1);
        wear('axe', 1);
        burst(new THREE.Vector3(z.gx, 1.5, z.gz), new THREE.Color('#bfe0ff'), 10, 3, 3);
        sound.chop();
        anim.play('chop');
        toast(`🪓 Isen revner… ${Math.min(GATE_NEED.axe, z.hits)}/${GATE_NEED.axe}`);
        if (z.hits >= GATE_NEED.axe) openZone(z);
    } else if (z.gate === 'cleats') {
        wear('cleats', 10);
        anim.play('craft');
        openZone(z);
    }
}

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
        if (!c.active || (c.minR && r < c.minR)) continue;   // minR: spærrer kun for større kroppe (sprækken)
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
                const chip = $('btn-inv');
                const r = chip.getBoundingClientRect();
                f.to = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                f.chip = chip;
            }
            const k = Math.min(1, (f.t - 0.5) / 0.55), e = k * k * (3 - 2 * k);
            const x = f.from.x + (f.to.x - f.from.x) * e, y = f.from.y + (f.to.y - f.from.y) * e - Math.sin(e * Math.PI) * 60;
            f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 - e * 0.45})`;
            f.el.style.opacity = String(1 - Math.max(0, k - 0.85) / 0.15);
            if (k >= 1) {
                if (f.chip) {
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
    if (e.code === 'KeyM') toggleMap();
    if (e.code === 'KeyQ') toggleControl();
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
    return ['panel-craft', 'panel-inv', 'panel-journal', 'panel-talk', 'panel-map', 'panel-chest'].some((id) => !$(id).classList.contains('hidden'));
}
function closePanels() {
    ['panel-craft', 'panel-inv', 'panel-talk', 'panel-map', 'panel-chest'].forEach((id) => $(id).classList.add('hidden'));
    S.bench = false;
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
        if (id === 'panel-map') renderMap();
        if (id === 'panel-chest') renderChest();
    }
}

function canAfford(r) {
    return Object.entries(r.cost).every(([k, v]) => S.inv[k] >= v);
}
function renderCraft() {
    const box = $('recipes');
    box.innerHTML = '';
    for (const r of RECIPES) {
        if (!S.known.has(r.id)) {
            if (!RECIPE_HINTS[r.id]) continue;
            const lock = document.createElement('div');
            lock.className = 'recipe locked';
            lock.innerHTML = `<div class="ic">❓</div><div class="txt"><div class="nm">Ukendt opskrift</div><div class="ds">${RECIPE_HINTS[r.id]}</div></div>`;
            box.appendChild(lock);
            continue;
        }
        const have = r.slot && S.owned[r.slot] ? cur(r.slot).tier : 0;
        const done = r.slot && have >= r.tier;
        const row = document.createElement('div');
        row.className = 'recipe' + (done ? ' done' : canAfford(r) ? ' ready' : '');
        const cost = Object.entries(r.cost).map(([k, v]) =>
            `<span class="${S.inv[k] >= v ? '' : 'miss'}">${ITEMS[k].icon} ${S.inv[k]}/${v}</span>`).join(' · ');
        const stats = r.st ? `<div class="stats">${STAT_LABEL(r.st)}${r.tier > 1 ? ` · tier ${r.tier}` : ''}</div>` : '';
        row.innerHTML = `<div class="ic">${r.icon}</div><div class="txt"><div class="nm">${r.name}</div>` +
            `<div class="ds">${r.desc}</div>${stats}<div class="cost">${cost}</div></div>`;
        const b = document.createElement('button');
        b.className = 'btn';
        b.textContent = done ? (S.has[r.slot] ? '✓ Har' : 'Itu') : have ? 'Opgradér' : 'Lav';
        b.disabled = done || !canAfford(r);
        b.addEventListener('click', () => { craft(r); renderCraft(); });
        row.appendChild(b);
        box.appendChild(row);
    }
}
function renderInv() {
    const box = $('inv-list');
    const keepScroll = box.scrollTop;
    box.innerHTML = '';
    const sec = (title) => {
        const h = document.createElement('div');
        h.className = 'bag-sec';
        h.textContent = title;
        box.appendChild(h);
    };
    const pct = (v) => Math.round(v * 100);

    // Karakterark
    const prot = pct(stat('anorak', 'insul') + stat('kamik', 'insul'));
    const spd = stat('kamik', 'speed', 1) * stat('sled', 'speed', 1);
    const sheet = document.createElement('div');
    sheet.className = 'bag-sheet';
    const vit = (ic, label, v) => `<div class="vit"><span>${ic}</span><b>${Math.round(v)}</b><small>${label}</small></div>`;
    sheet.innerHTML =
        `<div class="who"><div class="face">🧣</div><div><div class="nm">Arnarulunnguaq</div><div class="sub">Dag ${S.day} · ${S.weather === 'storm' ? 'storm' : 'klar'}</div></div></div>` +
        `<div class="vits">${vit('❤️', 'helbred', S.health)}${vit('🔥', 'varme', S.warmth)}${vit('🍖', 'mæthed', S.food)}</div>` +
        `<div class="derived"><span>🧥 kuldeværn <b>${prot}%</b></span><span>⚡ fart <b>×${spd.toFixed(2)}</b></span>` +
        `<span>🎯 fangst <b>${S.has.harpoon ? 85 + pct(stat('harpoon', 'hit')) : '–'}${S.has.harpoon ? '%' : ''}</b></span>` +
        `<span>⛏ hug <b>${S.has.axe ? stat('axe', 'power') : '–'}</b></span></div>`;
    box.appendChild(sheet);

    if (S.bench) {
        const q = document.createElement('div');
        q.className = 'bag-quest';
        q.innerHTML = '<b>🔧 Arbejdsbænken</b> Reparationer koster det halve herhjemme.';
        box.appendChild(q);
    }
    const goal = goalText(S);
    if (goal) {
        const q = document.createElement('div');
        q.className = 'bag-quest';
        q.innerHTML = `<b>📋 Opgave</b> ${goal}`;
        box.appendChild(q);
    }

    // Udstyr
    const owned = Object.keys(GEAR).filter((k) => S.owned[k]);
    sec('Udstyr');
    if (!owned.length) {
        const e = document.createElement('div');
        e.className = 'bag-empty';
        e.textContent = 'Intet endnu – lav noget under 🔨 Byg.';
        box.appendChild(e);
    }
    for (const k of owned) {
        const g = GEAR[k], v = cur(k), d = Math.max(0, Math.ceil(S.dur[k]));
        const row = document.createElement('div');
        row.className = 'gear-tile' + (S.has[k] ? '' : ' broken');
        const p = pct(Math.max(0, S.dur[k]) / v.st.max);
        row.innerHTML = `<div class="gic">${v.icon}<i class="tier">${'●'.repeat(v.tier)}</i></div>` +
            `<div class="gtx"><div class="gnm">${v.name}</div><div class="gst">${STAT_LABEL({ ...v.st, max: 0 })}</div>` +
            `<div class="dur"><i style="width:${p}%"></i></div>` +
            `<div class="gdu">${S.has[k] ? `${d} ${g.unit} tilbage` : 'Itu – skal repareres'}</div></div>`;
        if (S.dur[k] < v.st.max) {
            const cost = repairCost(k);
            const b = document.createElement('button');
            b.className = 'btn';
            b.innerHTML = `Reparér<small>${Object.entries(cost).map(([c, n]) => `${ITEMS[c].icon}${n}`).join(' ')}</small>`;
            b.disabled = !Object.entries(cost).every(([c, n]) => S.inv[c] >= n);
            b.addEventListener('click', () => { repair(k); renderInv(); });
            row.appendChild(b);
        }
        box.appendChild(row);
    }

    // Rygsækkens indhold: ting i felter, tallet i hjørnet
    sec('Rygsæk');
    const grid = document.createElement('div');
    grid.className = 'bag-grid';
    for (const [k, it] of Object.entries(ITEMS)) {
        const n = S.inv[k];
        const cell = document.createElement('div');
        cell.className = 'cell' + (n > 0 ? '' : ' empty');
        cell.innerHTML = `<div class="ic">${it.icon}</div><div class="cnt">${n}</div><div class="nm">${it.name}</div>`;
        if (n > 0 && (it.food || k === 'meat' || k === 'cooked')) {
            const act = document.createElement('div');
            act.className = 'acts';
            if (it.food) {
                const b = document.createElement('button');
                b.textContent = 'Spis';
                b.addEventListener('click', () => { eat(k); renderInv(); });
                act.appendChild(b);
            }
            if (k === 'meat' || k === 'cooked') {
                const b = document.createElement('button');
                b.textContent = 'Siku';
                b.title = 'Giv til Siku';
                b.addEventListener('click', () => { S.inv[k]--; siku.feed(G); renderInv(); });
                act.appendChild(b);
            }
            cell.appendChild(act);
        }
        grid.appendChild(cell);
    }
    box.appendChild(grid);

    const sk = document.createElement('div');
    sk.className = 'bag-dog';
    sk.innerHTML = `🐕 <b>Siku</b> – ${siku.mood || 'hviler'} · mæthed ${Math.round(siku.hunger)}% · tillid ${Math.round(siku.love)}%`;
    box.appendChild(sk);
    box.scrollTop = keepScroll;
}

/** Reparationspris. Hjemmets arbejdsbænk (senere fase) halverer den. */
function repairCost(k) {
    if (!S.bench) return GEAR[k].fix;
    return Object.fromEntries(Object.entries(GEAR[k].fix).map(([c, v]) => [c, Math.max(1, Math.ceil(v / 2))]));
}

function repair(k) {
    const cost = repairCost(k);
    if (!S.owned[k] || !Object.entries(cost).every(([c, v]) => S.inv[c] >= v)) return;
    for (const [c, v] of Object.entries(cost)) S.inv[c] -= v;
    S.dur[k] = cur(k).st.max;
    S.has[k] = true;
    applyGear();
    sound.craft();
    anim.play('craft');
    toast(`${cur(k).icon} ${cur(k).name} er repareret.`);
}

/** Slider udstyr. Går det i stykker, virker det ikke, før det er repareret. */
function wear(k, amt) {
    if (!S.has[k] || S.over) return;
    S.dur[k] -= amt;
    if (S.dur[k] <= 0) {
        S.dur[k] = 0;
        S.has[k] = false;
        applyGear();
        sound.hurt();
        toast(`${cur(k).icon} ${cur(k).name} er itu! Reparér den i Tasken (🧵 sener).`);
    } else if (S.dur[k] / cur(k).st.max < 0.2 && !S.wearWarn?.[k]) {
        (S.wearWarn ||= {})[k] = true;
        toast(`${cur(k).icon} ${cur(k).name} er ved at være slidt.`);
    }
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
// Hjemmet: iglo-interiør. Man kan ikke dø derinde; sengen springer til morgen, bænken reparerer til halv pris.
// ---------------------------------------------------------------------------
function iglooDoor(ig) {
    const rot = ig.obj.group.rotation.y;
    return { x: ig.x + Math.sin(rot) * 3.5, z: ig.z + Math.cos(rot) * 3.5, rot };
}
function enterHome(ig) {
    S.home = true;
    S.homeIgloo = ig;
    if (S.control === 'dog') toggleControl();
    closePanels();
    home.scene.add(player.group, pBlob, siku.root, siku.blob, hl.m);
    P.pos.set(home.spawn.x, 0, home.spawn.z);
    P.vel.set(0, 0, 0);
    P.yaw = Math.PI;
    P.speed = 0;
    siku.pos.set(home.dogSpot.x, 0, home.dogSpot.z);
    siku.yaw = 0.8;
    camTarget.copy(P.pos);
    post.uniforms.uFade.value = 1;
    document.body.classList.add('inhome');
    sound.chime();
    toast('🏠 Du er hjemme. Her kan intet nå dig – hvil, reparér og pak din rygsæk om.');
}
function exitHome() {
    const ig = S.homeIgloo, d = iglooDoor(ig);
    S.home = false;
    scene.add(player.group, pBlob, siku.root, siku.blob, hl.m);
    const ox = Math.sin(d.rot) * 1.2, oz = Math.cos(d.rot) * 1.2;
    P.pos.set(d.x + ox, Math.max(0, W.groundHeight(d.x + ox, d.z + oz)), d.z + oz);
    P.vel.set(0, 0, 0);
    siku.pos.set(d.x + ox * 1.8, 0, d.z + oz * 1.8);
    siku.setState('follow');
    camTarget.copy(P.pos);
    post.uniforms.uFade.value = 1;
    document.body.classList.remove('inhome');
}
function sleepUntilMorning() {
    const target = 0.27;
    const skipped = ((target - S.t + 1) % 1) * DAY_LEN;
    const newDay = S.t > target;
    S.t = target;
    S.night = 0;
    if (newDay) { S.day++; S.burstDone = false; rollAurora(); }
    // Det, der brændte imens, er brændt: fakler og bål
    for (const h of heaters) {
        if (h.camp || !h.lit) continue;
        h.fuel -= skipped * 0.6;
        if (h.fuel <= 0) { h.lit = false; h.obj.flames.visible = false; if (h.obj.glow) h.obj.glow.visible = false; if (h.kind === 'torch') h.obj.head.material.color.set('#15100c'); }
    }
    S.warmth = 100;
    S.food = Math.max(12, S.food - skipped * 0.09);
    S.health = Math.min(100, S.health + 35);
    siku.hunger = Math.max(15, siku.hunger - skipped * 0.04);
    S.storm = Math.max(0, S.storm - 0.5);
    post.uniforms.uFade.value = 1;
    dayCard(`Dag ${S.day}`, newDay ? 'Du vågner udhvilet' : 'Du sov lidt og vågner igen');
}
function homeInteraction() {
    const p = P.pos;
    // Det nærmeste (efter rækkevidde) vinder, så tætte genstande ikke skygger for hinanden
    const cands = [
        [home.door, 2.1, { kind: 'exit', label: 'Gå ud', icon: '🚪' }],
        [home.bench, 2.3, { kind: 'sleep', label: 'Sov til morgen', icon: '😴' }],
        [home.work, 1.7, { kind: 'bench', label: 'Arbejdsbænk · reparér', icon: '🔧' }],
        [home.chest, 1.7, { kind: 'chest', label: 'Åbn kisten', icon: '📦' }],
        [siku.pos, 1.9, { kind: 'pet', label: 'Klap Siku', icon: '🐕' }],
    ];
    let best = null, bd = 1e9;
    for (const [o, r, it] of cands) {
        const d = dist2(o, p.x, p.z) - r;
        if (d < 0 && d < bd) { bd = d; best = it; }
    }
    return best || { kind: 'none', label: '—', icon: '✋', disabled: true };
}

// Kisten: læg ting væk, tag dem ud igen
function renderChest() {
    const box = $('chest-list');
    box.innerHTML = '';
    for (const [k, it] of Object.entries(ITEMS)) {
        const inBag = S.inv[k], inChest = S.chest[k] || 0;
        const row = document.createElement('div');
        row.className = 'chest-row' + (inBag || inChest ? '' : ' empty');
        row.innerHTML = `<div class="ic">${it.icon}</div><div class="nm">${it.name}</div><b class="a">${inBag}</b>`;
        const mv = (label, n, fromBag) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.disabled = fromBag ? inBag <= 0 : inChest <= 0;
            b.addEventListener('click', () => {
                const q = Math.min(n, fromBag ? S.inv[k] : (S.chest[k] || 0));
                S.inv[k] += fromBag ? -q : q;
                S.chest[k] = (S.chest[k] || 0) + (fromBag ? q : -q);
                renderChest();
            });
            return b;
        };
        row.append(mv('⇒ alt', 999, true), mv('→', 1, true), mv('←', 1, false), mv('alt ⇐', 999, false));
        const c = document.createElement('b');
        c.className = 'c';
        c.textContent = inChest;
        row.appendChild(c);
        box.appendChild(row);
    }
}

function showNote(title, text, quote = true) {
    sound.chime();
    $('j-title').textContent = title;
    $('j-text').textContent = quote ? '“' + text + '”' : text;
    closePanels();
    $('panel-journal').classList.remove('hidden');
    S.paused = true;
    actionHeld = false;
}
function discoverPoi(p) {
    const d0 = p.def;
    // Hvalbuen gemmer Ukaleqs kortskind — først når hun har bedt om det
    if (d0.id === 'whale_arch' && S.q.map < 2) {
        if (S.q.map === 0) {
            showNote(d0.title, 'Under ribbenene er der noget gemt i sneen, men du ved ikke, hvad du leder efter. Måske kan Ukaleq i lejren fortælle det.', false);
            return;
        }
        S.q.map = 2;
        p.found = true;
        S.found[d0.id] = true;
        exploreMap.reveal(p.x, p.z, 12);
        showNote(d0.title, 'Under ribbenene, i en pakke af sælskind bundet med sene, ligger fangstkassen. Indeni: et kortskind, rullet sammen. Kun kysten er tegnet. Du lægger det i rygsækken og tager det med til Ukaleq.', false);
        return;
    }
    p.found = true;
    S.found[d0.id] = true;
    p.g.scale.setScalar(1);
    exploreMap.reveal(p.x, p.z, 12);
    const d = p.def;
    let extra = '';
    for (const [k, v] of Object.entries(d.reward || {})) { S.inv[k] += v; extra += ` ${ITEMS[k].icon}${v}`; }
    if (d.recipe && !S.known.has(d.recipe)) { talkCtx.learn(d.recipe); extra += ` 📖 ${RBY[d.recipe].name}`; }
    showNote(d.title, d.text + (extra ? `\n\nDu tager med:${extra}` : '') + (S.hasMap ? '\n\n📍 Stedet er mærket på kortet.' : ''), false);
}

// Kortet
function mapMarks() {
    const m = [];
    if (world.camp && exploreMap.isSeen(world.camp.x, world.camp.z)) m.push({ x: world.camp.x, z: world.camp.z, icon: '⛺', label: 'Lejren', big: true });
    for (const c of cairns) {
        if (c.found) m.push({ x: c.x, z: c.z, icon: '🗿', label: 'Varde', color: '#e0a82e' });
        else if (exploreMap.isSeen(c.x, c.z)) m.push({ x: c.x, z: c.z, icon: '❔', label: 'Varde?' });
    }
    for (const p of pois) if (p.found) m.push({ x: p.x, z: p.z, icon: p.def.icon, label: p.def.name, color: p.def.kind === 'trace' ? '#8a6a3a' : '#3a7a8a' });
    for (const z of zones) if (exploreMap.isSeen(z.x, z.z)) m.push({ x: z.x, z: z.z, icon: z.icon, label: z.name + (z.open || z.gate === 'crack' ? '' : ' 🔒'), big: true });
    for (const c of caches) if (c.found) m.push({ x: c.x, z: c.z, icon: '📖', label: 'Depot' });
    if (!FUN.open && exploreMap.isSeen(FUN.gate.x, FUN.gate.z)) m.push({ x: FUN.gate.x, z: FUN.gate.z, icon: '🚧', label: 'Snedrive' });
    return m;
}
function renderMap() {
    const cv = $('map-cv');
    cv.width = cv.height = 640;
    exploreMap.draw(cv, mapMarks(), { x: P.pos.x, z: P.pos.z, yaw: P.yaw });
    const f = pois.filter((q) => q.found).length;
    $('map-key').textContent = `Udforsket ${Math.round(exploreMap.fraction * 100)} % · Fund ${f} · Varder ${S.cairnsFound}/${cairns.length}`;
}
function toggleMap() {
    if (!S.hasMap) { toast('Du har intet kort endnu. Ukaleq i lejren har et.'); return; }
    togglePanel('panel-map');
}
bindButton('btn-map', toggleMap);

// ---------------------------------------------------------------------------
// Samtaler
// ---------------------------------------------------------------------------
const talkCtx = {
    S,
    name: (k) => ITEMS[k].name.toLowerCase(),
    has: (o) => Object.entries(o).every(([k, v]) => S.inv[k] >= v),
    take: (o) => { for (const [k, v] of Object.entries(o)) S.inv[k] -= v; },
    give: (o) => { for (const [k, v] of Object.entries(o)) S.inv[k] += v; },
    dogLove: () => siku.love,
    giveMap: () => {
        S.hasMap = true;
        $('btn-map').classList.remove('hidden');
        exploreMap.reveal(P.pos.x, P.pos.z, 22);
        toast('🗺 Du fik et kort! Åbn det med 🗺 eller M – det fyldes ud, mens du udforsker.');
    },
    learn: (id) => {
        S.known.add(id);
        const r = RECIPES.find((x) => x.id === id);
        sound.chime();
        toast(`📖 Ny opskrift: ${r.name}`);
    },
};
let talking = null;
function openTalk(npc) {
    closePanels();
    talking = npc;
    $('panel-talk').classList.remove('hidden');
    $('backdrop').classList.remove('hidden');
    S.paused = true;
    actionHeld = false;
    renderTalk(talk(npc.id, talkCtx));
}
function renderTalk(node) {
    const d = talking.def;
    $('t-name').innerHTML = `<span class="face">${d.icon}</span>${d.name}`;
    $('t-role').textContent = d.role;
    $('t-text').innerHTML = node.lines.map((l) => `<p>${l}</p>`).join('');
    const box = $('t-opts');
    box.innerHTML = '';
    for (const o of node.options) {
        const b = document.createElement('button');
        b.className = 'btn talkopt';
        b.textContent = o.label;
        b.disabled = !!o.disabled;
        b.addEventListener('click', () => {
            const next = o.act && o.act();
            if (next) renderTalk(next); else closePanels();
        });
        box.appendChild(b);
    }
}

// ---------------------------------------------------------------------------
// Byg / sy
// ---------------------------------------------------------------------------
function frontSpot(d) {
    return new THREE.Vector3(P.pos.x + Math.sin(P.yaw) * d, 0, P.pos.z + Math.cos(P.yaw) * d);
}

function placeHeater(kind, x, z) {
    const obj = kind === 'fire' ? W.makeFire() : kind === 'torch' ? W.makeTorch() : W.makeQulliq();
    const y = Math.max(0, W.groundHeight(x, z));
    obj.group.position.set(x, y, z);
    scene.add(obj.group);
    popIn(obj.group);
    const collider = { x, z, r: kind === 'fire' ? 0.55 : kind === 'torch' ? 0.22 : 0.35, active: true };
    colliders.push(collider);
    heaters.push({ kind, x, z, y, obj, lit: true, fuel: kind === 'fire' ? 150 : kind === 'torch' ? TORCH_FUEL : 420, collider });
}

function craft(r) {
    if (!canAfford(r) || (r.slot && S.owned[r.slot] && cur(r.slot).tier >= r.tier)) return;
    for (const [k, v] of Object.entries(r.cost)) S.inv[k] -= v;
    sound.craft();
    anim.play('craft');
    if (r.id === 'fire') {
        const s = frontSpot(1.7);
        placeHeater('fire', s.x, s.z);
        S.builtFire = true;
        toast('🔥 Bålet knitrer. Bliv tæt på det for at holde varmen.');
    } else if (r.id === 'torch') {
        const s = frontSpot(1.2);
        placeHeater('torch', s.x, s.z);
        toast('🏮 Fakkelen lyser op. Den brænder ud med tiden – en fakkelbrand tænder den igen.');
    } else if (r.id === 'tinder') {
        for (const [k, v] of Object.entries(r.makes)) S.inv[k] += v;
        toast('🕯️ To fakkelbrande, klar til brug.');
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
        const upgrade = S.owned[r.slot];
        S.equip[r.slot] = r.id;
        S.has[r.slot] = true;
        S.owned[r.slot] = true;
        S.dur[r.slot] = r.st.max;
        applyGear();
        toast(`${r.icon} ${upgrade ? 'Opgraderet: ' : ''}${r.name} er klar. ${STAT_LABEL({ ...r.st, max: 0 })}`);
    }
    floatText(r.icon, P.pos, '#fff', true);
}

const ORIG = { boots: player.mats.boots.color.clone(), coat: player.mats.coat.color.clone(), pants: player.mats.pants.color.clone() };
function applyGear() {
    player.harpoon.visible = S.has.harpoon;
    player.mats.boots.color.copy(ORIG.boots);
    player.mats.coat.color.copy(ORIG.coat);
    player.mats.pants.color.copy(ORIG.pants);
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
    } else if (!S.has.sled && sled.visible) {
        sled.visible = false;
        traces.visible = false;
        for (const d of teamDogs) scene.remove(d.root, d.blob);
        teamDogs.length = 0;
    }
}

// ---------------------------------------------------------------------------
// Handling
// ---------------------------------------------------------------------------
function getInteraction() {
    if (S.home) return homeInteraction();
    if (S.control === 'dog') return dogInteraction();
    const p = P.pos;
    for (const ig of igloos) {
        const d = iglooDoor(ig);
        if (dist2(d, p.x, p.z) < 2.1) return { kind: 'enter', ig, label: 'Gå ind i hjemmet', icon: '🏠' };
    }
    for (const z of zones) {
        if (z.open || z.gate === 'crack' || z.gate === 'rope') continue;
        if (dist2({ x: z.gx, z: z.gz }, p.x, p.z) > 3.4) continue;
        if (z.gate === 'axe') return S.has.axe ? { kind: 'gate', z, label: 'Hug i isvæggen', icon: '🪓' } : { kind: 'none', label: 'Isvæg – kræver økse', icon: '🪓', disabled: true };
        return S.has.cleats ? { kind: 'gate', z, label: 'Kravl op med isbrodder', icon: '🦶' } : { kind: 'none', label: 'Stejl is – kræver isbrodder', icon: '🦶', disabled: true };
    }
    let best = null, bestD = 1e9;
    const consider = (d, o) => { if (d < bestD) { bestD = d; best = o; } };
    if (S.has.harpoon) {
        const RG = stat('harpoon', 'range', 1);
        for (const b of bears) { const d = dist2(b.pos, p.x, p.z); if (d < 7 * RG) consider(d - 4, { kind: 'bear', b, label: 'Skræm isbjørnen', icon: '🔱' }); }
        for (const s of seals) { if (s.state === 'up') { const d = dist2(s.hole, p.x, p.z); if (d < 6.5 * RG) consider(d, { kind: 'seal', s, label: 'Harpunér sælen', icon: '🔱' }); } }
        for (const h of hares) { if (h.alive) { const d = dist2(h.pos, p.x, p.z); if (d < 7 * RG) consider(d, { kind: 'hare', h, label: 'Harpunér haren', icon: '🔱' }); } }
        if (best) return best;
    }
    for (const q of pois) {
        if (q.found) continue;
        const d = dist2(q, p.x, p.z);
        if (d < 2.6) consider(d - 1, { kind: 'poi', p: q, label: q.def.kind === 'trace' ? 'Undersøg sporene' : 'Se nærmere', icon: '🔍' });
    }
    for (const n of npcs) {
        const d = dist2(n, p.x, p.z);
        if (d < 3) consider(d - 1.5, { kind: 'talk', n, label: `Tal med ${n.def.name}`, icon: '💬' });
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
        } else if (h.kind === 'torch') {
            if (S.inv.brand > 0 && h.fuel < 150) consider(d, { kind: 'torchfuel', h, label: h.lit ? 'Tilsæt brand (1 🕯️)' : 'Tænd fakkel (1 🕯️)', icon: '🕯️' });
            else if (!h.lit) consider(d + 0.4, { kind: 'torchpick', h, label: 'Tag den udbrændte fakkel', icon: '🪵' });
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
    wear('harpoon', 1);
    setTimeout(() => sound.whoosh(), 200);
}

function killHare(h) {
    S.stats.hares++;
    h.alive = false;
    h.m.visible = false;
    h.respawn = 50 + Math.random() * 30;
    burst(h.pos, COL.snow, 8);
}

function doAction(it) {
    if (it.disabled) return;
    actionCD = 0.4;
    const ANIM = { torchfuel: 'tend', torchpick: 'gather', poi: 'read', cook: 'tend', fuel: 'tend', relight: 'tend', refill: 'tend', cairn: 'read', snow: 'cut', pet: 'pet', feed: 'pet' };
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
        case 'torchfuel': {
            S.inv.brand--;
            const h = it.h;
            h.fuel = Math.min(TORCH_FUEL + 40, h.fuel + TORCH_FUEL);
            h.lit = true;
            h.obj.flames.visible = true;
            h.obj.head.material.color.set('#3a2515');
            burst(new THREE.Vector3(h.x, 1.8, h.z), COL.ember, 8);
            sound.crackle();
            break;
        }
        case 'torchpick': {
            const h = it.h;
            scene.remove(h.obj.group);
            h.collider.active = false;
            heaters.splice(heaters.indexOf(h), 1);
            gain('wood', 1, new THREE.Vector3(h.x, 1, h.z));
            break;
        }
        case 'talk': openTalk(it.n); break;
        case 'poi': discoverPoi(it.p); break;
        case 'enter': enterHome(it.ig); break;
        case 'exit': exitHome(); break;
        case 'sleep': sleepUntilMorning(); actionCD = 2; break;
        case 'bench': S.bench = true; togglePanel('panel-inv'); break;
        case 'chest': togglePanel('panel-chest'); break;
        case 'gate': openZoneGateFor(it.z); actionCD = 0.7; break;
        case 'bark': siku.bark(G, '📢'); actionCD = 1; break;
        case 'pull': {
            rope.pulled = true;
            siku.digT = 1.3;
            sound.bark();
            floatText('🪢', siku.pos, '#fff', true);
            const bz = zones.find((q) => q.id === 'bird');
            if (bz) setTimeout(() => { openZone(bz); toast('🪢 Rebet strammer – en snedrive løsner sig et sted bag dig.'); }, 700);
            break;
        }
        case 'dig': {
            const c = it.c;
            c.found = true;
            S.found[c.id] = true;
            siku.digT = 1.3;
            actionCD = 1.3;
            setTimeout(() => {
                scene.remove(c.g);
                burst(new THREE.Vector3(c.x, 0.4, c.z), COL.snow, 18, 3, 3);
                let extra = '';
                for (const [k, v] of Object.entries(c.reward || {})) { S.inv[k] += v; extra += ` ${ITEMS[k].icon}${v}`; }
                if (!S.known.has(c.recipe)) { talkCtx.learn(c.recipe); extra += ` 📖 ${RBY[c.recipe].name}`; }
                exploreMap.reveal(c.x, c.z, 12);
                showNote(c.title, c.text + `\n\nDu tager med:${extra}` + (S.hasMap ? '\n\n📍 Stedet er mærket på kortet.' : ''), false);
            }, 900);
            break;
        }
        case 'snow':
            actionCD = 0.6;
            wear('knife', 1);
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
                if (s.state === 'up' && Math.random() < 0.85 + stat('harpoon', 'hit')) {
                    S.stats.seals++;
                    s.state = 'gone';
                    s.timer = 45;
                    const pos = new THREE.Vector3(s.hole.x, 0, s.hole.z);
                    gain('meat', 2, pos);
                    setTimeout(() => gain('blubber', 2, pos), 250);
                    setTimeout(() => gain('hide', 1, pos), 500);
                    setTimeout(() => gain('sinew', 2, pos), 750);
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
                if (h.alive && Math.random() < 0.75 + stat('harpoon', 'hit') && dist2(h.pos, P.pos.x, P.pos.z) < 8.5 * stat('harpoon', 'range', 1)) {
                    killHare(h);
                    gain('meat', 1, h.pos);
                    setTimeout(() => gain('hide', 1, h.pos), 250);
                    setTimeout(() => gain('sinew', 1, h.pos), 500);
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
    const m = S.control === 'dog' ? { x: 0, y: 0 } : moveInput();
    wish.set(0, 0, 0).addScaledVector(camRight, m.x).addScaledVector(camUp, m.y);
    const input = wish.length();
    const gh = W.groundHeight(P.pos.x, P.pos.z);
    P.onIce = !S.home && gh < 0.05;
    let spd = 4.3 * stat('kamik', 'speed', 1) * stat('sled', 'speed', 1);
    if (S.health < 25) spd *= 0.8;
    if (input > 0.01) {
        const head = -wish.dot(S.wind) / (S.wind.length() + 1e-6) / input;
        spd *= 1 - S.storm * 0.35 * Math.max(0, head) * (1 - stat('anorak', 'storm'));
    }
    const accel = P.onIce && !S.has.sled ? 1.7 : 11;
    const k = 1 - Math.exp(-accel * dt);
    P.vel.x += (wish.x * spd - P.vel.x) * k;
    P.vel.z += (wish.z * spd - P.vel.z) * k;
    const wk = S.home ? 0 : 1;
    P.pos.x += (P.vel.x + S.wind.x * S.storm * 0.06 * wk) * dt;
    P.pos.z += (P.vel.z + S.wind.z * S.storm * 0.06 * wk) * dt;
    if (S.home) home.constrain(P.pos, 0.42); else collide(P.pos, 0.42);
    const r = Math.hypot(P.pos.x, P.pos.z);
    if (!S.home && r > W.WORLD_RADIUS) {
        P.pos.x *= W.WORLD_RADIUS / r;
        P.pos.z *= W.WORLD_RADIUS / r;
        if (!S.edgeWarn) { toast('Pakisen er brækket op foran dig. Der er intet at hente herude – vend om.'); S.edgeWarn = true; }
    }
    P.pos.y = Math.max(0, W.groundHeight(P.pos.x, P.pos.z));
    P.speed = Math.hypot(P.vel.x, P.vel.z);
    if (P.speed > 0.5) { wear('kamik', dt * (P.onIce ? 1.5 : 1)); if (S.has.sled && P.speed > 1) wear('sled', dt); }
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
    if (!S.home && !S.has.sled && stepIdx !== P.lastStep && P.speed > 0.6 && P.slide < 0.5) {
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
const NPC_CTX = { speed: 0, onIce: false, sled: false, idle: 5, cold: 0, fire: 0.55, storm: 0, windSide: 0, sliding: 0, turn: 0, dead: false };
function updateNpcs(dt) {
    for (const n of npcs) {
        const near = dist2(n, P.pos.x, P.pos.z) < 6;
        const tx = near ? P.pos.x : n.fireAt.x, tz = near ? P.pos.z : n.fireAt.z;
        n.yaw = angleLerp(n.yaw, Math.atan2(tx - n.x, tz - n.z), 1 - Math.exp(-3 * dt));
        n.rig.group.rotation.y = n.yaw;
        NPC_CTX.fire = near ? 0.2 : 0.6;
        NPC_CTX.storm = S.sheltered ? 0 : S.storm * 0.5;
        n.anim.update(dt, NPC_CTX);
    }
}

function updateTeam(dt) {
    if (S.home) {
        siku.pos.set(home.dogSpot.x, 0, home.dogSpot.z);
        siku.stateT += dt; siku.barkT -= dt;
        siku.animate(dt, 0, G, { lie: 1 });
        siku.root.position.copy(siku.pos);
        siku.root.rotation.y = siku.yaw;
        siku.blob.position.set(siku.pos.x, 0.03, siku.pos.z);
        return;
    }
    const G2 = G;
    if (S.control === 'dog') controlDog(dt); else siku.update(dt, G2);
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
            wear('anorak', 25);
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
        if (!h.camp) h.fuel -= dt;
        const fl = h.obj.flames;
        if (h.fuel <= 0) {
            h.lit = false;
            fl.visible = false;
            if (h.obj.glow) h.obj.glow.visible = false;
            if (dist2(h, P.pos.x, P.pos.z) < 20) toast(h.kind === 'fire' ? 'Bålet er gået ud.' : h.kind === 'torch' ? '🏮 En fakkel er brændt ud.' : 'Lampen er brændt ud.');
            if (h.kind === 'torch') h.obj.head.material.color.set('#15100c');
            continue;
        }
        if (h.obj.glow) h.obj.glow.visible = true;
        const low = h.kind === 'fire' ? clamp(h.fuel / 40, 0.4, 1) : h.kind === 'torch' ? clamp(h.fuel / 25, 0.45, 1) : 1;
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
    if (S.home) {
        S.sheltered = true;
        S.warmth = clamp(S.warmth + 6 * dt, 0, 100);
        S.food = Math.max(5, S.food - dt * 0.05);
        S.health = clamp(S.health + 1.2 * dt, 0, 100);
        return;
    }
    let heat = 0;
    for (const h of heaters) {
        if (!h.lit) continue;
        const d = dist2(h, P.pos.x, P.pos.z);
        const R = h.kind === 'fire' ? 6 : h.kind === 'torch' ? 3.2 : 4.5;
        if (d < R) heat += (1 - d / R) * (h.kind === 'fire' ? 9 : h.kind === 'torch' ? 2.5 : 5);
    }
    S.sheltered = igloos.some((i) => dist2(i, P.pos.x, P.pos.z) < 2.0);
    if (S.storm > 0.3 && !S.sheltered) wear('anorak', dt * S.storm);
    const dogWarm = siku.state === 'warm' && siku.lie > 0.7 ? 0.5 : 0;
    const cold = 0.3 + S.night * 0.42 + S.storm * 1.4 * (S.sheltered ? 0 : 1) + (P.onIce ? 0.1 : 0);
    const insul = 1 - stat('anorak', 'insul') - stat('kamik', 'insul');
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

/** Nordlyset kommer ikke hver nat: ca. hver anden-tredje, og aldrig mere end tre tørre nætter i træk. Første nat er altid mørk. */
function rollAurora() {
    const first = S.day <= 1;
    S.auroraNight = !first && (S.dryNights >= 3 || Math.random() < 0.4);
    S.dryNights = S.auroraNight ? 0 : S.dryNights + 1;
}
rollAurora();
function updateClock(dt) {
    const before = S.t;
    S.t = (S.t + dt / DAY_LEN) % 1;
    if (before > 0.5 && S.t <= 0.5 && S.t > 0.4) { /* middag */ }
    if (before > S.t) {
        S.day++;
        S.burstDone = false;
        rollAurora();
        dayCard(`Dag ${S.day}`, 'Morgenen gryr over isen');
    }
    if (S.night > 0.6 && S.nightCardDay !== S.day && S.started) {
        S.nightCardDay = S.day;
        dayCard('Natten falder på', S.auroraNight ? 'Himlen er klar – nordlyset kan komme' : 'En mørk og stille nat – hold varmen', `Dag ${S.day}`);
    }
    // Nordlys
    S.auroraRetarget -= dt;
    if (S.auroraRetarget <= 0) {
        S.auroraRetarget = 15 + Math.random() * 10;
        S.auroraTarget = 0.45 + Math.random() * 0.65;
    }
    S.burst = Math.max(0, S.burst - dt);
    if (S.auroraNight && S.night > 0.8 && !S.burstDone && S.storm < 0.3 && Math.random() < dt / 35) {
        S.burstDone = true;
        S.burst = 22;
        toast('✨ Nordlyset danser – se det spejle sig i isen!');
    }
    const target = !S.auroraNight ? 0 : S.burst > 0 ? 2 : S.auroraTarget;
    S.aurora += (target - S.aurora) * Math.min(1, dt * (target > S.aurora ? 0.4 : 0.8));
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
        const fp = S.control === 'dog' ? siku.pos : P.pos, fv = S.control === 'dog' ? dogVel : P.vel;
        camGoal.set(fp.x + clamp(fv.x * la, -3, 3), fp.y, fp.z + clamp(fv.z * la, -3, 3));
        if (S.home) camGoal.set(home.center.x + (P.pos.x - home.center.x) * 0.3, 0, home.center.z + (P.pos.z - home.center.z) * 0.3 + 0.8);
        S.camBlend = Math.min(1, (S.camBlend || 0) + dt * 0.5);
        camTarget.lerp(camGoal, 1 - Math.exp(-(1 + S.camBlend * 3) * dt));
    }
    const zoomGoal = S.home ? 0.72 : S.has.sled && P.speed > 3 ? 1.15 : 1;
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
        if (i === 0 && FIRE_SHADOWS) { const want = !!h && dist2(h, P.pos.x, P.pos.z) < 15; if (l.castShadow !== want) l.castShadow = want; }
        if (!h) { l.intensity = 0; fu.w = 0; return; }
        const fk = 1 + Math.sin(S.time * 17 + i) * 0.1 + Math.sin(S.time * 29 + h.x) * 0.08 + Math.sin(S.time * 7.3 + i) * 0.06;
        const low = h.kind === 'fire' ? clamp(h.fuel / 40, 0.35, 1) : h.kind === 'torch' ? clamp(h.fuel / 25, 0.4, 1) : 1;
        const T = h.kind === 'torch';
        l.position.set(h.x, h.y + (h.kind === 'fire' ? 1 : T ? 1.8 : 0.6), h.z);
        l.intensity = (h.kind === 'fire' ? 14 : T ? 8 : 5) * fk * low * (0.6 + S.night * 0.6);
        l.color.set(h.kind === 'fire' ? '#ff8a3a' : T ? '#ffa24a' : '#ffb766');
        fu.set(h.x, h.y + (T ? 1.6 : 0.8), h.z, (h.kind === 'fire' ? 3 : T ? 1.8 : 1.2) * fk * low);
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
/** Hvor pilen peger, mens en opgave er aktiv. */
function questTarget() {
    const camp = world.camp ? { x: world.camp.x, z: world.camp.z, label: 'lejren' } : null;
    const m = S.q.map;
    if (m === 0 || m === 2 || m === 4) return camp;
    if (m === 1) { const w = pois.find((q) => q.def.id === 'whale_arch'); return w ? { x: w.x, z: w.z, label: 'hvalbuen' } : camp; }
    if (m === 3) return { x: FUN.gate.x, z: FUN.gate.z, label: 'passet' };
    if (S.q.ittu === 1) { const z = zones.find((q) => q.id === 'thin'); return z ? { x: z.x, z: z.z, label: 'tyndisen' } : null; }
    if (S.q.ittu === 2) { const z = zones.find((q) => q.id === 'bird'); return z ? { x: z.x, z: z.z, label: 'fuglefjeldet' } : null; }
    const tn = targetNpc(S);
    if (tn === 'ukaleq') return camp;
    if (tn && outposts[tn]) return { x: outposts[tn].x, z: outposts[tn].z, label: NPC_DEFS[tn].name.toLowerCase() };
    return null;
}
function campDist() {
    return world.camp ? Math.round(dist2(world.camp, P.pos.x, P.pos.z)) : 0;
}
function objective() {
    const I = S.inv, H = S.has;
    const qg = S.builtFire ? goalText(S) : null;
    if (qg) return qg;
    if (!S.builtFire) {
        if (I.wood < 3 || I.stone < 3) return 'Saml 3 drivtømmer og 3 sten – natten nærmer sig';
        return 'Byg et bål (🔨 Byg) og hold varmen';
    }
    if (!H.harpoon) {
        if (I.bone < 1) return 'Find knogler ved hvalskelettet på stranden';
        if (I.wood < 2 || I.stone < 1) return 'Saml mere tømmer og sten til en harpun';
        return 'Lav en harpun (🔨 Byg)';
    }
    if (!H.kamik && !S.known.has('kamik')) return `Tal med Ukaleq i lejren (${campDist()} m) – hun kan lære dig at sy`;
    if (!H.kamik) return I.hide < 2 ? 'Fang sæler ved åndehullerne på havisen – eller harer' : 'Sy kamikker af skind';
    if (!H.anorak) return S.known.has('anorak') ? 'Sy en skindanorak (3 skind, 1 knogle)' : 'Ukaleq lærer dig at sy en anorak – bring skind og sener';
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
    const part = S.night > 0.75 ? 'nat' : S.t < 0.5 ? (S.night > 0.25 ? 'daggry' : 'formiddag') : (S.night > 0.25 ? 'aften' : 'eftermiddag');
    $('day').innerHTML = `Dag ${S.day}<small>${part}</small>`;
    // Soldiale: solen (eller månen) vandrer over horisonten
    const th = (S.t - 0.25) * TAU, dial = $('dial-body');
    dial.setAttribute('cx', (60 - 50 * Math.cos(th)).toFixed(1));
    dial.setAttribute('cy', (40 - 34 * Math.sin(th)).toFixed(1));
    dial.setAttribute('class', S.night > 0.5 ? 'moon' : 'sun');
    $('weather').textContent = S.weather === 'storm' ? 'Snestorm' : S.weather === 'snow' ? 'Snefald' : S.night > 0.6 ? 'Klart og stjerneklart' : 'Klart';
    $('cairns').textContent = `Varder ${S.cairnsFound} af ${cairns.length}` + (S.sheltered ? ' · i ly' : '');
    const obj = objective();
    const objEl = $('objective');
    if (objEl.textContent !== obj) {
        if (objEl.textContent) { objEl.classList.remove('flash'); void objEl.offsetWidth; objEl.classList.add('flash'); }
        objEl.textContent = obj;
    }
    // Tal på tingene vises kun i rygsækken — HUD'en holdes ren

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
    let label = 'varde';
    const qt = S.builtFire ? questTarget() : null;
    if (qt) { best = qt; bd = dist2(qt, P.pos.x, P.pos.z); label = qt.label; }
    if (best) {
        comp.style.display = '';
        const a = toScreen(P.pos, { x: 0, y: 0 });
        const b = toScreen(new THREE.Vector3(best.x, 0, best.z), { x: 0, y: 0 });
        $('arrow').style.transform = `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)`;
        $('cdist').textContent = `${label} ${Math.round(bd)} m`;
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
        updateNpcs(dt);
        updateFunnel(dt);
        updateQuests();
        updateZones(dt);
        dressing.update(dt, S.time, P.pos.x, P.pos.z);
        if (!S.home) exploreMap.reveal(P.pos.x, P.pos.z, 16);
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
    if (S.home) {
        home.update(dt, S.time, S.night, S.aurora);
        renderer.setClearColor('#1c140e');
        post.uniforms.uWarm.value = 0.7;
    }
    post.render(S.home ? home.scene : scene, camera);
}
loop();
{
    const sb = $('btn-start');
    sb.disabled = false;
    sb.textContent = 'Begynd rejsen';
}

window.__game = { outposts, home, enterHome, exitHome, sleepUntilMorning, igloos, questTarget, collide, zones, caches, rope, toggleControl, openZone, exploreMap, pois, FUN, openFunnel, RBY, stat, npcs, talkCtx, openTalk, GEAR, wear, repair, S, P, siku, scene, camera, post, anim, lightUniforms, getInteraction, doAction, craft, RECIPES, nodes, seals, bears, heaters };
