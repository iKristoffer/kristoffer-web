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
import { LEVELS } from './levels.js';
import { PLAYER_CARS } from './config.js';
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
    this.toMenu();
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
  setGraphics(ps1) { if (ps1 !== PS1) setGraphics(ps1); }

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
    this.hud.showMenu(this.sel);
  }

  toMenu() {
    if (this.session) { this.session.dispose(); this.session = null; }
    this.audio.engine(0, 0, false);
    this.audio.slowmo(false);
    this.hud.showMenu(this.sel);
    this.renderPass.scene = this.menuScene;
  }

  startLevel(id) {
    this.sel.level = id;
    this.hud.hideMenu();
    document.getElementById('loading').classList.remove('hidden');
    setTimeout(() => {
      if (this.session) this.session.dispose();
      const def = LEVELS.find(l => l.id === id);
      const car = PLAYER_CARS.find(c => c.id === this.sel.car) || PLAYER_CARS[0];
      this.session = new Session(this, def, car);
      this.renderPass.scene = this.session.scene;
      document.getElementById('loading').classList.add('hidden');
      this.last = performance.now();
    }, 30);
  }

  restart() { if (this.sel.level) this.startLevel(this.sel.level); }

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
    if (this.session) {
      if (this.input.pressed('Escape')) this.toMenu();
      else if (this.input.pressed('KeyR')) this.restart();
      else this.session.update(dt);
    } else {
      this.turntable.rotation.y += dt * 0.4;
      const t = now * 0.0001;
      this.camera.position.set(Math.sin(t) * 1.5 + 6.2, 2.0, 6.2);
      this.camera.lookAt(0, 0.6, 0);
      if (this.camera.fov !== 40) { this.camera.fov = 40; this.camera.updateProjectionMatrix(); }
      if (this.input.pressed('Enter')) this.startLevel(this.sel.level || LEVELS[0].id);
    }
    this.input.endFrame();
    this.composer.render();
  }
}

new Game();
