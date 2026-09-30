import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Is og åbent vand med spejlet nordlys og stjerner
// ---------------------------------------------------------------------------
const ICE_VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
}`;

const ICE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uATime;
uniform float uNight;
uniform float uAurora;
uniform float uStorm;
uniform vec3 uCam;
uniform vec3 uSky;
uniform vec4 uShoot;
varying vec3 vWorld;
#include <fog_pars_fragment>

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
}

vec3 aurora(vec2 p) {
    vec3 col = vec3(0.0);
    float t = uATime;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float off = sin(p.x * 0.045 + t * 0.09 + fi * 2.1) * 6.0 + (fbm(vec2(p.x * 0.03 + t * 0.04, fi * 3.7)) - 0.5) * 22.0;
        float y = p.y - off - fi * 13.0;
        y = mod(y + 20.0, 40.0) - 20.0;
        float w = 2.2 + fi * 0.9;
        float core = exp(-y * y / (w * w));
        float up = y - w * 1.5;
        float fringe = exp(-up * up / (w * w * 3.0));
        float rays = 0.35 + 0.65 * noise(vec2(p.x * 0.7 + t * 0.6 + fi * 10.0, fi + t * 0.05));
        rays *= 0.55 + 0.45 * noise(vec2(p.x * 2.3 - t * 1.1, fi * 5.0));
        float fade = 0.6 + 0.4 * sin(p.x * 0.02 + t * 0.13 + fi);
        col += vec3(0.12, 1.0, 0.55) * core * rays * fade;
        col += vec3(0.62, 0.2, 0.9) * fringe * rays * rays * fade * 0.32;
    }
    return col;
}

void main() {
    vec2 wp = vWorld.xz;
    float r = length(wp);
    const vec2 SR = vec2(0.70710678, -0.70710678);
    const vec2 SU = vec2(-0.70710678, -0.70710678);
    vec2 s = wp - uCam.xz;
    vec2 q = vec2(dot(s, SR), dot(s, SU));
    vec2 cq = vec2(dot(uCam.xz, SR), dot(uCam.xz, SU));

    float water = smoothstep(107.0, 113.0, r + (fbm(wp * 0.05) - 0.5) * 14.0);
    vec2 dist = vec2(noise(wp * 1.1 + uTime * 0.04), noise(wp * 1.1 - 5.2 - uTime * 0.03)) - 0.5;
    dist *= mix(1.2, 4.0, water);
    dist += water * vec2(sin(wp.y * 0.8 + uTime * 1.2), sin(wp.x * 0.7 - uTime)) * 0.5;

    vec3 aur = aurora(q * 0.85 + cq * 0.2 + dist) * uAurora;

    // Stjerner (længere væk -> mindre parallakse)
    vec2 sp = q * 0.9 + cq * 0.05 + dist * 0.25;
    vec2 g = sp * 1.6;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float hs = hash(id);
    float star = 0.0;
    if (hs > 0.9) {
        vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
        star = smoothstep(0.09, 0.0, length(f - o * 0.6)) * (0.55 + 0.45 * sin(uTime * (1.5 + hs * 4.0) + hs * 80.0));
    }
    // Stjerneskud
    float shoot = 0.0;
    if (uShoot.w > 0.0 && uShoot.w < 1.0) {
        vec2 dir = vec2(cos(uShoot.z), sin(uShoot.z));
        vec2 rel = sp - uShoot.xy;
        float along = dot(rel, dir);
        float perp = abs(dot(rel, vec2(-dir.y, dir.x)));
        float head = uShoot.w * 16.0;
        float tl = 5.0;
        float inSeg = step(head - tl, along) * step(along, head);
        shoot = inSeg * smoothstep(0.08, 0.0, perp) * (along - (head - tl)) / tl * (1.0 - uShoot.w) * 2.5;
    }

    vec3 sky = uSky * vec3(0.8, 0.9, 1.0) * (1.0 - uNight) * 0.3 + vec3(0.01, 0.02, 0.05) * uNight;
    vec3 refl = sky + aur + vec3(star + shoot) * uNight * (1.0 - uStorm);

    float n1 = fbm(wp * 0.3);
    float c1 = 1.0 - smoothstep(0.0, 0.035, abs(noise(wp * 0.22) - 0.5));
    float c2 = 1.0 - smoothstep(0.0, 0.03, abs(noise(wp * 0.8 + 3.1) - 0.5));
    float cracks = max(c1 * 0.9, c2 * 0.45);
    vec3 iceDay = mix(vec3(0.3, 0.5, 0.66), vec3(0.5, 0.7, 0.84), n1);
    vec3 iceNight = vec3(0.035, 0.065, 0.12) + n1 * 0.04;
    vec3 base = mix(iceDay, iceNight, uNight);
    float refk = 0.85 - cracks * 0.5;
    vec3 col = base * (1.0 - 0.35 * refk * uNight) + refl * refk;
    col += mix(vec3(0.3), vec3(0.08, 0.11, 0.15), uNight) * cracks;

    float frost = smoothstep(0.55, 0.8, fbm(wp * 0.12 + 20.0));
    vec3 frostCol = mix(vec3(0.86, 0.92, 0.98), vec3(0.16, 0.22, 0.34), uNight);
    col = mix(col, frostCol, frost * 0.55 * (1.0 - water));

    float sh = hash(floor(wp * 7.0));
    col += step(0.992, sh) * pow(max(0.0, sin(uTime * 2.5 + sh * 90.0 + dot(uCam.xz, vec2(0.8, 1.1)))), 10.0) * 0.9 * (1.0 - water);

    vec3 wcol = mix(vec3(0.05, 0.18, 0.27), vec3(0.006, 0.014, 0.03), uNight);
    col = mix(col, wcol + refl * 0.95, water);
    col = mix(col, mix(vec3(0.75, 0.8, 0.86), vec3(0.12, 0.15, 0.2), uNight), uStorm * 0.45);

    gl_FragColor = vec4(pow(max(col, 0.0), vec3(2.2)), 1.0);
    #include <fog_fragment>
    #include <colorspace_fragment>
}`;

