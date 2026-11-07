/* SLAY.HTML v3 client — accounts, levels, 2nd skills, legend weapons */
(() => {
'use strict';

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const angLerp = (a, b, t) => { const d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI; return a + d * t; };
const nowMs = () => performance.now();

const cv = $('game'), ctx = cv.getContext('2d');
const mmCv = $('minimap'), mmCtx = mmCv.getContext('2d');
let W = 0, H = 0;
function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
addEventListener('resize', resize); resize();

// ---------- static tables ----------
const SKILL_LABEL = { dash: 'DASH', heal: 'HEAL', reveal: 'RADAR', shield: 'SHIELD' };
const CLS_LETTER = { assault: 'A', medic: 'M', scout: 'S', heavy: 'H' };
const CLS_ORDER = ['assault', 'medic', 'scout', 'heavy'];
const CLS_COLOR = { assault: '#ffca28', medic: '#66bb6a', scout: '#4fc3f7', heavy: '#ef5350' };
const WPN_COLOR = { pistol: '#bdbdbd', smg: '#4fc3f7', shotgun: '#ffca28', rifle: '#81c784', sniper: '#ef5350', deagle: '#ffd54f', minigun: '#ce93d8', railgun: '#4dd0e1', quad: '#ff8a65' };
const SKILL2_LABEL = { barrage: 'RAPID', guard: 'GUARD', blink: 'BLINK', slam: 'SLAM' };
const CLASS_DEFS = [
  { id: 'assault', name: 'Assault', skill: 'DASH',   cd: '4s',  skill2: 'RAPID', cd2: '10s', hp: 100, wpn: 'Rifle',   desc: 'Full mag + double fire rate' },
  { id: 'medic',   name: 'Medic',   skill: 'HEAL',   cd: '12s', skill2: 'GUARD', cd2: '14s', hp: 100, wpn: 'SMG',     desc: 'Heal 25 HP + 25 armor' },
  { id: 'scout',   name: 'Scout',   skill: 'RADAR',  cd: '15s', skill2: 'BLINK', cd2: '9s',  hp: 100, wpn: 'SMG',     desc: 'Teleport toward aim' },
  { id: 'heavy',   name: 'Heavy',   skill: 'SHIELD', cd: '14s', skill2: 'SLAM',  cd2: '12s', hp: 130, wpn: 'Shotgun', desc: 'AoE damage + slow' },
];

// ---------- state ----------
let ws = null, myId = 0, joined = false;
let TILE = 32, MAPW = 0, MAPH = 0;
let PLAYER_R = 13, MOVE_R = 9, SPEED = 220, MAXHP = 100, NADE_MAX = 3;
let WEAPONS = null, ZONE = null, LIMITS = null;
let grid = [], mapCanvas = null, mapCtx = null, mmBase = null, mmBaseCtx = null;
let MODE = 'ffa';
let teamKills = [0, 0], zpts = [0, 0], zoneOwner = 0, roundLeft = 0, winnerTxt = '';
let goFlashT = 0;

const others = new Map();      // id -> latest row (names/colors for killfeed)
let lastPs = [];               // latest snapshot ps rows
let lastSnapT = 0;             // timestamp of the previous snapshot (reconcile)
let lastSnapRt = 0;            // wall-clock time of the last snapshot (watchdog)
const snapBuf = [];            // {rt, ps} for interpolation
const INTERP = 110;
let lastBs = [], lastBsRt = 0;
let grenades = [], groundPk = [], groundWp = [];

const my = {
  id: 0, x: 0, y: 0, hp: 100, maxhp: 100, alive: false,
  weapon: 'pistol', slot: 1, primary: 'rifle', mag: 12, magSize: 12,
  reloadT: 0, reloadD: 1, gren: 3, prot: 0, respawn: 0,
  score: 0, kills: 0, deaths: 0, streak: 0, color: '#ff5252', name: '',
  cls: 'assault', team: 0, armor: 0, ping: 0,
  spdT: 0, pwrT: 0, rvlT: 0, shdT: 0, skCd: 0, skCdMax: 4, dashT: 0, heal: 0,
  sk2Cd: 0, sk2CdMax: 10, rapidT: 0, slowT: 0, acct: false, aname: '',
  level: 1, xp: 0, xpBase: 0, xpNext: 200,
  px: 0, py: 0,            // predicted position
  rx: 0, ry: 0,            // rendered position: low-pass smoothed (no jiggle)
  sx: undefined, sy: undefined, // server truth
};

// effects
const particles = [], rings = [], flashes = [], hitmarks = [], floaters = [];
let shake = 0, shakeX = 0, shakeY = 0, dmgFlash = 0;
const PARTICLE_CAP = 400;

const cam = { x: 0, y: 0, init: false };

// input
const keys = {};
let mouseX = innerWidth / 2, mouseY = innerHeight / 2, mouseDown = false;
let pendFp = 0, pendR = 0, pendG = 0, pendE = 0, pendE2 = 0, pendW = 0;
let muted = false, modeDirty = false, selCls = 'assault';

// ---------- audio ----------
const Snd = {
  ctx: null, master: null, noise: null,
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch (e) { /* no audio */ }
  },
  ok() {
    if (!this.ctx || muted) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
};
function noiseHit(fStart, fEnd, dur, vol, type) {
  if (!Snd.ok()) return;
  fStart = Math.max(1, +fStart || 1); fEnd = Math.max(1, +fEnd || 1);
  dur = Math.max(0.01, +dur || 0.01); vol = Math.max(0.0001, +vol || 0.0001);
  const ac = Snd.ctx, t = ac.currentTime;
  const src = ac.createBufferSource(); src.buffer = Snd.noise; src.loop = true;
  const flt = ac.createBiquadFilter(); flt.type = type || 'bandpass';
  flt.frequency.setValueAtTime(fStart, t);
  flt.frequency.exponentialRampToValueAtTime(Math.max(30, fEnd), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(g).connect(Snd.master);
  src.start(t); src.stop(t + dur + 0.02);
}
function tone(f0, f1, dur, vol, type) {
  if (!Snd.ok()) return;
  f0 = Math.max(20, +f0 || 20); f1 = Math.max(20, +f1 || 20);
  dur = Math.max(0.01, +dur || 0.01); vol = Math.max(0.0001, +vol || 0.0001);
  const ac = Snd.ctx, t = ac.currentTime;
  const o = ac.createOscillator(); o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(Snd.master);
  o.start(t); o.stop(t + dur + 0.02);
}
const att = d => (isFinite(d) ? clamp(1 - d / 950, 0, 1) : 0);

function playShot(weapon, x, y, mine) {
  const v0 = mine ? 1 : att(dist(x, y, cam.x, cam.y));
  if (!isFinite(v0) || v0 < 0.03) return;
  const v = Math.max(0.0001, v0);
  if (!Snd.ok()) return;
  const ac = Snd.ctx;
  const spec = {
    pistol: [900, 300, 0.10, 0.30], smg: [1100, 400, 0.06, 0.20],
    shotgun: [500, 80, 0.30, 0.55], rifle: [800, 200, 0.13, 0.38], sniper: [400, 60, 0.45, 0.6],
    deagle: [700, 250, 0.16, 0.40], minigun: [1200, 500, 0.05, 0.18], railgun: [300, 40, 0.50, 0.65],
    quad: [260, 50, 0.38, 0.55],
  }[weapon] || [900, 300, 0.1, 0.3];
  const t = ac.currentTime;
  const src = ac.createBufferSource(); src.buffer = Snd.noise; src.loop = true;
  const flt = ac.createBiquadFilter(); flt.type = weapon === 'sniper' || weapon === 'shotgun' || weapon === 'railgun' || weapon === 'quad' ? 'lowpass' : 'bandpass';
  flt.frequency.setValueAtTime(spec[0], t);
  flt.frequency.exponentialRampToValueAtTime(spec[1], t + spec[2]);
  const g = ac.createGain();
  g.gain.setValueAtTime(spec[3] * v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + spec[2]);
  src.connect(flt).connect(g).connect(Snd.master);
  src.start(t); src.stop(t + spec[2] + 0.02);
  if (weapon === 'shotgun' || weapon === 'sniper') {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.3);
    const g2 = ac.createGain(); g2.gain.setValueAtTime(0.4 * v, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g2).connect(Snd.master); o.start(t); o.stop(t + 0.32);
  }
}
function playExplosion(x, y) {
  const v = Math.max(0.15, att(dist(x, y, cam.x, cam.y)));
  if (!Snd.ok()) return;
  noiseHit(300, 40, 0.8, 0.7 * v, 'lowpass');
  tone(90, 28, 0.7, 0.5 * v, 'sine');
}
const sHit = () => tone(1300, 900, 0.05, 0.18, 'square');
const sHurt = () => tone(180, 90, 0.14, 0.3, 'sawtooth');
const sKill = () => { tone(880, 1320, 0.09, 0.22, 'square'); setTimeout(() => tone(1320, 1760, 0.12, 0.22, 'square'), 70); };
const sDeath = () => tone(220, 40, 0.6, 0.4, 'sawtooth');
const sReload = () => { tone(500, 400, 0.03, 0.15, 'square'); setTimeout(() => tone(700, 550, 0.03, 0.15, 'square'), 140); };
const sHeal = () => { tone(660, 990, 0.1, 0.2, 'sine'); setTimeout(() => tone(990, 1320, 0.12, 0.2, 'sine'), 80); };
const sSpawn = () => tone(330, 660, 0.18, 0.18, 'triangle');
const sClick = () => tone(900, 700, 0.03, 0.12, 'square');
const sSkill = () => { tone(440, 880, 0.08, 0.2, 'triangle'); setTimeout(() => tone(660, 1100, 0.1, 0.18, 'triangle'), 60); };

// ---------- map ----------
function gridAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAPW || ty >= MAPH) return 1;
  return grid[ty][tx];
}
function circleHitsWall(x, y, r) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (gridAt(tx, ty) === 0) continue;
    const cx = clamp(x, tx * TILE, tx * TILE + TILE);
    const cy = clamp(y, ty * TILE, ty * TILE + TILE);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}

