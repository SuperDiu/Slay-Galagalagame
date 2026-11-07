/* SLAY.HTML local sim — the authoritative Python server (server.py) ported
   1:1 to the browser. Exposes window.SlayLocal.createSocket(): a WebSocket-
   compatible object wired to an in-process game server that speaks the exact
   same JSON protocol as server.py. This lets the full game (bots, weapons,
   skills, FFA/TDM/KOTH) run from static hosting like GitHub Pages. */
(() => {
'use strict';

// ---------------- game constants (mirror of server.py) ----------------
const TICK_RATE = 30, DT = 1.0 / TICK_RATE;
const TILE = 32, MAP_W = 64, MAP_H = 48;
const PLAYER_R = 13;
const MOVE_R = 9;    // collision radius for movement: smaller than the visual body
const BASE_SPEED = 220.0;
const RESPAWN_TIME = 3.0, SPAWN_PROTECT = 2.0, MAX_PLAYERS = 16;
const BULLET_CAP = 250, DROP_CAP = 20;

const NADE_SPEED = 480.0, NADE_RADIUS = 140.0, NADE_DMG = 85.0, NADE_FUSE = 1.7;
const NADE_MAX = 3, NADE_REGEN = 7.0, NADE_CD = 1.0;

const CRATE_HP_MAX = 60;
const SCORE_LIMIT = { ffa: 20, tdm: 40, koth: 150 };
const ZONE_PTS_RATE = 2.0;
const ROUND_BREAK = 6.0;
const MODES = ['ffa', 'tdm', 'koth'];

const WEAPONS = {
  pistol:   { slot: 1,  name: 'Pistol',   dmg: 18,  rof: 0.24,  speed: 850,  spread: 0.003,  mag: 12,  reload: 1.0, pellets: 1, rrange: 900,  auto: false },
  smg:      { slot: 2,  name: 'SMG',      dmg: 9,   rof: 0.075, speed: 900,  spread: 0.006,  mag: 30,  reload: 1.6, pellets: 1, rrange: 750,  auto: true },
  shotgun:  { slot: 3,  name: 'Shotgun',  dmg: 8,   rof: 0.85,  speed: 750,  spread: 0.030,  mag: 6,   reload: 2.2, pellets: 6, rrange: 380,  auto: false },
  rifle:    { slot: 4,  name: 'Rifle',    dmg: 24,  rof: 0.15,  speed: 1000, spread: 0.003,  mag: 25,  reload: 1.9, pellets: 1, rrange: 1100, auto: true },
  sniper:   { slot: 5,  name: 'Sniper',   dmg: 90,  rof: 1.3,   speed: 2200, spread: 0.0004, mag: 5,   reload: 2.4, pellets: 1, rrange: 1600, auto: false },
  deagle:   { slot: 6,  name: 'Deagle',   dmg: 45,  rof: 0.45,  speed: 1100, spread: 0.002,  mag: 7,   reload: 1.8, pellets: 1, rrange: 1000, auto: false, legend: 1 },
  minigun:  { slot: 7,  name: 'Minigun',  dmg: 7,   rof: 0.050, speed: 950,  spread: 0.008,  mag: 80,  reload: 3.2, pellets: 1, rrange: 800,  auto: true,  legend: 1 },
  railgun:  { slot: 8,  name: 'Railgun',  dmg: 120, rof: 1.1,   speed: 1800, spread: 0.0002, mag: 4,   reload: 2.6, pellets: 1, rrange: 1800, auto: false, legend: 1 },
  quad:     { slot: 9,  name: 'Quad RL',  dmg: 80,  rof: 0.95,  speed: 760,  spread: 0.004,  mag: 1,   reload: 2.5, pellets: 1, rrange: 1300, auto: false, legend: 1, rocket: true },
  shuriken: { slot: 10, name: 'Shuriken', dmg: 10,  rof: 0.45,  speed: 1150, spread: 0.0,    mag: 999, reload: 0.0, pellets: 1, rrange: 800,  auto: false, legend: 1, shuriken: true },
};
const SNIPER_WEAPONS = ['sniper', 'railgun'];
const ROCKET_TURN = 1.6, ROCKET_RADIUS = 130.0, ROCKET_KNOCKBACK = 430.0;
const CRIT_CHANCE = 0.15, CRIT_MULT = 1.5;
const SHURIKEN_MAX = 8, SHURIKEN_REGEN = 1.0, SHURIKEN_SPIN = 2.2;
const SHURIKEN_ORBIT_R = 46, SHURIKEN_RANGE = 700, SHURIKEN_GAP = 0.07;
const SHURIKEN_TURN = 3.0, SHURIKEN_SOAK = 0.15, SHURIKEN_SOAK_MAX = 0.6;
const WSPAWN_TIME = 20.0, DROP_TTL = 25.0;

const CLASSES = ['assault', 'medic', 'scout', 'heavy'];
const CLASS_INFO = {
  assault: { name: 'Assault', skill: 'dash',   cd: 4.0,  skill2: 'barrage', cd2: 10.0, maxhp: 100, default: 'rifle' },
  medic:   { name: 'Medic',   skill: 'heal',   cd: 12.0, skill2: 'guard',   cd2: 14.0, maxhp: 100, default: 'smg' },
  scout:   { name: 'Scout',   skill: 'reveal', cd: 15.0, skill2: 'blink',   cd2: 9.0,  maxhp: 100, default: 'smg' },
  heavy:   { name: 'Heavy',   skill: 'shield', cd: 14.0, skill2: 'slam',    cd2: 12.0, maxhp: 130, default: 'shotgun' },
};
const CLS_IDX = { assault: 0, medic: 1, scout: 2, heavy: 3 };

const PICKUP_RESPAWN = { med: 20.0, armor: 35.0, speed: 30.0, power: 35.0, ammo: 25.0, nade: 30.0 };
const NADE_PICKUP_CAP = 9;
const MED_HEAL = 50, MED_HEAL_MEDIC = 75, ARMOR_AMOUNT = 50, BUFF_TIME = 10.0;
const SPEED_MULT = 1.35, POWER_MULT = 1.5, SCOUT_SPEED = 1.15;
const DASH_TIME = 0.18, DASH_MULT = 3.2;
const SHIELD_TIME = 4.0, SHIELD_REDUCE = 0.3;
const REVEAL_TIME = 6.0, HEAL_REGEN = 10.0, HEAL_TOTAL = 40, HEAL_TEAMMATE = 25;

const LEGEND_INTERVAL = 40.0, LEGEND_MAX = 5;
const LEGEND_KEYS = ['deagle', 'minigun', 'railgun', 'quad', 'shuriken'];

const TEAM_COLOR = { 0: '#ffffff', 1: '#ff5252', 2: '#40a4ff' };
const PALETTE = ['#ff5252', '#4fc3f7', '#66bb6a', '#ffca28', '#ab47bc', '#26c6da',
                 '#ff7043', '#9ccc65', '#ec407a', '#8d6e63', '#5c6bc0', '#26a69a',
                 '#ef5350', '#29b6f6', '#d4e157', '#ffa726'];

const ZONE = { x: Math.floor(MAP_W / 2) * TILE, y: Math.floor(MAP_H / 2) * TILE, r: 140.0 };

// ---------------- helpers ----------------
const now = () => performance.now() / 1000;
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const randRange = (min, maxExcl) => Math.floor(Math.random() * (maxExcl - min)) + min;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ---------------- map (mirror of build_world) ----------------
function buildWorld() {
  const W = MAP_W, H = MAP_H;
  const g = Array.from({ length: H }, () => new Array(W).fill(0));
  for (let x = 0; x < W; x++) { g[0][x] = 1; g[H - 1][x] = 1; }
  for (let y = 0; y < H; y++) { g[y][0] = 1; g[y][W - 1] = 1; }

  const rect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if (x === x0 || x === x1 || y === y0 || y === y1) g[y][x] = 1;
  };
  const door = pts => { for (const [x, y] of pts) g[y][x] = 0; };
  const blocks = pts => {
    for (const [x, y] of pts) for (const dy of [0, 1]) for (const dx of [0, 1]) g[y + dy][x + dx] = 1;
  };
  const mirror4 = pts => {
    const out = [];
    for (const [x, y] of pts) out.push([x, y], [W - 1 - x, y], [x, H - 1 - y], [W - 1 - x, H - 1 - y]);
    return out;
  };
  const crates = pts => { for (const [x, y] of mirror4(pts)) g[y][x] = 2; };

  // corner buildings (rooms with two doorways each)
  rect(4, 4, 12, 10);   door([[8, 10], [9, 10], [12, 7], [12, 8]]);
  rect(51, 4, 59, 10);  door([[54, 10], [55, 10], [51, 7], [51, 8]]);
  rect(4, 37, 12, 43);  door([[8, 37], [9, 37], [12, 39], [12, 40]]);
  rect(51, 37, 59, 43); door([[54, 37], [55, 37], [51, 39], [51, 40]]);
  // mid-edge buildings
  rect(27, 3, 36, 7);   door([[30, 7], [33, 7]]);
  rect(27, 40, 36, 44); door([[30, 40], [33, 40]]);
  // center cross + pillars (kept outside the KOTH zone radius)
  rect(31, 16, 32, 17); rect(31, 30, 32, 31);
  rect(23, 23, 24, 24); rect(39, 23, 40, 24);
  blocks(mirror4([[26, 19]]));
  blocks(mirror4([[18, 14]]));
  blocks(mirror4([[13, 29]]));
  // scattered crates (destructible cover, also blocks bullets)
  crates([[16, 8], [44, 15]]);

  const centerOf = (tx, ty) => [tx * TILE + TILE / 2, ty * TILE + TILE / 2];
  const nearestFloor = (tx, ty) => {
    if (g[ty][tx] === 0) return [tx, ty];
    for (let r = 1; r < 6; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x > 0 && x < W - 1 && y > 0 && y < H - 1 && g[y][x] === 0) return [x, y];
      }
    return [1, 1];
  };
  const spots = (pts, oneSide = false) => {
    const out = [], seen = new Set();
    for (const [x, y] of (oneSide ? pts : mirror4(pts))) {
      const k = x + ',' + y;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(centerOf(...nearestFloor(x, y)));
    }
    return out;
  };

  const spawns = spots([[7, 15], [3, 24], [15, 3], [26, 44]]);
  const meds = spots([[10, 12], [15, 26]]);
  const speed = spots([[22, 8]]);
  const power = spots([[31, 13]]);
  const ammo = spots([[12, 24], [24, 40]]);
  const nades = spots([[16, 36]]);
  const armor = spots([[31, 24]], true);   // center pair only

  const pickups = (
    meds.map(([x, y]) => ({ x, y, kind: 'med', timer: 0 }))
      .concat(armor.map(([x, y]) => ({ x, y, kind: 'armor', timer: 0 })))
      .concat(speed.map(([x, y]) => ({ x, y, kind: 'speed', timer: 0 })))
      .concat(power.map(([x, y]) => ({ x, y, kind: 'power', timer: 0 })))
      .concat(ammo.map(([x, y]) => ({ x, y, kind: 'ammo', timer: 0 })))
      .concat(nades.map(([x, y]) => ({ x, y, kind: 'nade', timer: 0 })))
  );

  const wspot = (tx, ty, wk) => {
    const [x, y] = centerOf(...nearestFloor(tx, ty));
    return { x, y, weapon: wk, timer: 0.0 };
  };
  const wspawns = [
    wspot(31, 5, 'sniper'), wspot(32, 42, 'sniper'),
    wspot(8, 7, 'shotgun'), wspot(55, 40, 'shotgun'),
    wspot(5, 23, 'rifle'), wspot(58, 24, 'rifle'),
    wspot(31, 15, 'smg'), wspot(32, 32, 'smg'),
  ];
  const rows = g.map(row => row.map(v => v === 1 ? '#' : v === 2 ? 'C' : '.').join(''));
  return { rows, g, spawns, pickups, wspawns };
}

