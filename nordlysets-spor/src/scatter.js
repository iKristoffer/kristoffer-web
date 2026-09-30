import * as THREE from 'three';
import { groundHeight, slopeAt, vnoise, mulberry32, WORLD_RADIUS } from './world.js';
import { lightUniforms } from './shaders.js';

// ---------------------------------------------------------------------------
// Små detaljer spredt ud over landskabet (instansieret, få draw calls)
// ---------------------------------------------------------------------------
const dummy = new THREE.Object3D();
const col = new THREE.Color();

function instanced(geo, mat, max, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.count = 0;
    return m;
}

function place(mesh, x, y, z, ry, sx, sy, sz, rx = 0, rz = 0, color = null) {
    const i = mesh.count++;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (color) mesh.setColorAt(i, color);
}

/** Græstotter: tre tynde blade flettet sammen; toppen svajer i vinden. */
function tuftGeometry() {
    const parts = [];
    for (let i = 0; i < 5; i++) {
        const c = new THREE.ConeGeometry(0.035, 0.34 + (i % 3) * 0.08, 3, 1);
        c.translate(0, 0.17, 0);
        c.rotateZ((i - 2) * 0.22);
        c.rotateY(i * 1.3);
        c.translate((i - 2) * 0.03, 0, ((i * 7) % 3 - 1) * 0.03);
        parts.push(c.toNonIndexed());
    }
    const merged = new THREE.BufferGeometry();
    let count = 0;
    for (const g of parts) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3);
    let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.computeVertexNormals();
    return merged;
}

function swayMaterial(color) {
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = lightUniforms.uTime;
        sh.uniforms.uWind = windUniform;
        sh.vertexShader = 'uniform float uTime;\nuniform vec3 uWind;\n' + sh.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
    vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float bend = transformed.y * transformed.y * 2.2;
    float gust = sin(uTime * 2.3 + iw.x * 0.7 + iw.z * 0.5) * 0.5 + 0.5;
    transformed.x += (uWind.x * 0.02 + sin(uTime * 3.1 + iw.z) * 0.03) * bend * (0.5 + gust);
    transformed.z += (uWind.z * 0.02 + cos(uTime * 2.7 + iw.x) * 0.03) * bend * (0.5 + gust);`
        );
    };
    mat.customProgramCacheKey = () => 'sway';
    return mat;
}

export const windUniform = { value: new THREE.Vector3(1, 0, 0) };

export function buildScatter(scene, nodes, isTouch) {
    const rng = mulberry32(99);
    const k = isTouch ? 0.6 : 1;

    // --- Græstotter i pletter
    const tufts = instanced(tuftGeometry(), swayMaterial('#ffffff'), Math.round(1400 * k), false);
    const straw = [new THREE.Color('#c2ad7a'), new THREE.Color('#a8955f'), new THREE.Color('#b9a88a'), new THREE.Color('#8d8a5e')];
    for (let tries = 0; tries < 12000 && tufts.count < tufts.instanceMatrix.count; tries++) {
        const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 92;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = groundHeight(x, z);
        if (h < 0.25 || slopeAt(x, z) > 0.35) continue;
        if (vnoise(x * 0.09 + 3, z * 0.09 - 8) < 0.15) continue;
        const cl = 1 + Math.floor(rng() * 4);
        for (let c = 0; c < cl && tufts.count < tufts.instanceMatrix.count; c++) {
            const px = x + (rng() - 0.5) * 1.2, pz = z + (rng() - 0.5) * 1.2;
            const s = 0.7 + rng() * 0.7;
            place(tufts, px, groundHeight(px, pz) - 0.03, pz, rng() * 6, s, s * (0.8 + rng() * 0.5), s, 0, 0, straw[Math.floor(rng() * 4)]);
        }
    }
    scene.add(tufts);

    // --- Småsten: omkring store sten og langs kysten
    const pebMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const pebbles = instanced(new THREE.DodecahedronGeometry(0.1, 0), pebMat, Math.round(900 * k));
    const pc = [new THREE.Color('#7b7f88'), new THREE.Color('#62666f'), new THREE.Color('#8e9096')];
    const addPebble = (x, z) => {
        const h = groundHeight(x, z);
        if (h < -0.2) return;
        const s = 0.5 + rng() * 1.4;
        place(pebbles, x, Math.max(0, h) + 0.02, z, rng() * 6, s, s * 0.6, s * (0.8 + rng() * 0.4), rng(), rng(), pc[Math.floor(rng() * 3)]);
    };
    for (const n of nodes) {
        if (n.type !== 'stone') continue;
        for (let i = 0; i < 6; i++) {
            const a = rng() * 6.28, r = 0.9 + rng() * 1.6;
            addPebble(n.x + Math.cos(a) * r, n.z + Math.sin(a) * r);
        }
    }
    for (let tries = 0; tries < 8000 && pebbles.count < pebbles.instanceMatrix.count; tries++) {
        const a = rng() * Math.PI * 2, r = 40 + rng() * 64;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = groundHeight(x, z);
        if (h > -0.1 && h < 0.6) addPebble(x, z);
    }
    scene.add(pebbles);

    // --- Små snedriver i læ af sten og drivtømmer
    const driftMat = new THREE.MeshLambertMaterial({ color: '#e8f0f9' });
    const driftGeo = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const drifts = instanced(driftGeo, driftMat, 120);
    const lee = new THREE.Vector2(-0.8, -0.6);
    for (const n of nodes) {
        if (n.type !== 'stone' && n.type !== 'wood') continue;
        const len = 0.8 + rng() * 1.0;
        const x = n.x + lee.x * (n.r + len * 0.45), z = n.z + lee.y * (n.r + len * 0.45);
        place(drifts, x, Math.max(0, groundHeight(x, z)) - 0.04, z, Math.atan2(lee.x, lee.y), 0.35 + rng() * 0.25, 0.07 + rng() * 0.04, len);
    }
    scene.add(drifts);

    // --- Isskruninger og isblokke langs kysten og ude på havisen
    const iceMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#0c2430' });
    const iceGeo = new THREE.IcosahedronGeometry(0.4, 0);
    const blocks = instanced(iceGeo, iceMat, Math.round(1100 * k));
    const ic = [new THREE.Color('#e4f3fb'), new THREE.Color('#cbe6f3'), new THREE.Color('#b4dbec'), new THREE.Color('#f2f7fb')];
    for (let tries = 0; tries < 30000 && blocks.count < blocks.instanceMatrix.count; tries++) {
        const a = rng() * Math.PI * 2, r = 55 + rng() * 52;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (Math.hypot(x, z) > WORLD_RADIUS + 3) continue;
        const h = groundHeight(x, z);
        const coast = h > -0.45 && h < 0.05;
        const ridge = h < -1.2 && vnoise(x * 0.12 + 11, z * 0.12) > 0.55;
        if (!coast && !ridge) continue;
        const cl = coast ? 3 : 2;
        for (let c = 0; c < cl && blocks.count < blocks.instanceMatrix.count; c++) {
            const px = x + (rng() - 0.5) * 1.4, pz = z + (rng() - 0.5) * 1.4;
            const s = (coast ? 0.6 : 0.8) + rng() * 1.1;
            place(blocks, px, 0.05 + s * 0.08, pz, rng() * 6, s * (0.8 + rng() * 0.6), s * (0.4 + rng() * 0.5), s,
                (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9, ic[Math.floor(rng() * 4)]);
        }
    }
    scene.add(blocks);

    for (const m of [tufts, pebbles, drifts, blocks]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
    }
    return { tufts, pebbles, drifts, blocks };
}