function drawTile(c, tx, ty, scale) {
  const v = grid[ty][tx], x = tx * TILE, y = ty * TILE;
  c.fillStyle = (tx + ty) % 2 ? '#22272f' : '#252b34';
  c.fillRect(x, y, TILE, TILE);
  if (v === 1) {
    c.fillStyle = '#3d4657'; c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#4a5468'; c.fillRect(x, y, TILE, 4);
    c.fillStyle = 'rgba(0,0,0,.30)'; c.fillRect(x, y + TILE - 5, TILE, 5);
  } else if (v === 2) {
    c.fillStyle = '#8a6a3f'; c.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    c.fillStyle = '#9c7c4e'; c.fillRect(x + 1, y + 1, TILE - 2, 4);
    c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(x + 2, y + TILE - 3); c.lineTo(x + TILE - 3, y + 2); c.stroke();
    c.strokeRect(x + 2.5, y + 2.5, TILE - 5, TILE - 5);
  }
}

function buildMapLayer() {
  mapCanvas = document.createElement('canvas');
  mapCanvas.width = MAPW * TILE; mapCanvas.height = MAPH * TILE;
  mapCtx = mapCanvas.getContext('2d');
  for (let ty = 0; ty < MAPH; ty++) for (let tx = 0; tx < MAPW; tx++) drawTile(mapCtx, tx, ty);
}

function patchTile(tx, ty) {
  if (ty < 0 || ty >= MAPH || tx < 0 || tx >= MAPW) return;
  if (mapCtx) drawTile(mapCtx, tx, ty);
  if (mmBaseCtx) {
    mmBaseCtx.fillStyle = grid[ty][tx] === 1 ? '#39424f' : grid[ty][tx] === 2 ? '#7a5f39' : '#1a2029';
    mmBaseCtx.fillRect(tx * 3, ty * 3, 3, 3);
  }
}

function buildMiniBase() {
  mmBase = document.createElement('canvas');
  mmBase.width = MAPW * 3; mmBase.height = MAPH * 3;
  mmBaseCtx = mmBase.getContext('2d');
  mmBaseCtx.fillStyle = '#10141b';
  mmBaseCtx.fillRect(0, 0, mmBase.width, mmBase.height);
  for (let ty = 0; ty < MAPH; ty++) for (let tx = 0; tx < MAPW; tx++) {
    const v = grid[ty][tx];
    if (v === 0) continue;
    mmBaseCtx.fillStyle = v === 1 ? '#39424f' : '#7a5f39';
    mmBaseCtx.fillRect(tx * 3, ty * 3, 3, 3);
  }
}

// ---------- effects ----------
function addParticles(x, y, n, c, spd, life, r) {
  for (let i = 0; i < n; i++) {
    if (particles.length >= PARTICLE_CAP) particles.shift();
    const a = Math.random() * Math.PI * 2, s = spd * (0.3 + Math.random() * 0.7);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), tot: life, c, r: r * (0.6 + Math.random() * 0.8) });
  }
}
function addRing(x, y, r0, r1, c, life, width) {
  rings.push({ x, y, r0, r1, c, life, tot: life, w: width || 3 });
}
function bloodDecal(x, y, big) {
  if (!mapCtx) return;
  if (Math.random() > (big ? 0.5 : 0.25)) return;  // keep the map clean: only some hits stain
  const n = big ? 3 : 1;
  for (let i = 0; i < n; i++) {
    mapCtx.fillStyle = 'rgba(140,26,26,' + (0.10 + Math.random() * 0.10) + ')';
    mapCtx.beginPath();
    mapCtx.arc(x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 22, 3 + Math.random() * (big ? 6 : 3), 0, 7);
    mapCtx.fill();
  }
}

// ---------- connection ----------
function connect(addr) {
  return new Promise((resolve, reject) => {
    let done = false;
    // empty address = solo vs bots through the built-in local sim
    // (localsim.js) — same JSON protocol, no server needed, works on
    // static hosting like GitHub Pages
    if (!addr && window.SlayLocal) {
      try { ws = window.SlayLocal.createSocket(); } catch (e) { reject('Local sim failed'); return; }
      ws.onopen = () => { done = true; resolve(); };
      ws.onerror = () => { if (!done) { done = true; reject('Local sim failed'); } };
      ws.onclose = () => { if (!done) { done = true; reject('Local sim failed'); return; } onDisconnected(); };
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } handleMessage(m); };
      return;
    }
    // https pages must use secure websockets — plain ws:// is blocked as mixed content
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    try { ws = new WebSocket(proto + addr); } catch (e) { reject('Invalid address'); return; }
    const to = setTimeout(() => { if (!done) { done = true; reject('Connection timeout'); try { ws.close(); } catch (e) {} } }, 5000);
    ws.onopen = () => { clearTimeout(to); resolve(); };
    ws.onerror = () => { if (!done) { done = true; clearTimeout(to); reject('Cannot reach server'); } };
    ws.onclose = () => {
      if (!done) { done = true; clearTimeout(to); reject('Cannot reach server'); return; }
      onDisconnected();
    };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } handleMessage(m); };
  });
}

function onDisconnected() {
  if (!joined) return;
  joined = false;
  others.clear(); snapBuf.length = 0; particles.length = 0;
  lastPs = []; lastBs = []; grenades = []; groundPk = []; groundWp = [];
  cam.init = false;
  $('hud').classList.add('hidden');
  $('scoreboard').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('playBtn').disabled = false;
  menuMsg('Disconnected from server');
}

function menuMsg(s) { $('menuMsg').textContent = s || ''; }

async function play() {
  if (joined) return;
  Snd.init();
  const name = ($('nameInput').value || '').trim() || 'Player';
  // empty server field = solo vs bots (local sim); enter host:port to join
  // a real multiplayer server instead
  const addr = ($('serverInput').value || '').trim();
  const acct = ($('acctName').value || '').trim();
  const pass = $('acctPass').value || '';
  localStorage.setItem('slayname', name);
  localStorage.setItem('slayserver', addr);
  localStorage.setItem('slayacct', acct);
  if (acct) localStorage.setItem('slaypass', pass);
  $('playBtn').disabled = true;
  menuMsg('Connecting…');
  try {
    await connect(addr);
    const joinMsg = { t: 'j', name, cls: selCls };
    if (acct) {
      if (pass.length < 3) { menuMsg('Password needs 3+ characters (or clear the account field)'); $('playBtn').disabled = false; try { ws.close(); } catch (e) {} return; }
      joinMsg.acct = acct; joinMsg.pass = pass;
    }
    ws.send(JSON.stringify(joinMsg));
    menuMsg('');
  } catch (err) {
    $('playBtn').disabled = false;
    menuMsg(String(err));
  }
}

function handleMessage(m) {
  switch (m.t) {
    case 'w': onWelcome(m); break;
    case 's': onSnapshot(m); break;
    case 'p': my.ping = Math.round(nowMs() - m.ts); break;
    case 'aerr': sysLine('Account: ' + (m.msg || 'error')); break;
    case 'err': menuMsg(m.msg); try { ws.close(); } catch (e) {} break;
  }
}

function onWelcome(m) {
  myId = m.id;
  TILE = m.tile;
  MAPW = m.rows[0].length; MAPH = m.rows.length;
  grid = m.rows.map(r => [...r].map(ch => ch === '.' ? 0 : ch === '#' ? 1 : 2));
  WEAPONS = m.weapons; ZONE = m.zone; LIMITS = m.limits; MODE = m.mode;
  PLAYER_R = m.consts.playerR; SPEED = m.consts.speed; MAXHP = m.consts.maxHp; NADE_MAX = m.consts.nadeMax;
  buildMapLayer(); buildMiniBase();
  my.color = m.color || my.color;
  my.px = my.x; my.py = my.y; my.rx = my.x; my.ry = my.y; my.sx = undefined; my.sy = undefined;
  lastSnapRt = nowMs();  // arm the connection watchdog for the new session
  joined = true;
  if (document.activeElement) document.activeElement.blur();
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  cam.init = false;
  // push desired mode if user picked a different one in the menu
  const want = $('modeSel').value;
  if (modeDirty && want && want !== MODE && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ t: 'mo', mode: want }));
  }
  modeDirty = false;
}

