// Main game loop, mission progression, ?shot=flight|approach|start|end showcase modes, and UI bindings.

import { MISSIONS, MISSION_ORDER, getMission } from './missions.js';
import { createAircraftState, stepFlightPhysics } from './physics.js';
import { FlightRenderer } from './renderer.js';
import { SoundEngine } from './audio.js';
import { InputController } from './input.js';

const canvas = document.getElementById('game-canvas');
const renderer = new FlightRenderer(canvas);
const audio = new SoundEngine();

const elHudOverlay = document.getElementById('hud-overlay');
const elHudMissionName = document.getElementById('hud-mission-name');
const elEventBanner = document.getElementById('event-banner');
const elStartOverlay = document.getElementById('start-overlay');
const elPauseOverlay = document.getElementById('pause-overlay');
const elEndOverlay = document.getElementById('end-overlay');
const elEndBadge = document.getElementById('end-badge');
const elEndTitle = document.getElementById('end-title');
const elEndSubtitle = document.getElementById('end-subtitle');
const elEndStats = document.getElementById('end-stats');

const btnCamera = document.getElementById('btn-camera');
const btnMouse = document.getElementById('btn-mouse');
const btnInvert = document.getElementById('btn-invert');
const btnAudio = document.getElementById('btn-audio');
const btnMenu = document.getElementById('btn-menu');
const btnLaunch = document.getElementById('btn-launch');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');
const btnMenuPause = document.getElementById('btn-menu-pause');
const btnRetry = document.getElementById('btn-retry');
const btnNextMission = document.getElementById('btn-next-mission');
const btnBackMenu = document.getElementById('btn-back-menu');
const missionCards = Array.from(document.querySelectorAll('.mission-card'));

let selectedMissionId = 'slalom';
let currentMission = getMission(selectedMissionId);
let aircraft = createAircraftState(currentMission.spawn);

const uiState = {
  phase: 'start', // 'start' | 'playing' | 'paused' | 'end'
  shotMode: null, // 'flight' | 'approach' | 'start' | 'end'
  cameraMode: 'chase',
  nextRing: 0,
  score: 0,
  combo: 0,
  elapsed: 0,
  timeRemaining: currentMission.timeLimit,
  showHud: true,
  bannerTimer: 0,
  time: 0,
  dpr: 1,
  endSummary: null,
};

function resizeCanvas() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth || 1280;
  const h = window.innerHeight || 720;
  uiState.dpr = dpr;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function showBanner(msg, duration = 2.0) {
  elEventBanner.textContent = msg;
  elEventBanner.classList.remove('hidden');
  uiState.bannerTimer = duration;
}

function syncToolbarLabels() {
  btnCamera.textContent = `CAM: ${uiState.cameraMode.toUpperCase()} [C]`;
  btnMouse.textContent = `MOUSE: ${input.mouseFlight ? 'ON' : 'OFF'} [M]`;
  btnMouse.classList.toggle('active', input.mouseFlight);
  btnInvert.textContent = `PITCH: ${input.invertPitch ? 'INV' : 'STD'} [I]`;
  btnInvert.classList.toggle('active', input.invertPitch);
  btnAudio.textContent = `AUDIO: ${audio.enabled ? 'ON' : 'OFF'} [V]`;
  btnAudio.classList.toggle('active', audio.enabled);
}

function syncOverlays() {
  elStartOverlay.classList.toggle('hidden', uiState.phase !== 'start');
  elPauseOverlay.classList.toggle('hidden', uiState.phase !== 'paused');
  elEndOverlay.classList.toggle('hidden', uiState.phase !== 'end');
  elHudOverlay.classList.toggle('hidden', uiState.phase === 'start');
}

function selectMission(id) {
  selectedMissionId = MISSIONS[id] ? id : 'slalom';
  currentMission = getMission(selectedMissionId);
  elHudMissionName.textContent = currentMission.name;
  for (const card of missionCards) {
    card.classList.toggle('selected', card.dataset.mission === selectedMissionId);
  }
}

