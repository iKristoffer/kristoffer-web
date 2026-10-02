// ---------------------------------------------------------------------------
// Set dressing: ting, der gør landskabet til et sted og ikke en tom flade.
// Alt tegnes som InstancedMesh pr. type (få draw calls); større ting får en lille kollider.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

const TAU = Math.PI * 2;
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), SC = new THREE.Vector3();

function inst(geo, mat, max) {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.count = 0;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
}
function put(m, x, y, z, ry, sx, sy, sz, color, rx = 0, rz = 0) {
    if (m.count >= m.instanceMatrix.count) return;
    E.set(rx, ry, rz);
    Q.setFromEuler(E);
    M.compose(V.set(x, y, z), Q, SC.set(sx, sy, sz));
    m.setMatrixAt(m.count, M);
    if (color) m.setColorAt(m.count, color);
    m.count++;
}
function finish(m) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
}

/** Ru sten: en ikosaeder med forskudte hjørner. Forskydningen afhænger af positionen, så sammenfaldende hjørner følges ad (ellers revner fladerne). */
function rockGeo(rng) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const a = rng() * 10, b = rng() * 10, c = rng() * 10;
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 0.86 + 0.14 * Math.sin(x * 6.1 + a) * Math.cos(y * 5.3 + b) + 0.1 * Math.sin(z * 7.7 + c + x * 2.3);
        p.setXYZ(i, x * k, y * k * 0.82, z * k);
    }
    g.computeVertexNormals();
    return g;
}

