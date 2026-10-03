import { fmtMoney } from './util.js';
import { MEDALS, PLAYER_CARS, GAME_TITLE, DRIVE, DRIVE_DEFAULTS, DRIVE_PARAMS, saveDrive } from './config.js';
import { fmtTime } from './testmode.js';
import { LEVELS } from './levels.js';
import { PS1 } from './ps1.js';

const $ = id => document.getElementById(id);

export function loadBest(id) {
  try { return JSON.parse(localStorage.getItem('bulebil.best.' + id)) || null; } catch { return null; }
}
export function saveBest(id, rec) {
  try { localStorage.setItem('bulebil.best.' + id, JSON.stringify(rec)); } catch { /* storage unavailable */ }
}
export function medalFor(score, targets) {
  let m = -1;
  targets.forEach((t, i) => { if (score >= t) m = i; });
  return m;
}

export class Hud {
  constructor(game) {
    this.game = game;
    this.shownCash = 0;
    $('logo').textContent = GAME_TITLE;
    this.wireMenus();
    document.title = GAME_TITLE[0] + GAME_TITLE.slice(1).toLowerCase();
  }

  // ---------- menus ----------
  // Screens: main / crash / test / settings. Keyboard: arrows move focus, Enter activates,
  // Esc goes back (handled by Game.frame so it never also reaches the game).
  wireMenus() {
    for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => this.screen(b.dataset.go);
    for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => this.back();
    for (const b of document.querySelectorAll('[data-p]')) b.onclick = () => this.game.pauseAction(b.dataset.p);
    $('btn-test-go').onclick = () => this.game.startTest();
    for (const b of $('set-gfx').querySelectorAll('button')) b.onclick = () => this.game.setGraphics(b.dataset.v === 'ps1');
    $('set-vol').oninput = e => { this.game.setVolume(e.target.value / 100); $('set-vol-v').textContent = e.target.value; };
    $('set-reset').onclick = () => {
      if (!this.confirmReset) { this.confirmReset = true; $('set-reset').textContent = 'Er du sikker?'; return; }
      this.confirmReset = false;
      $('set-reset').textContent = 'Nulstil alle';
      this.game.resetRecords();
      $('set-note').textContent = 'Alle rekorder og omgangstider er nulstillet.';
    };
    addEventListener('keydown', e => this.menuKey(e));
    $('tune-close').onclick = () => this.toggleTune(false);
    $('tune-reset').onclick = () => { this.game.resetDrive(); this.renderTune(); };
  }

  menuOpen() { return !$('menu').classList.contains('hidden'); }
  pauseOpen() { return !$('pause').classList.contains('hidden'); }

  focusables() {
    const root = this.menuOpen() ? $('screen-' + this.cur) : this.pauseOpen() ? $('pause') : null;
    if (!root) return [];
    return [...root.querySelectorAll('.mbtn:not([disabled]), .card, .seg button, .segbtn, input')];
  }

  menuKey(e) {
    const list = this.focusables();
    if (!list.length) return;
    const a = document.activeElement, i = list.indexOf(a);
    const onRange = a && a.type === 'range';
    let d = 0;
    if (e.code === 'ArrowDown' || (e.code === 'ArrowRight' && !onRange)) d = 1;
    if (e.code === 'ArrowUp' || (e.code === 'ArrowLeft' && !onRange)) d = -1;
    if (d) { e.preventDefault(); list[(i + d + list.length) % list.length].focus(); return; }
    if ((e.code === 'Enter' || e.code === 'Space') && a && list.includes(a) && !onRange) { e.preventDefault(); a.click(); }
  }

  showMenu(screen = 'main', over = false) {
    $('hud').classList.add('hidden');
    $('results').classList.add('hidden');
    $('pause').classList.add('hidden');
    $('menu').classList.remove('hidden');
    $('menu').classList.toggle('over', over);
    this.fromPause = over;
    this.screen(screen);
  }

  screen(name) {
    this.cur = name;
    for (const el of document.querySelectorAll('#menu .screen')) el.classList.toggle('hidden', el.id !== 'screen-' + name);
    $('logo').classList.toggle('hidden', this.fromPause);
    $('sub').classList.toggle('hidden', this.fromPause);
    if (name === 'crash' || name === 'test') this.renderCars();
    if (name === 'crash') this.renderLevels();
    if (name === 'settings') this.renderSettings();
    const first = this.focusables().find(el => el.classList.contains('sel')) || this.focusables()[0];
    if (first) first.focus({ preventScroll: true });
  }

  back() {
    if (this.fromPause) { this.hideMenu(); this.showPause(); return; }
    if (this.cur !== 'main') this.screen('main');
  }