function startMission(id = selectedMissionId) {
  audio.unlock();
  selectMission(id);
  uiState.shotMode = null;
  aircraft = createAircraftState(currentMission.spawn);
  uiState.phase = 'playing';
  uiState.nextRing = 0;
  uiState.score = 0;
  uiState.combo = 0;
  uiState.elapsed = 0;
  uiState.timeRemaining = currentMission.timeLimit;
  uiState.showHud = true;
  uiState.endSummary = null;
  syncOverlays();
  syncToolbarLabels();
  showBanner(currentMission.mode === 'landing' ? 'INTERCEPT 3.2 DEG PAPI GLIDE SLOPE' : 'ALL SYSTEMS NOMINAL · CLEARED FOR FLIGHT', 2.2);
}

function finishMission(success, title, subtitle) {
  uiState.phase = 'end';
  uiState.endSummary = { success, title, subtitle };
  elEndBadge.textContent = success ? 'SORTIE ACCOMPLISHED' : 'SORTIE TERMINATED';
  elEndTitle.textContent = title;
  elEndSubtitle.textContent = subtitle;

  const ringsTotal = currentMission.rings.length;
  const stats = [
    { label: 'SCORE', value: `${uiState.score}` },
    { label: currentMission.mode === 'landing' ? 'TOUCHDOWN' : 'RINGS', value: currentMission.mode === 'landing' ? `${aircraft.lastTouchdownFpm || -320} FPM` : `${uiState.nextRing}/${ringsTotal}` },
    { label: 'TIME', value: `${uiState.elapsed.toFixed(1)}S` },
    { label: 'FUEL LEFT', value: `${Math.round(aircraft.fuel)}%` },
    { label: 'HULL', value: `${Math.round(aircraft.hull)}%` },
    { label: 'RATING', value: success ? (uiState.score >= 1200 ? 'S' : 'A') : 'C' },
  ];

  elEndStats.innerHTML = stats
    .map(
      (s) =>
        `<div class="stat-box"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`
    )
    .join('');

  syncOverlays();
}

function applyShotPreset(shot) {
  uiState.shotMode = shot;
  if (shot === 'flight') {
    selectMission('slalom');
    aircraft = createAircraftState({
      x: 580,
      y: 178,
      z: -380,
      yaw: -0.52,
      pitch: 0.02,
      roll: -0.38,
      airspeed: 147,
      throttle: 0.84,
      gearDown: false,
      flaps: 0,
    });
    aircraft.fuel = 82;
    aircraft.afterburner = true;
    aircraft.trailLeft = [
      { x: 602, y: 172, z: -435 },
      { x: 592, y: 174, z: -412 },
      { x: 582, y: 175, z: -390 },
    ];
    aircraft.trailRight = [
      { x: 614, y: 177, z: -428 },
      { x: 604, y: 179, z: -405 },
      { x: 594, y: 180, z: -383 },
    ];
    uiState.phase = 'playing';
    uiState.nextRing = 3;
    uiState.score = 950;
    uiState.timeRemaining = 114;
    uiState.showHud = true;
  } else if (shot === 'approach') {
    selectMission('approach');
    aircraft = createAircraftState({
      x: 0,
      y: 52,
      z: -660,
      yaw: 0,
      pitch: -0.02,
      roll: -0.06,
      airspeed: 71,
      throttle: 0.42,
      gearDown: true,
      flaps: 1,
    });
    aircraft.fuel = 74;
    uiState.phase = 'playing';
    uiState.nextRing = 2;
    uiState.score = 600;
    uiState.timeRemaining = 96;
    uiState.showHud = true;
  } else if (shot === 'start') {
    selectMission('slalom');
    aircraft = createAircraftState({
      x: -440,
      y: 205,
      z: 1080,
      yaw: 0.48,
      pitch: 0.04,
      roll: -0.28,
      airspeed: 136,
      throttle: 0.78,
      gearDown: false,
      flaps: 0,
    });
    uiState.phase = 'start';
    uiState.showHud = false;
  } else if (shot === 'end') {
    selectMission('slalom');
    aircraft = createAircraftState({
      x: 180,
      y: 230,
      z: 1450,
      yaw: -0.35,
      pitch: 0.06,
      roll: -0.24,
      airspeed: 142,
      throttle: 0.75,
      gearDown: false,
      flaps: 0,
    });
    aircraft.fuel = 68;
    uiState.nextRing = 8;
    uiState.score = 1950;
    uiState.elapsed = 86.4;
    finishMission(true, 'ARCHIPELAGO CLEARED', 'All 8 canyon and caldera gates cleared with precision.');
    return;
  }

  syncOverlays();
  syncToolbarLabels();
}

