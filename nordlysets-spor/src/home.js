// ---------------------------------------------------------------------------
// Hjemmet: iglo-interiøret. Egen THREE.Scene (egne lys), placeret langt uden for verdens terræn-gitter
// (HX/HZ), så groundHeight() svarer -2,5 og spilleren står i y=0. Her kan man ikke dø.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import * as W from './world.js';

export const HX = 1000, HZ = 1000;
const TAU = Math.PI * 2;

const lam = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    return m;
};

export function buildHome() {
    const scene = new THREE.Scene();
    const g = new THREE.Group();
    g.position.set(HX, 0, HZ);
    scene.add(g);

    // --- Kuppel: snéblokke indefra og udefra, med fuger ---
    const R = 4.4;
    const domeGeo = new THREE.SphereGeometry(R, 20, 9, 0, TAU, 0, Math.PI / 2).toNonIndexed();
    const cols = new Float32Array(domeGeo.attributes.position.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < domeGeo.attributes.position.count; i += 6) {
        col.set('#dfe9f4').offsetHSL(0, 0, -Math.random() * 0.1);
        for (let k = i; k < Math.min(domeGeo.attributes.position.count, i + 6); k++) cols.set([col.r, col.g, col.b], k * 3);
    }
    domeGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    domeGeo.computeVertexNormals();
    const dome = new THREE.Mesh(domeGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.BackSide }));
    dome.receiveShadow = true;
    g.add(dome);
    // Gulv: trampet sne
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 30).rotateX(-Math.PI / 2), lam('#cfdcea'));
    floor.receiveShadow = true;
    g.add(floor);
    // Tunnel mod døren (+z)
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 2.2, 10, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2), lam('#dbe6f2', { side: THREE.BackSide }));
    tunnel.position.set(0, 0, R + 0.8);
    g.add(tunnel);
    const doorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.4), new THREE.MeshBasicMaterial({ color: '#aac8ee', transparent: true, opacity: 0.55 }));
    doorGlow.position.set(0, 0.7, R + 1.85);
    g.add(doorGlow);

    // --- Skind på gulvet ---
    const fur1 = lam('#e9dfca'), fur2 = lam('#8a6a48'), fur3 = lam('#3d3a38');
    const rug = (x, z, sx, sz, mat, ry = 0) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), mat);
        m.scale.set(sx, 1, sz);
        m.position.set(x, 0.03 + Math.random() * 0.004, z);
        m.rotation.y = ry;
        g.add(m);
    };
    rug(0.2, 0.9, 1.9, 1.4, fur2, 0.3);
    rug(0.6, 1.2, 1.2, 0.9, fur1, 1.0);
    rug(-1.3, 1.9, 0.8, 0.5, fur3, 0.6);

    // --- Sovebriks: en hævet bænk af sne, dækket af skind ---
    const bench = new THREE.Group();
    bench.position.set(-2.4, 0, -0.8);
    bench.rotation.y = 0.2;
    bench.add(box(2.2, 0.55, 1.5, lam('#e4edf7'), 0, 0.27, 0));
    bench.add(box(2.1, 0.12, 1.4, fur2, 0, 0.6, 0));
    bench.add(box(1.5, 0.14, 1.2, fur1, 0.1, 0.72, 0));
    bench.add(box(0.5, 0.2, 0.9, fur3, -0.75, 0.82, 0));
    g.add(bench);

    // --- Arbejdsbænk: en træstub med redskaber ---
    const work = new THREE.Group();
    work.position.set(2.2, 0, -1.7);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.8, 9), lam('#6b4c2e'));
    stump.position.y = 0.4;
    stump.castShadow = true;
    work.add(stump);
    work.add(box(0.9, 0.05, 0.5, lam('#8a6a48'), 0, 0.83, 0));
    for (let i = 0; i < 4; i++) {
        const n = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.35, 4), lam('#e8dfca'));
        n.position.set(-0.3 + i * 0.12, 0.9, 0.05);
        n.rotation.z = Math.PI / 2;
        n.rotation.y = i * 0.3;
        work.add(n);
    }
    work.add(box(0.2, 0.08, 0.14, lam('#7a7e87'), 0.3, 0.9, -0.1));
    g.add(work);

    // --- Kiste ---
    const chest = new THREE.Group();
    chest.position.set(0.4, 0, -3.0);
    chest.add(box(1.2, 0.6, 0.7, lam('#7a5836'), 0, 0.3, 0));
    chest.add(box(1.24, 0.12, 0.74, lam('#5b4026'), 0, 0.66, 0));
    chest.add(box(0.1, 0.62, 0.74, lam('#cdbd9a'), -0.3, 0.31, 0), box(0.1, 0.62, 0.74, lam('#cdbd9a'), 0.3, 0.31, 0));
    g.add(chest);

    // --- Spæklampe, midt i rummet ---
    const lamp = W.makeQulliq();
    lamp.group.position.set(0.1, 0, -0.3);
    lamp.group.scale.setScalar(1.7);
    g.add(lamp.group);
    const lampLight = new THREE.PointLight(0xffa24a, 18, 12, 1.6);
    lampLight.position.set(0.1, 1.2, -0.3);
    g.add(lampLight);

    // --- Tørrestreng og skind på væggen ---
    const line = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.012, 3, 20, Math.PI * 0.7), new THREE.MeshBasicMaterial({ color: '#8a7a58' }));
    line.position.set(0, 2.4, 0);
    line.rotation.set(Math.PI / 2, 0, Math.PI * 0.65);
    g.add(line);
    for (let i = 0; i < 6; i++) {
        const a = Math.PI * 0.65 + (i / 6) * Math.PI * 0.7;
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 4), lam(i % 2 ? '#bda57c' : '#a98d63'));
        f.position.set(Math.cos(a) * 2.6, 2.1, Math.sin(a) * 2.6);
        f.rotation.x = Math.PI;
        g.add(f);
    }
    const pelt = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), lam('#8a6a48', { side: THREE.DoubleSide }));
    pelt.position.set(-3.2, 2.0, 1.8);
    pelt.rotation.y = Math.PI / 2 + 0.55;
    g.add(pelt);

    // --- Lys: varm hovedkilde + blåt skær oppefra (dag og nordlys sniger sig ind gennem isen) ---
    const hemi = new THREE.HemisphereLight(0xbfd8f5, 0x6b5a48, 0.55);
    scene.add(hemi);
    const sky = new THREE.PointLight(0x9fc4ff, 3, 14, 1.4);
    sky.position.set(HX, 4.2, HZ);
    scene.add(sky);

    // Kollision: [x, z, r] i hjemmets lokale koordinater
    const obstacles = [[-2.4, -0.8, 1.15], [2.2, -1.7, 0.85], [0.4, -3.0, 0.7], [0.1, -0.3, 0.45]];
    const bounds = 3.45;
    function constrain(p, r = 0.42) {
        let lx = p.x - HX, lz = p.z - HZ;
        // Rum + tunnel mod døren
        const inTunnel = lz > bounds - 0.4 && Math.abs(lx) < 0.65;
        if (inTunnel) {
            lx = Math.max(-0.65 + r * 0.4, Math.min(0.65 - r * 0.4, lx));
            lz = Math.min(lz, R + 2.4);
        } else {
            const d = Math.hypot(lx, lz);
            if (d > bounds) { lx *= bounds / d; lz *= bounds / d; }
        }
        for (const [ox, oz, or] of obstacles) {
            const dx = lx - ox, dz = lz - oz, d2 = dx * dx + dz * dz, rr = or + r;
            if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); lx = ox + dx / d * rr; lz = oz + dz / d * rr; }
        }
        p.x = HX + lx;
        p.z = HZ + lz;
    }

    const at = (x, z) => ({ x: HX + x, z: HZ + z });
    return {
        scene,
        center: at(0, 0),
        spawn: at(0, 3.0),
        door: at(0, R + 1.9),
        bench: at(-2.4, -0.8),
        work: at(2.2, -1.7),
        chest: at(0.4, -3.0),
        lamp: lamp,
        dogSpot: at(-1.2, 1.7),
        constrain,
        /** Kaldes hvert billede: flimrende lampe, lys efter døgn og vejr. */
        update(dt, time, night, aurora) {
            const fk = 1 + Math.sin(time * 13) * 0.08 + Math.sin(time * 23 + 1.3) * 0.06;
            lampLight.intensity = 18 * fk;
            const fl = lamp.flames;
            if (fl) fl.scale.set(1, fk, 1);
            hemi.intensity = 0.5 - night * 0.22;
            sky.intensity = 1.5 + (1 - night) * 2.5 + aurora * 2;
            sky.color.set(aurora > 0.2 ? '#7dffc0' : '#9fc4ff');
        },
    };
}