  renderCars() {
    for (const row of document.querySelectorAll('.carrow')) {
      row.innerHTML = '';
      for (const c of PLAYER_CARS) {
        const d = document.createElement('div');
        d.className = 'card carbtn' + (c.id === this.game.sel.car ? ' sel' : '');
        d.tabIndex = 0;
        d.innerHTML = `<h3>${c.name}</h3><p>${c.desc}</p>`;
        d.onclick = () => { this.game.selectCar(c.id); this.renderCars(); row.children[PLAYER_CARS.indexOf(c)].focus(); };
        row.appendChild(d);
      }
    }
  }

  renderLevels() {
    const lr = $('levelrow');
    lr.innerHTML = '';
    for (const L of LEVELS) {
      const best = loadBest(L.id);
      const d = document.createElement('div');
      d.className = 'card';
      d.tabIndex = 0;
      const medal = best && best.medal >= 0 ? `<span style="color:${MEDALS[best.medal].color}">● ${MEDALS[best.medal].name}</span> · ` : '';
      d.innerHTML = `<h3>${L.name}</h3><p>${L.blurb}</p><div class="best">${best ? medal + 'Rekord ' + fmtMoney(best.score) : 'Ikke spillet'}</div>`;
      d.onclick = () => this.game.startLevel(L.id);
      lr.appendChild(d);
    }
  }

  renderSettings() {
    for (const b of $('set-gfx').querySelectorAll('button')) b.classList.toggle('on', (b.dataset.v === 'ps1') === PS1);
    const v = Math.round(this.game.audio.vol * 100);
    $('set-vol').value = v; $('set-vol-v').textContent = v;
    $('set-note').textContent = 'Skift af grafik genindlæser spillet.';
  }

  hideMenu() { $('menu').classList.add('hidden'); }

  showPause() {
    $('pause').classList.remove('hidden');
    $('pause').querySelector('.mbtn').focus();
  }
  hidePause() { $('pause').classList.add('hidden'); }

  // ---------- test drive ----------
  testStart(m) {
    $('hud').classList.remove('hidden');
    $('results').classList.add('hidden');
    for (const id of ['lvl', 'scorebox', 'breakerbox', 'impactbox', 'prompt', 'banner', 'countdown']) $(id).classList.add('hidden');
    $('lapbox').classList.remove('hidden');
    $('msgs').innerHTML = '';
    this.test = m;
    this.toggleTune(false);
  }

  testUpdate(m) {
    const s = m.s, d = s.driver;
    $('laptime').textContent = m.lapOn ? fmtTime(m.lapT) : 'Kør over stregen';
    $('laprows').innerHTML = `Omgang ${m.lapNo || '–'}<br>Sidste ${fmtTime(m.last)}<br>Bedste ${fmtTime(m.best)}`;
    const g = Math.abs(d.latAcc || 0) / 9.82;
    $('telemetry').innerHTML = `Sideglid ${Math.abs(d.lat || 0).toFixed(1)} m/s · ${g.toFixed(2)} g sideværts`
      + (d.offroad ? ' · <span class="off">I græsset</span>' : '');
    const kmh = Math.round(s.player.body.velocity.length() * 3.6);
    $('speed').innerHTML = `${kmh}<small>km/t</small>`;
    $('boostbar').firstElementChild.style.width = (d.boost * 100) + '%';
    if (!$('tune').classList.contains('hidden')) this.updateTuneValues();
  }

  toggleTune(force) {
    const el = $('tune');
    const show = force ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
    if (show) this.renderTune();
  }

  renderTune() {
    const rows = $('tune-rows');
    rows.innerHTML = '';
    for (const p of DRIVE_PARAMS) {
      const r = document.createElement('div');
      r.className = 'row2';
      r.innerHTML = `<span>${p.label}</span><span class="val" data-k="${p.k}"></span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${DRIVE[p.k]}">`;
      const inp = r.querySelector('input');
      inp.oninput = () => { DRIVE[p.k] = Number(inp.value); saveDrive(); this.updateTuneValues(); };
      inp.onchange = () => inp.blur(); // hand the arrow keys back to the car
      rows.appendChild(r);
    }
    this.updateTuneValues();
  }

  updateTuneValues() {
    for (const el of document.querySelectorAll('#tune .val')) {
      const v = DRIVE[el.dataset.k], dflt = DRIVE_DEFAULTS[el.dataset.k];
      el.textContent = +v.toFixed(4);
      el.style.color = v === dflt ? '' : 'var(--gold)';
    }
  }

  // ---------- run ----------
  runStart(def, best) {
    $('hud').classList.remove('hidden');
    for (const id of ['lvl', 'scorebox', 'breakerbox']) $(id).classList.remove('hidden');
    $('lapbox').classList.add('hidden');
    this.toggleTune(false);
    $('results').classList.add('hidden');
    $('prompt').classList.add('hidden');
    $('impactbox').classList.add('hidden');
    $('msgs').innerHTML = '';
    $('countdown').classList.add('hidden');
    document.querySelector('#lvl .name').textContent = def.name;
    this.def = def; this.best = best;
    this.shownCash = 0;
    const bb = $('breakerbar');
    bb.innerHTML = '';
    for (let i = 0; i < def.breakerCars; i++) bb.appendChild(document.createElement('b'));
    this.renderTargets(0);
  }

