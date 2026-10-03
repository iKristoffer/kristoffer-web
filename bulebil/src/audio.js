// Fully synthesized WebAudio: engine drone, crash impacts, glass, explosions, UI blips.
export class Sound {
  constructor() { this.ctx = null; this.recent = []; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.slowFilter = ctx.createBiquadFilter();
    this.slowFilter.type = 'lowpass'; this.slowFilter.frequency.value = 20000;
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    this.master.connect(this.slowFilter).connect(comp).connect(ctx.destination);
    const len = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine
    this.eGain = ctx.createGain(); this.eGain.gain.value = 0;
    this.eFilter = ctx.createBiquadFilter(); this.eFilter.type = 'lowpass'; this.eFilter.frequency.value = 800; this.eFilter.Q.value = 3;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o1.connect(this.eFilter); this.o2.connect(this.eFilter);
    this.eFilter.connect(this.eGain).connect(this.master);
    this.o1.start(); this.o2.start();
  }

  get t() { return this.ctx.currentTime; }

  engine(rpm, throttle, on) {
    if (!this.ctx) return;
    const f = 38 + rpm * 150;
    this.o1.frequency.setTargetAtTime(f, this.t, 0.04);
    this.o2.frequency.setTargetAtTime(f * 0.5 + 1.5, this.t, 0.04);
    this.eFilter.frequency.setTargetAtTime(300 + throttle * 1500 + rpm * 1400, this.t, 0.05);
    this.eGain.gain.setTargetAtTime(on ? 0.05 + throttle * 0.07 : 0, this.t, 0.08);
  }

  slowmo(on) {
    if (!this.ctx) return;
    this.slowFilter.frequency.setTargetAtTime(on ? 900 : 20000, this.t, 0.15);
  }

  noiseBurst({ dur, vol, type = 'bandpass', freq = 800, q = 0.8, freqEnd, rate = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, this.t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, this.t);
    g.gain.exponentialRampToValueAtTime(0.001, this.t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(this.t, Math.random() * 1.5, dur + 0.1);
  }
  tone({ type = 'sine', f0, f1, dur, vol, delay = 0 }) {
    const ctx = this.ctx, t = this.t + delay;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  limited() {
    const now = performance.now();
    this.recent = this.recent.filter(t => now - t < 120);
    if (this.recent.length > 10) return true;
    this.recent.push(now);
    return false;
  }

  crash(strength, dist) {
    if (!this.ctx || this.limited()) return;
    const vol = Math.min(1, strength / 28) / (1 + dist / 35);
    if (vol < 0.02) return;
    this.noiseBurst({ dur: 0.25 + Math.min(0.5, strength * 0.012), vol, freq: 300 + Math.random() * 900, q: 0.7, rate: 0.6 + Math.random() * 0.5 });
    this.tone({ f0: 90, f1: 35, dur: 0.25, vol: vol * 0.9 });
    for (let i = 0; i < 2; i++) this.tone({ type: 'triangle', f0: 300 + Math.random() * 1200, f1: 150 + Math.random() * 200, dur: 0.12 + Math.random() * 0.2, vol: vol * 0.12, delay: Math.random() * 0.05 });
  }

  glass(dist) {
    if (!this.ctx || this.limited()) return;
    const vol = 0.5 / (1 + dist / 30);
    this.noiseBurst({ dur: 0.35, vol, type: 'highpass', freq: 3500, q: 0.5 });
    for (let i = 0; i < 6; i++) this.tone({ f0: 3000 + Math.random() * 4000, dur: 0.08 + Math.random() * 0.15, vol: vol * 0.08, delay: Math.random() * 0.25 });
  }

  explosion(dist) {
    if (!this.ctx) return;
    const vol = 1.3 / (1 + dist / 60);
    this.noiseBurst({ dur: 2.2, vol, type: 'lowpass', freq: 1400, freqEnd: 80, q: 0.5, rate: 0.5 });
    this.tone({ f0: 70, f1: 25, dur: 1.2, vol: vol * 0.9 });
  }

  boost() { if (this.ctx) this.noiseBurst({ dur: 0.7, vol: 0.35, freq: 400, freqEnd: 2500, q: 2 }); }
  pickup(good = true) {
    if (!this.ctx) return;
    const notes = good ? [660, 880, 1320] : [440, 330, 220];
    notes.forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.12, vol: 0.12, delay: i * 0.07 }));
  }
  beep(high) { if (this.ctx) this.tone({ type: 'square', f0: high ? 1046 : 523, dur: high ? 0.5 : 0.18, vol: 0.15 }); }
}