const WORLD = buildWorld();
const ROWS = WORLD.rows, GRID = WORLD.g, SPAWNS = WORLD.spawns;
const PICKUPS = WORLD.pickups, WSPAWNS = WORLD.wspawns;
const CRATE_HP = new Map();
for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++)
  if (GRID[y][x] === 2) CRATE_HP.set(x + ',' + y, CRATE_HP_MAX);

// ---------------- state ----------------
const PLAYERS = new Map();
let BULLETS = [], GRENADES = [], DROPS = [], EVENTS = [];
let NEXT_ID = 1, NEXT_BULLET = 1, TICK_N = 0;
let MODE = 'ffa';
const TEAM_KILLS = [0, 0, 0];
const ZPTS = [0.0, 0.0];
let ROUND_OVER_UNTIL = 0.0, WINNER = '';
let LEGEND_TIMER = 12.0;
let FIRST_BLOOD_DONE = false;

// ---------------- accounts (localStorage-backed) ----------------
const ACCT_KEY = 'slayaccounts_v1';
let ACCOUNTS = {};
try { ACCOUNTS = JSON.parse(localStorage.getItem(ACCT_KEY) || '{}') || {}; }
catch (e) { ACCOUNTS = {}; }
function saveAccounts() {
  try { localStorage.setItem(ACCT_KEY, JSON.stringify(ACCOUNTS)); } catch (e) { /* private mode */ }
}
function hashPw(pw) {  // fast sync hash — casual game, not security-critical
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = String(pw);
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
function levelForXp(xp) { return Math.floor(Math.sqrt(Math.max(0, xp) / 200)) + 1; }

// ---------------- collision helpers ----------------
function solidAt(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return GRID[ty][tx] !== 0;
}
function solidWallAt(px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return GRID[ty][tx] === 1;
}
function circleHitsWall(x, y, r) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    if (GRID[ty][tx] === 0) continue;
    const cx = Math.min(Math.max(x, tx * TILE), tx * TILE + TILE);
    const cy = Math.min(Math.max(y, ty * TILE), ty * TILE + TILE);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}
function walkTile(tx, ty) {
  return tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && GRID[ty][tx] === 0;
}
function moveWithSlide(x, y, dx, dy, r) {
  if (dx === 0 && dy === 0) return [x, y];
  if (!circleHitsWall(x + dx, y + dy, r)) return [x + dx, y + dy];
  let nx = x, ny = y, moved = false;
  if (dx && !circleHitsWall(x + dx, y, r)) { nx = x + dx; moved = true; }
  if (dy && !circleHitsWall(nx, y + dy, r)) { ny = y + dy; moved = true; }
  if (moved) return [nx, ny];
  // sub-stepped creep: 8 tiny steps covering the full move (tight seams)
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
  // tangential nudge around protruding corners
  for (const sign of [1.0, -1.0]) {
    const tx = -dy * 0.35 * sign, ty = dx * 0.35 * sign;
    if (!circleHitsWall(x + tx, y + ty, r)) return [x + tx, y + ty];
  }
  return [x, y];
}
function depenetrate(x, y, r) {
  for (let tries = 0; tries < 3; tries++) {
    if (!circleHitsWall(x, y, r)) return [x, y];
    let best = null;
    for (let a = 0; a < 12; a++) {
      const ang = a * (Math.PI * 2 / 12);
      for (const d of [2, 4, 6, 9, 12, 16, 20, 26, 32]) {
        const tx = x + Math.cos(ang) * d, ty = y + Math.sin(ang) * d;
        if (!circleHitsWall(tx, ty, r)) {
          if (!best || d < best[2]) best = [tx, ty, d];
          break;
        }
      }
    }
    if (!best) return [x, y];
    x = best[0]; y = best[1];
  }
  return [x, y];
}
function hasLos(x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.floor(d / 14) + 1;
  for (let i = 1; i < steps; i++) {
    const tt = i / steps;
    if (solidAt(x1 + (x2 - x1) * tt, y1 + (y2 - y1) * tt)) return false;
  }
  return true;
}

// min-heap keyed on [f, cnt] for astar
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  lt(x, y) { return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.lt(a[i], a[p])) { const t = a[i]; a[i] = a[p]; a[p] = t; i = p; }
      else break;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, rr = l + 1;
        let m = i;
        if (l < a.length && this.lt(a[l], a[m])) m = l;
        if (rr < a.length && this.lt(a[rr], a[m])) m = rr;
        if (m === i) break;
        const t = a[i]; a[i] = a[m]; a[m] = t;
        i = m;
      }
    }
    return top;
  }
}
function astar(sx, sy, tx, ty) {
  if (!walkTile(sx, sy) || !walkTile(tx, ty)) return null;
  const open = new MinHeap();
  let cnt = 0;
  open.push([0, 0, sx, sy]);
  const came = new Map(), gscore = new Map([[sx + ',' + sy, 0]]);
  while (open.size) {
    const [, , x, y] = open.pop();
    if (x === tx && y === ty) {
      const path = [];
      let cx = x, cy = y;
      while (!(cx === sx && cy === sy)) {
        path.push([cx, cy]);
        const up = came.get(cx + ',' + cy);
        cx = up[0]; cy = up[1];
      }
      path.reverse();
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!walkTile(nx, ny)) continue;
      const ng = gscore.get(x + ',' + y) + 1;
      const nk = nx + ',' + ny;
      if (!gscore.has(nk) || ng < gscore.get(nk)) {
        gscore.set(nk, ng);
        came.set(nk, [x, y]);
        cnt++;
        if (cnt > 5000) return null;
        open.push([ng + Math.abs(tx - nx) + Math.abs(ty - ny), cnt, nx, ny]);
      }
    }
  }
  return null;
}

