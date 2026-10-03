// Game title — the one place to rename the game.
export const GAME_TITLE = 'BULEBIL';
export const GAME_SUBTITLE = 'CRASH MODE';

// Collision groups
export const G = { STATIC: 1, CAR: 2, DEBRIS: 4, PROP: 8, ALL: 15 };

export const GRAVITY = -14; // heavier than real for arcade weight

export const PLAYER_CARS = [
  { id: 'gt', name: 'Rød Raket', model: 'sports', color: 0xff5a00, mass: 1350, maxSpeed: 60, boostSpeed: 75, accel: 24,
    desc: 'Let og lynhurtig. Flyver langt.' },
  { id: 'muscle', name: 'Blå Bøffel', model: 'muscle', color: 0x1d4ed8, mass: 1800, maxSpeed: 57, boostSpeed: 71, accel: 21,
    desc: 'Tung front – skubber biler væk.' },
  { id: 'tank', name: 'Brumbassen', model: 'suv', color: 0x2f9e44, mass: 2600, maxSpeed: 51, boostSpeed: 64, accel: 18,
    desc: 'Langsom kampvogn. Kløver alt.' },
];

export const TRAFFIC_COLORS = [
  0xb8bcc4, 0x23262d, 0xf2f2f0, 0x8a1c1c, 0x1c3f8a, 0x2c5e3f, 0x6b6f76, 0xc9a227, 0x5a2d82, 0x9aa7b5, 0x3a2a1a, 0xd4572a,
];

export const MEDALS = [
  { key: 'bronze', name: 'Bronze', color: '#cd7f32' },
  { key: 'silver', name: 'Sølv', color: '#d9dde3' },
  { key: 'gold', name: 'Guld', color: '#ffd23f' },
  { key: 'plat', name: 'Platin', color: '#9ff3ff' },
];

// Driving model tuning (used by player.js). Adjustable live in Testkørsel (T), saved in localStorage.
export const DRIVE_DEFAULTS = {
  grip: 30, hbGrip: 7, steerIn: 3, steerOut: 6, maxAngle: 0.6, angleFalloff: 25,
  yawCap: 1.0, hbYawCap: 2.2, yawResponse: 8, slideScrub: 0.25, accelMul: 1, roll: 0.004, pitch: 0.0025,
};
export const DRIVE_PARAMS = [
  { k: 'grip', label: 'Dækgreb (m/s²)', min: 10, max: 60, step: 1 },
  { k: 'hbGrip', label: 'Greb med håndbremse', min: 2, max: 25, step: 0.5 },
  { k: 'steerIn', label: 'Rat ind (pr. s)', min: 1, max: 12, step: 0.5 },
  { k: 'steerOut', label: 'Rat tilbage (pr. s)', min: 1, max: 15, step: 0.5 },
  { k: 'maxAngle', label: 'Max styrevinkel (rad)', min: 0.2, max: 1.0, step: 0.02 },
  { k: 'angleFalloff', label: 'Vinkel-fald med fart (m/s)', min: 8, max: 80, step: 1 },
  { k: 'yawCap', label: 'Drejeloft (× greb)', min: 0.6, max: 2.0, step: 0.05 },
  { k: 'hbYawCap', label: 'Drejeloft håndbremse', min: 1, max: 4, step: 0.1 },
  { k: 'yawResponse', label: 'Drejerespons', min: 2, max: 25, step: 0.5 },
  { k: 'slideScrub', label: 'Fartstab ved glid', min: 0, max: 1, step: 0.05 },
  { k: 'accelMul', label: 'Acceleration (×)', min: 0.5, max: 2, step: 0.05 },
  { k: 'roll', label: 'Krængning', min: 0, max: 0.012, step: 0.0005 },
  { k: 'pitch', label: 'Nik ved gas/brems', min: 0, max: 0.008, step: 0.0005 },
];
export const DRIVE = { ...DRIVE_DEFAULTS };
try { Object.assign(DRIVE, JSON.parse(localStorage.getItem('bulebil.drive') || '{}')); } catch { /* ignore */ }
export function saveDrive() { try { localStorage.setItem('bulebil.drive', JSON.stringify(DRIVE)); } catch { /* ignore */ } }