export function createIceMaterial() {
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uATime: { value: 0 },
        uNight: { value: 0 },
        uAurora: { value: 0 },
        uStorm: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uSky: { value: new THREE.Color() },
        uShoot: { value: new THREE.Vector4(0, 0, 0, -1) },
    }]);
    return new THREE.ShaderMaterial({ uniforms, vertexShader: ICE_VERT, fragmentShader: ICE_FRAG, fog: true });
}

// ---------------------------------------------------------------------------
// Snefald / snestorm / diamantstøv
// ---------------------------------------------------------------------------
export class Snow {
    constructor(count) {
        this.count = count;
        this.box = new THREE.Vector3(70, 36, 70);
        const pos = new Float32Array(count * 3);
        const rnd = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            pos[i * 3] = (Math.random() - 0.5) * this.box.x;
            pos[i * 3 + 1] = Math.random() * this.box.y - 4;
            pos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
            rnd[i] = Math.random();
        }
        this.pos = pos;
        this.rnd = rnd;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
        this.geo = geo;
        this.uniforms = {
            uScale: { value: 30 },
            uSize: { value: 0.07 },
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(1, 1, 1) },
            uOpacity: { value: 0.8 },
            uSparkle: { value: 0 },
        };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            vertexShader: /* glsl */ `
                attribute float aRand;
                uniform float uScale, uSize, uTime;
                varying float vTw;
                void main() {
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = max(1.5, uSize * (0.5 + aRand) * uScale);
                    vTw = 0.5 + 0.5 * sin(uTime * (3.0 + aRand * 4.0) + aRand * 100.0);
                }`,
            fragmentShader: /* glsl */ `
                uniform vec3 uColor;
                uniform float uOpacity, uSparkle;
                varying float vTw;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.15, d);
                    float tw = mix(1.0, pow(vTw, 6.0) * 2.2, uSparkle);
                    gl_FragColor = vec4(uColor, a * uOpacity * tw);
                }`,
        });
        this.points = new THREE.Points(geo, mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = 5;
    }

    update(dt, center, wind, intensity, time) {
        const n = Math.floor(this.count * (0.15 + 0.85 * intensity));
        this.geo.setDrawRange(0, n);
        const p = this.pos, r = this.rnd;
        const hx = this.box.x / 2, hz = this.box.z / 2;
        const fall = 1.2 + intensity * 1.5;
        for (let i = 0; i < n; i++) {
            const k = i * 3, ri = r[i];
            p[k] += (wind.x * (0.6 + ri * 0.8) + Math.sin(time * 1.3 + ri * 20) * 0.4) * dt;
            p[k + 1] -= fall * (0.6 + ri * 0.8) * dt;
            p[k + 2] += (wind.z * (0.6 + ri * 0.8) + Math.cos(time * 1.1 + ri * 30) * 0.4) * dt;
            const dx = p[k] - center.x;
            if (dx < -hx) p[k] += this.box.x; else if (dx > hx) p[k] -= this.box.x;
            const dz = p[k + 2] - center.z;
            if (dz < -hz) p[k + 2] += this.box.z; else if (dz > hz) p[k + 2] -= this.box.z;
            if (p[k + 1] < center.y - 4) p[k + 1] += this.box.y;
            else if (p[k + 1] > center.y + this.box.y - 4) p[k + 1] -= this.box.y;
        }
        this.geo.attributes.position.needsUpdate = true;
        this.uniforms.uTime.value = time;
    }
}