// ---------------- players ----------------
function makePlayer(name, bot, cls) {
  if (!CLASSES.includes(cls)) cls = pick(CLASSES);
  const p = {
    id: NEXT_ID, name, bot, cls, team: 0,
    color: PALETTE[NEXT_ID % PALETTE.length], send: null,
    x: 0, y: 0, aim: 0, hp: CLASS_INFO[cls].maxhp, maxhp: CLASS_INFO[cls].maxhp,
    alive: false, respawn_at: 0, weapon: 'pistol',
    primary: CLASS_INFO[cls].default,
    mags: (() => { const m = {}; for (const k in WEAPONS) m[k] = WEAPONS[k].mag; return m; })(),
    armor: 0, reload_end: 0, next_fire: 0,
    gren: NADE_MAX, gren_cd: 0, gren_regen: 0,
    prot_until: 0, kills: 0, deaths: 0, streak: 0, score: 0, ping: 0,
    speed_until: 0, power_until: 0, reveal_until: 0, shield_until: 0,
    heal_left: 0.0, skill_ready: 0, skill2_ready: 0, dash_until: 0, dash_dx: 0, dash_dy: 0,
    rapid_until: 0, slow_until: 0, acct: null, scoping: false, aiming: false,
    trail: [], kbx: 0.0, kby: 0.0,
    shu_n: 0, shu_ang: 0.0, shu_fire: 0, shu_next: 0.0, shu_tgt: 0, shu_regen: 0.0,
    inp: { mx: 0, my: 0, aim: 0, f: 0, fp: 0, r: 0, w: 0, g: 0, e: 0, e2: 0, sc: 0, tg: 0 },
    path: null, path_t: 0, target: 0, lock: 0, strafe: Math.random() * 6.28, tap: 0,
    first_hit_t: 0, first_hit_att: 0, first_hit_full: false,
    stuck_n: 0, last_x: undefined, last_y: undefined, trail_box: null,
  };
  NEXT_ID++;
  return p;
}

function uniqueName(name) {
  const taken = new Set([...PLAYERS.values()].map(q => q.name));
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(name + '-' + i)) i++;
  return name + '-' + i;
}
function smallestTeam() {
  let reds = 0, blues = 0;
  for (const q of PLAYERS.values()) { if (q.team === 1) reds++; else if (q.team === 2) blues++; }
  return reds <= blues ? 1 : 2;
}
function applyTeam(p, team) {
  p.team = team;
  p.color = team ? TEAM_COLOR[team] : PALETTE[p.id % PALETTE.length];
}
function assignTeams() {
  const n = [0, 0, 0];
  for (const q of [...PLAYERS.values()].sort((a, b) => a.id - b.id)) {
    if (MODE === 'ffa') applyTeam(q, 0);
    else { const t = n[1] <= n[2] ? 1 : 2; applyTeam(q, t); n[t]++; }
  }
}

function respawn(p, t) {
  const half = Math.floor(MAP_W / 2) * TILE;
  let cand = SPAWNS.filter(s => MODE === 'ffa' || (p.team === 1 && s[0] < half) || (p.team === 2 && s[0] > half));
  if (!cand.length) cand = SPAWNS;
  let best = cand[0], bestd = -1.0;
  for (const [sx, sy] of cand) {
    let mind = 1e9;
    for (const q of PLAYERS.values()) {
      if (q === p || !q.alive || (MODE !== 'ffa' && q.team === p.team)) continue;
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < mind) mind = d;
    }
    if (mind > bestd) { bestd = mind; best = [sx, sy]; }
  }
  const [rx, ry] = depenetrate(best[0], best[1], MOVE_R);
  p.x = rx; p.y = ry;
  p.trail = [];
  p.trail_box = null;
  p.hp = p.maxhp;
  p.alive = true;
  p.prot_until = t + SPAWN_PROTECT;
  p.armor = 0;
  p.speed_until = p.power_until = p.reveal_until = p.shield_until = 0;
  p.rapid_until = p.slow_until = 0;
  p.heal_left = 0;
  p.mags = {}; for (const k in WEAPONS) p.mags[k] = WEAPONS[k].mag;
  p.reload_end = 0;
  p.gren = NADE_MAX;
  p.primary = CLASS_INFO[p.cls].default;
  p.weapon = 'pistol';
  EVENTS.push(['sp', p.id, r1(p.x), r1(p.y)]);
}

function damage(p, dmg, attackerId, cause, crit = false) {
  const t = now();
  if (!p.alive || t < p.prot_until || t < ROUND_OVER_UNTIL) return;
  const att = PLAYERS.get(attackerId);
  if (att && att !== p && MODE !== 'ffa' && att.team === p.team) return;
  if (t < p.shield_until) dmg *= SHIELD_REDUCE;
  if (att && att.bot) dmg *= 0.75;  // bots hit softer than players
  if (p.scoping && SNIPER_WEAPONS.includes(p.weapon)) dmg *= 0.6;  // braced stance
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, dmg * 0.6);
    p.armor -= absorbed;
    dmg -= absorbed;
  }
  // achievement tracking: burst window (first hit on a full-health target)
  if (att && att !== p) {
    if (!p.first_hit_t || t - p.first_hit_t > 0.5 || p.first_hit_att !== attackerId) {
      p.first_hit_t = t;
      p.first_hit_att = attackerId;
      p.first_hit_full = p.hp >= p.maxhp - 0.01;
    }
  }
  p.hp -= dmg;
  EVENTS.push(['ht', p.id, attackerId, r1(p.x), r1(p.y),
               Math.trunc(Math.max(1, Math.round(dmg))), crit ? 1 : 0]);
  if (p.hp <= 0) kill(p, att, cause, t);
}

function spawnDrop(x, y, weapon, t, owner = 0) {
  // nudge away from live players; dropper gets a no-pickup window
  for (let i = 0; i < 8; i++) {
    let near = false;
    for (const q of PLAYERS.values()) {
      if (q.alive && (q.x - x) ** 2 + (q.y - y) ** 2 < 40 * 40) { near = true; break; }
    }
    if (!near) break;
    const a = Math.random() * 6.2832;
    const nx = x + Math.cos(a) * 48, ny = y + Math.sin(a) * 48;
    if (!circleHitsWall(nx, ny, 10)) { x = nx; y = ny; }
  }
  DROPS.push({ x, y, weapon, ttl: DROP_TTL, arm: t + 1.5, owner });
  if (DROPS.length > DROP_CAP) DROPS.shift();
}

function kill(p, att, cause, t) {
  p.alive = false;
  p.deaths++;
  p.streak = 0;
  p.respawn_at = t + RESPAWN_TIME;
  if (att && att !== p) {
    att.kills++;
    att.streak++;
    att.score += 100;
    if (att.acct && ACCOUNTS[att.acct]) {
      ACCOUNTS[att.acct].xp = (ACCOUNTS[att.acct].xp || 0) + 100;
      saveAccounts();
    }
    if (MODE !== 'ffa') TEAM_KILLS[att.team]++;
    // shuriken perk: any kill while wielding the blades refills the orbit
    if (att.weapon === 'shuriken' && att.alive) { att.shu_n = SHURIKEN_MAX; att.shu_fire = 0; }
    // achievements (client shows only its own)
    if (!FIRST_BLOOD_DONE && !att.bot) { FIRST_BLOOD_DONE = true; EVENTS.push(['ach', att.id, 'firstblood']); }
    if (!att.bot && p.first_hit_full && p.first_hit_att === att.id && t - (p.first_hit_t || 0) <= 0.5)
      EVENTS.push(['ach', att.id, 'burst']);
    if (!att.bot && att.streak === 3) EVENTS.push(['ach', att.id, 'spree']);
    if (!att.bot && att.streak === 5) EVENTS.push(['ach', att.id, 'rampage']);
    if (!att.bot && att.streak === 8) EVENTS.push(['ach', att.id, 'godlike']);
  }
  if (p.primary) {
    // legendary weapons usually vanish with their fallen owner
    if (WEAPONS[p.primary].legend && Math.random() < 0.75) { /* gone */ }
    else spawnDrop(p.x, p.y, p.primary, t, p.id);
  }
  EVENTS.push(['kl', att ? att.id : 0, p.id, cause]);
}

function startReload(p, t) {
  const w = WEAPONS[p.weapon];
  if (p.mags[p.weapon] < w.mag && p.reload_end <= t) {
    const dur = w.reload * (p.cls === 'assault' ? 0.8 : 1.0);
    p.reload_end = t + dur;
  }
}

function hitCrate(x, y, dmg) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H && GRID[ty][tx] === 2) {
    const key = tx + ',' + ty;
    const left = (CRATE_HP.get(key) || 0) - dmg;
    if (left <= 0) {
      CRATE_HP.delete(key);
      GRID[ty][tx] = 0;
      EVENTS.push(['cr', tx, ty]);
    } else CRATE_HP.set(key, left);
  }
}

function blastSweepShuriken(x, y, radius) {
  // blades in radius die (no chain reaction); each soaks part of the blast
  const soak = {};
  for (const r of BULLETS) {
    if (r.weapon !== 'shuriken' || r.dead) continue;
    if (Math.hypot(r.x - x, r.y - y) < radius) {
      r.dead = true;
      soak[r.owner] = Math.min(SHURIKEN_SOAK_MAX, (soak[r.owner] || 0) + SHURIKEN_SOAK);
      EVENTS.push(['wx', r1(r.x), r1(r.y)]);
    }
  }
  return soak;
}

