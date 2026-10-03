import { fmtMoney } from './util.js';
import { MEDALS, PLAYER_CARS, GAME_TITLE, GAME_SUBTITLE } from './config.js';
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
    document.querySelector('#menu .sub').textContent = GAME_SUBTITLE;
    document.title = GAME_TITLE[0] + GAME_TITLE.slice(1).toLowerCase();
  }

  // ---------- menu ----------
  showMenu(sel) {
    $('hud').classList.add('hidden');
    $('results').classList.add('hidden');
    $('menu').classList.remove('hidden');
    const cr = $('carrow');
    cr.innerHTML = '';
    for (const c of PLAYER_CARS) {
      const d = document.createElement('div');
      d.className = 'card carbtn' + (c.id === sel.car ? ' sel' : '');
      d.innerHTML = `<h3>${c.name}</h3><p>${c.desc}</p>`;
      d.onclick = () => this.game.selectCar(c.id);
      cr.appendChild(d);
    }
    const gr = $('gfxrow');
    gr.innerHTML = '';
    for (const [ps1, name, desc] of [[false, 'Moderne', 'Skygger, refleksioner, høj opløsning'], [true, 'PS1 (1995)', 'Pixels, vaklende polygoner, dithering']]) {
      const d = document.createElement('div');
      d.className = 'card carbtn' + (ps1 === PS1 ? ' sel' : '');
      d.innerHTML = `<h3>${name}</h3><p>${desc}</p>`;
      d.onclick = () => this.game.setGraphics(ps1);
      gr.appendChild(d);
    }
    const lr = $('levelrow');
    lr.innerHTML = '';
    for (const L of LEVELS) {
      const best = loadBest(L.id);
      const d = document.createElement('div');
      d.className = 'card';
      const medal = best && best.medal >= 0 ? `<span style="color:${MEDALS[best.medal].color}">● ${MEDALS[best.medal].name}</span> · ` : '';
      d.innerHTML = `<h3>${L.name}</h3><p>${L.blurb}</p><div class="best">${best ? medal + 'Rekord ' + fmtMoney(best.score) : 'Ikke spillet'}</div>`;
      d.onclick = () => this.game.startLevel(L.id);
      lr.appendChild(d);
    }
  }
  hideMenu() { $('menu').classList.add('hidden'); }

  // ---------- run ----------
  runStart(def, best) {
    $('hud').classList.remove('hidden');
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
