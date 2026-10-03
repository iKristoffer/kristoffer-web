// Crash junction definitions. Units: metres. heading 0 = facing +z.
// Right-hand traffic: driving along direction u, the lane sits on the right side, right = (-uz, ux).
import { LANE_W as LW } from './textures.js';

const CITY = ['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'suv', 'van', 'taxi', 'sports', 'muscle', 'bus', 'truck'];
const BUSY = ['sedan', 'sedan', 'hatch', 'suv', 'van', 'taxi', 'truck', 'truck', 'bus', 'tanker'];
const HWY = ['sedan', 'sedan', 'suv', 'van', 'sports', 'muscle', 'truck', 'truck', 'truck', 'tanker', 'bus'];

// Lanes for one direction of travel A -> B. o.stop = [x, z, junctionSize] puts a stop line before that junction.
function lanes(ax, az, bx, bz, perDir, o) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, rx = -uz, rz = ux;
  const out = [];
  for (let i = 0; i < perDir; i++) {
    const off = LW * (i + 0.5);
    let stopT = null;
    if (o.stop) { const [jx, jz, js] = o.stop; stopT = (jx - ax) * ux + (jz - az) * uz - js / 2 - 1.5; }
    out.push({
      A: [ax + rx * off, az + rz * off], B: [bx + rx * off, bz + rz * off],
      speed: o.speed * (1 - i * 0.06), interval: o.interval * (1 + i * 0.2), types: o.types,
      group: o.group ?? -1, stopT, pole: i === perDir - 1, perDir, laneIdx: i,
    });
  }
  return out;
}

