// Procedural 3D volcanic archipelago heightmap, coastal runway field, and biome coloring.

export const RUNWAY = {
  centerX: 0,
  startZ: 0,
  endZ: 920,
  width: 48,
  deckY: 14.3,
  glideSlopeDeg: 3.2,
  papiZ: 125,
  papiX: -36,
};

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function gaussian2D(dx, dz, sx, sz) {
  return Math.exp(-((dx * dx) / (2 * sx * sx) + (dz * dz) / (2 * sz * sz)));
}

/**
 * Deterministic volcanic archipelago terrain height in meters at world (x, z).
 * Ocean surface sits at y = 0.
 */
export function getTerrainHeight(x, z) {
  let h = -22;

  // 1. Valkyrie Field (Coastal Runway Island around x = 0, z = 0..920)
  const rdx = Math.max(0, Math.abs(x) - 180);
  const rdz = z < -110 ? -110 - z : z > 1060 ? z - 1060 : 0;
  const runwayDist = Math.hypot(rdx, rdz);
  const runwayPlateau = 1 - smoothstep(0, 210, runwayDist);
  h = Math.max(h, -18 + runwayPlateau * 32.0);
  // Subtle coastal ridge west of the airstrip for visual relief without encroaching on final approach
  const airBaseHill = gaussian2D(x + 290, z - 560, 120, 240) * 68;
  h += airBaseHill * (1 - smoothstep(40, 170, Math.abs(x) - 55));

  // 2. Caldera Peak (Main Volcano Island across the bay North-Northwest)
  const vx = x + 760;
  const vz = z - 2550;
  const vr = Math.hypot(vx, vz);
  if (vr < 1650) {
    const baseCone = 445 * Math.exp(-(vr * vr) / (2 * 560 * 560));
    const ridges =
      32 * Math.sin(Math.atan2(vz, vx) * 5 + vr * 0.008) * smoothstep(140, 620, vr) * (1 - smoothstep(700, 1550, vr));
    const craterCut = 135 * Math.exp(-(vr * vr) / (2 * 135 * 135));
    const volcanoH = baseCone + ridges - craterCut - 26;
    h = Math.max(h, volcanoH);
  }

  // 3. Twin Spire Canyon (Dramatic basalt gorge to the East-Northeast)
  // Two towering peaks flanking a flyable valley centered around x = 1120, z = 1480
  const westSpire = 315 * gaussian2D(x - 740, z - 1460, 240, 380);
  const eastSpire = 335 * gaussian2D(x - 1520, z - 1560, 270, 440);
  const canyonBase = 165 * gaussian2D(x - 1130, z - 1510, 640, 740);
  // Carve a sweeping canyon channel down the middle along x ~ 1120 + 90*sin(z*0.003)
  const channelCenter = 1110 + Math.sin(z * 0.0032) * 85;
  const channelDist = Math.abs(x - channelCenter);
  const canyonCarve = (1 - smoothstep(65, 220, channelDist)) * smoothstep(680, 1050, z) * (1 - smoothstep(2050, 2450, z));
  const twinIslandH = Math.max(canyonBase + westSpire + eastSpire - 28, -22) - canyonCarve * 125;
  h = Math.max(h, twinIslandH);

  // 4. Emerald Arch & Lighthouse Key (Southwest island)
  const swPeak = 185 * gaussian2D(x + 1320, z - 520, 360, 320) + 75 * gaussian2D(x + 980, z - 260, 220, 210);
  if (swPeak > 2) {
    const wave = 14 * Math.sin(x * 0.011) * Math.cos(z * 0.011);
    h = Math.max(h, swPeak + wave - 24);
  }

  // 5. Coral Sentinel Atoll (Southeast reef & sea stack)
  const sePeak = 152 * gaussian2D(x - 1180, z + 640, 280, 260) + 60 * gaussian2D(x - 1460, z + 420, 170, 170);
  if (sePeak > 2) {
    h = Math.max(h, sePeak - 22);
  }

  // 6. Distant Northern Ridge Chain (horizon depth)
  const northChain =
    260 * gaussian2D(x - 240, z - 3650, 720, 360) +
    220 * gaussian2D(x - 1780, z - 3320, 560, 360);
  if (northChain > 2) {
    h = Math.max(h, northChain - 24);
  }

  // Clamp flat runway deck exactly to 14.0m inside apron bounds so tarmac sits flush
  if (Math.abs(x - RUNWAY.centerX) < 75 && z > -70 && z < 995) {
    const blend = smoothstep(52, 75, Math.abs(x - RUNWAY.centerX));
    h = 14.0 * (1 - blend) + h * blend;
  }

  return h;
}

