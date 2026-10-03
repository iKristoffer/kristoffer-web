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