// ---------------------------------------------------------------------------
// Generelle partikler (gnister, røg, ånde, sne-sprøjt)
// ---------------------------------------------------------------------------
export class Particles {
    constructor(max, additive) {
        this.max = max;
        this.pos = new Float32Array(max * 3);
        this.col = new Float32Array(max * 3);
        this.size = new Float32Array(max);
        this.alpha = new Float32Array(max);
        this.vel = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max).fill(1);
        this.s0 = new Float32Array(max);
        this.a0 = new Float32Array(max);
        this.grow = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.next = 0;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
        this.geo = geo;
        this.uniforms = { uScale: { value: 30 } };
        const mat = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthWrite: false,
            blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            vertexShader: /* glsl */ `
                attribute float aSize;
                attribute float aAlpha;
                attribute vec3 aColor;
                uniform float uScale;
                varying float vA;
                varying vec3 vC;
                void main() {
                    vA = aAlpha;
                    vC = aColor;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = aSize * uScale;
                }`,
            fragmentShader: /* glsl */ `
                varying float vA;
                varying vec3 vC;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.0, d) * vA;
                    if (a < 0.01) discard;
                    gl_FragColor = vec4(vC, a);
                }`,
        });
        this.points = new THREE.Points(geo, mat);
        this.points.frustumCulled = false;
        this.points.renderOrder = 6;
    }

    emit(x, y, z, vx, vy, vz, color, size, life, o = {}) {
        const i = this.next;
        this.next = (this.next + 1) % this.max;
        const k = i * 3;
        this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
        this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
        this.col[k] = color.r; this.col[k + 1] = color.g; this.col[k + 2] = color.b;
        this.s0[i] = size;
        this.a0[i] = o.alpha ?? 1;
        this.grow[i] = o.grow ?? 0;
        this.grav[i] = o.grav ?? 0;
        this.drag[i] = o.drag ?? 0;
        this.life[i] = this.maxLife[i] = life;
    }

    update(dt) {
        for (let i = 0; i < this.max; i++) {
            if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
            this.life[i] -= dt;
            const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
            const k = i * 3;
            this.vel[k + 1] += this.grav[i] * dt;
            const dr = 1 - Math.min(1, this.drag[i] * dt);
            this.vel[k] *= dr; this.vel[k + 1] *= dr; this.vel[k + 2] *= dr;
            this.pos[k] += this.vel[k] * dt;
            this.pos[k + 1] += this.vel[k + 1] * dt;
            this.pos[k + 2] += this.vel[k + 2] * dt;
            this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
            this.alpha[i] = this.a0[i] * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
        }
        const a = this.geo.attributes;
        a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
    }
}

// ---------------------------------------------------------------------------
// Fodspor, der langsomt fyger til
// ---------------------------------------------------------------------------
export class Footprints {
    constructor(max = 240) {
        this.max = max;
        const geo = new THREE.CircleGeometry(0.11, 8).rotateX(-Math.PI / 2).scale(1, 1, 1.8);
        const mat = new THREE.MeshLambertMaterial({
            color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2,
        });
        this.mesh = new THREE.InstancedMesh(geo, mat, max);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 3;
        this.age = new Float32Array(max).fill(999);
        this.idx = 0;
        this.dark = new THREE.Color('#7f93ad');
        this.light = new THREE.Color('#eef4fb');
        this.tmpC = new THREE.Color();
        this.m4 = new THREE.Matrix4();
        this.q = new THREE.Quaternion();
        this.v = new THREE.Vector3();
        this.sc = new THREE.Vector3(1, 1, 1);
        this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < max; i++) {
            this.mesh.setMatrixAt(i, this.zero);
            this.mesh.setColorAt(i, this.light);
        }
        this.acc = 0;
    }

    add(x, y, z, yaw, scale = 1) {
        const i = this.idx;
        this.idx = (this.idx + 1) % this.max;
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
        this.sc.set(scale, 1, scale);
        this.m4.compose(this.v.set(x, y + 0.04, z), this.q, this.sc);
        this.mesh.setMatrixAt(i, this.m4);
        this.mesh.setColorAt(i, this.dark);
        this.age[i] = 0;
        this.mesh.instanceMatrix.needsUpdate = true;
        this.mesh.instanceColor.needsUpdate = true;
    }

    update(dt, storm) {
        this.acc += dt;
        if (this.acc < 0.25) return;
        const step = this.acc * (1 + storm * 5);
        this.acc = 0;
        for (let i = 0; i < this.max; i++) {
            if (this.age[i] > 60) continue;
            this.age[i] += step;
            const t = Math.min(1, this.age[i] / 60);
            this.mesh.setColorAt(i, this.tmpC.copy(this.dark).lerp(this.light, t));
            if (t >= 1) this.mesh.setMatrixAt(i, this.zero);
        }
        this.mesh.instanceColor.needsUpdate = true;
        this.mesh.instanceMatrix.needsUpdate = true;
    }
}