// ---------- events ----------
function nameOf(id) {
  if (id === myId) return { name: my.name, color: my.color };
  const r = others.get(id);
  return r ? { name: r[7], color: r[12] } : { name: '?', color: '#aaa' };
}

function killfeedAdd(aid, vid, cause) {
  const kf = $('killfeed');
  const a = nameOf(aid), v = nameOf(vid);
  const div = document.createElement('div');
  div.className = 'kfRow';
  const tag = cause === 'grenade' ? '<span class="kfTag">NADE</span>'
    : cause && WEAPONS && WEAPONS[cause] ? '<span class="kfTag">' + WEAPONS[cause].name.toUpperCase() + '</span>' : '';
  div.innerHTML = '<b style="color:' + a.color + '">' + a.name + '</b> ' + tag + ' <span class="kfArrow">▸</span> <b style="color:' + v.color + '">' + v.name + '</b>';
  kf.appendChild(div);
  while (kf.children.length > 6) kf.removeChild(kf.firstChild);
  setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 4500);
}

function sysLine(text) {
  const kf = $('killfeed');
  const div = document.createElement('div');
  div.className = 'kfRow kfSys';
  div.textContent = text;
  kf.appendChild(div);
  while (kf.children.length > 6) kf.removeChild(kf.firstChild);
  setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 3500);
}

let toastTimer = null;
function showToast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- achievements ----------
const ACH_DEFS = {
  firstblood: { t: 'FIRST BLOOD', d: 'First kill of the round' },
  burst:      { t: 'LIGHTNING KILL', d: 'Full-health kill within 0.5s' },
  far:        { t: 'LONG SHOT', d: 'Kill beyond your screen edge' },
  spree:      { t: 'KILLING SPREE', d: '3 kills without dying' },
  rampage:    { t: 'RAMPAGE', d: '5 kills without dying' },
  godlike:    { t: 'GODLIKE', d: '8 kills without dying' },
};
const achQueue = [];
let achShowing = false;
const sAch = () => { tone(660, 990, 0.09, 0.2, 'square'); setTimeout(() => tone(990, 1480, 0.14, 0.2, 'square'), 90); };
function queueAchievement(type) {
  if (!ACH_DEFS[type] || achQueue.includes(type)) return;
  achQueue.push(type);
  showNextAchievement();
}
function showNextAchievement() {
  if (achShowing || !achQueue.length) return;
  achShowing = true;
  const def = ACH_DEFS[achQueue.shift()];
  const el = document.createElement('div');
  el.className = 'achBanner';
  el.innerHTML = '<span class="achDiamond"></span><span class="achText">' +
    '<span class="achLabel">ACHIEVEMENT</span>' +
    '<span class="achTitle">' + def.t + '</span>' +
    '<span class="achDesc">' + def.d + '</span></span>';
  sAch();
  $('achWrap').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => {
    el.remove();
    achShowing = false;
    showNextAchievement();
  }, 3200);
}

function posOf(pid) {
  if (pid === myId) return [my.rx, my.ry];
  const r = lastPs.find(row => row[0] === pid);
  return r ? [r[1], r[2]] : [0, 0];
}

function handleEvent(ev) {
  const k = ev[0];
  if (k === 'sh') {
    const [_, pid, x, y, aim, weapon] = ev;
    playShot(weapon, x, y, pid === myId);
    flashes.push({ x: x + Math.cos(aim) * 14, y: y + Math.sin(aim) * 14, ang: aim, life: 0.06, tot: 0.06 });
    if (pid === myId) shake = Math.max(shake, weapon === 'sniper' || weapon === 'shotgun' ? 4 : 1.6);
  } else if (k === 'ht') {
    const [_, pid, aid, x, y, dmgv, crit] = ev;
    addParticles(x, y, 8, '#c62828', 150, 0.4, 2.6);
    bloodDecal(x, y, false);
    if (pid === myId) { dmgFlash = 0.65; sHurt(); }
    if (aid === myId) {
      hitmarks.push({ life: 0.14, tot: 0.14 });
      sHit();
      if (crit) {
        // critical hit: golden ring burst + sparks + big yellow number
        addRing(x, y, 5, 30, '#ffd54f', 0.28, 2.5);
        addParticles(x, y, 10, '#ffd54f', 210, 0.45, 2.2);
        if (floaters.length < 60) floaters.push({
          x, y: y - 20, vy: -62,
          life: 1.0, tot: 1.0, txt: dmgv + '!', c: '#ffd54f', sz: 19,
        });
      } else if (floaters.length < 60) {
        floaters.push({
          x: x + (Math.random() - 0.5) * 12, y: y - 16, vy: -48,
          life: 0.8, tot: 0.8, txt: String(dmgv), c: '#ffffff', sz: 12,
        });
      }
    }
  } else if (k === 'kl') {
    const [_, aid, vid, cause] = ev;
    killfeedAdd(aid, vid, cause);
    const kp = posOf(aid), vp = posOf(vid);
    if (aid === myId && vid !== myId) {
      // LONG SHOT: kill distance beyond the edge of the visible screen
      const d = dist(kp[0], kp[1], vp[0], vp[1]);
      if (d > Math.hypot(W, H) / (2 * viewScale)) queueAchievement('far');
    }
    const vpx = posOf(vid);
    bloodDecal(vp[0], vp[1], true);
    addParticles(vp[0], vp[1], 16, '#a02020', 190, 0.6, 3);
    if (vid === myId) sDeath();
    if (aid === myId && vid !== myId) sKill();
  } else if (k === 'ex') {
    const [_, x, y] = ev;
    playExplosion(x, y);
    addParticles(x, y, 34, '#ff9333', 330, 0.7, 4);
    addParticles(x, y, 18, '#5a5a5a', 160, 0.9, 3.4);
    addRing(x, y, 10, 130, 'rgba(255,150,60,.8)', 0.4, 5);
    if (dist(x, y, cam.x, cam.y) < 600) shake = Math.max(shake, 12);
  } else if (k === 'wx') {
    const [_, x, y] = ev;
    addParticles(x, y, 3, '#c8cdd6', 90, 0.22, 1.6);
    if (att(dist(x, y, cam.x, cam.y)) > 0.4) tone(220, 120, 0.03, 0.05, 'square');
  } else if (k === 'cr') {
    const [_, tx, ty] = ev;
    addParticles(tx * TILE + 16, ty * TILE + 16, 12, '#9c7c4e', 170, 0.5, 3);
    patchTile(tx, ty);
    if (att(dist(tx * TILE, ty * TILE, cam.x, cam.y)) > 0.3) noiseHit(700, 150, 0.12, 0.14, 'bandpass');
  } else if (k === 'pk') {
    const [_, pid, x, y, kind] = ev;
    addRing(x, y, 4, 30, 'rgba(255,255,255,.5)', 0.3, 2);
    if (pid === myId) {
      const label = kind.startsWith('wpn:')
        ? WEAPONS[kind.slice(4)].name + ' acquired'
        : { med: '+ Health', armor: '+ Armor', speed: 'Speed Boost', power: 'Damage Boost', ammo: 'Ammo Refill', nade: '+2 Grenades' }[kind] || kind;
      showToast(label);
      if (kind === 'med') sHeal(); else sClick();
    }
  } else if (k === 'sk') {
    const [_, pid, cls] = ev;
    const [x, y] = posOf(pid);
    if (cls === 'assault') addParticles(x, y, 10, '#ffca28', 220, 0.3, 2.4);
    else if (cls === 'medic') addRing(x, y, 8, 160, 'rgba(102,187,106,.7)', 0.6, 4);
    else if (cls === 'scout') addRing(x, y, 10, 700, 'rgba(79,195,247,.55)', 0.9, 3);
    else if (cls === 'heavy') addRing(x, y, 14, 30, 'rgba(80,160,255,.8)', 0.35, 4);
    if (pid === myId) sSkill();
  } else if (k === 'sk2') {
    const [_, pid, cls] = ev;
    const [x, y] = posOf(pid);
    if (cls === 'assault') { addRing(x, y, 6, 40, 'rgba(255,202,40,.8)', 0.35, 3); addParticles(x, y, 8, '#ffca28', 200, 0.3, 2.2); }
    else if (cls === 'medic') { addRing(x, y, 8, 46, 'rgba(102,187,106,.85)', 0.45, 4); addParticles(x, y, 8, '#66bb6a', 150, 0.4, 2.2); }
    else if (cls === 'heavy') { addRing(x, y, 10, 160, 'rgba(255,112,67,.75)', 0.5, 5); addParticles(x, y, 16, '#ff7043', 260, 0.5, 3); if (dist(x, y, cam.x, cam.y) < 600) shake = Math.max(shake, 8); }
    if (pid === myId) sSkill();
  } else if (k === 'bl') {
    const [_, pid, x1, y1, x2, y2] = ev;
    addParticles(x1, y1, 10, '#ce93d8', 190, 0.35, 2.6);
    addParticles(x2, y2, 10, '#ce93d8', 190, 0.35, 2.6);
    addRing(x2, y2, 4, 26, 'rgba(206,147,216,.85)', 0.3, 3);
    if (pid === myId) { my.px = x2; my.py = y2; my.rx = x2; my.ry = y2; }
  } else if (k === 'sp') {
    const [_, pid, x, y] = ev;
    addRing(x, y, 6, 42, 'rgba(255,255,255,.6)', 0.4, 3);
    if (pid === myId) { sSpawn(); my.px = x; my.py = y; my.rx = x; my.ry = y; cam.x = x; cam.y = y; }
  } else if (k === 'jn') {
    sysLine(ev[2] + ' joined');
    if (ev[2] === my.name) sSpawn();
  } else if (k === 'aok') {
    my.acct = true;
    sysLine(ev[2]);
  } else if (k === 'lv') {
    sysLine(ev[2] + ' left');
  } else if (k === 'ach') {
    if (ev[1] === myId) queueAchievement(ev[2]);
  } else if (k === 'go') {
    winnerTxt = ''; goFlashT = 1.4;
  } else if (k === 'end') {
    winnerTxt = ev[1] || '';
  } else if (k === 'mo') {
    MODE = ev[1];
    goFlashT = Math.max(goFlashT, 1.0);
  }
}