function rocketExplode(x, y, dmg, ownerId) {
  EVENTS.push(['ex', r1(x), r1(y)]);
  const crit = Math.random() < CRIT_CHANCE;  // one crit roll per blast
  const soak = blastSweepShuriken(x, y, ROCKET_RADIUS);
  for (const q of [...PLAYERS.values()]) {
    if (!q.alive) continue;
    const d = Math.hypot(q.x - x, q.y - y);
    if (d < ROCKET_RADIUS && hasLos(x, y, q.x, q.y)) {
      const dd = (d < 40 ? dmg : Math.max(12.0, dmg * (1 - (d - 40) / (ROCKET_RADIUS - 40))))
                 * (1.0 - (soak[q.id] || 0));
      damage(q, crit ? Math.trunc(dd * CRIT_MULT) : Math.trunc(dd), ownerId, 'quad', crit);
      // radial knockback impulse, full strength up close
      if (d > 0.001) {
        const strength = ROCKET_KNOCKBACK * (1 - d / ROCKET_RADIUS) + 90;
        q.kbx += (q.x - x) / d * strength;
        q.kby += (q.y - y) / d * strength;
      }
    }
  }
  const t0x = Math.floor((x - ROCKET_RADIUS) / TILE), t1x = Math.floor((x + ROCKET_RADIUS) / TILE);
  const t0y = Math.floor((y - ROCKET_RADIUS) / TILE), t1y = Math.floor((y + ROCKET_RADIUS) / TILE);
  for (let ty = Math.max(0, t0y); ty <= Math.min(MAP_H - 1, t1y); ty++)
    for (let tx = Math.max(0, t0x); tx <= Math.min(MAP_W - 1, t1x); tx++)
      if (GRID[ty][tx] === 2) {
        const cx = tx * TILE + 16, cy = ty * TILE + 16;
        if (Math.hypot(cx - x, cy - y) < ROCKET_RADIUS) {
          CRATE_HP.delete(tx + ',' + ty);
          GRID[ty][tx] = 0;
          EVENTS.push(['cr', tx, ty]);
        }
      }
}

function shurikenFire(p, t) {
  if (p.shu_n <= 0 || p.shu_fire > 0) return;
  if (t < p.next_fire) return;
  p.next_fire = t + WEAPONS.shuriken.rof;
  let best = null, bestHp = 1e9;
  for (const q of PLAYERS.values()) {
    if (q === p || !q.alive) continue;
    if (MODE !== 'ffa' && q.team === p.team) continue;
    if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 > SHURIKEN_RANGE ** 2) continue;
    if (!hasLos(p.x, p.y, q.x, q.y)) continue;
    if (q.hp < bestHp) { best = q; bestHp = q.hp; }
  }
  p.shu_tgt = best ? best.id : 0;
  p.shu_fire = p.shu_n;
  p.shu_next = t;   // first blade leaves immediately
}

function launchShuriken(p, t) {
  const n = p.shu_n;
  const i = p.shu_fire - 1;
  p.shu_n--;
  p.shu_fire--;
  p.shu_next = t + SHURIKEN_GAP;
  p.prot_until = 0;
  let tgt = p.shu_tgt || 0;
  const tq = PLAYERS.get(tgt);
  if (!tq || !tq.alive) tgt = 0;
  const a0 = p.shu_ang + (6.28318 / Math.max(1, n)) * i;
  let sx = p.x + Math.cos(a0) * SHURIKEN_ORBIT_R;
  let sy = p.y + Math.sin(a0) * SHURIKEN_ORBIT_R;
  if (circleHitsWall(sx, sy, 6)) { sx = p.x; sy = p.y; }
  const ad = tgt ? Math.atan2(tq.y - sy, tq.x - sx) : p.aim;
  const w = WEAPONS.shuriken;
  const dmg = w.dmg * (t < p.power_until ? POWER_MULT : 1.0);
  BULLETS.push({
    id: NEXT_BULLET, x: sx, y: sy, ang: ad,
    dx: Math.cos(ad), dy: Math.sin(ad), target: tgt,
    speed: w.speed, dmg, owner: p.id, weapon: 'shuriken',
    ttl: w.rrange / w.speed,
  });
  NEXT_BULLET++;
  if (BULLETS.length > BULLET_CAP) BULLETS.shift();
  EVENTS.push(['sh', p.id, r1(p.x), r1(p.y), r2(ad), 'shuriken']);
}

function tryFire(p, t) {
  const w = WEAPONS[p.weapon];
  if (t < p.next_fire || p.reload_end > t) return;
  if (p.mags[p.weapon] <= 0) { startReload(p, t); return; }
  p.next_fire = t + w.rof * (t < p.rapid_until ? 0.5 : 1.0);
  p.mags[p.weapon]--;
  p.prot_until = 0;
  const dmg = w.dmg * (t < p.power_until ? POWER_MULT : 1.0);
  let sp = w.spread;
  if (p.aiming) sp *= 0.45;  // aim stance: much tighter accuracy
  for (let i = 0; i < w.pellets; i++) {
    const a = p.aim + (Math.random() * 2 - 1) * sp;
    // quad rocket: carry the client-locked target (validated) for homing
    let tgt = 0;
    if (w.rocket) {
      const tq = PLAYERS.get(p.inp.tg || 0);
      if (tq && tq.alive && tq.id !== p.id) tgt = tq.id;
    }
    BULLETS.push({
      id: NEXT_BULLET, x: p.x + Math.cos(a) * 2, y: p.y + Math.sin(a) * 2, ang: a,
      dx: Math.cos(a), dy: Math.sin(a), target: tgt,
      speed: w.speed, dmg, owner: p.id, weapon: p.weapon,
      ttl: w.rrange / w.speed,
    });
    NEXT_BULLET++;
  }
  if (BULLETS.length > BULLET_CAP) BULLETS.shift();
  EVENTS.push(['sh', p.id, r1(p.x), r1(p.y), r2(p.aim), p.weapon]);
}

function throwNade(p, t) {
  if (p.gren <= 0 || t < p.gren_cd) return;
  p.gren--;
  p.gren_cd = t + NADE_CD;
  p.prot_until = 0;
  const a = p.aim;
  GRENADES.push({
    x: p.x + Math.cos(a) * 20, y: p.y + Math.sin(a) * 20,
    vx: Math.cos(a) * NADE_SPEED, vy: Math.sin(a) * NADE_SPEED,
    fuse: NADE_FUSE, owner: p.id,
  });
}

function useSkill(p, t) {
  if (!p.alive || t < p.skill_ready) return;
  const info = CLASS_INFO[p.cls];
  p.skill_ready = t + info.cd;
  EVENTS.push(['sk', p.id, p.cls]);
  const sk = info.skill;
  if (sk === 'dash') {
    const mx = p.inp.mx, my = p.inp.my;
    if (mx || my) { p.dash_dx = mx; p.dash_dy = my; }
    else { p.dash_dx = Math.cos(p.aim); p.dash_dy = Math.sin(p.aim); }
    p.dash_until = t + DASH_TIME;
  } else if (sk === 'heal') {
    p.heal_left = HEAL_TOTAL;
    if (MODE !== 'ffa') {
      for (const q of PLAYERS.values()) {
        if (q !== p && q.alive && q.team === p.team &&
            Math.hypot(q.x - p.x, q.y - p.y) < 160)
          q.hp = Math.min(q.maxhp, q.hp + HEAL_TEAMMATE);
      }
    }
  } else if (sk === 'reveal') {
    p.reveal_until = t + REVEAL_TIME;
  } else if (sk === 'shield') {
    p.shield_until = t + SHIELD_TIME;
  }
}

function useSkill2(p, t) {
  if (!p.alive || t < p.skill2_ready) return;
  const info = CLASS_INFO[p.cls];
  p.skill2_ready = t + info.cd2;
  EVENTS.push(['sk2', p.id, p.cls]);
  const sk = info.skill2;
  if (sk === 'barrage') {
    p.mags[p.weapon] = WEAPONS[p.weapon].mag;
    p.rapid_until = t + 3.0;
  } else if (sk === 'guard') {
    p.hp = Math.min(p.maxhp, p.hp + 25);
    p.armor = Math.min(100, p.armor + 25);
  } else if (sk === 'blink') {
    const a = p.aim;
    for (let i = 25; i >= 1; i--) {
      const nx = p.x + Math.cos(a) * 8 * i;
      const ny = p.y + Math.sin(a) * 8 * i;
      if (!circleHitsWall(nx, ny, MOVE_R)) {
        if (i >= 3) EVENTS.push(['bl', p.id, r1(p.x), r1(p.y), r1(nx), r1(ny)]);
        p.x = nx; p.y = ny;
        break;
      }
    }
  } else if (sk === 'slam') {
    for (const q of PLAYERS.values()) {
      if (q === p || !q.alive) continue;
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < 160 && hasLos(p.x, p.y, q.x, q.y)) {
        damage(q, 35, p.id, 'slam');
        q.slow_until = t + 2.0;
      }
    }
  }
}