const input = new InputController(canvas, {
  onToggleGear: () => {
    if (uiState.phase !== 'playing') return;
    aircraft.gearDown = !aircraft.gearDown;
    showBanner(aircraft.gearDown ? 'LANDING GEAR DEPLOYED' : 'LANDING GEAR RETRACTED', 1.4);
  },
  onToggleFlaps: () => {
    if (uiState.phase !== 'playing') return;
    aircraft.flaps = aircraft.flaps > 0 ? 0 : 1;
    showBanner(aircraft.flaps > 0 ? 'FLAPS SET TO 20 DEG' : 'FLAPS RETRACTED', 1.4);
  },
  onToggleCamera: () => {
    uiState.cameraMode = uiState.cameraMode === 'chase' ? 'cockpit' : 'chase';
    syncToolbarLabels();
  },
  onToggleMouse: () => {
    input.mouseFlight = !input.mouseFlight;
    syncToolbarLabels();
  },
  onToggleInvert: () => {
    input.invertPitch = !input.invertPitch;
    syncToolbarLabels();
  },
  onToggleAudio: () => {
    audio.unlock();
    audio.setEnabled(!audio.enabled);
    syncToolbarLabels();
  },
  onTogglePause: () => {
    if (uiState.phase === 'playing') {
      uiState.phase = 'paused';
      syncOverlays();
    } else if (uiState.phase === 'paused') {
      uiState.phase = 'playing';
      syncOverlays();
    }
  },
});

// UI Listeners
for (const card of missionCards) {
  card.addEventListener('click', () => {
    audio.unlock();
    selectMission(card.dataset.mission);
  });
}

btnLaunch.addEventListener('click', () => startMission(selectedMissionId));
btnCamera.addEventListener('click', () => {
  uiState.cameraMode = uiState.cameraMode === 'chase' ? 'cockpit' : 'chase';
  syncToolbarLabels();
});
btnMouse.addEventListener('click', () => {
  input.mouseFlight = !input.mouseFlight;
  syncToolbarLabels();
});
btnInvert.addEventListener('click', () => {
  input.invertPitch = !input.invertPitch;
  syncToolbarLabels();
});
btnAudio.addEventListener('click', () => {
  audio.unlock();
  audio.setEnabled(!audio.enabled);
  syncToolbarLabels();
});
btnMenu.addEventListener('click', () => {
  if (uiState.phase === 'playing') {
    uiState.phase = 'paused';
    syncOverlays();
  }
});
btnResume.addEventListener('click', () => {
  uiState.phase = 'playing';
  syncOverlays();
});
btnRestart.addEventListener('click', () => startMission(selectedMissionId));
btnMenuPause.addEventListener('click', () => {
  uiState.phase = 'start';
  uiState.showHud = false;
  syncOverlays();
});
btnRetry.addEventListener('click', () => startMission(selectedMissionId));
btnNextMission.addEventListener('click', () => {
  const nextIdx = (MISSION_ORDER.indexOf(selectedMissionId) + 1) % MISSION_ORDER.length;
  startMission(MISSION_ORDER[nextIdx]);
});
btnBackMenu.addEventListener('click', () => {
  uiState.phase = 'start';
  uiState.showHud = false;
  syncOverlays();
});

// Check URL ?shot= param on startup
const params = new URLSearchParams(window.location.search);
const initialShot = params.get('shot');
if (initialShot && ['flight', 'approach', 'start', 'end'].includes(initialShot)) {
  applyShotPreset(initialShot);
} else {
  applyShotPreset('start');
  uiState.shotMode = null;
}

// Expose deterministic inspection hook
window.__GAME__ = {
  getState: () => ({ phase: uiState.phase, mission: selectedMissionId, aircraft, uiState }),
  setShot: (shot) => applyShotPreset(shot),
  startMission,
};

let lastTs = performance.now();