// ---------- snapshot ----------
function onSnapshot(m) {
  if (m.ev) for (const ev of m.ev) handleEvent(ev);
  const y = m.you;
  if (!y) return;
  my.x = y.x; my.y = y.y;
  my.sx = y.x; my.sy = y.y;
  my.hp = y.hp; my.maxhp = y.maxhp; my.alive = !!y.alive;
  my.weapon = y.weapon; my.slot = y.slot; my.primary = y.primary;
  my.mag = y.mag; my.magSize = y.magSize;
  my.reloadT = y.reloadT; my.reloadD = y.reloadD;
  my.gren = y.gren; my.prot = y.prot; my.respawn = y.respawn;
  my.score = y.score; my.kills = y.kills; my.deaths = y.deaths; my.streak = y.streak;
  my.color = y.color; my.name = y.name; my.cls = y.cls; my.team = y.team;
  my.armor = y.armor;
  my.spdT = y.spdT; my.pwrT = y.pwrT; my.rvlT = y.rvlT; my.shdT = y.shdT;
  my.skCd = y.skCd; my.skCdMax = y.skCdMax; my.dashT = y.dashT; my.heal = y.heal;
  my.sk2Cd = y.sk2Cd; my.sk2CdMax = y.sk2CdMax; my.rapidT = y.rapidT; my.slowT = y.slowT;
  my.shu = y.shu || 0;
  my.level = y.level || 1; my.xp = y.xp || 0; my.xpBase = y.xpBase || 0; my.xpNext = y.xpNext || 200;
  my.aname = y.aname || '';
  if (y.aname) my.acct = true; else if (y.aname === '') my.acct = false;
  // drop aim/scope when invalid (death, sniper reload, weapon swap)
  if (!my.alive) { aiming = false; scoped = false; }
  else if (scoped && (!SNIPER_WEAPONS.includes(my.weapon) || my.reloadT > 0)) scoped = false;

  // reconcile prediction (frame-rate independent). Never hard-snap on
  // moderate drift — a sudden teleport reads as "bounced off the wall".
  // Small drift bleeds in gently; large drift (dash/corner divergence)
  // catches up fast but still smoothly.
  if (!my.alive || my.sx === undefined || !isFinite(my.sx) || !isFinite(my.px)) {
    my.px = my.x; my.py = my.y;
  } else {
    const err = dist(my.px, my.py, my.x, my.y);
    if (!isFinite(err) || err > 300) { my.px = my.x; my.py = my.y; }
    else {
      const nowT = nowMs();
      const steps = lastSnapT ? Math.min(3, (nowT - lastSnapT) / 16.7) : 1;
      lastSnapT = nowT;
      const base = err > 120 ? 0.78 : 0.94;
      const k = 1 - Math.pow(base, steps);
      my.px += (my.x - my.px) * k;
      my.py += (my.y - my.py) * k;
    }
  }

  lastPs = m.ps;
  lastSnapRt = nowMs();
  snapBuf.push({ rt: nowMs(), ps: m.ps });
  while (snapBuf.length > 20) snapBuf.shift();
  for (const row of m.ps) others.set(row[0], row);

  lastBs = m.bs; lastBsRt = nowMs();
  grenades = m.gs; groundPk = m.pk; groundWp = m.ws;
  MODE = m.mode; teamKills = m.tks; zpts = m.zpts; zoneOwner = m.zone;
  roundLeft = m.ro; winnerTxt = m.win;
  if (!modeDirty) {
    const sel = $('modeSel');
    if (sel.value !== MODE) sel.value = MODE;
  }
}

function interpOthers() {
  const target = nowMs() - INTERP;
  let s0 = null, s1 = null;
  for (let i = snapBuf.length - 1; i >= 0; i--) {
    if (snapBuf[i].rt <= target) {
      s0 = snapBuf[i];
      s1 = snapBuf[i + 1] || snapBuf[i];
      break;
    }
  }
  if (!s0) { s1 = snapBuf[snapBuf.length - 1]; s0 = s1; }
  if (!s1) return [];
  const span = Math.max(1, s1.rt - s0.rt);
  const t = s0 === s1 ? 1 : clamp((target - s0.rt) / span, 0, 1);
  const out = [];
  for (const a of s1.ps) {
    const b = s0.ps.find(r => r[0] === a[0]) || a;
    out.push({
      id: a[0], x: lerp(b[1], a[1], t), y: lerp(b[2], a[2], t),
      aim: angLerp(b[3], a[3], t), hp: a[4], wslot: a[5], alive: a[6],
      name: a[7], score: a[8], kills: a[9], deaths: a[10], ping: a[11],
      color: a[12], bot: a[13], team: a[14], clsIdx: a[15], slow: a[16],
      shu: a[17] || 0,
    });
  }
  return out;
}

// ---------- input ----------
addEventListener('keydown', e => {
  if (!joined) {
    if (e.code === 'Enter' && (document.activeElement === $('nameInput') || document.activeElement === $('serverInput'))) play();
    return;
  }
  if (e.code === 'Tab') { e.preventDefault(); $('scoreboard').classList.remove('hidden'); return; }
  if (e.repeat) return;
  keys[e.code] = true;
  switch (e.code) {
    case 'Space': e.preventDefault(); pendFp = 1; break;
    case 'KeyR': pendR = 1; sReload(); break;
    case 'KeyQ': pendG = 1; break;   // grenade
    case 'KeyE': pendE = 1; break;   // skill 1
    case 'KeyF': pendE2 = 1; break;  // skill 2
    case 'Digit1': pendW = 1; break;
    case 'Digit2': pendW = 2; break;
    case 'KeyM': muted = !muted; break;
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'Tab') $('scoreboard').classList.add('hidden');
});
cv.addEventListener('mousedown', e => {
  if (!joined) return;
  if (e.button === 0) {
    mouseDown = true;
    pendFp = 1;
    // auto-reload: clicking on an empty mag starts the reload immediately
    // (server also triggers it from the fire path — this is instant feedback)
    if (my.alive && my.weapon !== 'shuriken' && my.mag <= 0 && my.reloadT <= 0) {
      pendR = 1;
      sReload();
    }
  }
  else if (e.button === 1) { e.preventDefault(); pendG = 1; }        // middle: grenade
  else if (e.button === 2) updateScope(true);                        // right: scope
});
addEventListener('mouseup', e => {
  if (e.button === 0) mouseDown = false;
  else if (e.button === 2) updateScope(false);
});
addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; updateScope(false); });
addEventListener('contextmenu', e => { if (e.target === cv) e.preventDefault(); });

let aiming = false, scoped = false, viewScale = 1;
let lockId = 0;                    // quad rocket lock target (0 = none)
const SNIPER_WEAPONS = ['sniper', 'railgun'];  // full scope stance
function updateScope(on) {
  aiming = !!(on && joined && my.alive);
  scoped = aiming && SNIPER_WEAPONS.includes(my.weapon) && my.reloadT <= 0;
}

function moveVec() {
  if (scoped) return { x: 0, y: 0 };  // braced while scoped
  let x = 0, y = 0;
  if (keys.KeyW || keys.ArrowUp) y -= 1;
  if (keys.KeyS || keys.ArrowDown) y += 1;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (x && y) { x *= 0.7071; y *= 0.7071; }
  return { x, y };
}
const aimAng = () => Math.atan2(mouseY - H / 2, mouseX - W / 2);

// send input @30Hz
setInterval(() => {
  if (!joined || !ws || ws.readyState !== 1) return;
  const mv = moveVec();
  const msg = { t: 'i', mx: mv.x, my: mv.y, aim: aimAng(), f: (mouseDown || keys.Space) ? 1 : 0, sc: aiming ? 1 : 0, tg: lockId };
  if (pendFp) { msg.fp = 1; pendFp = 0; }
  if (pendR) { msg.r = 1; pendR = 0; }
  if (pendG) { msg.g = 1; pendG = 0; }
  if (pendE) { msg.e = 1; pendE = 0; }
  if (pendE2) { msg.e2 = 1; pendE2 = 0; }
  if (pendW) { msg.w = pendW; pendW = 0; }
  try { ws.send(JSON.stringify(msg)); } catch (e) {}
}, 33);

