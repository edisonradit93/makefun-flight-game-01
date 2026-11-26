// Aerodynamic 6-DOF-feel flight model: lift, drag, thrust, stall, bank-to-turn, and runway touchdown.

import { getTerrainHeight, isOverRunway, RUNWAY } from './terrain.js';
import { sampleWind } from './missions.js';

export function createAircraftState(spawn) {
  const vx = Math.sin(spawn.yaw) * Math.cos(spawn.pitch) * spawn.airspeed;
  const vy = Math.sin(spawn.pitch) * spawn.airspeed;
  const vz = Math.cos(spawn.yaw) * Math.cos(spawn.pitch) * spawn.airspeed;

  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx,
    vy,
    vz,
    yaw: spawn.yaw,
    pitch: spawn.pitch,
    roll: spawn.roll,
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0,
    airspeed: spawn.airspeed,
    verticalSpeed: vy,
    throttle: spawn.throttle,
    afterburner: false,
    airbrake: false,
    gearDown: Boolean(spawn.gearDown),
    gearAnim: spawn.gearDown ? 1 : 0,
    flaps: spawn.flaps || 0,
    fuel: 100,
    hull: 100,
    onGround: false,
    isStalling: false,
    stallBuffer: 0,
    aoa: 0,
    gForce: 1.0,
    trailLeft: [],
    trailRight: [],
    lastTouchdownFpm: 0,
    touchedDown: false,
  };
}

export function getBasisVectors(yaw, pitch, roll) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const fwd = { x: sy * cp, y: sp, z: cy * cp };
  const right0 = { x: cy, y: 0, z: -sy };
  const up0 = { x: -sy * sp, y: cp, z: -cy * sp };

  const right = {
    x: right0.x * cr - up0.x * sr,
    y: right0.y * cr - up0.y * sr,
    z: right0.z * cr - up0.z * sr,
  };
  const up = {
    x: right0.x * sr + up0.x * cr,
    y: right0.y * sr + up0.y * cr,
    z: right0.z * sr + up0.z * cr,
  };

  return { fwd, right, up };
}