function tick(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
  lastTs = now;
  uiState.time += dt;

  if (uiState.bannerTimer > 0) {
    uiState.bannerTimer -= dt;
    if (uiState.bannerTimer <= 0) {
      elEventBanner.classList.add('hidden');
    }
  }

  if (uiState.shotMode && uiState.phase !== 'start') {
    // Showcase shots hold exact hero pose while keeping water shimmer & afterburner flicker alive
    audio.updateFlight(aircraft, false);
  } else if (uiState.phase === 'start') {
    // Gentle scenic orbit in start background (held steady when ?shot=start is active)
    if (uiState.shotMode === 'start') {
      aircraft.x = 240;
      aircraft.y = 195;
      aircraft.z = -180;
      aircraft.yaw = -0.46;
      aircraft.roll = -0.28;
      aircraft.pitch = 0.04;
    } else {
      const orbitYaw = uiState.time * 0.08 - 0.46;
      aircraft.x = 180 + Math.sin(orbitYaw) * 280;
      aircraft.z = 240 + Math.cos(orbitYaw) * 240;
      aircraft.y = 205 + Math.sin(uiState.time * 0.5) * 14;
      aircraft.yaw = orbitYaw - Math.PI * 0.5;
      aircraft.roll = -0.32;
      aircraft.pitch = 0.04;
    }
    aircraft.afterburner = false;
    audio.updateFlight(aircraft, false);
  } else if (uiState.phase === 'playing') {
    const controls = input.sample();
    const events = stepFlightPhysics(aircraft, controls, currentMission, dt, uiState.time);
    audio.updateFlight(aircraft, true);

    uiState.elapsed += dt;
    uiState.timeRemaining = Math.max(0, uiState.timeRemaining - dt);

    if (events.touchedDown) {
      audio.playTouchdown(events.smoothLanding);
      showBanner(
        events.smoothLanding
          ? `GREASED TOUCHDOWN! ${aircraft.lastTouchdownFpm} FPM`
          : `FIRM TOUCHDOWN ${aircraft.lastTouchdownFpm} FPM`,
        2.5
      );
      if (currentMission.mode === 'landing') {
        uiState.score += events.smoothLanding ? 900 : 550;
      }
    }

    if (events.hullDamaged) {
      audio.playImpact();
      showBanner(events.crashed ? 'AIRFRAME LOST' : 'TERRAIN SCRAPE! HULL DAMAGED', 2.0);
    }

    if (events.crashed) {
      finishMission(false, 'AIRFRAME LOST', 'Terrain or water impact exceeded structural limits.');
    } else if (uiState.timeRemaining <= 0) {
      finishMission(false, 'SORTIE TIME EXPIRED', 'Mission clock reached zero before completion.');
    } else {
      // Ring progression check
      const ring = currentMission.rings[uiState.nextRing];
      if (ring) {
        const d = Math.hypot(aircraft.x - ring.x, aircraft.y - ring.y, aircraft.z - ring.z);
        if (d <= ring.radius + 9) {
          uiState.nextRing += 1;
          uiState.combo += 1;
          const centerBonus = Math.round(Math.max(0, 1 - d / (ring.radius + 9)) * 150);
          uiState.score += 200 + centerBonus + uiState.combo * 25;
          audio.playRingPass(uiState.combo);
          showBanner(`GATE ${uiState.nextRing}/${currentMission.rings.length} CLEARED · +${200 + centerBonus}`, 1.6);

          if (currentMission.mode === 'rings' && uiState.nextRing >= currentMission.rings.length) {
            uiState.score += Math.round(uiState.timeRemaining * 8);
            finishMission(true, 'SORTIE COMPLETE', `All ${currentMission.rings.length} aerial waypoints cleared!`);
          }
        }
      }

      // Coastal Touch-and-Go victory after smooth landing rollout below 48 KTS or clean touch-and-go
      if (currentMission.mode === 'landing' && aircraft.touchedDown && aircraft.onGround && aircraft.airspeed < 28) {
        uiState.score += Math.round(uiState.timeRemaining * 6);
        finishMission(true, 'TOUCHDOWN CONFIRMED', `Safe rollout on Runway 36 (${aircraft.lastTouchdownFpm} FPM).`);
      }
    }
  } else {
    audio.updateFlight(aircraft, false);
  }

  renderer.render(aircraft, currentMission, uiState);
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);