// wall-slide movement, mirrors server move_with_slide: full step -> axis
// slide -> sub-stepped creep (full displacement in tight seams) -> tangential
function moveSlide(x, y, dx, dy, r) {
  if (!dx && !dy) return [x, y];
  if (!circleHitsWall(x + dx, y + dy, r)) return [x + dx, y + dy];
  let nx = x, ny = y, moved = false;
  if (dx && !circleHitsWall(x + dx, y, r)) { nx = x + dx; moved = true; }
  if (dy && !circleHitsWall(nx, y + dy, r)) { ny = y + dy; moved = true; }
  if (moved) return [nx, ny];
  let cx = x, cy = y, progressed = false;
  for (let i = 0; i < 8; i++) {
    const fx = dx * 0.125, fy = dy * 0.125;
    let stepMoved = false;
    if (!circleHitsWall(cx + fx, cy + fy, r)) { cx += fx; cy += fy; stepMoved = true; }
    else {
      if (dx && !circleHitsWall(cx + fx, cy, r)) { cx += fx; stepMoved = true; }
      if (dy && !circleHitsWall(cx, cy + fy, r)) { cy += fy; stepMoved = true; }
    }
    if (!stepMoved) break;
    progressed = true;
  }
  if (progressed) return [cx, cy];
  for (const sign of [1, -1]) {
    const tx = -dy * 0.35 * sign, ty = dx * 0.35 * sign;
    if (!circleHitsWall(x + tx, y + ty, r)) return [x + tx, y + ty];
  }
  return [x, y];
}

// ---------- prediction ----------
let prevDashT = 0, dashVX = 0, dashVY = 0, dashAim = 0;
function predict(dt) {
  if (!joined) return;
  if (!my.alive) {
    my.px = lerp(my.px, my.x, 0.3);
    my.py = lerp(my.py, my.y, 0.3);
  } else {
    const mv = moveVec();
    let sp = SPEED * (my.cls === 'scout' ? 1.15 : 1);
    if (my.spdT > 0) sp *= 1.35;
    if (my.dashT > 0) sp *= 3.2;
    else if (aiming) sp *= 0.6;  // braced walk while aiming
    let dx = mv.x, dy = mv.y;
    if (my.dashT > 0) {
      // dash direction is fixed at dash start (mirrors server dash_dx/dy):
      // locked move input, else the aim angle at that moment
      if (!prevDashT) {
        dashVX = mv.x; dashVY = mv.y; dashAim = aimAng();
      }
      dx = dashVX; dy = dashVY;
      if (!dx && !dy) { dx = Math.cos(dashAim); dy = Math.sin(dashAim); }
    }
    prevDashT = my.dashT;
    if (dx || dy) {
      // re-normalize against blocked axes (full-speed wall sliding), then
      // slide/creep exactly like the server
      const l = Math.hypot(dx, dy) || 1;
      let ux = dx / l, uy = dy / l;
      if (ux && circleHitsWall(my.px + ux * sp * dt, my.py, MOVE_R)) ux = 0;
      if (uy && circleHitsWall(my.px, my.py + uy * sp * dt, MOVE_R)) uy = 0;
      if (ux || uy) {
        const l2 = Math.hypot(ux, uy);
        const [nx2, ny2] = moveSlide(my.px, my.py, ux / l2 * sp * dt, uy / l2 * sp * dt, MOVE_R);
        my.px = nx2; my.py = ny2;
      }
    }
  }
  // rendered position: low-pass smoothed copy of the prediction — filters
  // out the 30Hz reconcile ripple so movement is perfectly fluid
  const k = 1 - Math.pow(0.72, dt * 60);
  my.rx += (my.px - my.rx) * k;
  my.ry += (my.py - my.ry) * k;
}

// ---------- drawing ----------
function visible(x, y, m) {
  const hw = W / (2 * viewScale), hh = H / (2 * viewScale);
  return x > cam.x - hw - m && x < cam.x + hw + m && y > cam.y - hh - m && y < cam.y + hh + m;
}

function drawPlayer(p, isMe) {
  const x = p.x, y = p.y, aim = p.aim;
  const prot = isMe ? my.prot : 0;
  ctx.save();
  ctx.translate(x, y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.arc(0, 2, PLAYER_R, 0, 7); ctx.fill();
  // gun
  ctx.strokeStyle = '#1c2027'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(aim) * (PLAYER_R + 9), Math.sin(aim) * (PLAYER_R + 9)); ctx.stroke();
  ctx.strokeStyle = '#4d5768'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(Math.cos(aim) * (PLAYER_R + 8), Math.sin(aim) * (PLAYER_R + 8)); ctx.stroke();
  // body
  ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 2; ctx.stroke();
  // class badge
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px Consolas,monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(CLS_LETTER[CLS_ORDER[p.clsIdx] || 'assault'], 0, 0.5);
  // shield bubble (self only — server sends own shield state)
  if (isMe && my.shdT > 0) {
    ctx.strokeStyle = 'rgba(90,170,255,.85)'; ctx.lineWidth = 2.5;
    ctx.fillStyle = 'rgba(90,170,255,.14)';
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R + 7, 0, 7); ctx.fill(); ctx.stroke();
  }
  // heal aura (self)
  if (isMe && my.heal > 0) {
    ctx.strokeStyle = 'rgba(102,187,106,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R + 4 + Math.sin(nowMs() / 120) * 2, 0, 7); ctx.stroke();
  }
  // slowed tint
  if (isMe ? my.slowT > 0 : p.slow) {
    ctx.strokeStyle = 'rgba(140,180,255,.65)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R + 3.5, 0, 7); ctx.stroke();
  }
  // spawn protection
  if (prot) {
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_R + 5, nowMs() / 300, nowMs() / 300 + 6.28); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  // hp pip
  const hpFrac = clamp(p.hp / (isMe ? my.maxhp : 100), 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(x - 14, y - PLAYER_R - 10, 28, 4);
  ctx.fillStyle = hpFrac > 0.5 ? '#66bb6a' : hpFrac > 0.25 ? '#ffca28' : '#ef5350';
  ctx.fillRect(x - 13, y - PLAYER_R - 9, 26 * hpFrac, 2);
  // name
  if (!isMe) {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = '10px Consolas,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(p.name, x, y - PLAYER_R - 13);
  }
  // scout radar marker on revealed enemies
  if (!isMe && my.rvlT > 0 && p.team !== my.team) {
    ctx.fillStyle = 'rgba(79,195,247,.9)';
    ctx.beginPath();
    ctx.moveTo(x, y - PLAYER_R - 20);
    ctx.lineTo(x - 5, y - PLAYER_R - 28);
    ctx.lineTo(x + 5, y - PLAYER_R - 28);
    ctx.fill();
  }
}

function drawPickup(x, y, kind, t) {
  const fy = y + Math.sin(t / 300 + x * 0.05) * 2.5;
  ctx.save();
  ctx.translate(x, fy);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(0, y - fy + 9, 9, 3.5, 0, 0, 7); ctx.fill();
  if (kind === 'med') {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
    ctx.fillStyle = '#e53935';
    ctx.fillRect(-1.8, -6, 3.6, 12); ctx.fillRect(-6, -1.8, 12, 3.6);
  } else if (kind === 'armor') {
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(8, -5); ctx.lineTo(8, 2);
    ctx.quadraticCurveTo(8, 8, 0, 10); ctx.quadraticCurveTo(-8, 8, -8, 2);
    ctx.lineTo(-8, -5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  } else if (kind === 'speed') {
    ctx.fillStyle = '#ffee58';
    ctx.beginPath();
    ctx.moveTo(2, -10); ctx.lineTo(-6, 1); ctx.lineTo(-1, 1); ctx.lineTo(-3, 10);
    ctx.lineTo(6, -2); ctx.lineTo(1, -2); ctx.closePath(); ctx.fill();
  } else if (kind === 'power') {
    ctx.fillStyle = '#ff7043';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? 4 : 10;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
  } else if (kind === 'ammo') {
    ctx.fillStyle = '#6d6d6d';
    ctx.fillRect(-9, -6, 18, 12);
    ctx.fillStyle = '#8d8d8d'; ctx.fillRect(-9, -6, 18, 3.5);
    ctx.fillStyle = '#e0c069';
    for (let i = -1; i <= 1; i++) ctx.fillRect(i * 5 - 1.2, -2.5, 2.4, 7);
  } else if (kind === 'nade') {
    ctx.fillStyle = '#4a6b3a';
    ctx.beginPath(); ctx.arc(0, 1, 8, 0, 7); ctx.fill();
    ctx.fillStyle = '#5f7d4a';
    ctx.fillRect(-3.5, -9, 7, 4);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 1, 8, 0, 7); ctx.stroke();
  }
  ctx.restore();
}