export function stepFlightPhysics(state, controls, mission, dt, time) {
  const clampedDt = Math.min(0.05, Math.max(0.001, dt));

  // Throttle & afterburner
  state.throttle = Math.max(0, Math.min(1, state.throttle + controls.throttleDelta * 0.45 * clampedDt));
  state.afterburner = Boolean(controls.afterburner && state.fuel > 0.5 && !state.onGround);
  state.airbrake = Boolean(controls.airbrake);

  // Smooth gear extension/retraction
  const gearTarget = state.gearDown ? 1 : 0;
  state.gearAnim += (gearTarget - state.gearAnim) * Math.min(1, clampedDt * 5.5);

  // Fuel consumption
  const burnRate = (0.38 + state.throttle * 0.72 + (state.afterburner ? 1.45 : 0)) * 0.35;
  state.fuel = Math.max(0, state.fuel - burnRate * clampedDt);
  const effectiveThrottle = state.fuel > 0.1 ? state.throttle : 0;

  // Control authority scales with dynamic airflow (minimum authority on runway roll)
  const airFactor = Math.min(1.15, Math.max(0.28, state.airspeed / 85));

  // Roll, pitch, yaw angular dynamics
  const targetRollRate = controls.roll * 2.15 * airFactor;
  const targetPitchRate = controls.pitch * 1.35 * airFactor;
  const targetYawRate = controls.yaw * 0.75 * airFactor;

  state.rollRate += (targetRollRate - state.rollRate) * Math.min(1, clampedDt * 9.0);
  state.pitchRate += (targetPitchRate - state.pitchRate) * Math.min(1, clampedDt * 8.5);
  state.yawRate += (targetYawRate - state.yawRate) * Math.min(1, clampedDt * 7.5);

  // Subtle wing-level stability when hands off roll controls
  if (Math.abs(controls.roll) < 0.05 && !state.onGround) {
    state.roll -= state.roll * 0.22 * clampedDt;
  }

  state.roll += state.rollRate * clampedDt;
  // Normalize roll to [-PI, PI]
  if (state.roll > Math.PI) state.roll -= Math.PI * 2;
  if (state.roll < -Math.PI) state.roll += Math.PI * 2;

  // Bank-to-turn heading coupling and nosewheel steering when rolling on tarmac
  const bankTurn = state.onGround ? 0 : Math.sin(state.roll) * (0.62 * Math.min(1.2, state.airspeed / 95));
  const groundSteer = state.onGround ? controls.roll * 0.48 * Math.min(1, state.airspeed / 25) : 0;
  state.yaw += (state.yawRate + bankTurn + groundSteer) * clampedDt;
  state.pitch = Math.max(-1.15, Math.min(1.15, state.pitch + state.pitchRate * clampedDt));

  const { fwd, up } = getBasisVectors(state.yaw, state.pitch, state.roll);

  // Ambient wind & storm turbulence
  const wind = sampleWind(mission, state.x, state.y, state.z, time);
  const relVx = state.vx - wind.wx;
  const relVy = state.vy - wind.wy;
  const relVz = state.vz - wind.wz;
  const speed = Math.hypot(relVx, relVy, relVz);
  state.airspeed = speed;

  // Stall speed decreases when flaps are deployed
  const stallSpeed = state.flaps > 0 ? 40 : 52;
  state.isStalling = !state.onGround && speed < stallSpeed;
  if (state.isStalling) {
    state.stallBuffer = Math.min(1, state.stallBuffer + clampedDt * 3);
    // Natural nose-drop stall recovery torque
    state.pitch = Math.max(-0.9, state.pitch - 0.35 * clampedDt);
  } else {
    state.stallBuffer = Math.max(0, state.stallBuffer - clampedDt * 4);
  }

  // Thrust along aircraft nose
  const maxThrust = state.afterburner ? 56.0 : 34.5;
  const thrust = effectiveThrottle * maxThrust + (state.afterburner ? 18.0 : 0);

  // Aerodynamic lift, flaps boost, and ground-effect flare cushion near runway
  const gravity = 16.5; // tuned for responsive arcade-sim scale
  const flightPitch = Math.atan2(relVy, Math.max(1, Math.hypot(relVx, relVz)));
  state.aoa = state.pitch - flightPitch;

  const agl = Math.max(0, state.y - Math.max(0, getTerrainHeight(state.x, state.z)));
  const groundEffect = agl < 16 ? 1 + (1 - agl / 16) * 0.22 : 1.0;
  const flapsBoost = state.flaps > 0 ? 1.32 : 1.0;
  const stallPenalty = state.isStalling ? Math.max(0.35, speed / stallSpeed) : 1.0;
  const liftAccel = Math.min(36.0, (speed / 78) * (speed / 78) * gravity * flapsBoost * groundEffect * stallPenalty);

  // Parasitic + induced + gear/flap/airbrake drag
  const dragCoeff =
    0.00145 +
    (state.gearAnim * 0.00085) +
    (state.flaps > 0 ? 0.00055 : 0) +
    (state.airbrake ? 0.0024 : 0);

  // Align velocity smoothly toward nose direction (weathercock stability) + apply forces
  const alignStrength = state.onGround ? 6.0 : Math.min(3.8, 1.4 + speed * 0.018);
  const targetVx = fwd.x * speed + wind.wx * 0.25;
  const targetVy = fwd.y * speed + wind.wy * 0.15;
  const targetVz = fwd.z * speed + wind.wz * 0.25;

  state.vx += (targetVx - state.vx) * Math.min(1, alignStrength * clampedDt);
  state.vy += (targetVy - state.vy) * Math.min(1, alignStrength * 0.65 * clampedDt);
  state.vz += (targetVz - state.vz) * Math.min(1, alignStrength * clampedDt);

  const ax = fwd.x * thrust + up.x * (liftAccel - gravity * 0.2) - relVx * speed * dragCoeff;
  const ay = fwd.y * thrust + up.y * liftAccel - gravity - relVy * speed * dragCoeff;
  const az = fwd.z * thrust + up.z * (liftAccel - gravity * 0.2) - relVz * speed * dragCoeff;

  state.vx += ax * clampedDt;
  state.vy += ay * clampedDt;
  state.vz += az * clampedDt;

  // Clamp max airspeed cleanly
  const newSpeed = Math.hypot(state.vx, state.vy, state.vz);
  const maxSpeed = state.afterburner ? 228 : 178;
  if (newSpeed > maxSpeed) {
    const scale = maxSpeed / newSpeed;
    state.vx *= scale;
    state.vy *= scale;
    state.vz *= scale;
  }

  state.x += state.vx * clampedDt;
  state.y += state.vy * clampedDt;
  state.z += state.vz * clampedDt;
  state.verticalSpeed = state.vy;
  state.gForce = Math.max(0.2, Math.min(7.5, (liftAccel / gravity) * Math.cos(state.roll * 0.4) + Math.abs(state.pitchRate) * 1.4));

  // Record wingtip contrails when banking hard or boosting
  const showTrail = !state.onGround && (state.afterburner || Math.abs(state.roll) > 0.35 || state.airspeed > 140);
  if (showTrail) {
    const { right } = getBasisVectors(state.yaw, state.pitch, state.roll);
    state.trailLeft.push({ x: state.x - right.x * 7.2, y: state.y - right.y * 7.2, z: state.z - right.z * 7.2 });
    state.trailRight.push({ x: state.x + right.x * 7.2, y: state.y + right.y * 7.2, z: state.z + right.z * 7.2 });
    if (state.trailLeft.length > 26) state.trailLeft.shift();
    if (state.trailRight.length > 26) state.trailRight.shift();
  } else {
    if (state.trailLeft.length > 0) state.trailLeft.shift();
    if (state.trailRight.length > 0) state.trailRight.shift();
  }

  // Terrain, ocean, and Coastal Runway collision / landing evaluation
  const groundH = Math.max(0, getTerrainHeight(state.x, state.z));
  const overRwy = isOverRunway(state.x, state.z);
  const deckH = overRwy ? RUNWAY.deckY : groundH;
  const clearance = state.gearDown ? 2.2 : 1.4;

  const events = {
    touchedDown: false,
    smoothLanding: false,
    crashed: false,
    hullDamaged: false,
  };

  if (state.y <= deckH + clearance) {
    const sinkFpm = state.vy * 196.85;
    const bankOk = Math.abs(state.roll) < 0.34;
    const sinkOk = state.vy > -7.2;

    if (overRwy && state.gearDown && bankOk && sinkOk) {
      // Safe runway contact / rollout
      if (!state.onGround && state.vy < -0.5) {
        events.touchedDown = true;
        events.smoothLanding = state.vy > -4.6;
        state.lastTouchdownFpm = Math.round(sinkFpm);
        state.touchedDown = true;
      }
      state.y = deckH + clearance;
      state.vy = Math.max(0, state.vy);
      state.onGround = true;
      state.roll *= 0.72;
      state.pitch = Math.max(-0.02, Math.min(0.18, state.pitch));

      // Rolling friction + wheel braking
      const brakeDecel = state.airbrake ? 22.0 : 8.5;
      const groundSpeed = Math.hypot(state.vx, state.vz);
      if (groundSpeed > 0.5 && controls.pitch <= 0.15) {
        const drop = Math.max(0, groundSpeed - brakeDecel * clampedDt) / groundSpeed;
        state.vx *= drop;
        state.vz *= drop;
      }
    } else {
      // Rough impact on water or island terrain
      const impactDamage = overRwy ? 35 : groundH <= 0.2 ? 55 : 100;
      state.hull = Math.max(0, state.hull - impactDamage);
      events.hullDamaged = true;
      if (state.hull <= 0) {
        state.y = deckH + clearance;
        events.crashed = true;
      } else {
        // Bounce safely back above terrain so glancing scrapes feel fair
        state.y = deckH + clearance + 18;
        state.vy = Math.max(12, Math.abs(state.vy) * 0.5);
        state.pitch = Math.max(0.12, state.pitch);
        state.roll *= 0.4;
      }
    }
  } else {
    state.onGround = false;
  }

  return events;
}
