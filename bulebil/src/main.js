import { PS1, PS1_LINES, DitherShader, setGraphics } from './ps1.js';
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Hud } from './hud.js';
import { Session } from './session.js';
import { LEVELS, TEST_TRACK } from './levels.js';
import { PLAYER_CARS, DRIVE, DRIVE_DEFAULTS, saveDrive } from './config.js';
import { MODELS } from './vehicleModel.js';

class Game {
  constructor() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: !PS1, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    r.setPixelRatio(this.pixelRatio());
    if (PS1) r.domElement.style.imageRendering = 'pixelated';
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.62;
    r.shadowMap.enabled = !PS1;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('app').appendChild(r.domElement);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 6000);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(140));
    this.env = this.makeEnv();

    this.input = new Input();
    this.audio = new Sound();
    this.hud = new Hud(this);
    this.sel = { car: 'gt', level: null };
    try { this.sel.car = localStorage.getItem('bulebil.car') || 'gt'; } catch { /* ignore */ }

    this.composer = new EffectComposer(r);
    this.renderPass = new RenderPass(new THREE.Scene(), this.camera);
    this.composer.addPass(this.renderPass);
    if (!PS1) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    if (PS1) {
      this.dither = new ShaderPass(DitherShader);
      this.composer.addPass(this.dither);
      this.updateDitherRes();
    }

    addEventListener('resize', () => this.resize());
    addEventListener('pointerdown', () => this.audio.unlock());
    addEventListener('keydown', () => this.audio.unlock());

    this.buildMenuScene();
    let ret = null;
    try { ret = sessionStorage.getItem('bulebil.return'); sessionStorage.removeItem('bulebil.return'); } catch { /* ignore */ }
    this.toMenu(ret || 'main');
    document.getElementById('loading').classList.add('hidden');
    this.last = performance.now();
    r.setAnimationLoop(() => this.frame());
    window.game = this; // debugging handle
  }

  // PS1: render ~240 lines and let the browser upscale with hard pixels.
  pixelRatio() { return PS1 ? PS1_LINES / innerHeight : Math.min(devicePixelRatio, 2); }
  updateDitherRes() {
    if (this.dither) this.dither.uniforms.res.value.set(Math.round(innerWidth * this.pixelRatio()), PS1_LINES);
  }

  makeEnv() {
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.5; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDir);
    const s = new THREE.Scene();
    s.add(sky);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3d3a36 }));
    floor.position.y = -20;
    s.add(floor);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const rt = pm.fromScene(s, 0, 0.1, 3000);
    pm.dispose();
    return rt.texture;
  }

  buildMenuScene() {
    const s = this.menuScene = new THREE.Scene();
    s.environment = this.env;
    s.background = new THREE.Color(0x07080c);
    s.fog = new THREE.Fog(0x07080c, 14, 40);
    const key = new THREE.SpotLight(0xffe2c0, 400, 40, 0.5, 0.6);
    key.position.set(4, 9, 5); key.castShadow = true;
    s.add(key, key.target);
    const rim = new THREE.SpotLight(0xff6a00, 250, 40, 0.6, 0.6);
    rim.position.set(-6, 4, -6);
    s.add(rim, rim.target);
    s.add(new THREE.HemisphereLight(0x8090b0, 0x101010, 0.4));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.35, metalness: 0.4 }));
    floor.receiveShadow = true;
    s.add(floor);
    this.turntable = new THREE.Group();
    s.add(this.turntable);
    this.setMenuCar();
  }

  setMenuCar() {
    this.turntable.clear();
    const spec = PLAYER_CARS.find(c => c.id === this.sel.car) || PLAYER_CARS[0];
    const kit = MODELS[spec.model].build(spec.color);
    kit.model.position.y = 0;
    kit.model.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.turntable.add(kit.model);
  }

  selectCar(id) {
    this.sel.car = id;
    try { localStorage.setItem('bulebil.car', id); } catch { /* ignore */ }
    this.setMenuCar();
  }

  toMenu(screen = 'main') {
    if (this.session) { this.session.dispose(); this.session = null; }
    this.paused = false;
    this.audio.engine(0, 0, false);
    this.audio.slowmo(false);
    this.hud.showMenu(screen);
    this.renderPass.scene = this.menuScene;
  }

  startSession(def) {
    this.sel.def = def;
    this.paused = false;
    this.hud.hideMenu();
    this.hud.hidePause();
    document.getElementById('loading').classList.remove('hidden');
    setTimeout(() => {
      if (this.session) this.session.dispose();
      const car = PLAYER_CARS.find(c => c.id === this.sel.car) || PLAYER_CARS[0];
      this.session = new Session(this, def, car);
      this.renderPass.scene = this.session.scene;
      document.getElementById('loading').classList.add('hidden');
      this.last = performance.now();
    }, 30);
  }
  startLevel(id) { this.startSession(LEVELS.find(l => l.id === id)); }
  startTest() { this.startSession(TEST_TRACK); }
  restart() { if (this.sel.def) this.startSession(this.sel.def); }

  pause() {
    this.paused = true;
    this.audio.engine(0, 0, false);
    this.audio.slowmo(false);
    this.hud.showPause();
  }
  resume() {
    this.paused = false;
    this.hud.hidePause();
    this.hud.hideMenu();
    this.last = performance.now();
  }
  pauseAction(a) {
    if (a === 'resume') this.resume();
    else if (a === 'restart') this.restart();
    else if (a === 'settings') { this.hud.hidePause(); this.hud.showMenu('settings', true); }
    else if (a === 'menu') this.toMenu();
  }

  setGraphics(ps1) {
    if (ps1 === PS1) return;
    try { sessionStorage.setItem('bulebil.return', 'settings'); } catch { /* ignore */ }
    setGraphics(ps1);
  }
  setVolume(v) { this.audio.setVolume(v); }
  resetRecords() {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('bulebil.best') ) localStorage.removeItem(k); } catch { /* ignore */ }
  }
  resetDrive() { Object.assign(DRIVE, DRIVE_DEFAULTS); saveDrive(); }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(this.pixelRatio());
    this.composer.setSize(innerWidth, innerHeight);
    this.updateDitherRes();
  }

  frame() {
    const now = performance.now();
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.input.update();
    const esc = this.input.pressed('Escape');
    if (this.session) {
      if (this.hud.menuOpen()) { if (esc) this.hud.back(); }
      else if (this.paused) { if (esc) this.resume(); }
      else if (esc) { if (this.session.mode.state === 'results') this.toMenu(); else this.pause(); }
      else if (this.input.pressed('KeyR')) { if (this.session.mode.reset) this.session.mode.reset(); else this.restart(); }
      else this.session.update(dt);
    } else {
      if (esc) this.hud.back();
      this.turntable.rotation.y += dt * 0.4;
      const t = now * 0.0001;
      this.camera.position.set(Math.sin(t) * 1.5 + 7.6, 2.3, 7.6);
      this.camera.lookAt(-2.2, 0.9, 1.2);
      if (this.camera.fov !== 40) { this.camera.fov = 40; this.camera.updateProjectionMatrix(); }
    }
    this.input.endFrame();
    this.composer.render();
  }
}

new Game();