// classic 4-point throwing star: swept steel blades, dark edge, riveted hub
function drawShuriken(x, y, r, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const ir = r * 0.34;
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    const i1 = a - Math.PI / 4, i2 = a + Math.PI / 4;
    if (k === 0) ctx.moveTo(Math.cos(i1) * ir, Math.sin(i1) * ir);
    else ctx.lineTo(Math.cos(i1) * ir, Math.sin(i1) * ir);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.lineTo(Math.cos(i2) * ir, Math.sin(i2) * ir);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, '#f4f7f8');
  g.addColorStop(0.5, '#b7c6cd');
  g.addColorStop(1, '#78909c');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#37474f';
  ctx.lineWidth = Math.max(1.2, r * 0.14);
  ctx.lineJoin = 'round';
  ctx.stroke();
  // riveted hub with the classic center hole
  ctx.fillStyle = '#546e7a';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, 7); ctx.fill();
  ctx.fillStyle = '#263238';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, 7); ctx.fill();
  ctx.restore();
}

function drawGroundWeapon(x, y, wk, t) {
  const fy = y + Math.sin(t / 260 + x * 0.07) * 3;
  const col = WPN_COLOR[wk] || '#ccc';
  const legend = WEAPONS && WEAPONS[wk] && WEAPONS[wk].legend;
  ctx.save();
  ctx.translate(x, fy);
  if (legend) {
    ctx.strokeStyle = 'rgba(255,213,79,.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -t / 40;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,213,79,.10)';
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, 7); ctx.fill();
  }
  if (wk === 'shuriken') {
    drawShuriken(0, 0, 15, t / 600);
    ctx.restore();
  } else {
    ctx.rotate(-0.35);
    // simple gun silhouette
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-16, -3, 32, 6);
    ctx.fillRect(-10, 0, 6, 10);
    ctx.fillStyle = col;
    ctx.fillRect(-16, -3, 32, 2.2);
    ctx.fillRect(-10, 0, 6, 2.2);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.font = 'bold 9px Consolas,monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const label = (WEAPONS[wk] ? WEAPONS[wk].name : wk).toUpperCase() + (legend ? ' ★' : '');
  const tw = ctx.measureText(label).width;
  ctx.fillRect(x - tw / 2 - 4, y + 12, tw + 8, 13);
  ctx.fillStyle = legend ? '#ffd54f' : col;
  ctx.fillText(label, x, y + 14);
}

// ---------- main render ----------
function render(t) {
  ctx.fillStyle = '#101318';
  ctx.fillRect(0, 0, W, H);
  if (!joined || !mapCanvas) return;

  // smooth zoom while scoped (wider view)
  viewScale = lerp(viewScale, scoped ? 0.72 : 1, 0.14);
  const s = viewScale;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(s, s);
  ctx.translate(-cam.x + shakeX, -cam.y + shakeY);

  // map layer (source-rect blit = viewport culling)
  const hw = W / (2 * viewScale), hh = H / (2 * viewScale);
  const vx = clamp(cam.x - hw - TILE, 0, MAPW * TILE);
  const vy = clamp(cam.y - hh - TILE, 0, MAPH * TILE);
  const vw = Math.min(MAPW * TILE - vx, hw * 2 + TILE * 2);
  const vh = Math.min(MAPH * TILE - vy, hh * 2 + TILE * 2);
  if (vw > 0 && vh > 0) ctx.drawImage(mapCanvas, vx, vy, vw, vh, vx, vy, vw, vh);

  // KOTH zone
  if (MODE === 'koth' && ZONE) {
    const zc = zoneOwner === 1 ? 'rgba(255,82,82,' : zoneOwner === 2 ? 'rgba(64,164,255,' : 'rgba(255,255,255,';
    ctx.fillStyle = zc + '0.07)';
    ctx.beginPath(); ctx.arc(ZONE.x, ZONE.y, ZONE.r, 0, 7); ctx.fill();
    ctx.strokeStyle = zc + '0.65)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -t / 30;
    ctx.beginPath(); ctx.arc(ZONE.x, ZONE.y, ZONE.r, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = zc + '0.5)';
    ctx.font = 'bold 13px Consolas,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ZONE', ZONE.x, ZONE.y - ZONE.r - 8);
  }

  // pickups & ground weapons
  for (const p of groundPk) if (visible(p[0], p[1], 40)) drawPickup(p[0], p[1], p[2], t);
  for (const w of groundWp) if (visible(w[0], w[1], 60)) drawGroundWeapon(w[0], w[1], w[2], t);

  // grenades
  for (const g of grenades) {
    ctx.fillStyle = '#3b4a2f';
    ctx.beginPath(); ctx.arc(g[0], g[1], 5, 0, 7); ctx.fill();
    if (Math.sin(t / 60) > 0) {
      ctx.fillStyle = '#ff5252';
      ctx.beginPath(); ctx.arc(g[0], g[1], 2, 0, 7); ctx.fill();
    }
  }

  // bullets (extrapolated tracers)
  const bAge = Math.min(0.05, (nowMs() - lastBsRt) / 1000);
  for (const b of lastBs) {
    const spec = WEAPONS[b[4]] || {};
    const spd = spec.speed || 900;
    const bx = b[1] + Math.cos(b[3]) * spd * bAge;
    const by = b[2] + Math.sin(b[3]) * spd * bAge;
    if (b[4] === 'quad') {
      // rocket: chunky orange head + exhaust glow + flame trail
      ctx.fillStyle = 'rgba(255,140,70,.95)';
      ctx.beginPath(); ctx.arc(bx, by, 4, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,210,120,.5)';
      ctx.beginPath(); ctx.arc(bx, by, 6.5, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,150,80,.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(b[3]) * 20, by - Math.sin(b[3]) * 20);
      ctx.stroke();
      // flame + smoke trail particles
      addParticles(bx, by, 1, Math.random() < 0.6 ? '#ff9333' : '#ffd54f', 55, 0.3, 2.0);
      addParticles(bx, by, 1, '#5a5a5a', 35, 0.55, 1.6);
      continue;
    }
    if (b[4] === 'shuriken') {
      // spinning steel star + faint shadow trail
      addParticles(bx, by, 1, 'rgba(45,45,55,0.45)', 22, 0.4, 2.6);
      drawShuriken(bx, by, 10, nowMs() / 28);
      continue;
    }
    const ln = b[4] === 'sniper' ? 22 : 13;
    ctx.strokeStyle = b[4] === 'sniper' ? 'rgba(255,235,160,.95)' : 'rgba(255,220,130,.85)';
    ctx.lineWidth = b[4] === 'sniper' ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - Math.cos(b[3]) * ln, by - Math.sin(b[3]) * ln);
    ctx.stroke();
  }

  // players
  for (const p of interpOthers()) {
    if (!p.alive || !visible(p.x, p.y, 50)) continue;
    drawPlayer(p, false);
  }
  if (my.alive) drawPlayer({ x: my.rx, y: my.ry, aim: aimAng(), color: my.color, hp: my.hp, clsIdx: CLS_ORDER.indexOf(my.cls), team: my.team }, true);

  // orbiting shuriken blades (holder keeps the count in the snapshot)
  const shuSpin = nowMs() / 1000 * 2.2;
  const drawOrbit = (px, py, n) => {
    for (let i = 0; i < n; i++) {
      const aa = shuSpin + (Math.PI * 2 / n) * i;
      const ox = px + Math.cos(aa) * 46, oy = py + Math.sin(aa) * 46;
      drawShuriken(ox, oy, 8, nowMs() / 30);
    }
  };
  for (const p of interpOthers()) {
    if (p.alive && p.shu > 0 && visible(p.x, p.y, 70)) drawOrbit(p.x, p.y, p.shu);
  }
  if (my.alive && my.shu > 0) drawOrbit(my.rx, my.ry, my.shu);

  // quad rocket lock: while aiming, lock the enemy closest to the aim line
  if (my.alive && aiming && my.weapon === 'quad') {
    const myAng = aimAng();
    let best = 0, bestD = 0.62;   // ~35 degree acquisition cone
    for (const p of interpOthers()) {
      if (!p.alive) continue;
      const ang = Math.atan2(p.y - my.ry, p.x - my.rx);
      const d = Math.abs(((ang - myAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d < bestD) { bestD = d; best = p.id; }
    }
    lockId = best;
  } else {
    lockId = 0;
  }
  // lock reticle on the locked enemy
  if (lockId) {
    const [lx, ly] = posOf(lockId);
    const s = 15, o = 5 + Math.sin(nowMs() / 120) * 2;
    ctx.strokeStyle = 'rgba(255,90,60,.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx - s - o, ly - s - o + 9); ctx.lineTo(lx - s - o, ly - s - o); ctx.lineTo(lx - s - o + 9, ly - s - o);
    ctx.moveTo(lx + s + o - 9, ly - s - o); ctx.lineTo(lx + s + o, ly - s - o); ctx.lineTo(lx + s + o, ly - s - o + 9);
    ctx.moveTo(lx + s + o, ly + s + o - 9); ctx.lineTo(lx + s + o, ly + s + o); ctx.lineTo(lx + s + o - 9, ly + s + o);
    ctx.moveTo(lx - s - o + 9, ly + s + o); ctx.lineTo(lx - s - o, ly + s + o); ctx.lineTo(lx - s - o, ly + s + o - 9);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,90,60,.95)';
    ctx.font = 'bold 9px Consolas,monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LOCK', lx, ly + s + o + 13);
  }
  // quad aiming FX: rotating seeker arcs around the crosshair, lock line
  if (my.alive && aiming && my.weapon === 'quad') {
    const rot = t / 200;
    const col = lockId ? 'rgba(255,90,60,.9)' : 'rgba(255,140,70,.5)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    for (let s2 = 0; s2 < 3; s2++) {
      const a0 = rot + s2 * (Math.PI * 2 / 3);
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 18, a0, a0 + 1.4);
      ctx.stroke();
    }
    if (lockId) {
      const [lx2, ly2] = posOf(lockId);
      ctx.setLineDash([6, 6]);
      ctx.lineDashOffset = -t / 30;
      ctx.strokeStyle = 'rgba(255,90,60,.5)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(mouseX, mouseY);
      ctx.lineTo(lx2, ly2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // muzzle flashes
  for (const f of flashes) {
    const a = f.life / f.tot;
    ctx.fillStyle = 'rgba(255,220,120,' + a + ')';
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(f.ang);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, -4); ctx.lineTo(16, 0); ctx.lineTo(12, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // particles
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.tot, 0, 1);
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // rings
  for (const r of rings) {
    const k = 1 - r.life / r.tot;
    ctx.strokeStyle = r.c;
    ctx.lineWidth = r.w;
    ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r0, r.r1, k), 0, 7); ctx.stroke();
  }

  // damage floaters
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life / f.tot, 0, 1);
    ctx.fillStyle = f.c;
    ctx.font = 'bold ' + f.sz + 'px Consolas,monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 3;
    ctx.strokeText(f.txt, f.x, f.y);
    ctx.fillText(f.txt, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // sniper scope: dotted trajectory preview up to the first wall (crates
  // don't block bullets, so they don't block the preview either)
  if (scoped && my.alive) {
    const ang = aimAng(), maxD = 2400, step = 6;
    const dxc = Math.cos(ang), dyc = Math.sin(ang);
    let hitD = maxD;
    for (let d = step; d < maxD; d += step) {
      if (gridAt(Math.floor((my.rx + dxc * d) / TILE), Math.floor((my.ry + dyc * d) / TILE)) !== 0) { hitD = d; break; }
    }
    const ex = my.rx + dxc * hitD, ey = my.ry + dyc * hitD;
    ctx.strokeStyle = 'rgba(255,235,160,.8)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([7, 9]);
    ctx.lineDashOffset = -t / 40;
    ctx.beginPath();
    ctx.moveTo(my.rx + dxc * (PLAYER_R + 4), my.ry + dyc * (PLAYER_R + 4));
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
    // impact marker
    ctx.strokeStyle = 'rgba(255,235,160,.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(ex, ey, 7, 0, 7); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ex - 12, ey); ctx.lineTo(ex - 4, ey);
    ctx.moveTo(ex + 4, ey); ctx.lineTo(ex + 12, ey);
    ctx.moveTo(ex, ey - 12); ctx.lineTo(ex, ey - 4);
    ctx.moveTo(ex, ey + 4); ctx.lineTo(ex, ey + 12);
    ctx.stroke();
  }

  ctx.restore();

  // scope overlay: soft vignette (no lens ring) — keeps the wider view readable
  if (scoped) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30, W / 2, H / 2, Math.max(W, H) * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, 'rgba(0,0,0,.18)');
    g.addColorStop(1, 'rgba(0,0,0,.62)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // damage vignette
  if (dmgFlash > 0.01) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(255,0,0,0)');
    g.addColorStop(1, 'rgba(255,0,0,' + (dmgFlash * 0.5) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // hitmarks near crosshair
  for (const hm of hitmarks) {
    const a = hm.life / hm.tot;
    ctx.strokeStyle = 'rgba(255,80,80,' + a + ')';
    ctx.lineWidth = 2.5;
    const s = 9;
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(mouseX + dx * 5, mouseY + dy * 5);
      ctx.lineTo(mouseX + dx * (5 + s), mouseY + dy * (5 + s));
      ctx.stroke();
    }
  }

  // crosshair — always visible now (scope has no lens overlay anymore);
  // shows the green accuracy ring while aiming. The shuriken auto-locks its
  // target, so both the OS cursor and the aim crosshair stay hidden.
  if (joined && my.weapon !== 'shuriken') {
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(mouseX - 8, mouseY); ctx.lineTo(mouseX - 3, mouseY);
    ctx.moveTo(mouseX + 3, mouseY); ctx.lineTo(mouseX + 8, mouseY);
    ctx.moveTo(mouseX, mouseY - 8); ctx.lineTo(mouseX, mouseY - 3);
    ctx.moveTo(mouseX, mouseY + 3); ctx.lineTo(mouseX, mouseY + 8);
    ctx.stroke();
    if (aiming && my.alive) {
      ctx.strokeStyle = 'rgba(102,255,150,.75)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 13, 0, 7);
      ctx.stroke();
    }
  }
}

