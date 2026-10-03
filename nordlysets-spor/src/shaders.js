import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Fælles GLSL
// ---------------------------------------------------------------------------
export const GLSL_COMMON = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec3 hash32(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}
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
`;

export const GLSL_AURORA = /* glsl */ `
vec3 aurora(vec2 p, float t) {
    vec3 col = vec3(0.0);
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
        col += vec3(0.62, 0.2, 0.9) * fringe * rays * rays * fade * 0.2;
    }
    return col;
}
`;

// Lys-/kamera-data som sne og is deler
export const lightUniforms = {
    uTime: { value: 0 },
    uATime: { value: 0 },
    uAurora: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightCol: { value: new THREE.Color(1, 1, 1) },
    uEye: { value: new THREE.Vector3() },
    uPx: { value: 0.04 },
    uGlint: { value: 1 },
    uShadowTint: { value: 1 },
    uFire0: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFire1: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFireCol: { value: new THREE.Color('#ff8a3a') },
};

// Glimt: ét mikrofacet pr. celle (~5 px). Kun facetter, der spejler lyset mod øjet, lyser op.
export const GLSL_GLINT = /* glsl */ `
float glint(vec3 wp, vec3 N, vec3 L, vec3 V, float density) {
    float cs = uPx * 5.0;
    vec2 g = wp.xz / cs;
    vec2 id = floor(g);
    vec3 h = hash32(id);
    vec2 c = 0.2 + 0.6 * h.xy;
    float dpx = length((fract(g) - c) * cs) / uPx;
    float spot = smoothstep(1.15, 0.2, dpx);
    if (spot <= 0.0) return 0.0;
    vec3 r = hash32(id + 19.19) * 2.0 - 1.0;
    vec3 mn = normalize(N * 0.7 + r);
    mn.y = abs(mn.y);
    vec3 wob = vec3(sin(uTime * 0.6 + h.z * 6.3), 0.0, cos(uTime * 0.45 + h.x * 6.3)) * 0.012;
    vec3 H = normalize(L + V + wob);
    float lo = 1.0 - 0.02 * density;
    float k = smoothstep(lo, 1.0 - (1.0 - lo) * 0.1, dot(mn, H));
    return spot * k * k * (0.5 + h.z);
}
`;

// ---------------------------------------------------------------------------
// Sne-terræn: Lambert + vindriller, kornet albedo, blå skygger, nordlysskær og glimt
// ---------------------------------------------------------------------------
export function makeSnowMaterial() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, lightUniforms);
        sh.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWN;\n' + sh.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vWN = normalize(mat3(modelMatrix) * objectNormal);`
        );
        sh.fragmentShader = /* glsl */ `
uniform float uTime, uATime, uAurora, uPx, uGlint, uShadowTint;
uniform vec3 uLightDir, uLightCol, uEye, uFireCol;
uniform vec4 uFire0, uFire1;
varying vec3 vWPos;
varying vec3 vWN;
${GLSL_COMMON}
${GLSL_AURORA}
${GLSL_GLINT}
float sastrugi(vec2 p, out vec2 grad) {
    vec2 d = vec2(0.8, 0.6), d2 = vec2(0.45, 0.89);
    float warp = noise(p * 0.22) * 5.0 + noise(p * 0.9) * 1.2;
    float k = 4.5;
    float arg = dot(p, d) * k + warp;
    float arg2 = dot(p, d2) * 7.0 + warp * 1.3;
    float amp = smoothstep(0.3, 0.85, noise(p * 0.08 + 7.0)) * (0.6 + 0.4 * noise(p * 0.6));
    float amp2 = 0.35 * smoothstep(0.4, 0.9, noise(p * 0.17 - 3.0));
    grad = d * k * cos(arg) * amp + d2 * 7.0 * cos(arg2) * amp2;
    return sin(arg) * amp + sin(arg2) * amp2;
}
` + sh.fragmentShader
            .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
    float gSnowy = smoothstep(0.42, 0.75, dot(diffuseColor.rgb, vec3(0.3333)));
    vec2 sgrad;
    float sz = sastrugi(vWPos.xz, sgrad);
    float grain = noise(vWPos.xz * 2.7) * 0.6 + noise(vWPos.xz * 8.3) * 0.4;
    diffuseColor.rgb *= 1.0 + ((grain - 0.5) * 0.07 + sz * 0.02) * gSnowy;
    float lowK = smoothstep(1.4, 0.0, vWPos.y) * gSnowy;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.88, 0.94, 1.04), lowK * 0.7);`)
            .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
    float rippleFade = smoothstep(0.09, 0.035, uPx) * gSnowy;
    vec3 pW = vec3(-sgrad.x, 0.0, -sgrad.y) * 0.017 * rippleFade;
    normal = normalize(normal + (viewMatrix * vec4(pW, 0.0)).xyz);
    vec3 gN = normalize(vWN + pW);`)
            .replace('#include <opaque_fragment>', /* glsl */ `
    float gShadow = 1.0;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        gShadow = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize,
            directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias,
            directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
    #endif
    outgoingLight *= mix(vec3(1.0), vec3(0.76, 0.88, 1.16), (1.0 - gShadow) * uShadowTint * gSnowy);
    const vec2 SR = vec2(0.70710678, -0.70710678);
    const vec2 SU = vec2(-0.70710678, -0.70710678);
    if (uAurora > 0.01) {
        vec3 aur = aurora(vec2(dot(vWPos.xz, SR), dot(vWPos.xz, SU)) * 0.55, uATime) * uAurora;
        outgoingLight += aur * diffuseColor.rgb * 0.16;
    }
    vec3 Vv = normalize(uEye - vWPos);
    vec3 gcol = uLightCol * glint(vWPos, gN, normalize(uLightDir), Vv, 1.0) * gShadow;
    if (uFire0.w > 0.0) {
        vec3 d0 = uFire0.xyz - vWPos; float l0 = length(d0);
        gcol += uFireCol * glint(vWPos, gN, d0 / l0, Vv, 1.6) * uFire0.w / (1.0 + l0 * l0 * 0.3);
    }
    if (uFire1.w > 0.0) {
        vec3 d1 = uFire1.xyz - vWPos; float l1 = length(d1);
        gcol += uFireCol * glint(vWPos, gN, d1 / l1, Vv, 1.6) * uFire1.w / (1.0 + l1 * l1 * 0.3);
    }
    outgoingLight += gcol * uGlint * gSnowy * 1.5;
    #include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'snow-v3';
    return mat;
}

// ---------------------------------------------------------------------------
// Flammer: støjbaseret billboard (additiv)
// ---------------------------------------------------------------------------
export const flameUniforms = { uTime: { value: 0 } };
const FLAME_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLAME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uPower;
uniform float uWide;
varying vec2 vUv;
${GLSL_COMMON}
void main() {
    vec2 uv = vUv;
    float t = uTime * 1.6 + uSeed;
    vec2 q = vec2(uv.x - 0.5, uv.y);
    float n = fbm(vec2(q.x * 4.0 + uSeed, q.y * 3.0 - t * 2.2));
    float n2 = noise(vec2(q.x * 9.0 + uSeed * 3.0, q.y * 6.0 - t * 4.0));
    float width = mix(0.42, 0.05, pow(uv.y, mix(0.8, 3.0, uWide)));
    float sway = (n - 0.5) * 0.22 * uv.y + sin(t * 1.3 + uSeed) * 0.03 * uv.y;
    float shape = 1.0 - smoothstep(width * 0.35, width, abs(q.x + sway));
    float body = shape * smoothstep(1.0, 0.2, uv.y + (n2 - 0.5) * 0.4) * smoothstep(0.0, 0.1, uv.y);
    float f = clamp(body * (0.7 + n * 0.7) * uPower, 0.0, 1.6);
    vec3 col = mix(vec3(0.85, 0.1, 0.01), vec3(1.0, 0.5, 0.1), smoothstep(0.1, 0.6, f));
    col = mix(col, vec3(1.0, 0.93, 0.72), smoothstep(0.75, 1.25, f));
    gl_FragColor = vec4(col * f * 1.7, 1.0);
}`;

export function makeFlame(w, h, seed, wide = 0) {
    const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: flameUniforms.uTime, uSeed: { value: seed }, uPower: { value: 1 }, uWide: { value: wide } },
        vertexShader: FLAME_VERT,
        fragmentShader: FLAME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), mat);
    m.userData.billboard = true;
    m.renderOrder = 7;
    return m;
}
