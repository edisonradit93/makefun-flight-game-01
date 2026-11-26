// Mission definitions, ring coordinates, final approach gate setup, and wind shear logic.

export const MISSION_ORDER = ['slalom', 'approach', 'storm'];

export const MISSIONS = {
  slalom: {
    id: 'slalom',
    name: 'ARCHIPELAGO RING SLALOM',
    mode: 'rings',
    timeLimit: 160,
    isStorm: false,
    wind: { x: 2.0, z: -1.5, gust: 1.5 },
    spawn: {
      x: 1080,
      y: 205,
      z: -1250,
      yaw: -0.52,
      pitch: 0.01,
      roll: 0,
      airspeed: 138,
      throttle: 0.78,
      gearDown: false,
      flaps: 0,
    },
    rings: [
      { x: 930, y: 192, z: -980, radius: 38, yaw: -0.52, label: 'CORAL REEF' },
      { x: 780, y: 185, z: -720, radius: 38, yaw: -0.52, label: 'SOUTH STRAIT' },
      { x: 640, y: 178, z: -480, radius: 38, yaw: -0.52, label: 'BAY ENTRY' },
      { x: 390, y: 165, z: -40, radius: 36, yaw: -0.52, label: 'RUNWAY OVERLOOK' },
      { x: 240, y: 175, z: 420, radius: 36, yaw: -0.15, label: 'TURQUOISE CHANNEL' },
      { x: 520, y: 205, z: 980, radius: 36, yaw: 0.62, label: 'CANYON ENTRY' },
      { x: 1080, y: 195, z: 1460, radius: 36, yaw: 0.12, label: 'TWIN SPIRE PASS' },
      { x: 420, y: 270, z: 2220, radius: 40, yaw: -0.95, label: 'CALDERA RIDGE' },
    ],
  },

  approach: {
    id: 'approach',
    name: 'COASTAL TOUCH-AND-GO',
    mode: 'landing',
    timeLimit: 140,
    isStorm: false,
    wind: { x: 3.2, z: -2.0, gust: 1.8 },
    spawn: {
      x: -45,
      y: 145,
      z: -1650,
      yaw: 0.02,
      pitch: -0.04,
      roll: 0,
      airspeed: 84,
      throttle: 0.48,
      gearDown: true,
      flaps: 1,
    },
    rings: [
      { x: 0, y: 92, z: -1020, radius: 42, yaw: 0, label: 'OUTER MARKER' },
      { x: 0, y: 50, z: -420, radius: 38, yaw: 0, label: 'FINAL PAPI GATE' },
    ],
  },

  storm: {
    id: 'storm',
    name: 'STORM RECON PATROL',
    mode: 'rings',
    timeLimit: 150,
    isStorm: true,
    wind: { x: 11.5, z: -5.5, gust: 8.5 },
    spawn: {
      x: -540,
      y: 230,
      z: -240,
      yaw: -0.45,
      pitch: 0.01,
      roll: 0,
      airspeed: 138,
      throttle: 0.82,
      gearDown: false,
      flaps: 0,
    },
    rings: [
      { x: -900, y: 185, z: 220, radius: 38, yaw: -0.52, label: 'LIGHTHOUSE SQUALL' },
      { x: -1160, y: 195, z: 820, radius: 38, yaw: 0.15, label: 'WEST REEF SHEAR' },
      { x: -940, y: 295, z: 1620, radius: 38, yaw: 0.35, label: 'CRATER UPDRAFT' },
      { x: -450, y: 375, z: 2340, radius: 38, yaw: 0.88, label: 'CALDERA RIM' },
      { x: 320, y: 265, z: 2200, radius: 38, yaw: 1.78, label: 'STRAIT CROSSWIND' },
      { x: 980, y: 170, z: 1420, radius: 40, yaw: 2.55, label: 'GORGE EXTRACTION' },
    ],
  },
};

export function getMission(id) {
  return MISSIONS[id] || MISSIONS.slalom;
}

/**
 * Returns deterministic ambient wind vector at position + time for wind shear simulation.
 */
export function sampleWind(mission, x, y, z, time) {
  const w = mission.wind;
  const shear = Math.sin(time * 0.9 + x * 0.004 + z * 0.003) * w.gust;
  const updraft = mission.isStorm ? Math.cos(time * 1.4 + z * 0.005) * 4.2 : 0;
  return {
    wx: w.x + shear,
    wy: updraft,
    wz: w.z + Math.cos(time * 0.7 + x * 0.003) * w.gust * 0.6,
  };
}