// ---------- HUD ----------
let lastHud = 0, lastMini = 0, lastSb = 0;

function updateHud() {
  if (!joined) return;
  $('modeLabel').textContent = MODE.toUpperCase();
  const ts = $('teamScore');
  if (MODE === 'ffa') ts.classList.add('hidden');
  else {
    ts.classList.remove('hidden');
    if (MODE === 'tdm') { $('redScore').textContent = teamKills[0]; $('blueScore').textContent = teamKills[1]; }
    else { $('redScore').textContent = zpts[0]; $('blueScore').textContent = zpts[1]; }
  }
  const mc = $('modeChip');
  mc.style.borderColor = zoneOwner === 1 ? '#ff5252' : zoneOwner === 2 ? '#40a4ff' : '';
  // persistent account badge (sysLine disappears; this stays)
  const chip = $('acctChip');
  if (my.acct) {
    chip.classList.remove('hidden');
    chip.textContent = (my.aname || my.name) + ' · LV ' + my.level;
  } else {
    chip.classList.add('hidden');
  }

  $('hpFill').style.width = clamp(my.hp / my.maxhp * 100, 0, 100) + '%';
  $('hpFill').style.background = my.hp / my.maxhp > 0.5 ? '#66bb6a' : my.hp / my.maxhp > 0.25 ? '#ffca28' : '#ef5350';
  $('hpText').textContent = Math.ceil(my.hp);
  $('armorBar').style.display = my.armor > 0 ? '' : 'none';
  $('armorFill').style.width = clamp(my.armor, 0, 100) + '%';
  $('armorText').textContent = my.armor > 0 ? my.armor : '';
  $('xpFill').style.width = clamp((my.xp - my.xpBase) / Math.max(1, my.xpNext - my.xpBase) * 100, 0, 100) + '%';
  $('lvlText').textContent = 'LV ' + my.level;

  // weapon slots (color-coded) + ammo bar
  const s1 = $('slot1'), s2 = $('slot2');
  const wCol1 = WPN_COLOR[my.weapon] || '#bdbdbd';
  const wCol2 = WPN_COLOR[my.primary] || '#bdbdbd';
  s1.classList.toggle('cur', my.slot === 1);
  s2.classList.toggle('cur', my.slot === 2);
  s1.style.borderColor = my.slot === 1 ? wCol1 : '';
  s2.style.borderColor = my.slot === 2 ? wCol2 : '';
  $('wdot1').style.background = wCol1;
  $('wdot2').style.background = wCol2;
  $('name2').textContent = WEAPONS && WEAPONS[my.primary] ? WEAPONS[my.primary].name : my.primary;
  $('mag1').textContent = my.slot === 1 ? my.mag : '·';
  $('mag2').textContent = my.slot === 2 ? my.mag : '·';
  $('ammoCur').textContent = my.reloadT > 0 ? '--' : my.mag;
  $('ammoMax').textContent = '/' + my.magSize;
  $('ammoCur').style.color = my.mag === 0 ? '#ef5350' : my.mag <= Math.ceil(my.magSize * 0.25) ? '#ffca28' : '#fff';
  const reloading = my.reloadT > 0;
  $('ammoFill').style.width = reloading ? '100%' : clamp(my.mag / Math.max(1, my.magSize) * 100, 0, 100) + '%';
  $('ammoFill').style.background = reloading ? '#ffca28' : my.mag / Math.max(1, my.magSize) <= 0.25 ? '#ef5350' : wCol1;

  // grenade pips (regen cap 3, pickups can exceed) — dirty-checked
  let pips = '';
  for (let i = 0; i < Math.min(3, my.gren); i++) pips += '<span class="pip on"></span>';
  for (let i = my.gren; i < 3; i++) pips += '<span class="pip"></span>';
  if (my.gren > 3) pips += '<span class="pipMore">+' + (my.gren - 3) + '</span>';
  const gp = $('grenPips');
  if (gp.innerHTML !== pips) gp.innerHTML = pips;

  // skill 1 (E)
  const clsDef = CLASS_DEFS.find(c => c.id === my.cls) || CLASS_DEFS[0];
  $('skillName').textContent = SKILL_LABEL[clsDef.skill.toLowerCase()] || clsDef.skill;
  const cdEl = $('skillCd');
  const frac = my.skCdMax > 0 ? clamp(my.skCd / my.skCdMax, 0, 1) : 0;
  cdEl.style.height = (frac * 100) + '%';
  $('skillBox').classList.toggle('ready', my.skCd <= 0);
  $('skillCdText').textContent = my.skCd > 0 ? Math.ceil(my.skCd) : '';

  // skill 2 (F)
  $('skillName2').textContent = SKILL2_LABEL[clsDef.skill2.toLowerCase()] || clsDef.skill2;
  const frac2 = my.sk2CdMax > 0 ? clamp(my.sk2Cd / my.sk2CdMax, 0, 1) : 0;
  $('skillCd2').style.height = (frac2 * 100) + '%';
  $('skillBox2').classList.toggle('ready', my.sk2Cd <= 0);
  $('skillCd2Text').textContent = my.sk2Cd > 0 ? Math.ceil(my.sk2Cd) : '';

  // buffs
  let bf = '';
  if (my.spdT > 0) bf += '<span class="buff spd">SPD ' + Math.ceil(my.spdT) + '</span>';
  if (my.pwrT > 0) bf += '<span class="buff pwr">PWR ' + Math.ceil(my.pwrT) + '</span>';
  if (my.rvlT > 0) bf += '<span class="buff rvl">RADAR ' + Math.ceil(my.rvlT) + '</span>';
  if (my.shdT > 0) bf += '<span class="buff shd">SHIELD ' + Math.ceil(my.shdT) + '</span>';
  if (my.rapidT > 0) bf += '<span class="buff rap">RAPID ' + Math.ceil(my.rapidT) + '</span>';
  if (my.slowT > 0) bf += '<span class="buff slw">SLOWED ' + Math.ceil(my.slowT) + '</span>';
  if (scoped && my.alive) bf += '<span class="buff scp">SCOPED</span>';
  else if (aiming && my.alive) bf += '<span class="buff scp">AIM</span>';
  const buffs = $('buffs');
  if (buffs.innerHTML !== bf) buffs.innerHTML = bf;

  // banner / respawn / reload
  const banner = $('banner');
  if (winnerTxt) {
    banner.classList.remove('hidden');
    $('bannerMain').textContent = winnerTxt;
    $('bannerSub').textContent = 'Next round in ' + Math.ceil(roundLeft) + 's';
  } else if (goFlashT > 0) {
    banner.classList.remove('hidden');
    $('bannerMain').textContent = MODE === 'koth' ? 'CAPTURE THE ZONE' : 'FIGHT!';
    $('bannerSub').textContent = '';
  } else banner.classList.add('hidden');

  const rp = $('respawn');
  if (!my.alive && joined) {
    rp.classList.remove('hidden');
    rp.textContent = my.respawn > 0 ? 'Respawn in ' + my.respawn.toFixed(1) + 's' : '';
  } else rp.classList.add('hidden');

  $('reloadHint').classList.toggle('hidden', !(my.reloadT > 0));
  $('muteChip').classList.toggle('hidden', !muted);
}