export function buildDressing({ scene, W, world, colliders, rng, zones, camp, isTouch }) {
    const k = isTouch ? 0.6 : 1;
    const gy = (x, z) => Math.max(0, W.groundHeight(x, z));
    const land = world.isLand;
    const anyWalk = (h) => h > -2.4;
    const shore = (h) => h > -0.4 && h < 0.8;
    const c = (hex) => new THREE.Color(hex);
    const lam = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...o });
    const tick = [];   // opdateringsfunktioner (ravne)
    const placeAt = (cond, cx, cz, r0, r1, r) => world.spot(cond, cx, cz, r0, r1, r, false);

    // --- Bjergsilhuetter uden for verden: giver horisont og dybde -----------------------------------
    {
        const m = inst(new THREE.ConeGeometry(1, 1, 6), lam('#ffffff'), 90);
        m.castShadow = false;
        const cols = [c('#a9b9cf'), c('#97a8c0'), c('#b8c6d8'), c('#8d9db6')];
        for (let i = 0; i < 90; i++) {
            const a = (i / 90) * TAU + rng() * 0.05, r = 150 + rng() * 70;
            const w = 26 + rng() * 40, h = 20 + rng() * 52;
            put(m, Math.cos(a) * r, h * 0.5 - 2, Math.sin(a) * r, rng() * TAU, w, h, w * (0.7 + rng() * 0.5), cols[i % 4]);
        }
        finish(m);
        scene.add(m);
    }

    // --- Stenklynger: store sten med sneklædte toppe ----------------------------------------------------
    {
        const geo = rockGeo(rng);
        const rocks = inst(geo, lam('#ffffff'), Math.round(360 * k));
        const caps = inst(geo, lam('#f4f8fc'), Math.round(360 * k));
        const greys = [c('#6f737c'), c('#5d616a'), c('#7d8089'), c('#686c75')];
        const add = (x, z, s) => {
            const y = gy(x, z);
            const sy = s * (0.7 + rng() * 0.6);
            put(rocks, x, y + sy * 0.28, z, rng() * TAU, s, sy, s * (0.8 + rng() * 0.5), greys[Math.floor(rng() * 4)], (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3);
            put(caps, x, y + sy * 0.62, z, rng() * TAU, s * 0.82, sy * 0.4, s * 0.8, null);
            if (s > 0.85) colliders.push({ x, z, r: s * 0.78, active: true });
        };
        for (let n = 0; n < Math.round(34 * k); n++) {
            const s0 = placeAt(land, 0, 0, 8, 96, 4);
            if (!s0) continue;
            const cnt = 3 + Math.floor(rng() * 5);
            for (let i = 0; i < cnt; i++) {
                const a = rng() * TAU, d = rng() * 3.2;
                const x = s0.x + Math.cos(a) * d, z = s0.z + Math.sin(a) * d;
                if (W.groundHeight(x, z) < 0.3) continue;
                add(x, z, 0.5 + rng() * rng() * 2.2);
            }
        }
        finish(rocks); finish(caps);
        scene.add(rocks, caps);
    }

    // --- Isspir og -blokke langs kysten og ude på havisen -------------------------------------------------
    {
        const m = inst(new THREE.ConeGeometry(0.5, 1, 5), lam('#ffffff', { transparent: true, opacity: 0.92 }), Math.round(140 * k));
        const ice = [c('#d4e8f8'), c('#b6d6f0'), c('#e6f2fc'), c('#9cc4e8')];
        for (let n = 0; n < Math.round(46 * k); n++) {
            const s0 = placeAt((h) => h < 0.5 && h > -2.2, 0, 0, 20, 100, 3);
            if (!s0) continue;
            const cnt = 2 + Math.floor(rng() * 4);
            for (let i = 0; i < cnt; i++) {
                const x = s0.x + (rng() - 0.5) * 3, z = s0.z + (rng() - 0.5) * 3;
                const h = 0.8 + rng() * 2.6, w = 0.7 + rng() * 1.3;
                put(m, x, gy(x, z) + h * 0.45, z, rng() * TAU, w, h, w, ice[Math.floor(rng() * 4)], (rng() - 0.5) * 0.35, (rng() - 0.5) * 0.35);
            }
        }
        finish(m);
        scene.add(m);
    }

    // --- Knogler, kranier og ribben spredt i sneen -------------------------------------------------------
    {
        const bone = lam('#e8dfca');
        const long = inst(new THREE.CylinderGeometry(0.04, 0.05, 1, 5), bone, Math.round(160 * k));
        const skull = inst(new THREE.DodecahedronGeometry(0.2, 0), bone, Math.round(30 * k));
        for (let n = 0; n < Math.round(70 * k); n++) {
            const s0 = placeAt(land, 0, 0, 6, 98, 1.5);
            if (!s0) continue;
            const cnt = 1 + Math.floor(rng() * 3);
            for (let i = 0; i < cnt; i++) {
                const x = s0.x + (rng() - 0.5) * 1.6, z = s0.z + (rng() - 0.5) * 1.6;
                const L = 0.5 + rng() * 0.9;
                put(long, x, gy(x, z) + 0.06, z, rng() * TAU, 1, L, 1, null, 0, Math.PI / 2 + (rng() - 0.5) * 0.3);
            }
            if (rng() < 0.4) put(skull, s0.x, gy(s0.x, s0.z) + 0.12, s0.z, rng() * TAU, 1, 0.8, 1.3, null);
        }
        finish(long); finish(skull);
        scene.add(long, skull);
        // Ribbuer: halve tori, rejst som porte
        const arch = inst(new THREE.TorusGeometry(1, 0.07, 5, 12, Math.PI), bone, Math.round(22 * k));
        for (let n = 0; n < Math.round(8 * k); n++) {
            const s0 = placeAt(shore, 0, 0, 30, 100, 3);
            if (!s0) continue;
            const rot = rng() * TAU, cnt = 2 + Math.floor(rng() * 2);
            for (let i = 0; i < cnt; i++) {
                const off = (i - (cnt - 1) / 2) * 0.9, sc = 1.0 + rng() * 0.5;
                const x = s0.x + Math.cos(rot) * off, z = s0.z - Math.sin(rot) * off;
                put(arch, x, gy(x, z) - 0.05, z, rot + Math.PI / 2, sc, sc * 1.1, sc, null);
            }
            colliders.push({ x: s0.x, z: s0.z, r: 0.6, active: true });
        }
        finish(arch);
        scene.add(arch);
    }

    // --- Dværgpil og tørre grene: krogede buske, der stikker op af sneen ----------------------------------------
    {
        const m = inst(new THREE.CylinderGeometry(0.015, 0.035, 1, 4), lam('#5b4632'), Math.round(520 * k));
        m.castShadow = false;
        for (let n = 0; n < Math.round(70 * k); n++) {
            const s0 = placeAt((h, x, z) => land(h, x, z) && h < 3, 0, 0, 4, 94, 1.2);
            if (!s0) continue;
            const cnt = 4 + Math.floor(rng() * 6);
            for (let i = 0; i < cnt; i++) {
                const x = s0.x + (rng() - 0.5) * 1.3, z = s0.z + (rng() - 0.5) * 1.3;
                const h = 0.35 + rng() * 0.6;
                put(m, x, gy(x, z) + h * 0.45, z, rng() * TAU, 1, h, 1, null, (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9);
            }
        }
        finish(m);
        scene.add(m);
    }

    // --- Inuksuit: stablede sten, der viser vej ---------------------------------------------------------------
    {
        const stone = lam('#7a7e87');
        const mk = (x, z, rot, big) => {
            const g = new THREE.Group();
            const sc = big ? 1.3 : 1;
            const part = (w, h, d, px, py, pz, ry = 0) => {
                const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
                b.position.set(px, py, pz);
                b.rotation.set((rng() - 0.5) * 0.12, ry, (rng() - 0.5) * 0.12);
                b.castShadow = b.receiveShadow = true;
                g.add(b);
            };
            part(0.5, 0.55, 0.5, -0.45, 0.27, 0, 0.2);
            part(0.5, 0.5, 0.5, 0.45, 0.25, 0, -0.3);
            part(1.5, 0.28, 0.5, 0, 0.7, 0);        // overligger
            part(0.42, 0.5, 0.42, 0, 1.1, 0, 0.5);
            part(0.28, 0.4, 0.28, 0.02, 1.52, 0, 0.1);
            part(0.8, 0.28, 0.32, 0, 1.82, 0, 0.9);  // "armene"
            g.scale.setScalar(sc);
            g.position.set(x, gy(x, z), z);
            g.rotation.y = rot;
            scene.add(g);
            colliders.push({ x, z, r: 0.7 * sc, active: true });
            return g;
        };
        const posts = [];
        for (let n = 0; n < Math.round(11 * k); n++) {
            const s0 = placeAt((h, x, z) => land(h, x, z) && h < 5, 0, 0, 12, 94, 2.5);
            if (!s0) continue;
            posts.push(mk(s0.x, s0.z, rng() * TAU, rng() < 0.3));
        }
        // Ravne sidder på stenene og på hvalribbenene — og letter, når man kommer for tæt på
        const raven = new THREE.MeshLambertMaterial({ color: '#15171c', flatShading: true });
        const birds = [];
        const spots = posts.map((p) => ({ x: p.position.x, y: gy(p.position.x, p.position.z) + 2.05, z: p.position.z }));
        for (let i = 0; i < Math.round(9 * k) && spots.length; i++) {
            const g = new THREE.Group();
            const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 7, 6), raven);
            body.scale.set(1, 0.85, 1.6);
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), raven);
            head.position.set(0, 0.1, 0.24);
            const beak = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4).rotateX(Math.PI / 2), raven);
            beak.position.set(0, 0.09, 0.38);
            const wl = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.2), raven), wr = wl.clone();
            wl.position.set(-0.22, 0.02, 0);
            wr.position.set(0.22, 0.02, 0);
            const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.28), raven);
            tail.position.set(0, 0, -0.34);
            g.add(body, head, beak, wl, wr, tail);
            g.castShadow = true;
            const sp = spots[i % spots.length];
            const b = { g, wl, wr, spot: sp, state: 'perch', t: rng() * 6, to: null, flap: 0, yaw: rng() * TAU, home: sp };
            g.position.set(sp.x, sp.y, sp.z);
            scene.add(g);
            birds.push(b);
        }
        tick.push((dt, time, px, pz) => {
            for (const b of birds) {
                b.t += dt;
                const d = Math.hypot(b.g.position.x - px, b.g.position.z - pz);
                if (b.state === 'perch') {
                    b.g.rotation.y = b.yaw + Math.sin(time * 0.4 + b.t) * 0.4;
                    b.g.position.y = b.spot.y + Math.sin(time * 2 + b.t) * 0.004;
                    b.wl.rotation.z = b.wr.rotation.z = 0.5;
                    if (d < 5.5) { b.state = 'fly'; b.t = 0; const a = Math.atan2(b.g.position.x - px, b.g.position.z - pz); b.dir = a + (rng() - 0.5); b.climb = 1; }
                } else if (b.state === 'fly') {
                    b.g.position.x += Math.sin(b.dir) * 5.5 * dt;
                    b.g.position.z += Math.cos(b.dir) * 5.5 * dt;
                    b.g.position.y += (b.t < 2.5 ? 1.8 : -0.9) * dt;
                    b.g.rotation.y = b.dir;
                    const f = Math.sin(time * 22) * 0.9;
                    b.wl.rotation.z = f; b.wr.rotation.z = -f;
                    if (b.t > 5.5) { b.state = 'away'; b.t = 0; b.g.visible = false; }
                } else if (b.t > 24 && d > 14) {
                    b.g.visible = true;
                    b.g.position.set(b.home.x, b.home.y, b.home.z);
                    b.state = 'perch';
                    b.t = 0;
                }
            }
        });
    }

    // --- Lejren: telte, tørrestativer, kajak, brændestabel, hundepæle ------------------------------------------
    if (camp) {
        const skin = lam('#c9a77a'), skinDark = lam('#9b7a52'), wood = lam('#6b4c2e'), fur = lam('#e9e2d2');
        const at = (dx, dz) => ({ x: camp.x + dx, z: camp.z + dz });
        const grp = (p, ry = 0) => { const g = new THREE.Group(); g.position.set(p.x, gy(p.x, p.z), p.z); g.rotation.y = ry; scene.add(g); return g; };
        const tent = (dx, dz, ry) => {
            const p = at(dx, dz), g = grp(p, ry);
            const cone = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.4, 9, 1, true), skin);
            cone.position.y = 1.2; cone.castShadow = true;
            const cap = new THREE.Mesh(new THREE.ConeGeometry(1.72, 0.5, 9, 1, true), skinDark);
            cap.position.y = 0.25;
            const door = new THREE.Mesh(new THREE.CircleGeometry(0.5, 8, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#1d1610' }));
            door.position.set(0, 0.02, 1.52); door.rotation.y = 0;
            g.add(cone, cap, door);
            for (let i = 0; i < 5; i++) {
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.1, 4), wood);
                const a = (i / 5) * TAU;
                pole.position.set(Math.sin(a) * 0.12, 2.8, Math.cos(a) * 0.12);
                pole.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
                g.add(pole);
            }
            colliders.push({ x: p.x, z: p.z, r: 1.6, active: true });
        };
        tent(-3.2, -3.8, 0.4);
        tent(3.8, 3.2, 3.6);

        const rack = (dx, dz, ry) => {
            const p = at(dx, dz), g = grp(p, ry);
            for (const sx of [-1.3, 1.3]) {
                const a = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2, 5), wood);
                a.position.set(sx, 1, 0); a.rotation.z = sx * 0.08; a.castShadow = true;
                g.add(a);
            }
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 5).rotateZ(Math.PI / 2), wood);
            bar.position.y = 1.9; g.add(bar);
            for (let i = 0; i < 7; i++) {
                const fish = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.55, 4), i % 3 === 0 ? skinDark : lam('#bda57c'));
                fish.position.set(-1.1 + i * 0.37, 1.55, 0);
                fish.rotation.z = Math.PI;
                g.add(fish);
            }
            colliders.push({ x: p.x - Math.cos(ry) * 1.3, z: p.z + Math.sin(ry) * 1.3, r: 0.25, active: true });
            colliders.push({ x: p.x + Math.cos(ry) * 1.3, z: p.z - Math.sin(ry) * 1.3, r: 0.25, active: true });
        };
        rack(-0.6, 4.6, 0.2);
        rack(5.6, -2.6, 1.3);

        // Kajak på to bukke
        {
            const p = at(-5.4, 1.4), g = grp(p, 0.8);
            const hull = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), lam('#7f6a4a'));
            hull.scale.set(3.4, 0.55, 1); hull.position.y = 0.95; hull.castShadow = true;
            const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 5, 10), wood);
            rim.rotation.x = Math.PI / 2; rim.position.set(0.1, 1.12, 0);
            g.add(hull, rim);
            for (const sx of [-0.6, 0.6]) {
                const a = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.9), wood);
                a.position.set(sx, 0.4, 0); a.rotation.x = 0.0; g.add(a);
            }
            colliders.push({ x: p.x, z: p.z, r: 1.1, active: true });
        }
        // Brændestabel + skindbunke
        {
            const p = at(2.4, -4.2), g = grp(p, 0.3);
            for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
                const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 1.1, 6).rotateZ(Math.PI / 2), wood);
                l.position.set(0, 0.12 + r * 0.2, -0.3 + i * 0.22 + r * 0.11);
                l.castShadow = true;
                g.add(l);
            }
            const pile = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), fur);
            pile.scale.set(1.3, 0.45, 1); pile.position.set(1.2, 0.2, 0.2);
            g.add(pile);
        }
        // Hundepæle med kæder (dog-parkeringen)
        for (let i = 0; i < 3; i++) {
            const p = at(-2.0 + i * 1.3, -6.0 + (i % 2) * 0.5), g = grp(p, 0);
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.8, 5), wood);
            pole.position.y = 0.4;
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 4, 8), lam('#555a63'));
            ring.position.y = 0.7; ring.rotation.x = Math.PI / 2;
            g.add(pole, ring);
        }
    }

    // --- Zone-dressing: hver zone får sit eget udtryk ----------------------------------------------------------------
    for (const z of zones) {
        const cx = z.x, cz = z.z, R = z.R;
        const ring = (n, r0, r1, fn) => { for (let i = 0; i < n; i++) { const a = rng() * TAU, d = r0 + rng() * (r1 - r0); fn(cx + Math.cos(a) * d, cz + Math.sin(a) * d, a); } };
        if (z.id === 'thin') {
            // Sort revnet is med mørke sprækker og dampende åndehuller
            const dark = new THREE.MeshBasicMaterial({ color: '#0a1019', transparent: true, opacity: 0.85 });
            ring(7, 1, R - 1.5, (x, zz) => {
                const m = new THREE.Mesh(new THREE.CircleGeometry(0.8 + rng() * 1.6, 10).rotateX(-Math.PI / 2), dark);
                m.position.set(x, gy(x, zz) + 0.04, zz); m.scale.z = 0.5 + rng() * 0.6; m.rotation.y = rng() * TAU;
                scene.add(m);
            });
            const crack = new THREE.MeshBasicMaterial({ color: '#0a1019' });
            ring(16, 0.5, R - 1, (x, zz) => {
                const m = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 1.5 + rng() * 2.5).rotateX(-Math.PI / 2), crack);
                m.position.set(x, gy(x, zz) + 0.05, zz); m.rotation.y = rng() * TAU;
                scene.add(m);
            });
        } else if (z.id === 'bird') {
            // Fuglefjeld: høje stenpiller, hvide af fugle
            const geo = rockGeo(rng);
            const m = inst(geo, lam('#ffffff'), 14);
            ring(9, 3, R - 1.2, (x, zz) => {
                const h = 2.2 + rng() * 2.4;
                put(m, x, gy(x, zz) + h * 0.35, zz, rng() * TAU, 0.8 + rng() * 0.5, h, 0.8 + rng() * 0.5, c(rng() < 0.5 ? '#e8e4dc' : '#a6a8ae'));
                colliders.push({ x, z: zz, r: 0.7, active: true });
            });
            finish(m); scene.add(m);
        } else if (z.id === 'pass') {
            // Gletsjerpas: skråtstillede blå isflager
            const geo = new THREE.BoxGeometry(1, 1, 0.4);
            const m = inst(geo, lam('#ffffff', { transparent: true, opacity: 0.88 }), 20);
            ring(12, 2, R - 1.2, (x, zz) => {
                const h = 1.6 + rng() * 2.6;
                put(m, x, gy(x, zz) + h * 0.42, zz, rng() * TAU, 1.2 + rng() * 1.4, h, 1, c(['#a9d3f5', '#8fc2ee', '#c4e2fa'][Math.floor(rng() * 3)]), (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.5);
            });
            finish(m); scene.add(m);
        } else if (z.id === 'peak') {
            // Nordlysbjerget: en ring af stående sten omkring varden
            const stone = new THREE.MeshLambertMaterial({ color: '#7d8190', flatShading: true, emissive: '#1a3a30', emissiveIntensity: 0.6 });
            for (let i = 0; i < 9; i++) {
                const a = (i / 9) * TAU, r = 4.6, h = 1.8 + rng() * 1.6;
                const x = cx + Math.cos(a) * r, zz = cz + Math.sin(a) * r;
                const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, h, 0.5), stone);
                b.position.set(x, gy(x, zz) + h / 2 - 0.1, zz);
                b.rotation.set((rng() - 0.5) * 0.12, a + Math.PI / 2, (rng() - 0.5) * 0.12);
                b.castShadow = true;
                scene.add(b);
                colliders.push({ x, z: zz, r: 0.5, active: true });
            }
        }
    }

    return { update: (dt, time, px, pz) => { for (const f of tick) f(dt, time, px, pz); } };
}
