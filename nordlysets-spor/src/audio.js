// Procedurel lyd via WebAudio — ingen lydfiler nødvendige.
export class Sound {
    constructor() {
        this.ctx = null;
        this.muted = false;
    }

    init() {
        if (this.ctx) {
            if (this.ctx.state === 'suspended') this.ctx.resume();
            return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.master.connect(ctx.destination);

        const len = ctx.sampleRate * 2;
        const brown = ctx.createBuffer(1, len, ctx.sampleRate);
        const white = ctx.createBuffer(1, len, ctx.sampleRate);
        const bd = brown.getChannelData(0), wd = white.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            wd[i] = w;
            last = (last + 0.02 * w) / 1.02;
            bd[i] = last * 3.5;
        }
        this.white = white;

        // Vind: brun støj gennem et svajende båndpas
        const src = ctx.createBufferSource();
        src.buffer = brown;
        src.loop = true;
        this.windBp = ctx.createBiquadFilter();
        this.windBp.type = 'bandpass';
        this.windBp.frequency.value = 450;
        this.windBp.Q.value = 0.6;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0;
        src.connect(this.windBp).connect(this.windGain).connect(this.master);
        src.start();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.13;
        const lg = ctx.createGain();
        lg.gain.value = 220;
        lfo.connect(lg).connect(this.windBp.frequency);
        lfo.start();

        // Hylen i stormen
        const src2 = ctx.createBufferSource();
        src2.buffer = white;
        src2.loop = true;
        this.whBp = ctx.createBiquadFilter();
        this.whBp.type = 'bandpass';
        this.whBp.frequency.value = 900;
        this.whBp.Q.value = 14;
        this.whGain = ctx.createGain();
        this.whGain.gain.value = 0;
        src2.connect(this.whBp).connect(this.whGain).connect(this.master);
        src2.start();
        const lfo2 = ctx.createOscillator();
        lfo2.frequency.value = 0.21;
        const lg2 = ctx.createGain();
        lg2.gain.value = 300;
        lfo2.connect(lg2).connect(this.whBp.frequency);
        lfo2.start();
    }

    /** Stille stemningsmusik: bløde akkorder + spredte klokketoner (flere om natten). */
    startMusic() {
        if (!this.ctx || this.music) return;
        const ctx = this.ctx;
        const out = ctx.createGain();
        out.gain.value = 0;
        out.connect(this.master);
        const delay = ctx.createDelay(1.5);
        delay.delayTime.value = 0.42;
        const fb = ctx.createGain();
        fb.gain.value = 0.45;
        const dlp = ctx.createBiquadFilter();
        dlp.type = 'lowpass';
        dlp.frequency.value = 2200;
        delay.connect(dlp).connect(fb).connect(delay);
        delay.connect(out);
        const padLP = ctx.createBiquadFilter();
        padLP.type = 'lowpass';
        padLP.frequency.value = 850;
        const pad = ctx.createGain();
        pad.gain.value = 0.32;
        padLP.connect(pad);
        pad.connect(out);
        pad.connect(delay);
        const voices = [0, 1, 2].map(() => {
            const g = ctx.createGain();
            g.gain.value = 0.33;
            g.connect(padLP);
            const oscs = [-4, 4].map((det, i) => {
                const o = ctx.createOscillator();
                o.type = i ? 'sine' : 'triangle';
                o.detune.value = det;
                o.connect(g);
                o.start();
                return o;
            });
            return { g, oscs };
        });
        this.music = { out, delay, voices, chord: -1, t: 0, bellT: 4 };
        this.nextChord();
    }

    nextChord() {
        const CH = [[146.83, 220, 293.66], [116.54, 174.61, 233.08], [130.81, 196, 261.63], [110, 164.81, 220]];
        const m = this.music;
        m.chord = (m.chord + 1) % CH.length;
        const t = this.ctx.currentTime;
        m.voices.forEach((v, i) => v.oscs.forEach((o) => o.frequency.setTargetAtTime(CH[m.chord][i], t, 1.8)));
    }

    bell() {
        const NOTES = [587.33, 698.46, 783.99, 880, 1046.5, 1174.66];
        const f = NOTES[Math.floor(Math.random() * NOTES.length)];
        const ctx = this.ctx, t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        o.connect(g);
        g.connect(this.music.out);
        g.connect(this.music.delay);
        o.start(t);
        o.stop(t + 2.5);
    }

    musicUpdate(dt, night, storm) {
        const m = this.music;
        if (!m) return;
        const vol = (0.5 + night * 0.35) * (1 - storm * 0.6);
        m.out.gain.setTargetAtTime(vol, this.ctx.currentTime, 2.5);
        m.t += dt;
        if (m.t > 10) { m.t = 0; this.nextChord(); }
        m.bellT -= dt;
        if (m.bellT <= 0) {
            m.bellT = (night > 0.5 ? 1.4 : 3.5) + Math.random() * 3.5;
            this.bell();
        }
    }

    setMuted(m) {
        this.muted = m;
        if (this.master) this.master.gain.value = m ? 0 : 0.7;
    }

    wind(level) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        this.windGain.gain.setTargetAtTime(0.06 + level * 0.5, t, 0.8);
        this.windBp.frequency.setTargetAtTime(380 + level * 500, t, 1);
        this.whGain.gain.setTargetAtTime(level * level * 0.1, t, 1);
    }

    burst(freq, q, dur, vol, type = 'bandpass', delay = 0) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime + delay;
        const s = ctx.createBufferSource();
        s.buffer = this.white;
        const f = ctx.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        s.connect(f).connect(g).connect(this.master);
        s.start(t, Math.random() * 1.5, dur + 0.05);
    }

    tone(freq, dur, type = 'sine', vol = 0.2, slideTo = 0, delay = 0) {
        if (!this.ctx) return;
        const ctx = this.ctx, t = ctx.currentTime + delay;
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + dur + 0.05);
    }

    step() { this.burst(1800 + Math.random() * 1200, 0.8, 0.07, 0.1); }
    iceStep() { this.burst(4200, 2, 0.05, 0.05, 'highpass'); }
    chop() { this.burst(700 + Math.random() * 300, 1.5, 0.14, 0.4); }
    crackle() { this.burst(2500 + Math.random() * 2000, 1, 0.03, 0.05 + Math.random() * 0.1, 'highpass'); }
    whoosh() { this.burst(900, 0.7, 0.3, 0.25); }
    splash() { this.burst(600, 0.5, 0.4, 0.25, 'lowpass'); }
    craft() { this.tone(660, 0.15, 'triangle', 0.15); this.tone(880, 0.25, 'triangle', 0.15, 0, 0.1); }
    eat() { this.burst(1200, 3, 0.08, 0.2); this.burst(1000, 3, 0.08, 0.2, 'bandpass', 0.12); }
    hurt() { this.tone(160, 0.35, 'square', 0.18, 50); }
    growl() { this.tone(90, 0.9, 'sawtooth', 0.12, 60); this.burst(300, 1, 0.8, 0.15, 'lowpass'); }
    chime() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.4, 'sine', 0.1, 0, i * 0.13)); }
    whine() { this.tone(900, 0.5, 'sine', 0.06, 1300); }

    bark() {
        [0, 0.2].forEach((d) => {
            this.tone(520, 0.12, 'sawtooth', 0.12, 240, d);
            this.burst(900, 1, 0.1, 0.12, 'bandpass', d);
        });
    }
}