function explode(g) {
  EVENTS.push(['ex', r1(g.x), r1(g.y)]);
  const soak = blastSweepShuriken(g.x, g.y, NADE_RADIUS);
  for (const q of [...PLAYERS.values()]) {
    if (!q.alive) continue;
    const d = Math.hypot(q.x - g.x, q.y - g.y);
    if (d < NADE_RADIUS && hasLos(g.x, g.y, q.x, q.y)) {
      let dmg = NADE_DMG;
      if (d >= 50) dmg = Math.max(10.0, NADE_DMG * (1 - (d - 50) / (NADE_RADIUS - 50)));
      dmg *= 1.0 - (soak[q.id] || 0);
      damage(q, Math.trunc(dmg), g.owner, 'grenade');
    }
  }
  const t0x = Math.floor((g.x - NADE_RADIUS) / TILE), t1x = Math.floor((g.x + NADE_RADIUS) / TILE);
  const t0y = Math.floor((g.y - NADE_RADIUS) / TILE), t1y = Math.floor((g.y + NADE_RADIUS) / TILE);
  for (let ty = Math.max(0, t0y); ty <= Math.min(MAP_H - 1, t1y); ty++)
    for (let tx = Math.max(0, t0x); tx <= Math.min(MAP_W - 1, t1x); tx++)
      if (GRID[ty][tx] === 2) {
        const cx = tx * TILE + 16, cy = ty * TILE + 16;
        if (Math.hypot(cx - g.x, cy - g.y) < NADE_RADIUS) {
          CRATE_HP.delete(tx + ',' + ty);
          GRID[ty][tx] = 0;
          EVENTS.push(['cr', tx, ty]);
        }
      }
}

function applyPickup(p, kind, t) {
  if (kind === 'med') {
    const heal = p.cls === 'medic' ? MED_HEAL_MEDIC : MED_HEAL;
    if (p.hp >= p.maxhp) return false;
    p.hp = Math.min(p.maxhp, p.hp + heal);
  } else if (kind === 'armor') {
    if (p.armor >= 100) return false;
    p.armor = Math.min(100, p.armor + ARMOR_AMOUNT);
  } else if (kind === 'speed') {
    p.speed_until = Math.max(t, p.speed_until) + BUFF_TIME;
  } else if (kind === 'power') {
    p.power_until = Math.max(t, p.power_until) + BUFF_TIME;
  } else if (kind === 'ammo') {
    for (const k in WEAPONS) p.mags[k] = WEAPONS[k].mag;
    p.gren = Math.min(NADE_MAX, p.gren + 2);
  } else if (kind === 'nade') {
    if (p.gren >= NADE_PICKUP_CAP) return false;
    p.gren = Math.min(NADE_PICKUP_CAP, p.gren + 2);
  }
  return true;
}

function updatePlayer(p, dt, t) {
  const inp = p.inp;
  if (inp.e) { useSkill(p, t); inp.e = 0; }
  if (inp.e2) { useSkill2(p, t); inp.e2 = 0; }
  if (inp.w) {
    const key = inp.w === 1 ? 'pistol' : p.primary;
    if (key && key !== p.weapon) {
      p.weapon = key;
      p.reload_end = 0;
      p.next_fire = t + 0.15;
    }
    inp.w = 0;
  }
  if (inp.r) { if (p.alive) startReload(p, t); inp.r = 0; }
  if (inp.g) { if (p.alive) throwNade(p, t); inp.g = 0; }

  if (p.reload_end && t >= p.reload_end) {
    p.reload_end = 0;
    p.mags[p.weapon] = WEAPONS[p.weapon].mag;
  }

  if (!p.alive) return;

  p.aim = inp.aim;

  // aim stance (right-click) works for any weapon; full scope only for sniper
  const aiming = !!inp.sc && p.alive;
  p.aiming = aiming;
  p.scoping = aiming && SNIPER_WEAPONS.includes(p.weapon);

  // movement with passive/buff/dash multipliers
  let sp = BASE_SPEED;
  if (p.cls === 'scout') sp *= SCOUT_SPEED;
  if (t < p.speed_until) sp *= SPEED_MULT;
  if (t < p.slow_until) sp *= 0.55;
  const dashing = t < p.dash_until;
  let dx, dy;
  if (dashing) {
    sp *= DASH_MULT;
    dx = p.dash_dx; dy = p.dash_dy;
  } else {
    if (p.aiming) sp *= 0.6;  // aim stance: braced walk
    dx = inp.mx; dy = inp.my;
  }
  if (p.scoping && !dashing) dx = dy = 0;  // sniper scope: planted in place
  if (dx || dy) {
    // wall-slide: re-normalize against blocked axes
    const l = Math.hypot(dx, dy) || 1.0;
    let ux = dx / l, uy = dy / l;
    if (ux && circleHitsWall(p.x + ux * sp * dt, p.y, MOVE_R)) ux = 0;
    if (uy && circleHitsWall(p.x, p.y + uy * sp * dt, MOVE_R)) uy = 0;
    if (ux || uy) {
      const l2 = Math.hypot(ux, uy);
      const [nx, ny] = moveWithSlide(p.x, p.y, ux / l2 * sp * dt, uy / l2 * sp * dt, MOVE_R);
      p.x = nx; p.y = ny;
    }
  }

  // rocket knockback: decaying extra velocity through the collision system
  const kbm = Math.hypot(p.kbx, p.kby);
  if (kbm > 4.0) {
    const [nx, ny] = moveWithSlide(p.x, p.y, p.kbx * dt, p.kby * dt, MOVE_R);
    p.x = nx; p.y = ny;
    const decay = Math.exp(-5.5 * dt);
    p.kbx *= decay; p.kby *= decay;
  } else if (kbm > 0.0) { p.kbx = 0.0; p.kby = 0.0; }

  // safety net: push out of walls
  if (circleHitsWall(p.x, p.y, MOVE_R)) {
    const [nx, ny] = depenetrate(p.x, p.y, MOVE_R);
    p.x = nx; p.y = ny;
  }

  // stuck rescue: pressing movement but not moving for ~22 ticks
  if (p.alive && (inp.mx || inp.my) && !p.scoping) {
    const ddx = p.x - (p.last_x === undefined ? p.x : p.last_x);
    const ddy = p.y - (p.last_y === undefined ? p.y : p.last_y);
    if (ddx * ddx + ddy * ddy < 0.01) p.stuck_n++;
    else p.stuck_n = 0;
    p.last_x = p.x; p.last_y = p.y;
    if (p.stuck_n >= 22) {
      p.stuck_n = 0;
      const tx0 = Math.floor(p.x / TILE), ty0 = Math.floor(p.y / TILE);
      let best = null;
      outer:
      for (let rr = 1; rr < 9; rr++) {
        for (let ddy2 = -rr; ddy2 <= rr; ddy2++) {
          for (let ddx2 = -rr; ddx2 <= rr; ddx2++) {
            const tx2 = tx0 + ddx2, ty2 = ty0 + ddy2;
            if (walkTile(tx2, ty2) && !circleHitsWall(tx2 * TILE + TILE / 2, ty2 * TILE + TILE / 2, MOVE_R)) {
              best = [tx2 * TILE + TILE / 2, ty2 * TILE + TILE / 2];
              break outer;
            }
          }
        }
      }
      if (best) {
        p.x = best[0]; p.y = best[1];
        p.trail = [];
        EVENTS.push(['sp', p.id, r1(p.x), r1(p.y)]);
      }
    }
  } else p.stuck_n = 0;

  // position trail for bullet hit-reg (~200ms window)
  p.trail.push([p.x, p.y]);
  if (p.trail.length > 6) p.trail.splice(0, p.trail.length - 6);
  let xs = 1e9, ys = 1e9, xb = -1e9, yb = -1e9;
  for (const tp of p.trail) {
    if (tp[0] < xs) xs = tp[0]; if (tp[0] > xb) xb = tp[0];
    if (tp[1] < ys) ys = tp[1]; if (tp[1] > yb) yb = tp[1];
  }
  p.trail_box = [xs - 22, ys - 22, xb + 22, yb + 22];

  // firing (tap edge fires at least one round for any weapon)
  const w = WEAPONS[p.weapon];
  if (inp.fp) {
    if (p.weapon === 'shuriken') shurikenFire(p, t);
    else tryFire(p, t);
  }
  if (w.auto && inp.f) tryFire(p, t);
  inp.fp = 0;

  // shuriken: orbit spin + blade regen + sequential volley launch
  if (p.weapon === 'shuriken') {
    p.shu_ang = (p.shu_ang + SHURIKEN_SPIN * dt) % 6.28318;
    if (p.shu_n < SHURIKEN_MAX && t >= p.shu_regen) {
      p.shu_n++;
      p.shu_regen = t + SHURIKEN_REGEN;
    }
    if (p.shu_fire > 0 && t >= p.shu_next && p.shu_n > 0) launchShuriken(p, t);
  }

  // medic regen
  if (p.heal_left > 0) {
    const r = Math.min(p.heal_left, HEAL_REGEN * dt);
    p.hp = Math.min(p.maxhp, p.hp + r);
    p.heal_left -= r;
  }

  // grenade regen
  if (p.gren < NADE_MAX) {
    p.gren_regen += dt;
    if (p.gren_regen >= NADE_REGEN) { p.gren_regen = 0; p.gren++; }
  }

  // pickups & weapon spawns
  for (const m of PICKUPS) {
    if (m.timer <= 0) {
      const d2 = (p.x - m.x) ** 2 + (p.y - m.y) ** 2;
      if (d2 < 24 * 24 && applyPickup(p, m.kind, t)) {
        m.timer = PICKUP_RESPAWN[m.kind];
        EVENTS.push(['pk', p.id, r1(m.x), r1(m.y), m.kind]);
      }
    }
  }
  for (const s of WSPAWNS) {
    if (s.timer <= 0) {
      const d2 = (p.x - s.x) ** 2 + (p.y - s.y) ** 2;
      if (d2 < 24 * 24) {
        if (p.primary === s.weapon) {
          p.mags[s.weapon] = WEAPONS[s.weapon].mag;
        } else {
          spawnDrop(p.x, p.y, p.primary, t, p.id);
          p.primary = s.weapon;
          p.mags[s.weapon] = WEAPONS[s.weapon].mag;
          p.weapon = s.weapon;
          p.reload_end = 0;
        }
        s.timer = WSPAWN_TIME;
        EVENTS.push(['pk', p.id, r1(s.x), r1(s.y), 'wpn:' + s.weapon]);
      }
    }
  }
  for (const d of [...DROPS]) {
    if (t < (d.arm || 0) && d.owner === p.id) continue;
    if ((p.x - d.x) ** 2 + (p.y - d.y) ** 2 < 24 * 24) {
      if (p.primary !== d.weapon) {
        DROPS.splice(DROPS.indexOf(d), 1);
        spawnDrop(p.x, p.y, p.primary, t, p.id);
        p.primary = d.weapon;
        p.mags[d.weapon] = WEAPONS[d.weapon].mag;
        p.weapon = d.weapon;
        p.reload_end = 0;
        EVENTS.push(['pk', p.id, r1(d.x), r1(d.y), 'wpn:' + d.weapon]);
        break;
      }
    }
  }
}

