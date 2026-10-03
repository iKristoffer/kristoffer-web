// Optional PlayStation 1 look. Chosen in the menu, stored in localStorage, applied at page load
// (shader chunks are patched before anything compiles, so switching reloads the page).
import * as THREE from 'three';

export const PS1 = (() => {
  try { return localStorage.getItem('bulebil.gfx') === 'ps1'; } catch { return false; }
})();

export function setGraphics(ps1) {
  try { localStorage.setItem('bulebil.gfx', ps1 ? 'ps1' : 'modern'); } catch { /* ignore */ }
  location.reload();
}

export const PS1_LINES = 360;       // vertical render resolution (240 was too crude)
export const PS1_TEX_DIV = 2;       // canvas textures are shrunk by this factor

if (PS1) {
  // Vertex snapping: clip-space xy rounded to the low-res pixel grid → the classic polygon wobble.
  // Only for vertices in front of the camera: with w ≈ 0 the divide blows up to inf/NaN and the
  // whole (large) triangle vanished — whole roads disappeared in the crash camera.
  const gy = PS1_LINES / 2, gx = (gy * innerWidth) / innerHeight;
  THREE.ShaderChunk.project_vertex += `
  if (gl_Position.w > 0.5) {
    vec2 grid = vec2(${gx.toFixed(1)}, ${gy.toFixed(1)});
    gl_Position.xy = floor(gl_Position.xy / gl_Position.w * grid + 0.5) / grid * gl_Position.w;
  }`;
}

// 18-bit colour with a soft 4×4 ordered dither, applied after tone mapping / sRGB output.
export const DitherShader = {
  uniforms: { tDiffuse: { value: null }, res: { value: new THREE.Vector2(320, 240) } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 res; varying vec2 vUv;
    float bayer(vec2 p) {
      int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
      int i = x + y * 4;
      float m[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
      return m[i] / 16.0 - 0.5;
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += bayer(floor(vUv * res)) * 0.6 / 63.0;
      c.rgb = floor(clamp(c.rgb, 0.0, 1.0) * 63.0 + 0.5) / 63.0;
      gl_FragColor = c;
    }`,
};

// Shrink a canvas texture and sample it with nearest filtering (no smoothing between texels).
export function ps1Canvas(c) {
  const w = Math.max(16, (c.width / PS1_TEX_DIV) | 0), h = Math.max(16, (c.height / PS1_TEX_DIV) | 0);
  const s = document.createElement('canvas');
  s.width = w; s.height = h;
  const g = s.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(c, 0, 0, w, h);
  return s;
}
export function ps1Texture(t) {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.anisotropy = 1;
  return t;
}