// ---------------------------------------------------------------------------
// Efterbehandling: lav opløsning, glød, kornet film, vignet, farvegradering
// ---------------------------------------------------------------------------
export class PostFX {
    constructor(renderer) {
        this.renderer = renderer;
        this.enabled = true;
        this.rt = new THREE.WebGLRenderTarget(4, 4, { samples: 4 });
        this.rt.texture.colorSpace = THREE.SRGBColorSpace;
        this.rt.texture.minFilter = THREE.LinearFilter;
        this.rt.texture.magFilter = THREE.LinearFilter;
        this.uniforms = {
            tDiffuse: { value: this.rt.texture },
            uRes: { value: new THREE.Vector2(4, 4) },
            uTime: { value: 0 },
            uNight: { value: 0 },
            uStorm: { value: 0 },
        };
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            depthTest: false,
            depthWrite: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
            fragmentShader: /* glsl */ `
                uniform sampler2D tDiffuse;
                uniform vec2 uRes;
                uniform float uTime, uNight, uStorm;
                varying vec2 vUv;
                float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
                vec3 lum3(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114))); }
                void main() {
                    vec2 uv = vUv;
                    vec2 px = 1.0 / uRes;
                    vec2 cd = uv - 0.5;
                    float ca = dot(cd, cd) * 2.2;
                    vec3 c;
                    c.r = texture2D(tDiffuse, uv + cd * px * 6.0 * ca).r;
                    c.g = texture2D(tDiffuse, uv).g;
                    c.b = texture2D(tDiffuse, uv - cd * px * 6.0 * ca).b;
                    // Billig glød
                    vec3 b = vec3(0.0);
                    for (int i = 0; i < 8; i++) {
                        float a = float(i) * 0.785398;
                        vec2 o = vec2(cos(a), sin(a));
                        b += max(texture2D(tDiffuse, uv + o * px * 3.5).rgb - 0.55, 0.0);
                        b += max(texture2D(tDiffuse, uv + o * px * 9.0).rgb - 0.55, 0.0) * 0.6;
                    }
                    c += b * 0.16;
                    vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
                    // Farvegradering: kølige skygger, varme højlys, let afmættet
                    float l = dot(g, vec3(0.299, 0.587, 0.114));
                    g = mix(lum3(g), g, 0.88);
                    g += vec3(-0.02, 0.01, 0.05) * (1.0 - l) + vec3(0.03, 0.01, -0.02) * l;
                    g = mix(g, g * g * (3.0 - 2.0 * g), 0.3);
                    g = mix(g, g + vec3(0.03, 0.04, 0.06), uStorm * 0.5);
                    // Vignet
                    float v = smoothstep(0.95, 0.3, length(cd * vec2(1.1, 1.0)));
                    g *= mix(0.62, 1.0, v);
                    // Filmkorn + svage scanlines
                    float n = hash(floor(uv * uRes) + fract(uTime * 7.3) * 91.7) - 0.5;
                    g += n * mix(0.045, 0.07, uNight);
                    g *= 0.975 + 0.025 * sin(uv.y * uRes.y * 3.14159);
                    gl_FragColor = vec4(g, 1.0);
                }`,
        }));
        this.scene = new THREE.Scene();
        this.scene.add(this.quad);
        this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    /** Returnerer den interne opløsning (højde i pixels). */
    setSize(w, h) {
        const budget = 720 * 540;
        const k = Math.min(this.renderer.getPixelRatio(), Math.sqrt(budget / (w * h)));
        const iw = Math.max(2, Math.round(w * k)), ih = Math.max(2, Math.round(h * k));
        this.rt.setSize(iw, ih);
        this.uniforms.uRes.value.set(iw, ih);
        return ih;
    }

    render(scene, camera) {
        if (!this.enabled) {
            this.renderer.setRenderTarget(null);
            this.renderer.render(scene, camera);
            return;
        }
        this.renderer.setRenderTarget(this.rt);
        this.renderer.render(scene, camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.scene, this.cam);
    }
}