function segDist2(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  if (l2 <= 0.0) return (px - x0) ** 2 + (py - y0) ** 2;
  let t = ((px - x0) * dx + (py - y0) * dy) / l2;
  if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
  const cx = x0 + dx * t, cy = y0 + dy * t;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function updateBullets(dt, t) {
  const playersAll = [];
  for (const q of PLAYERS.values())
    if (q.alive && q.id !== -1 && t >= q.prot_until) playersAll.push(q);
  const keep = [];
  for (const b of BULLETS) {
    let dead = false;
    // homing: steer toward the locked target at a limited turn rate
    if (b.target) {
      const tq = PLAYERS.get(b.target);
      if (tq && tq.alive) {
        const desired = Math.atan2(tq.y - b.y, tq.x - b.x);
        let d = (desired - b.ang + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        const turnRate = b.weapon === 'quad' ? ROCKET_TURN : SHURIKEN_TURN;
        const turn = turnRate * dt;
        if (d > turn) d = turn; else if (d < -turn) d = -turn;
        b.ang += d;
        b.dx = Math.cos(b.ang);
        b.dy = Math.sin(b.ang);
      }
    }
    const sx = b.x, sy = b.y;
    const steps = Math.max(1, Math.floor(b.speed * dt / 6));
    const step = b.speed * dt / steps;
    const bdx = b.dx, bdy = b.dy;
    let hitCratePos = null;
    for (let i = 0; i < steps; i++) {
      b.x += bdx * step;
      b.y += bdy * step;
      if (solidAt(b.x, b.y)) {          // walls AND crates stop bullets
        if (!solidWallAt(b.x, b.y)) hitCratePos = [b.x, b.y];
        dead = true;
        break;
      }
    }
    // precise sweep vs current position AND recent trail
    const ex = b.x, ey = b.y;
    const minx = Math.min(sx, ex) - 20, maxx = Math.max(sx, ex) + 20;
    const miny = Math.min(sy, ey) - 20, maxy = Math.max(sy, ey) + 20;
    const hr2 = (PLAYER_R + 3) ** 2;
    const isRocket = b.weapon === 'quad';
    for (const q of playersAll) {
      if (q.id === b.owner) continue;
      const tb = q.trail_box;
      if (tb && (tb[2] < minx || tb[0] > maxx || tb[3] < miny || tb[1] > maxy)) continue;
      if (segDist2(q.x, q.y, sx, sy, ex, ey) < hr2) {
        if (!isRocket) {
          const crit = Math.random() < CRIT_CHANCE;
          damage(q, crit ? Math.trunc(b.dmg * CRIT_MULT) : b.dmg, b.owner, b.weapon, crit);
        }
        dead = true;
        break;
      }
      let hit = false;
      for (const [tx, ty] of q.trail) {
        if (segDist2(tx, ty, sx, sy, ex, ey) < hr2) { hit = true; break; }
      }
      if (hit) {
        if (!isRocket) {
          const crit = Math.random() < CRIT_CHANCE;
          damage(q, crit ? Math.trunc(b.dmg * CRIT_MULT) : b.dmg, b.owner, b.weapon, crit);
        }
        dead = true;
        break;
      }
    }
    // bullets detonate rockets they pass through
    if (!dead && !isRocket) {
      for (const r of BULLETS) {
        if (r === b || r.weapon !== 'quad' || r.dead) continue;
        if (segDist2(r.x, r.y, sx, sy, ex, ey) < (PLAYER_R * 0.7) ** 2) {
          dead = true;
          r.dead = true;
          rocketExplode(r.x, r.y, r.dmg, r.owner);
          break;
        }
      }
    }
    // blades and bullets destroy each other; orbiting blades are a shield
    if (!dead && b.weapon !== 'shuriken') {
      for (const r of BULLETS) {
        if (r === b || r.weapon !== 'shuriken' || r.dead) continue;
        if (segDist2(r.x, r.y, sx, sy, ex, ey) < 13 ** 2) {
          dead = true;
          r.dead = true;
          EVENTS.push(['wx', r1(b.x), r1(b.y)]);
          break;
        }
      }
      if (!dead) {
        const bo = PLAYERS.get(b.owner);
        for (const q of PLAYERS.values()) {
          if (!q.alive || q.weapon !== 'shuriken' || q.shu_n <= 0 || q.id === b.owner) continue;
          if (bo && MODE !== 'ffa' && bo.team === q.team) continue;
          const n = q.shu_n;
          for (let i = 0; i < n; i++) {
            const aa = q.shu_ang + 6.28318 / n * i;
            const bxq = q.x + Math.cos(aa) * SHURIKEN_ORBIT_R;
            const byq = q.y + Math.sin(aa) * SHURIKEN_ORBIT_R;
            if ((b.x - bxq) ** 2 + (b.y - byq) ** 2 < 14 ** 2) {
              dead = true;
              EVENTS.push(['wx', r1(b.x), r1(b.y)]);
              break;
            }
          }
          if (dead) break;
        }
      }
    }
    if (dead) {
      b.dead = true;
      if (isRocket) rocketExplode(b.x, b.y, b.dmg, b.owner);
      else if (hitCratePos) {
        hitCrate(b.x, b.y, b.dmg);
        EVENTS.push(['wx', r1(b.x), r1(b.y)]);
      }
      else if (solidWallAt(b.x, b.y)) EVENTS.push(['wx', r1(b.x), r1(b.y)]);
    }
    b.ttl -= dt;
    if (!dead && !b.dead && b.ttl > 0) keep.push(b);
  }
  BULLETS = keep.filter(b => !b.dead);
}

function updateNades(dt) {
  const keep = [];
  for (const g of GRENADES) {
    g.fuse -= dt;
    const nx = g.x + g.vx * dt;
    if (circleHitsWall(nx, g.y, 6)) g.vx = -g.vx * 0.55;
    else g.x = nx;
    const ny = g.y + g.vy * dt;
    if (circleHitsWall(g.x, ny, 6)) g.vy = -g.vy * 0.55;
    else g.y = ny;
    g.vx *= (1 - 2.2 * dt);
    g.vy *= (1 - 2.2 * dt);
    if (g.fuse <= 0) explode(g);
    else keep.push(g);
  }
  GRENADES = keep;
}

// ---------------- bots ----------------
const BOT_NAMES = ['Rambo', 'NoScope', 'Camper', 'Sprayer', 'Rusher', 'Ghost', 'Viper', 'Blaze',
                   'Frost', 'Hawk', 'Reaper', 'Storm', 'Wolf', 'Falcon', 'Vex', 'Onyx'];
const PREF_RANGE = { pistol: 240, smg: 200, shotgun: 110, rifle: 280, sniper: 420 };

function botThink(p, dt, t) {
  const inp = p.inp;
  let best = null, bestD = 1e9;
  for (const q of PLAYERS.values()) {
    if (q === p || !q.alive) continue;
    if (MODE !== 'ffa' && q.team === p.team) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 680 && d < bestD && hasLos(p.x, p.y, q.x, q.y)) { best = q; bestD = d; }
  }
  const engaging = best !== null;
  if (engaging) {
    if (p.target !== best.id) { p.target = best.id; p.lock = 0; }
    p.lock += dt;
    const w = WEAPONS[p.weapon];
    const pref = PREF_RANGE[p.weapon] !== undefined ? PREF_RANGE[p.weapon] : 240;
    const ang = Math.atan2(best.y - p.y, best.x - p.x);
    const strafe = Math.sin(t * 1.7 + p.strafe);
    const to = Math.max(-1.0, Math.min(1.0, (bestD - pref) / 80.0));
    const mx = Math.cos(ang) * to + Math.cos(ang + Math.PI / 2) * strafe * 0.9;
    const my = Math.sin(ang) * to + Math.sin(ang + Math.PI / 2) * strafe * 0.9;
    const l = Math.hypot(mx, my) || 1.0;
    inp.mx = mx / l;
    inp.my = my / l;
    const acc = Math.max(0.13, Math.min(0.5, 0.5 - p.lock * 0.22));
    inp.aim = ang + Math.sin(t * 6.3 + p.strafe * 2) * acc;
    if (w.auto) inp.f = 1;
    else if (t >= p.tap) {
      inp.fp = 1;
      p.tap = t + w.rof + 0.25 + Math.random() * 0.45;
    }
    if (p.gren > 0 && bestD > 110 && bestD < 300 && Math.random() < 0.06 * dt) inp.g = 1;
  } else {
    p.target = 0;
    inp.f = 0;
    p.path_t -= dt;
    if (!p.path || p.path_t <= 0) {
      for (let i = 0; i < 20; i++) {
        let tx, ty;
        if (MODE === 'koth' && Math.random() < 0.55) {
          tx = Math.floor(ZONE.x / TILE) + randRange(-4, 5);
          ty = Math.floor(ZONE.y / TILE) + randRange(-3, 4);
        } else if (MODE === 'tdm' && Math.random() < 0.5) {
          tx = p.team === 1 ? randRange(Math.floor(MAP_W / 2), MAP_W - 1) : randRange(1, Math.floor(MAP_W / 2));
          ty = randRange(1, MAP_H - 1);
        } else {
          tx = randRange(1, MAP_W - 1);
          ty = randRange(1, MAP_H - 1);
        }
        if (walkTile(tx, ty)) {
          const path = astar(Math.floor(p.x / TILE), Math.floor(p.y / TILE), tx, ty);
          if (path) { p.path = path.map(([x, y]) => [x * TILE + 16, y * TILE + 16]); break; }
        }
      }
      p.path_t = 3 + Math.random() * 3;
    }
    while (p.path && p.path.length > 1 && hasLos(p.x, p.y, p.path[1][0], p.path[1][1])) p.path.shift();
    if (p.path && p.path.length) {
      const n = p.path[0];
      const dx = n[0] - p.x, dy = n[1] - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 14) { p.path.shift(); inp.mx = 0; inp.my = 0; }
      else {
        inp.mx = dx / d;
        inp.my = dy / d;
        inp.aim = Math.atan2(dy, dx);
      }
    } else { inp.mx = 0; inp.my = 0; }
  }
  // bot skill usage
  if (t >= p.skill_ready && Math.random() < 1.5 * dt) {
    const c = p.cls;
    if ((c === 'heavy' && p.hp < 60) ||
        (c === 'medic' && p.hp < 65) ||
        (c === 'assault' && engaging && bestD > 200) ||
        (c === 'scout' && !engaging)) inp.e = 1;
  }
}