  renderTargets(score) {
    const t = this.def.medals.map((v, i) => `<div class="${score >= v ? 'done' : ''}"><span class="dot" style="background:${MEDALS[i].color}"></span>${MEDALS[i].name} ${fmtMoney(v)}</div>`).join('');
    const b = this.best ? `<div style="margin-top:4px;opacity:.8">Rekord ${fmtMoney(this.best.score)}</div>` : '';
    document.querySelector('#lvl .targets').innerHTML = t + b;
  }

  banner(title, sub) {
    const el = $('banner');
    if (!title) { el.classList.add('hidden'); return; }
    el.querySelector('.t').textContent = title;
    el.querySelector('.s').textContent = sub || '';
    el.classList.remove('hidden');
  }

  countdown(text, rev, zone) {
    const el = $('countdown');
    if (text === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.querySelector('.n').textContent = text;
    const z = el.querySelector('.zone');
    z.style.left = (zone[0] / 1.1 * 100) + '%';
    z.style.width = ((zone[1] - zone[0]) / 1.1 * 100) + '%';
    el.querySelector('.red').style.width = ((1.1 - 0.95) / 1.1 * 100) + '%';
    el.querySelector('.needle').style.left = `calc(${Math.min(1.1, rev) / 1.1 * 100}% - 3px)`;
  }

  msg(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    const box = $('msgs');
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 1700);
  }

  prompt(text) {
    const el = $('prompt');
    if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  update(dt, m) {
    const s = m.s;
    const cash = m.damageCash + m.bonus;
    this.shownCash += (cash - this.shownCash) * Math.min(1, dt * 6);
    if (Math.abs(cash - this.shownCash) < 50) this.shownCash = cash;
    $('cash').textContent = fmtMoney(this.shownCash);
    const mu = $('mult');
    mu.textContent = (m.heart ? '½ ' : '') + '×' + m.mult;
    mu.classList.toggle('heart', m.heart);
    $('cars').textContent = 'BILER ' + m.cars;
    const kmh = Math.round(s.player.body.velocity.length() * 3.6);
    $('speed').innerHTML = `${kmh}<small>km/t</small>`;
    $('boostbar').firstElementChild.style.width = (s.driver.boost * 100) + '%';
    const bars = $('breakerbar').children;
    const filled = m.breakerReady || m.breakerUsed ? bars.length : Math.min(bars.length, m.cars);
    for (let i = 0; i < bars.length; i++) bars[i].classList.toggle('on', i < filled);
    $('breakerbox').classList.toggle('ready', m.breakerReady);
    $('breakerbox').style.opacity = m.breakerUsed ? 0.3 : 1;
    const ib = $('impactbox');
    ib.classList.toggle('hidden', m.state !== 'crash');
    ib.querySelector('i').style.width = (m.impactBudget / 2.5 * 100) + '%';
    this.renderTargets(cash * m.mult * (m.heart ? 0.5 : 1));
  }

  results(r) {
    $('prompt').classList.add('hidden');
    $('impactbox').classList.add('hidden');
    const el = $('results');
    const medal = r.medal >= 0 ? `<div class="medal" style="color:${MEDALS[r.medal].color}">${MEDALS[r.medal].name}medalje!</div>` : '<div class="medal" style="color:#aaa">Ingen medalje</div>';
    const next = r.medal < 3 ? `<div style="opacity:.8">Næste mål: ${fmtMoney(this.def.medals[r.medal + 1])}</div>` : '';
    el.querySelector('.box').innerHTML = `
      <h2>Crash-opgørelse</h2>
      <table>
        <tr><td>Biler i crashet</td><td>${r.cars}</td></tr>
        <tr><td>Skade</td><td>${fmtMoney(r.damage)}</td></tr>
        <tr><td>Bonusser</td><td>${fmtMoney(r.bonus)}</td></tr>
        <tr><td>Multiplikator</td><td>×${r.mult}</td></tr>
        ${r.heart ? '<tr><td style="color:#ff4d6d">Heartbreaker</td><td style="color:#ff4d6d">½</td></tr>' : ''}
        <tr class="total"><td>Total</td><td>${fmtMoney(r.total)}</td></tr>
      </table>
      ${medal}${next}
      ${r.newBest ? '<div class="newbest">NY REKORD!</div>' : ''}
      <div class="keys"><kbd>R</kbd>/<kbd>ENTER</kbd> prøv igen · <kbd>ESC</kbd> menu</div>`;
    el.classList.remove('hidden');
  }
}
