export class Input {
  constructor() {
    this.keys = new Set();
    this.pressedSet = new Set();
    this.gp = null;
    this.gpPrev = [];
    addEventListener('keydown', e => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressedSet.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }
  k(...codes) { return codes.some(c => this.keys.has(c)); }

  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find(Boolean);
    if (!p) { this.gp = null; return; }
    const btn = i => (p.buttons[i] ? p.buttons[i].value : 0);
    const edges = [0, 3, 9];
    for (const i of edges) {
      const now = btn(i) > 0.5;
      if (now && !this.gpPrev[i]) this.pressedSet.add({ 0: 'Space', 3: 'KeyR', 9: 'Escape' }[i]);
      this.gpPrev[i] = now;
    }
    const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0;
    this.gp = { steer: ax, thr: btn(7), brk: btn(6), boost: btn(2) > 0.5 || btn(5) > 0.5, hb: btn(1) > 0.5, fwd: -(p.axes[1] || 0) };
  }

  get throttle() { return Math.max(this.k('KeyW', 'ArrowUp') ? 1 : 0, this.gp?.thr || 0); }
  get brake() { return Math.max(this.k('KeyS', 'ArrowDown') ? 1 : 0, this.gp?.brk || 0); }
  get steer() {
    let s = (this.k('KeyD', 'ArrowRight') ? 1 : 0) - (this.k('KeyA', 'ArrowLeft') ? 1 : 0);
    if (this.gp && this.gp.steer) s = this.gp.steer;
    return s;
  }
  get handbrake() { return this.k('Space') || (this.gp?.hb ?? false); }
  get boost() { return this.k('ShiftLeft', 'ShiftRight') || !!this.gp?.boost; }
  pressed(code) { return this.pressedSet.has(code); }
  anyPressed() { return this.pressedSet.size > 0; }
  endFrame() { this.pressedSet.clear(); }
}