function updateMinimap() {
  if (!joined || !mmBase) return;
  mmCtx.clearRect(0, 0, mmCv.width, mmCv.height);
  mmCtx.drawImage(mmBase, 0, 0);
  if (MODE === 'koth' && ZONE) {
    mmCtx.strokeStyle = zoneOwner === 1 ? '#ff5252' : zoneOwner === 2 ? '#40a4ff' : 'rgba(255,255,255,.7)';
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath();
    mmCtx.arc(ZONE.x / TILE * 3, ZONE.y / TILE * 3, ZONE.r / TILE * 3, 0, 7);
    mmCtx.stroke();
  }
  for (const row of lastPs) {
    if (!row[6]) continue;
    const isTeammate = MODE !== 'ffa' && row[14] === my.team;
    const d = dist(row[1], row[2], my.rx, my.ry);
    if (!isTeammate && d > 320 && my.rvlT <= 0) continue;
    mmCtx.fillStyle = row[12];
    mmCtx.fillRect(row[1] / TILE * 3 - 1.5, row[2] / TILE * 3 - 1.5, 3, 3);
  }
  mmCtx.fillStyle = '#fff';
  mmCtx.fillRect(my.rx / TILE * 3 - 2, my.ry / TILE * 3 - 2, 4, 4);
}

function updateScoreboard() {
  if (!joined) return;
  const rows = lastPs.map(r => ({
    name: r[7], color: r[12], kills: r[9], deaths: r[10], score: r[8],
    team: r[14], clsIdx: r[15], me: false,
  }));
  rows.push({ name: my.name, color: my.color, kills: my.kills, deaths: my.deaths, score: my.score, team: my.team, clsIdx: CLS_ORDER.indexOf(my.cls), me: true });
  if (MODE !== 'ffa') rows.sort((a, b) => a.team - b.team || b.kills - a.kills);
  else rows.sort((a, b) => b.kills - a.kills);
  let html = '';
  for (const r of rows) {
    const cls = CLS_ORDER[r.clsIdx] || '?';
    html += '<tr class="' + (r.me ? 'meRow' : '') + '">' +
      '<td style="color:' + r.color + '">' + r.name + (r.me ? ' (you)' : '') + '</td>' +
      '<td><span class="clsTag" style="background:' + (CLS_COLOR[cls] || '#888') + '22;color:' + (CLS_COLOR[cls] || '#888') + ';border-color:' + (CLS_COLOR[cls] || '#888') + '">' + (CLS_LETTER[cls] || '?') + ' ' + cls + '</span></td>' +
      '<td>' + r.kills + '</td><td>' + r.deaths + '</td><td>' + r.score + '</td></tr>';
  }
  $('sbBody').innerHTML = html;
}

// ---------- main loop ----------
let lastT = nowMs();
function frame() {
  requestAnimationFrame(frame);
  const t = nowMs();
  let dt = (t - lastT) / 1000;
  lastT = t;
  dt = Math.min(dt, 0.05);

  predict(dt);

  // camera
  if (joined) {
    // watchdog: no snapshots for 2.5s means a dead/half-open connection —
    // surface it immediately instead of a frozen screen (skipped for the
    // in-process local sim: background tabs throttle its timers)
    if (lastSnapRt && !(ws && ws._local) && nowMs() - lastSnapRt > 2500) {
      try { ws.close(); } catch (e) {}
      onDisconnected();
      return;
    }
    if (!cam.init) { cam.x = my.rx; cam.y = my.ry; cam.init = true; }
    cam.x = lerp(cam.x, my.rx, 0.22);
    cam.y = lerp(cam.y, my.ry, 0.22);
  }

  // effects update
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].life -= dt; if (rings[i].life <= 0) rings.splice(i, 1); }
  for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].life -= dt; if (flashes[i].life <= 0) flashes.splice(i, 1); }
  for (let i = hitmarks.length - 1; i >= 0; i--) { hitmarks[i].life -= dt; if (hitmarks[i].life <= 0) hitmarks.splice(i, 1); }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.y += f.vy * dt; f.vy *= 1 - 1.5 * dt; f.life -= dt;
    if (f.life <= 0) floaters.splice(i, 1);
  }
  shake = Math.max(0, shake - 40 * dt);
  shakeX = (Math.random() - 0.5) * shake; shakeY = (Math.random() - 0.5) * shake;
  dmgFlash = Math.max(0, dmgFlash - 1.8 * dt);
  goFlashT = Math.max(0, goFlashT - dt);

  render(t);

  if (t - lastHud > 80) { lastHud = t; updateHud(); }
  if (t - lastMini > 100) { lastMini = t; updateMinimap(); }
  if (t - lastSb > 250 && !$('scoreboard').classList.contains('hidden')) { lastSb = t; updateScoreboard(); }
}
frame();

// ---------- menu wiring ----------
function buildClassCards() {
  const row = $('classRow');
  row.innerHTML = '';
  for (const c of CLASS_DEFS) {
    const card = document.createElement('div');
    card.className = 'clsCard' + (c.id === selCls ? ' sel' : '');
    card.dataset.cls = c.id;
    card.innerHTML =
      '<div class="clsHead" style="color:' + CLS_COLOR[c.id] + '">' + c.name + '</div>' +
      '<div class="clsSkill">E · ' + c.skill + ' <span class="clsCd">' + c.cd + '</span></div>' +
      '<div class="clsSkill">F · ' + c.skill2 + ' <span class="clsCd">' + c.cd2 + '</span></div>' +
      '<div class="clsMeta">' + c.hp + ' HP · ' + c.wpn + '</div>' +
      '<div class="clsDesc">' + c.desc + '</div>';
    card.addEventListener('click', () => {
      selCls = c.id;
      for (const el of row.children) el.classList.toggle('sel', el.dataset.cls === c.id);
      sClick();
    });
    row.appendChild(card);
  }
}
buildClassCards();

$('modeSel').addEventListener('change', () => { modeDirty = true; });
$('playBtn').addEventListener('click', play);
$('nameInput').value = localStorage.getItem('slayname') || '';
$('serverInput').value = localStorage.getItem('slayserver') || '';
$('acctName').value = localStorage.getItem('slayacct') || '';
$('acctPass').value = localStorage.getItem('slaypass') || '';
})();
