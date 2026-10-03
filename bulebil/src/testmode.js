// Testkørsel: free driving on the circuit with lap timing. No traffic, no crash rules —
// the place to feel and tune the driving model (T opens the tuning panel).

const key = car => 'bulebil.bestlap.' + car;
export function loadBestLap(car) { try { return Number(localStorage.getItem(key(car))) || null; } catch { return null; } }
function saveBestLap(car, t) { try { localStorage.setItem(key(car), String(t)); } catch { /* ignore */ } }
export function fmtTime(t) {
  if (t == null) return '–';
  const m = Math.floor(t / 60), sec = t - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export class TestDriveMode {
  constructor(s) {
    this.s = s; this.def = s.def;
    this.state = 'runup'; this.stateT = 0; this.counting = false;
    this.lapOn = false; this.lapT = 0; this.lapNo = 0; this.last = null; this.half = false; this.idx = null;
    this.best = loadBestLap(s.carSpec.id);
    s.cam.mode = 'chase'; s.cam.snap = true;
    s.game.hud.testStart(this);
  }

  driveMode() { return 'drive'; }
  startCrash() {}
  onWreck() {}
  addBonus() {}

  frame(dt, inp) {
    const s = this.s, hud = s.game.hud, T = s.track;
    this.stateT += dt;
    s.timeScale = 1;
    if (inp.pressed('KeyT')) hud.toggleTune();

    // Lap timing: crossing from the last 20 % of the lap into the first 20 % is the line.
    // A lap only counts if the car passed the middle of the track in between.
    const p = s.player.body.position, i = T.nearest(p.x, p.z), N = T.N;
    if (this.idx != null) {
      if (i > N * 0.4 && i < N * 0.6) this.half = true;
      if (this.idx > N * 0.8 && i < N * 0.2) {
        if (this.lapOn && this.half) {
          this.last = this.lapT;
          this.lapNo++;
          if (!this.best || this.lapT < this.best) {
            this.best = this.lapT;
            saveBestLap(s.carSpec.id, this.best);
            hud.msg('NY BEDSTE TID! ' + fmtTime(this.lapT), 'gold');
          } else hud.msg(fmtTime(this.lapT), 'small');
        }
        if (!this.lapOn) this.lapNo = Math.max(this.lapNo, 1);
        this.lapOn = true; this.lapT = 0; this.half = false;
      } else if (this.idx < N * 0.2 && i > N * 0.8) {
        this.lapOn = false; this.half = false; // backwards over the line voids the lap
      }
    }
    this.idx = i;
    if (this.lapOn) this.lapT += dt;

    const sp = Math.max(0, s.player.speedFwd());
    const gearPos = (sp / s.driver.spec.maxSpeed) * 4;
    s.game.audio.engine(0.25 + (gearPos % 1) * 0.6 + Math.min(gearPos, 4) * 0.04, inp.throttle, true);
    hud.testUpdate(this);
  }

  // R: put the car back on the tarmac at the nearest point, facing along the track.
  reset() {
    const s = this.s, T = s.track, b = s.player.body;
    const sm = T.samples[T.nearest(b.position.x, b.position.z)];
    s.player.setPose(sm.x, sm.z, Math.atan2(sm.tx, sm.tz));
    s.driver.steer = 0;
    this.lapOn = false; this.half = false; this.idx = null;
    s.cam.snap = true;
  }
}