function ensureBots() {
  const humans = [], bots = [];
  for (const p of PLAYERS.values()) (p.bot ? bots : humans).push(p);
  const targetTotal = Math.max(6, Math.min(14, humans.length + 2));
  const wantBots = Math.max(0, Math.min(targetTotal - humans.length, MAX_PLAYERS - humans.length));
  while (bots.length < wantBots) {
    const used = new Set([...PLAYERS.values()].map(q => q.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || ('Bot' + bots.length);
    const p = makePlayer(name, true, pick(CLASSES));
    if (MODE !== 'ffa') applyTeam(p, smallestTeam());
    PLAYERS.set(p.id, p);
    bots.push(p);
  }
  while (bots.length > wantBots) {
    let victim = bots[0];
    for (const q of bots) if (q.score < victim.score) victim = q;
    EVENTS.push(['lv', victim.id, victim.name]);
    PLAYERS.delete(victim.id);
    bots.splice(bots.indexOf(victim), 1);
  }
}

// ---------------- modes & rounds ----------------
function setMode(mode) {
  MODE = mode;
  TEAM_KILLS[1] = TEAM_KILLS[2] = 0;
  ZPTS[0] = ZPTS[1] = 0.0;
  ROUND_OVER_UNTIL = 0.0;
  WINNER = '';
  LEGEND_TIMER = 10.0;
  assignTeams();
  BULLETS = [];
  GRENADES = [];
  DROPS = [];
  for (const s of WSPAWNS) s.timer = 0.0;
  for (const m of PICKUPS) m.timer = 0.0;
  for (const q of PLAYERS.values()) {
    q.alive = false;
    q.respawn_at = 0.0;
    q.prot_until = 0.0;
  }
  EVENTS.push(['mo', mode]);
  EVENTS.push(['go']);
}

function checkRound(t) {
  if (t < ROUND_OVER_UNTIL) return;
  if (WINNER) { resetRound(); return; }
  let winner = '';
  if (MODE === 'ffa') {
    let top = null;
    for (const q of PLAYERS.values()) if (!top || q.kills > top.kills) top = q;
    if (top && top.kills >= SCORE_LIMIT.ffa) winner = top.name + ' WINS THE MATCH';
  } else if (MODE === 'tdm') {
    if (TEAM_KILLS[1] >= SCORE_LIMIT.tdm) winner = 'RED TEAM WINS';
    else if (TEAM_KILLS[2] >= SCORE_LIMIT.tdm) winner = 'BLUE TEAM WINS';
  } else if (MODE === 'koth') {
    if (ZPTS[0] >= SCORE_LIMIT.koth) winner = 'RED TEAM WINS';
    else if (ZPTS[1] >= SCORE_LIMIT.koth) winner = 'BLUE TEAM WINS';
  }
  if (winner) {
    ROUND_OVER_UNTIL = t + ROUND_BREAK;
    WINNER = winner;
    EVENTS.push(['end', winner]);
  }
}

function resetRound() {
  TEAM_KILLS[1] = TEAM_KILLS[2] = 0;
  ZPTS[0] = ZPTS[1] = 0.0;
  ROUND_OVER_UNTIL = 0.0;
  WINNER = '';
  FIRST_BLOOD_DONE = false;
  for (const q of PLAYERS.values()) {
    q.alive = false;
    q.respawn_at = 0.0;
    q.prot_until = 0.0;
    q.kills = q.deaths = q.score = q.streak = 0;
  }
  EVENTS.push(['go']);
}

// ---------------- snapshot (mirror of snapshot_for) ----------------
function snapshotFor(p, t) {
  const info = CLASS_INFO[p.cls];
  const w = WEAPONS[p.weapon];
  const reloadLeft = Math.max(0.0, p.reload_end - t);
  const acctXp = (p.acct && ACCOUNTS[p.acct]) ? Math.floor(ACCOUNTS[p.acct].xp || 0) : Math.floor(p.score);
  const lvl = levelForXp(acctXp);
  const you = {
    id: p.id, x: r1(p.x), y: r1(p.y), hp: Math.trunc(Math.max(0, p.hp)),
    maxhp: p.maxhp, alive: p.alive ? 1 : 0,
    weapon: p.weapon, slot: p.weapon === 'pistol' ? 1 : 2,
    primary: p.primary,
    mag: p.weapon === 'shuriken' ? p.shu_n : p.mags[p.weapon],
    magSize: p.weapon === 'shuriken' ? SHURIKEN_MAX : w.mag,
    reloadT: r2(reloadLeft), reloadD: r2(w.reload),
    gren: p.gren, prot: t < p.prot_until ? 1 : 0,
    respawn: !p.alive ? r2(Math.max(0.0, p.respawn_at - t)) : 0,
    score: p.score, kills: p.kills, deaths: p.deaths, streak: p.streak,
    color: p.color, name: p.name, cls: p.cls, team: p.team,
    armor: Math.trunc(p.armor),
    spdT: r1(Math.max(0.0, p.speed_until - t)), pwrT: r1(Math.max(0.0, p.power_until - t)),
    rvlT: r1(Math.max(0.0, p.reveal_until - t)), shdT: r1(Math.max(0.0, p.shield_until - t)),
    skCd: r1(Math.max(0.0, p.skill_ready - t)), skCdMax: info.cd,
    sk2Cd: r1(Math.max(0.0, p.skill2_ready - t)), sk2CdMax: info.cd2,
    rapidT: r1(Math.max(0.0, p.rapid_until - t)), slowT: r1(Math.max(0.0, p.slow_until - t)),
    dashT: r1(Math.max(0.0, p.dash_until - t)), heal: r1(p.heal_left),
    shu: p.weapon === 'shuriken' ? p.shu_n : 0,
    level: lvl, xp: acctXp,
    xpBase: (lvl - 1) * (lvl - 1) * 200,
    xpNext: lvl * lvl * 200,
    aname: (p.acct && ACCOUNTS[p.acct]) ? p.acct : '',
  };
  const ps = [];
  for (const q of PLAYERS.values()) {
    if (q === p) continue;
    ps.push([
      q.id, r1(q.x), r1(q.y), r2(q.aim), Math.trunc(Math.max(0, q.hp)),
      q.weapon === 'pistol' ? 1 : 2, q.alive ? 1 : 0, q.name,
      q.score, q.kills, q.deaths, q.ping, q.color,
      q.bot ? 1 : 0, q.team, CLS_IDX[q.cls],
      t < q.slow_until ? 1 : 0,
      q.weapon === 'shuriken' ? q.shu_n : 0,
    ]);
  }
  const gws = WSPAWNS.filter(s => s.timer <= 0).map(s => [r1(s.x), r1(s.y), s.weapon]);
  for (const d of DROPS) if (d.ttl > 0) gws.push([r1(d.x), r1(d.y), d.weapon]);
  let zowner = 0;
  if (MODE === 'koth') zowner = ZPTS[0] > ZPTS[1] ? 1 : (ZPTS[1] > ZPTS[0] ? 2 : 0);
  return {
    t: 's', tick: TICK_N, you, ps,
    bs: BULLETS.map(b => [b.id, r1(b.x), r1(b.y), r2(b.ang), b.weapon]),
    gs: GRENADES.map(g => [r1(g.x), r1(g.y)]),
    pk: PICKUPS.filter(m => m.timer <= 0).map(m => [r1(m.x), r1(m.y), m.kind]),
    ws: gws,
    mode: MODE, tks: [TEAM_KILLS[1], TEAM_KILLS[2]],
    zpts: [Math.trunc(ZPTS[0]), Math.trunc(ZPTS[1])], zone: zowner,
    ro: r1(Math.max(0.0, ROUND_OVER_UNTIL - t)), win: WINNER,
    ev: EVENTS,
  };
}

// ---------------- main tick ----------------
function gameTick() {
  const t = now();
  TICK_N++;
  const dt = DT;
  ensureBots();
  for (const p of [...PLAYERS.values()]) {
    if (p.bot && p.alive) botThink(p, dt, t);
    updatePlayer(p, dt, t);
    if (!p.alive && t >= p.respawn_at && t >= ROUND_OVER_UNTIL - ROUND_BREAK) respawn(p, t);
  }
  updateBullets(dt, t);
  updateNades(dt);
  for (const m of PICKUPS) if (m.timer > 0) m.timer -= dt;
  for (const s of WSPAWNS) if (s.timer > 0) s.timer -= dt;
  if (DROPS.length) DROPS = DROPS.filter(d => (d.ttl -= dt) > 0);
  // random legendary weapon drops
  LEGEND_TIMER -= dt;
  if (LEGEND_TIMER <= 0) {
    LEGEND_TIMER = LEGEND_INTERVAL;
    let legends = 0;
    for (const d of DROPS) if (WEAPONS[d.weapon].legend) legends++;
    if (legends < LEGEND_MAX) {
      for (let i = 0; i < 30; i++) {
        const ltx = randRange(2, MAP_W - 2), lty = randRange(2, MAP_H - 2);
        if (walkTile(ltx, lty)) {
          spawnDrop(ltx * TILE + 16, lty * TILE + 16, pick(LEGEND_KEYS), t);
          break;
        }
      }
    }
  }
  // koth scoring
  if (MODE === 'koth' && t >= ROUND_OVER_UNTIL) {
    const present = { 1: false, 2: false };
    for (const q of PLAYERS.values()) {
      if (q.alive && (q.team === 1 || q.team === 2) &&
          Math.hypot(q.x - ZONE.x, q.y - ZONE.y) < ZONE.r) present[q.team] = true;
    }
    if (present[1] && !present[2]) ZPTS[0] += ZONE_PTS_RATE * dt;
    else if (present[2] && !present[1]) ZPTS[1] += ZONE_PTS_RATE * dt;
  }
  checkRound(t);
  // send snapshots
  for (const p of [...PLAYERS.values()]) {
    if (p.send) {
      try { p.send(snapshotFor(p, t)); } catch (e) { /* keep ticking */ }
    }
  }
  EVENTS = [];
}

function removePlayer(p) {
  if (PLAYERS.has(p.id)) {
    PLAYERS.delete(p.id);
    if (p.acct) saveAccounts();
    EVENTS.push(['lv', p.id, p.name]);
  }
}

// ---------------- protocol handling (mirror of ws_session) ----------------
function sockHandle(sock, m) {
  const mt = m.t;
  if (mt === 'p') { sock._dispatch({ t: 'p', ts: m.ts }); return; }
  if (mt === 'j') {
    if (sock._player) return;
    if (PLAYERS.size >= MAX_PLAYERS) {
      sock._dispatch({ t: 'err', msg: 'Server is full' });
      sock.close();
      return;
    }
    let raw = String(m.name || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 12);
    if (!raw) raw = 'Player';
    const cls = CLASSES.includes(m.cls) ? m.cls : 'assault';
    const p = makePlayer(uniqueName(raw), false, cls);
    const acct = String(m.acct || '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 12);
    const pw = String(m.pass || '').slice(0, 32);
    if (acct && acct.length >= 2 && pw.length >= 3) {
      if (ACCOUNTS[acct]) {
        if (ACCOUNTS[acct].pw === hashPw(pw)) p.acct = acct;
        else sock._dispatch({ t: 'aerr', msg: 'Wrong password — playing as guest' });
      } else {
        ACCOUNTS[acct] = { pw: hashPw(pw), xp: 0 };
        saveAccounts();
        p.acct = acct;
        EVENTS.push(['aok', p.id, 'Account created: ' + acct]);
      }
    }
    if (p.acct) {
      EVENTS.push(['aok', p.id, 'Logged in as ' + p.acct + ' (LV ' + levelForXp(ACCOUNTS[p.acct].xp) + ')']);
    }
    if (MODE !== 'ffa') applyTeam(p, smallestTeam());
    p.send = o => sock._dispatch(o);
    sock._player = p;
    PLAYERS.set(p.id, p);
    sock._dispatch({
      t: 'w', id: p.id, tile: TILE, rows: ROWS, weapons: WEAPONS,
      classes: CLASS_INFO, zone: ZONE, mode: MODE, limits: SCORE_LIMIT,
      consts: { playerR: PLAYER_R, speed: BASE_SPEED, maxHp: 100,
                nadeSpeed: NADE_SPEED, nadeMax: NADE_MAX },
      color: p.color,
    });
    EVENTS.push(['jn', p.id, p.name]);
    return;
  }
  if (mt === 'i' && sock._player) {
    const p = sock._player, inp = p.inp;
    inp.mx = Math.max(-1.0, Math.min(1.0, Number(m.mx) || 0));
    inp.my = Math.max(-1.0, Math.min(1.0, Number(m.my) || 0));
    const a = Number(m.aim);
    if (isFinite(a)) inp.aim = a;
    inp.f = m.f ? 1 : 0;
    inp.sc = m.sc ? 1 : 0;
    if (m.fp) inp.fp = 1;
    if (m.r) inp.r = 1;
    if (m.g) inp.g = 1;
    if (m.e) inp.e = 1;
    if (m.e2) inp.e2 = 1;
    const tg = parseInt(m.tg, 10) || 0;
    inp.tg = tg > 0 ? tg : 0;
    inp.w = parseInt(m.w, 10) || 0;
    return;
  }
  if (mt === 'mo' && sock._player) {
    const mode = String(m.mode || '');
    if (MODES.includes(mode) && mode !== MODE) setMode(mode);
  }
}

// ---------------- WebSocket-compatible local socket ----------------
class LocalSocket {
  constructor() {
    this.readyState = 0;          // mirrors WebSocket.CONNECTING
    this._local = true;           // client skips the snapshot watchdog for us
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this._player = null;
    this._closed = false;
    this._out = [];
    this._pumpScheduled = false;
    const me = this;
    setTimeout(() => {
      if (me._closed) return;
      me.readyState = 1;
      if (me.onopen) me.onopen();
    }, 0);
  }
  send(str) {
    if (this.readyState !== 1 || this._closed) return;
    let m;
    try { m = JSON.parse(str); } catch (e) { return; }
    sockHandle(this, m);
  }
  close() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3;
    if (this._player) { removePlayer(this._player); this._player = null; }
    const me = this;
    setTimeout(() => { if (me.onclose) me.onclose({}); }, 0);
  }
  _dispatch(obj) {
    if (this._closed) return;
    this._out.push(obj);
    if (this._out.length > 8) this._out.shift();  // slow consumer drops old frames
    if (this._pumpScheduled) return;
    this._pumpScheduled = true;
    const me = this;
    setTimeout(() => {
      me._pumpScheduled = false;
      const q = me._out.splice(0, me._out.length);
      for (const o of q) {
        if (me._closed) return;
        try { if (me.onmessage) me.onmessage({ data: JSON.stringify(o) }); } catch (e) { /* ignore */ }
      }
    }, 0);
  }
}

window.SlayLocal = { createSocket: () => new LocalSocket() };

// ---------------- 30Hz authoritative loop ----------------
setInterval(() => {
  try { gameTick(); } catch (e) { if (window.console) console.error('[sim tick]', e); }
}, 33);

})();