/**
 * Returns shallow turquoise reef depth factor [0..1] for ocean coloration near islands.
 */
export function getCoastalReefFactor(x, z) {
  const h = getTerrainHeight(x, z);
  if (h >= 0) return 1;
  return Math.max(0, Math.min(1, (h + 20) / 20));
}

/**
 * Computes surface normal at (x, z) via finite differences for crisp terrain lighting.
 */
export function getTerrainNormal(x, z, step = 18) {
  const hL = getTerrainHeight(x - step, z);
  const hR = getTerrainHeight(x + step, z);
  const hD = getTerrainHeight(x, z - step);
  const hU = getTerrainHeight(x, z + step);
  const nx = hL - hR;
  const ny = 2 * step;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/**
 * Evaluates terrain RGB color based on elevation, slope, caldera proximity, and weather mode.
 */
export function getTerrainBiomeColor(x, z, h, slopeY, isStorm = false) {
  // Check volcanic crater rim / lava core
  const vr = Math.hypot(x + 760, z - 2550);
  if (vr < 145 && h > 275) {
    // Glowing molten caldera interior
    const glow = Math.max(0, 1 - vr / 135);
    return {
      r: Math.round(195 + glow * 60),
      g: Math.round(62 + glow * 85),
      b: Math.round(24 + glow * 16),
      emissive: 0.45 + glow * 0.45,
    };
  }

  let r, g, b;
  if (h < 6.5) {
    // Sunlit sandy beach
    r = 222;
    g = 204;
    b = 156;
  } else if (slopeY < 0.72 || h > 235) {
    // Steep basalt cliffs & volcanic rock
    const rockMix = Math.min(1, Math.max(0, (h - 140) / 220));
    r = Math.round(98 - rockMix * 24);
    g = Math.round(92 - rockMix * 26);
    b = Math.round(94 - rockMix * 22);
  } else if (h < 95) {
    // Lush tropical coastal jungle
    r = 44;
    g = 132;
    b = 68;
  } else {
    // Highland emerald ridge grass
    r = 62;
    g = 124;
    b = 64;
  }

  if (isStorm) {
    r = Math.round(r * 0.72);
    g = Math.round(g * 0.76);
    b = Math.round(b * 0.86);
  }
  return { r, g, b, emissive: 0 };
}

/**
 * Generates decorative 3D cloud clusters floating above the archipelago.
 */
export function createCloudField() {
  const clouds = [];
  const anchors = [
    [-950, 620, 1950, 260],
    [420, 710, 2200, 310],
    [1680, 580, 1200, 240],
    [-1520, 650, 900, 250],
    [760, 680, 3100, 320],
    [-340, 560, 3400, 280],
    [1950, 640, -150, 260],
    [-1300, 590, -520, 230],
    [120, 740, 950, 200],
  ];
  for (let i = 0; i < anchors.length; i++) {
    const [cx, cy, cz, scale] = anchors[i];
    clouds.push({ x: cx, y: cy, z: cz, rx: scale, ry: scale * 0.24, rz: scale * 0.68 });
    clouds.push({ x: cx + scale * 0.55, y: cy - 12, z: cz + scale * 0.2, rx: scale * 0.72, ry: scale * 0.2, rz: scale * 0.55 });
    clouds.push({ x: cx - scale * 0.5, y: cy - 10, z: cz - scale * 0.18, rx: scale * 0.68, ry: scale * 0.19, rz: scale * 0.5 });
  }
  return clouds;
}

/**
 * Returns true if (x, z) is on the paved Coastal Runway deck.
 */
export function isOverRunway(x, z) {
  return Math.abs(x - RUNWAY.centerX) <= RUNWAY.width * 0.56 && z >= RUNWAY.startZ - 20 && z <= RUNWAY.endZ + 20;
}