export const LEVELS = [
  {
    id: 'kryds', name: 'Første Kryds', blurb: 'Klassisk lyskryds i myldretiden. Ram midten!',
    start: [-LW / 2, -330, 0], focus: [0, 0],
    roads: [{ a: [0, -420], b: [0, 260], perDir: 2 }, { a: [-280, 0], b: [280, 0], perDir: 2 }],
    junctions: [{ x: 0, z: 0, size: 2 * 2 * LW + 2 }],
    lanes: [
      ...lanes(-280, 0, 280, 0, 2, { speed: 15, interval: 3.4, types: CITY, group: 1, stop: [0, 0, 16] }),
      ...lanes(280, 0, -280, 0, 2, { speed: 15, interval: 3.6, types: CITY, group: 1, stop: [0, 0, 16] }),
      ...lanes(0, 260, 0, -420, 2, { speed: 14, interval: 4.0, types: CITY, group: 0, stop: [0, 0, 16] }),
      ...lanes(0, -110, 0, 260, 2, { speed: 13, interval: 4.8, types: CITY, group: 0, stop: [0, 0, 16] }),
    ],
    signals: { groups: 2, green: 8, allRed: 3 },
    pickups: [
      { type: 'x2', x: -LW / 2, z: -200 },
      { type: 'cash', amount: 10000, x: LW * 1.5, z: -150 },
      { type: 'heart', x: -LW * 1.5, z: -70 },
      { type: 'x4', x: 0, z: 3, y: 1.8 },
      { type: 'breaker', x: 24, z: -LW * 1.5 },
      { type: 'cash', amount: 25000, x: -28, z: LW * 0.5 },
    ],
    props: [{ type: 'cones', x: 12, z: -12, n: 6 }, { type: 'barrels', x: -12, z: 12, n: 5 }],
    breakerCars: 6,
    medals: [80000, 200000, 450000, 750000],
    city: { extent: 330, seed: 7, density: 0.85 },
    prewarm: 22,
  },
  {
    id: 'spring', name: 'Motorvejsspringet', blurb: 'Hop over autoværnet og land i seks spor motorvej.',
    start: [0, -300, 0], focus: [0, 0],
    roads: [{ a: [0, -330], b: [0, -26], perDir: 1 }, { a: [-420, 0], b: [420, 0], perDir: 3 }],
    junctions: [],
    lanes: [
      ...lanes(-260, 0, 260, 0, 3, { speed: 22, interval: 3.0, types: HWY }),
      ...lanes(260, 0, -260, 0, 3, { speed: 22, interval: 3.2, types: HWY }),
    ],
    ramps: [{ x: 0, z: -44, heading: 0, len: 16, width: 8, angle: 7 }],
    statics: [
      { x: 0, z: 0, w: 840, h: 0.9, d: 0.9, mat: 'concrete' },         // median
      { x: 0, z: 15.5, w: 840, h: 9, d: 3, mat: 'wall' },          // noise wall
      { x: -216, z: -12.4, w: 420, h: 0.8, d: 0.6, mat: 'rail' },       // guard rails with a gap for the jump
      { x: 216, z: -12.4, w: 420, h: 0.8, d: 0.6, mat: 'rail' },
    ],
    pickups: [
      { type: 'cash', amount: 15000, x: 0, z: -34, y: 2.6 },
      { type: 'x2', x: 0, z: -14, y: 6 },
      { type: 'heart', x: 0, z: -150 },
      { type: 'x4', x: 30, z: 8.75 },
      { type: 'breaker', x: -36, z: 5.25 },
      { type: 'cash', amount: 30000, x: 60, z: -8.75 },
    ],
    breakerCars: 8,
    medals: [120000, 400000, 800000, 1200000],
    city: { extent: 380, seed: 3, density: 0.55, clear: [[-30, -120, 30, -14]] },
    prewarm: 16,
  },
  {
    id: 'terminal', name: 'Busterminalen', blurb: 'T-kryds med en hel række holdende busser bagved.',
    start: [-LW / 2, -300, 0], focus: [0, 14],
    roads: [{ a: [0, -330], b: [0, 0], perDir: 2 }, { a: [-260, 0], b: [260, 0], perDir: 2 }],
    junctions: [{ x: 0, z: 0, size: 16 }],
    pads: [{ x: 0, z: 36, w: 90, d: 56 }],
    lanes: [
      ...lanes(-260, 0, 260, 0, 2, { speed: 16, interval: 3.0, types: BUSY }),
      ...lanes(260, 0, -260, 0, 2, { speed: 16, interval: 3.2, types: BUSY }),
    ],
    parked: [
      { type: 'bus', x: -18, z: 30, h: Math.PI }, { type: 'bus', x: -9, z: 30, h: Math.PI },
      { type: 'bus', x: 0, z: 30, h: Math.PI }, { type: 'bus', x: 9, z: 30, h: Math.PI },
      { type: 'bus', x: 18, z: 30, h: Math.PI }, { type: 'tanker', x: 0, z: 52, h: Math.PI / 2 },
      { type: 'sedan', x: -30, z: 50, h: 0 }, { type: 'van', x: -26, z: 50, h: 0 }, { type: 'taxi', x: 28, z: 18, h: 0 },
      { type: 'sedan', x: -LW * 1.5, z: -14, h: 0 }, { type: 'hatch', x: -LW * 1.5, z: -21, h: 0 }, { type: 'suv', x: -LW * 1.5, z: -28, h: 0 },
    ],
    pickups: [
      { type: 'x2', x: -LW / 2, z: -180 },
      { type: 'cash', amount: 15000, x: LW / 2, z: -110 },
      { type: 'heart', x: -LW / 2, z: -60 },
      { type: 'breaker', x: 0, z: 20, y: 1.6 },
      { type: 'x4', x: -30, z: LW * 0.5 },
      { type: 'cash', amount: 25000, x: 0, z: 62 },
    ],
    props: [{ type: 'barrels', x: 22, z: 44, n: 6 }, { type: 'cones', x: -22, z: 14, n: 6 }],
    breakerCars: 7,
    medals: [100000, 300000, 700000, 1100000],
    city: { extent: 330, seed: 11, density: 0.8, clear: [[-50, 6, 50, 70]] },
    prewarm: 14,
  },
  {
    id: 'stor', name: 'Storkrydset', blurb: 'Seks spor hver vej, lastbiler og tankvogne. Fuld knald på.',
    start: [-LW / 2, -360, 0], focus: [0, 0],
    roads: [{ a: [0, -440], b: [0, 280], perDir: 3 }, { a: [-300, 0], b: [300, 0], perDir: 3 }],
    junctions: [{ x: 0, z: 0, size: 3 * 2 * LW + 2 }],
    lanes: [
      ...lanes(-300, 0, 300, 0, 3, { speed: 16, interval: 3.4, types: BUSY, group: 1, stop: [0, 0, 23] }),
      ...lanes(300, 0, -300, 0, 3, { speed: 16, interval: 3.6, types: BUSY, group: 1, stop: [0, 0, 23] }),
      ...lanes(0, 280, 0, -440, 3, { speed: 15, interval: 4.2, types: BUSY, group: 0, stop: [0, 0, 23] }),
      ...lanes(0, -120, 0, 280, 3, { speed: 14, interval: 5.0, types: BUSY, group: 0, stop: [0, 0, 23] }),
    ],
    signals: { groups: 2, green: 9, allRed: 3 },
    pickups: [
      { type: 'x2', x: -LW * 2.5, z: -240 },
      { type: 'cash', amount: 20000, x: -LW / 2, z: -170 },
      { type: 'heart', x: -LW * 1.5, z: -90 },
      { type: 'x4', x: 6, z: -6, y: 1.8 },
      { type: 'breaker', x: -8, z: 8 },
      { type: 'x2', x: 34, z: -LW * 1.5 },
      { type: 'cash', amount: 40000, x: -34, z: LW * 2.5 },
    ],
    props: [{ type: 'cones', x: 17, z: -17, n: 6 }, { type: 'barrels', x: -17, z: 17, n: 6 }, { type: 'barrels', x: 17, z: 17, n: 4 }],
    breakerCars: 10,
    medals: [60000, 180000, 450000, 750000],
    city: { extent: 360, seed: 21, density: 0.9 },
    prewarm: 22,
  },
];

// Testkørsel: empty circuit, no traffic. Start pose and focus are filled in by track.js.
export const TEST_TRACK = {
  id: 'test', name: 'Testbanen', mode: 'test', blurb: 'Tom bane uden trafik.',
  roads: [], junctions: [], lanes: [], prewarm: 0, focus: [0, 0],
  track: {
    startAt: [0, -40],
    points: [[0, -150], [0, 120], [20, 190], [80, 215], [150, 200], [185, 140], [160, 80], [110, 55],
      [100, 0], [150, -50], [230, -60], [260, -130], [220, -210], [130, -240], [40, -225]],
  },
};
