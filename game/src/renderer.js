// 3D perspective archipelago renderer, shaded twin-tail Valkyrie jet, runway PAPI lights, and Glass HUD.

import {
  RUNWAY,
  getTerrainHeight,
  getTerrainNormal,
  getTerrainBiomeColor,
  getCoastalReefFactor,
  createCloudField,
} from './terrain.js';
import { getBasisVectors } from './physics.js';

const DEG = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const NEAR_Z = 2.0;

export class FlightRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sunDir = this._norm({ x: 0.48, y: 0.62, z: 0.62 });
    this.clouds = createCloudField();
    this.islandTris = this._buildIslandMesh();
  }

  _norm(v) {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  /**
   * Precomputes triangulated island terrain mesh for blazing-fast 60fps 3D rendering.
   */
  _buildIslandMesh() {
    const tris = [];
    const step = 95;
    const minX = -2100;
    const maxX = 2250;
    const minZ = -1350;
    const maxZ = 4050;
    const nx = Math.floor((maxX - minX) / step);
    const nz = Math.floor((maxZ - minZ) / step);

    const verts = [];
    for (let iz = 0; iz <= nz; iz++) {
      const row = [];
      const z = minZ + iz * step;
      for (let ix = 0; ix <= nx; ix++) {
        const x = minX + ix * step;
        const h = getTerrainHeight(x, z);
        const n = getTerrainNormal(x, z, 28);
        row.push({ x, y: h, z, n });
      }
      verts.push(row);
    }

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const v00 = verts[iz][ix];
        const v10 = verts[iz][ix + 1];
        const v01 = verts[iz + 1][ix];
        const v11 = verts[iz + 1][ix + 1];

        if (v00.y < -14 && v10.y < -14 && v01.y < -14 && v11.y < -14) continue;

        const addTri = (a, b, c) => {
          const cx = (a.x + b.x + c.x) / 3;
          const cy = (a.y + b.y + c.y) / 3;
          const cz = (a.z + b.z + c.z) / 3;
          if (cy < -12) return;
          const ny = (a.n.y + b.n.y + c.n.y) / 3;
          const n = this._norm({
            x: (a.n.x + b.n.x + c.n.x) / 3,
            y: ny,
            z: (a.n.z + b.n.z + c.n.z) / 3,
          });
          tris.push({ a, b, c, cx, cy, cz, n, ny });
        };

        addTri(v00, v10, v11);
        addTri(v00, v11, v01);
      }
    }
    return tris;
  }

  _buildCamera(state, cameraMode) {
    const { fwd, right, up } = getBasisVectors(state.yaw, state.pitch, state.roll);

    if (cameraMode === 'cockpit') {
      return {
        pos: {
          x: state.x + up.x * 1.45 + fwd.x * 1.8,
          y: state.y + up.y * 1.45 + fwd.y * 1.8,
          z: state.z + up.z * 1.45 + fwd.z * 1.8,
        },
        fwd,
        right,
        up,
      };
    }

    // Dynamic chase camera: follows aircraft roll softly (48%) so plane banking stands out vividly
    const camRoll = state.roll * 0.48;
    const camBasis = getBasisVectors(state.yaw, state.pitch * 0.85, camRoll);
    const pos = {
      x: state.x - camBasis.fwd.x * 35.0 + camBasis.up.x * 5.6,
      y: Math.max(4.5, state.y - camBasis.fwd.y * 35.0 + camBasis.up.y * 5.6),
      z: state.z - camBasis.fwd.z * 35.0 + camBasis.up.z * 5.6,
    };

    const lookAt = {
      x: state.x + fwd.x * 56,
      y: state.y + fwd.y * 56 + 1.4,
      z: state.z + fwd.z * 56,
    };
    const camFwd = this._norm({ x: lookAt.x - pos.x, y: lookAt.y - pos.y, z: lookAt.z - pos.z });
    const camRight0 = this._norm({ x: camFwd.z, y: 0, z: -camFwd.x });
    // cross(camFwd, camRight0) points +Y upward in right-handed world space
    const realUp0 = this._norm({
      x: camFwd.y * camRight0.z - camFwd.z * camRight0.y,
      y: camFwd.z * camRight0.x - camFwd.x * camRight0.z,
      z: camFwd.x * camRight0.y - camFwd.y * camRight0.x,
    });
    const cr = Math.cos(camRoll);
    const sr = Math.sin(camRoll);
    const camRight = {
      x: camRight0.x * cr - realUp0.x * sr,
      y: camRight0.y * cr - realUp0.y * sr,
      z: camRight0.z * cr - realUp0.z * sr,
    };
    const camUp = {
      x: camRight0.x * sr + realUp0.x * cr,
      y: camRight0.y * sr + realUp0.y * cr,
      z: camRight0.z * sr + realUp0.z * cr,
    };

    return { pos, fwd: camFwd, right: camRight, up: camUp };
  }

  _toCam(p, cam) {
    const dx = p.x - cam.pos.x;
    const dy = p.y - cam.pos.y;
    const dz = p.z - cam.pos.z;
    return {
      x: dx * cam.right.x + dy * cam.right.y + dz * cam.right.z,
      y: dx * cam.up.x + dy * cam.up.y + dz * cam.up.z,
      z: dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z,
    };
  }

  _projectCam(c, w, h, fov) {
    if (c.z < NEAR_Z) return null;
    const s = fov / c.z;
    return {
      x: w * 0.5 + c.x * s,
      y: h * 0.5 - c.y * s,
      z: c.z,
      scale: s,
    };
  }

  _projectWorld(p, cam, w, h, fov) {
    return this._projectCam(this._toCam(p, cam), w, h, fov);
  }

  _clipAndProjectPoly(pts, cam, w, h, fov) {
    const camPts = pts.map((p) => this._toCam(p, cam));
    const clipped = [];
    for (let i = 0; i < camPts.length; i++) {
      const curr = camPts[i];
      const prev = camPts[(i + camPts.length - 1) % camPts.length];
      const currIn = curr.z >= NEAR_Z;
      const prevIn = prev.z >= NEAR_Z;
      if (currIn !== prevIn) {
        const t = (NEAR_Z - prev.z) / (curr.z - prev.z);
        clipped.push({
          x: prev.x + (curr.x - prev.x) * t,
          y: prev.y + (curr.y - prev.y) * t,
          z: NEAR_Z,
        });
      }
      if (currIn) clipped.push(curr);
    }
    if (clipped.length < 3) return null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sumZ = 0;
    const screen = clipped.map((c) => {
      const s = fov / c.z;
      const sx = w * 0.5 + c.x * s;
      const sy = h * 0.5 - c.y * s;
      if (sx < minX) minX = sx;
      if (sx > maxX) maxX = sx;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
      sumZ += c.z;
      return { x: sx, y: sy };
    });

    if (maxX < -40 || minX > w + 40 || maxY < -40 || minY > h + 40) return null;
    return { screen, avgZ: sumZ / clipped.length };
  }

  render(state, mission, uiState) {
    const ctx = this.ctx;
    const dpr = uiState.dpr || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fov = w * 0.72;
    const isStorm = Boolean(mission.isStorm);
    const time = uiState.time || 0;

    const cam = this._buildCamera(state, uiState.cameraMode);

    // 1. Sky Dome + Sun Halo
    this._drawSky(ctx, cam, w, h, fov, isStorm);

    // 2. 3D Ocean Surface + Turquoise Coastal Shallows + Sun Reflection Path
    this._drawOceanGrid(ctx, cam, w, h, fov, isStorm, time);

    // 3. 3D Volcanic Islands, Beaches & Lava Caldera (Painter-sorted)
    this._drawTerrain(ctx, cam, w, h, fov, isStorm);

    // 4. Coastal Runway, Threshold Markings, Centerline, PAPI Lights & Control Tower
    this._drawRunwayAndBase(ctx, cam, w, h, fov, state, time);

    // 5. Volumetric 3D Cloud Layer
    this._drawClouds(ctx, cam, w, h, fov, isStorm);

    // 6. Depth-sorted Foreground Entities: Target Rings + Aircraft + Contrails
    this._drawRingsAndAircraft(ctx, cam, state, mission, uiState, w, h, fov, time);

    // 7. Canopy Frame (Cockpit mode) + Crisp Glass-Cockpit Avionics HUD
    if (uiState.showHud !== false) {
      if (uiState.cameraMode === 'cockpit') {
        this._drawCockpitFrame(ctx, w, h);
      }
      this._drawGlassHUD(ctx, cam, state, mission, uiState, w, h, fov);
    }
  }

  _drawSky(ctx, cam, w, h, fov, isStorm) {
    // Horizon reference point flattened horizontally along forward azimuth
    const hLen = Math.hypot(cam.fwd.x, cam.fwd.z) || 1;
    const hDirX = cam.fwd.x / hLen;
    const hDirZ = cam.fwd.z / hLen;
    const horWorld = {
      x: cam.pos.x + hDirX * 6000,
      y: 0,
      z: cam.pos.z + hDirZ * 6000,
    };
    const horRight = {
      x: horWorld.x + cam.right.x * 1600,
      y: 0,
      z: horWorld.z + cam.right.z * 1600,
    };
    const pMid = this._projectWorld(horWorld, cam, w, h, fov);
    const horY = pMid ? pMid.y : h * 0.48;
    const pR = this._projectWorld(horRight, cam, w, h, fov);
    const tilt = pMid && pR ? Math.atan2(pR.y - pMid.y, pR.x - pMid.x) : 0;

    ctx.save();
    ctx.translate(w * 0.5, horY);
    ctx.rotate(tilt);
    const skyGrad = ctx.createLinearGradient(0, -h * 1.1, 0, h * 0.9);
    if (isStorm) {
      skyGrad.addColorStop(0, '#102138');
      skyGrad.addColorStop(0.45, '#2b4764');
      skyGrad.addColorStop(0.62, '#9a8066');
      skyGrad.addColorStop(0.64, '#1b4763');
      skyGrad.addColorStop(1, '#081b2c');
    } else {
      skyGrad.addColorStop(0, '#0c437f');
      skyGrad.addColorStop(0.36, '#2e86cb');
      skyGrad.addColorStop(0.57, '#99dcff');
      skyGrad.addColorStop(0.62, '#ffe8c2');
      skyGrad.addColorStop(0.63, '#10628d');
      skyGrad.addColorStop(1, '#072a49');
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(-w * 1.4, -h * 1.4, w * 2.8, h * 2.8);
    ctx.restore();

    // Sun disk & warm atmospheric bloom
    const sunWorld = {
      x: cam.pos.x + this.sunDir.x * 5000,
      y: cam.pos.y + this.sunDir.y * 5000,
      z: cam.pos.z + this.sunDir.z * 5000,
    };
    const sunPt = this._projectWorld(sunWorld, cam, w, h, fov);
    if (sunPt) {
      const sunRad = isStorm ? 90 : 140;
      const g = ctx.createRadialGradient(sunPt.x, sunPt.y, 4, sunPt.x, sunPt.y, sunRad);
      if (isStorm) {
        g.addColorStop(0, 'rgba(255, 224, 160, 0.72)');
        g.addColorStop(0.35, 'rgba(255, 175, 100, 0.25)');
        g.addColorStop(1, 'rgba(255, 160, 90, 0)');
      } else {
        g.addColorStop(0, 'rgba(255, 253, 232, 0.96)');
        g.addColorStop(0.22, 'rgba(255, 232, 168, 0.55)');
        g.addColorStop(1, 'rgba(255, 210, 140, 0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sunPt.x, sunPt.y, sunRad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawOceanGrid(ctx, cam, w, h, fov, isStorm, time) {
    // World-snapped adaptive ocean quads reaching far horizon with turquoise reefs & sun shimmer
    const snap = 420;
    const baseX = Math.floor(cam.pos.x / snap) * snap;
    const baseZ = Math.floor(cam.pos.z / snap) * snap;
    const ringOffsets = [-5400, -3200, -1800, -1000, -480, 0, 480, 1000, 1800, 3200, 5400];
    const quads = [];

    for (let iz = 0; iz < ringOffsets.length - 1; iz++) {
      for (let ix = 0; ix < ringOffsets.length - 1; ix++) {
        const x0 = baseX + ringOffsets[ix];
        const x1 = baseX + ringOffsets[ix + 1];
        const z0 = baseZ + ringOffsets[iz];
        const z1 = baseZ + ringOffsets[iz + 1];
        const cx = (x0 + x1) * 0.5;
        const cz = (z0 + z1) * 0.5;
        const dist = Math.hypot(cx - cam.pos.x, cz - cam.pos.z);
        if (dist > 6800) continue;

        const proj = this._clipAndProjectPoly(
          [
            { x: x0, y: 0, z: z0 },
            { x: x1, y: 0, z: z0 },
            { x: x1, y: 0, z: z1 },
            { x: x0, y: 0, z: z1 },
          ],
          cam,
          w,
          h,
          fov
        );
        if (!proj) continue;

        // Turquoise coastal shallow reef blend
        const reef = getCoastalReefFactor(cx, cz);
        // Sun specular reflection along the sun azimuth
        const toCamX = (cx - cam.pos.x) / (dist || 1);
        const toCamZ = (cz - cam.pos.z) / (dist || 1);
        const sunAlign = Math.max(0, toCamX * this.sunDir.x + toCamZ * this.sunDir.z);
        const shimmer = Math.pow(sunAlign, 10) * (0.55 + 0.45 * Math.sin(time * 2.8 + cx * 0.015 + cz * 0.012));

        let r = isStorm ? 14 : 16;
        let g = isStorm ? 64 : 102;
        let b = isStorm ? 96 : 158;

        // Blend turquoise shallow reef
        r = Math.round(r + reef * (isStorm ? 18 : 34));
        g = Math.round(g + reef * (isStorm ? 56 : 112));
        b = Math.round(b + reef * (isStorm ? 46 : 62));

        // Sun reflection glint
        r = Math.min(255, Math.round(r + shimmer * (isStorm ? 75 : 155)));
        g = Math.min(255, Math.round(g + shimmer * (isStorm ? 68 : 138)));
        b = Math.min(255, Math.round(b + shimmer * (isStorm ? 52 : 98)));

        // Atmospheric horizon fog
        const fog = Math.min(0.88, Math.pow(Math.min(1, dist / 6200), 1.6));
        const fogR = isStorm ? 110 : 185;
        const fogG = isStorm ? 126 : 222;
        const fogB = isStorm ? 142 : 246;
        r = Math.round(r * (1 - fog) + fogR * fog);
        g = Math.round(g * (1 - fog) + fogG * fog);
        b = Math.round(b * (1 - fog) + fogB * fog);

        quads.push({ screen: proj.screen, avgZ: proj.avgZ, color: `rgb(${r},${g},${b})` });
      }
    }

    quads.sort((a, b) => b.avgZ - a.avgZ);
    for (let i = 0; i < quads.length; i++) {
      const q = quads[i];
      ctx.fillStyle = q.color;
      ctx.strokeStyle = q.color;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(q.screen[0].x, q.screen[0].y);
      ctx.lineTo(q.screen[1].x, q.screen[1].y);
      ctx.lineTo(q.screen[2].x, q.screen[2].y);
      ctx.lineTo(q.screen[3].x, q.screen[3].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawTerrain(ctx, cam, w, h, fov, isStorm) {
    const drawList = [];
    const fogR = isStorm ? 115 : 186;
    const fogG = isStorm ? 130 : 222;
    const fogB = isStorm ? 145 : 246;

    for (let i = 0; i < this.islandTris.length; i++) {
      const t = this.islandTris[i];
      const dx = t.cx - cam.pos.x;
      const dy = t.cy - cam.pos.y;
      const dz = t.cz - cam.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 5600) continue;

      // Coarse front-frustum culling before clipping
      const zEst = dx * cam.fwd.x + dy * cam.fwd.y + dz * cam.fwd.z;
      if (zEst < -160) continue;

      const proj = this._clipAndProjectPoly([t.a, t.b, t.c], cam, w, h, fov);
      if (!proj) continue;

      const biome = getTerrainBiomeColor(t.cx, t.cz, t.cy, t.ny, isStorm);
      const sunDot = Math.max(0.18, t.n.x * this.sunDir.x + t.n.y * this.sunDir.y + t.n.z * this.sunDir.z);
      const shade = Math.min(1.15, 0.36 + sunDot * 0.78 + biome.emissive);

      const fog = Math.min(0.84, Math.pow(Math.min(1, dist / 5200), 1.65));
      const r = Math.min(255, Math.round(biome.r * shade * (1 - fog) + fogR * fog));
      const g = Math.min(255, Math.round(biome.g * shade * (1 - fog) + fogG * fog));
      const b = Math.min(255, Math.round(biome.b * shade * (1 - fog) + fogB * fog));

      drawList.push({
        screen: proj.screen,
        avgZ: proj.avgZ,
        color: `rgb(${r},${g},${b})`,
      });
    }

    drawList.sort((a, b) => b.avgZ - a.avgZ);
    for (let i = 0; i < drawList.length; i++) {
      const poly = drawList[i];
      ctx.fillStyle = poly.color;
      ctx.strokeStyle = poly.color;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(poly.screen[0].x, poly.screen[0].y);
      for (let j = 1; j < poly.screen.length; j++) {
        ctx.lineTo(poly.screen[j].x, poly.screen[j].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawRunwayAndBase(ctx, cam, w, h, fov, state, time) {
    const y = RUNWAY.deckY;
    const hw = RUNWAY.width * 0.5;

    // 1. Concrete tarmac strip
    const deck = this._clipAndProjectPoly(
      [
        { x: -hw, y, z: RUNWAY.startZ },
        { x: hw, y, z: RUNWAY.startZ },
        { x: hw, y, z: RUNWAY.endZ },
        { x: -hw, y, z: RUNWAY.endZ },
      ],
      cam,
      w,
      h,
      fov
    );
    if (!deck) return;

    ctx.fillStyle = '#2d3540';
    ctx.strokeStyle = '#758599';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(deck.screen[0].x, deck.screen[0].y);
    for (let i = 1; i < deck.screen.length; i++) ctx.lineTo(deck.screen[i].x, deck.screen[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 2. Threshold piano keys & chevron stripes
    const drawStrip = (x0, x1, z0, z1, color) => {
      const p = this._clipAndProjectPoly(
        [
          { x: x0, y: y + 0.08, z: z0 },
          { x: x1, y: y + 0.08, z: z0 },
          { x: x1, y: y + 0.08, z: z1 },
          { x: x0, y: y + 0.08, z: z1 },
        ],
        cam,
        w,
        h,
        fov
      );
      if (!p) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(p.screen[0].x, p.screen[0].y);
      for (let i = 1; i < p.screen.length; i++) ctx.lineTo(p.screen[i].x, p.screen[i].y);
      ctx.closePath();
      ctx.fill();
    };

    // Threshold chevrons / blast pad stripes
    for (let cz = -36; cz <= -12; cz += 14) {
      drawStrip(-14, -4, cz, cz + 6, '#f2c144');
      drawStrip(4, 14, cz, cz + 6, '#f2c144');
    }

    // Piano key threshold markings
    for (let px = -19; px <= 16; px += 6) {
      if (Math.abs(px + 1) < 2) continue;
      drawStrip(px, px + 3, 18, 52, '#edf4ff');
    }

    // Touchdown zone blocks
    drawStrip(-14, -8, 155, 200, '#edf4ff');
    drawStrip(8, 14, 155, 200, '#edf4ff');

    // Dashed centerline down the runway
    for (let cz = 85; cz < RUNWAY.endZ - 50; cz += 58) {
      drawStrip(-1.2, 1.2, cz, cz + 30, '#f4f8ff');
    }

    // 3. Runway edge lights + green threshold bar
    for (let lz = 0; lz <= RUNWAY.endZ; lz += 76) {
      const isThreshold = lz === 0;
      const isEnd = lz > 860;
      const col = isThreshold ? '#47ff9c' : isEnd ? '#ff4e64' : '#ffeaa8';
      for (const sx of [-hw - 1.5, hw + 1.5]) {
        const lp = this._projectWorld({ x: sx, y: y + 0.7, z: lz }, cam, w, h, fov);
        if (lp && lp.z < 2600) {
          const rad = Math.max(1.8, Math.min(6, (1100 / lp.z) * 1.4));
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(lp.x, lp.y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 4. Sequenced ALSF Approach Flashers leading up to threshold
    const pulseIdx = Math.floor((time * 9) % 7);
    for (let i = 0; i < 7; i++) {
      const az = -260 + i * 38;
      const lit = i === pulseIdx;
      const lp = this._projectWorld({ x: 0, y: 12.8, z: az }, cam, w, h, fov);
      if (lp && lp.z < 2600) {
        const rad = lit ? Math.max(3.5, Math.min(11, 1800 / lp.z)) : Math.max(2, Math.min(5, 900 / lp.z));
        ctx.fillStyle = lit ? '#ffffff' : 'rgba(180, 235, 255, 0.72)';
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. PAPI 4-Light Precision Approach Path Indicator (left of touchdown zone)
    const distToPapi = Math.max(20, RUNWAY.papiZ - state.z);
    const glideDeg = Math.atan2(Math.max(0, state.y - y), distToPapi) * RAD_TO_DEG;
    const papiThresholds = [2.1, 2.55, 3.05, 3.55]; // nominal ~2.8-3.0° shows 2 white, 2 red
    for (let i = 0; i < 4; i++) {
      const lx = RUNWAY.papiX - i * 7.2;
      const lp = this._projectWorld({ x: lx, y: y + 1.8, z: RUNWAY.papiZ }, cam, w, h, fov);
      if (lp && lp.z < 2600) {
        const isWhite = glideDeg >= papiThresholds[i];
        const rad = Math.max(3.0, Math.min(9.5, 1750 / lp.z));
        ctx.fillStyle = isWhite ? 'rgba(255, 252, 235, 0.98)' : 'rgba(255, 58, 74, 0.98)';
        ctx.shadowColor = isWhite ? '#fff7cf' : '#ff3a4a';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // 6. Control Tower & Coastal Hangar beside Runway
    this._drawBoxBuilding(ctx, cam, w, h, fov, 78, y, 440, 14, 28, 14, '#c8d6e5', '#68dfff');
    this._drawBoxBuilding(ctx, cam, w, h, fov, 92, y, 540, 38, 15, 48, '#7b8c9f', '#3d4c5e');
  }

  _drawBoxBuilding(ctx, cam, w, h, fov, cx, baseY, cz, sx, sy, sz, wallCol, roofCol) {
    const hx = sx * 0.5;
    const hz = sz * 0.5;
    const top = baseY + sy;
    const faces = [
      {
        pts: [
          { x: cx - hx, y: baseY, z: cz - hz },
          { x: cx + hx, y: baseY, z: cz - hz },
          { x: cx + hx, y: top, z: cz - hz },
          { x: cx - hx, y: top, z: cz - hz },
        ],
        col: wallCol,
      },
      {
        pts: [
          { x: cx - hx, y: baseY, z: cz - hz },
          { x: cx - hx, y: baseY, z: cz + hz },
          { x: cx - hx, y: top, z: cz + hz },
          { x: cx - hx, y: top, z: cz - hz },
        ],
        col: '#8fa3b8',
      },
      {
        pts: [
          { x: cx - hx, y: top, z: cz - hz },
          { x: cx + hx, y: top, z: cz - hz },
          { x: cx + hx, y: top, z: cz + hz },
          { x: cx - hx, y: top, z: cz + hz },
        ],
        col: roofCol,
      },
    ];

    for (const f of faces) {
      const p = this._clipAndProjectPoly(f.pts, cam, w, h, fov);
      if (!p) continue;
      ctx.fillStyle = f.col;
      ctx.beginPath();
      ctx.moveTo(p.screen[0].x, p.screen[0].y);
      for (let i = 1; i < p.screen.length; i++) ctx.lineTo(p.screen[i].x, p.screen[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawClouds(ctx, cam, w, h, fov, isStorm) {
    const baseFill = isStorm ? 'rgba(92, 108, 126, 0.34)' : 'rgba(255, 255, 255, 0.42)';
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      const pt = this._projectWorld({ x: c.x, y: c.y, z: c.z }, cam, w, h, fov);
      if (!pt || pt.z > 5800) continue;
      const rw = c.rx * pt.scale;
      const rh = c.ry * pt.scale;
      if (rw < 6) continue;
      ctx.fillStyle = baseFill;
      ctx.beginPath();
      ctx.ellipse(pt.x, pt.y, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawRingsAndAircraft(ctx, cam, state, mission, uiState, w, h, fov, time) {
    const entities = [];

    // Queue target rings
    const rings = mission.rings || [];
    for (let i = uiState.nextRing; i < rings.length; i++) {
      const r = rings[i];
      const c = this._toCam(r, cam);
      if (c.z > NEAR_Z && c.z < 4200) {
        entities.push({
          type: 'ring',
          z: c.z,
          ring: r,
          isActive: i === uiState.nextRing,
          isNext: i === uiState.nextRing + 1,
        });
      }
    }

    // Queue player aircraft in chase view
    if (uiState.cameraMode !== 'cockpit') {
      const ac = this._toCam(state, cam);
      entities.push({ type: 'aircraft', z: ac.z });
    }

    entities.sort((a, b) => b.z - a.z);
    for (const ent of entities) {
      if (ent.type === 'ring') {
        this._drawTargetRing(ctx, cam, ent.ring, ent.isActive, ent.isNext, w, h, fov, time);
      } else {
        this._drawContrails(ctx, cam, state, w, h, fov);
        this._drawAircraft(ctx, cam, state, w, h, fov, time);
      }
    }
  }

  _drawTargetRing(ctx, cam, ring, isActive, isNext, w, h, fov, time) {
    const segs = 20;
    const outer = [];
    const inner = [];
    const cosY = Math.cos(ring.yaw);
    const sinY = Math.sin(ring.yaw);
    const rOut = ring.radius;
    const rIn = ring.radius * 0.85;

    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2 + (isActive ? time * 0.35 : 0);
      const lx = Math.cos(a);
      const ly = Math.sin(a);
      const pOut = this._projectWorld(
        { x: ring.x + lx * rOut * cosY, y: ring.y + ly * rOut, z: ring.z - lx * rOut * sinY },
        cam,
        w,
        h,
        fov
      );
      const pIn = this._projectWorld(
        { x: ring.x + lx * rIn * cosY, y: ring.y + ly * rIn, z: ring.z - lx * rIn * sinY },
        cam,
        w,
        h,
        fov
      );
      if (pOut && pIn) {
        outer.push(pOut);
        inner.push(pIn);
      }
    }
    if (outer.length < 6) return;

    const strokeCol = isActive ? '#4ef7ff' : isNext ? 'rgba(95, 224, 240, 0.52)' : 'rgba(130, 195, 220, 0.22)';
    const fillCol = isActive ? 'rgba(72, 244, 255, 0.24)' : isNext ? 'rgba(80, 210, 235, 0.1)' : 'rgba(120, 180, 210, 0.05)';

    ctx.save();
    if (isActive) {
      ctx.shadowColor = '#3cf4ff';
      ctx.shadowBlur = 18;
    }

    ctx.fillStyle = fillCol;
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = isActive ? 3.2 : 1.6;

    for (let i = 0; i < outer.length; i++) {
      const n = (i + 1) % outer.length;
      ctx.beginPath();
      ctx.moveTo(outer[i].x, outer[i].y);
      ctx.lineTo(outer[n].x, outer[n].y);
      ctx.lineTo(inner[n].x, inner[n].y);
      ctx.lineTo(inner[i].x, inner[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Active ring golden inner chevrons at cardinal points
    if (isActive) {
      ctx.strokeStyle = '#ffd666';
      ctx.lineWidth = 2.6;
      for (let k = 0; k < 4; k++) {
        const idx = Math.floor((k / 4) * outer.length);
        const o = outer[idx];
        const inn = inner[idx];
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(inn.x, inn.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawContrails(ctx, cam, state, w, h, fov) {
    const drawRibbon = (pts) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = 'rgba(235, 248, 255, 0.38)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const p = this._projectWorld(pts[i], cam, w, h, fov);
        if (!p) continue;
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    };
    drawRibbon(state.trailLeft);
    drawRibbon(state.trailRight);
  }

  _drawAircraft(ctx, cam, state, w, h, fov, time) {
    const { fwd, right, up } = getBasisVectors(state.yaw, state.pitch, state.roll);
    const localToWorld = (lx, ly, lz) => ({
      x: state.x + right.x * lx + up.x * ly + fwd.x * lz,
      y: state.y + right.y * lx + up.y * ly + fwd.y * lz,
      z: state.z + right.z * lx + up.z * ly + fwd.z * lz,
    });

    const flapDrop = state.flaps > 0 ? -0.42 : 0;

    // Shaded twin-tail jet/turboprop geometry in local meters
    const parts = [
      // Fuselage top left & right
      { pts: [[0, 0.4, 6.2], [-0.9, 0.55, 1.0], [0, 0.95, 1.0]], base: [236, 243, 252] },
      { pts: [[0, 0.4, 6.2], [0, 0.95, 1.0], [0.9, 0.55, 1.0]], base: [222, 232, 244] },
      { pts: [[-0.9, 0.55, 1.0], [-1.05, 0.35, -4.6], [0, 0.72, -4.6], [0, 0.95, 1.0]], base: [226, 235, 246] },
      { pts: [[0, 0.95, 1.0], [0, 0.72, -4.6], [1.05, 0.35, -4.6], [0.9, 0.55, 1.0]], base: [208, 220, 235] },
      // Fuselage belly
      { pts: [[0, 0.4, 6.2], [-0.9, -0.35, 1.0], [0.9, -0.35, 1.0]], base: [56, 72, 94] },
      { pts: [[-0.9, -0.35, 1.0], [0.9, -0.35, 1.0], [0.85, -0.4, -4.6], [-0.85, -0.4, -4.6]], base: [42, 56, 76] },
      // Bubble glass canopy
      { pts: [[0, 0.92, 3.3], [-0.52, 0.72, 1.2], [0, 1.48, 1.3]], base: [52, 198, 245] },
      { pts: [[0, 0.92, 3.3], [0, 1.48, 1.3], [0.52, 0.72, 1.2]], base: [34, 152, 212] },
      { pts: [[-0.52, 0.72, 1.2], [-0.45, 0.72, -0.6], [0, 1.48, 1.3]], base: [44, 176, 230] },
      { pts: [[0.52, 0.72, 1.2], [0, 1.48, 1.3], [0.45, 0.72, -0.6]], base: [28, 134, 196] },
      // Swept Main Wings (with cyan accent wingtip trim & flap drop)
      { pts: [[-0.85, 0.18, 1.5], [-7.4, 0.35 + flapDrop * 0.25, -2.2], [-7.2, 0.25 + flapDrop * 0.6, -3.5], [-0.95, 0.12, -2.4]], base: [228, 238, 248] },
      { pts: [[0.85, 0.18, 1.5], [0.95, 0.12, -2.4], [7.2, 0.25 + flapDrop * 0.6, -3.5], [7.4, 0.35 + flapDrop * 0.25, -2.2]], base: [212, 224, 238] },
      // Wingtip accent pods
      { pts: [[-6.1, 0.34, -1.7], [-7.5, 0.38, -2.2], [-7.3, 0.28, -3.6], [-5.9, 0.25, -3.1]], base: [42, 218, 255] },
      { pts: [[6.1, 0.34, -1.7], [5.9, 0.25, -3.1], [7.3, 0.28, -3.6], [7.5, 0.38, -2.2]], base: [42, 218, 255] },
      // Horizontal tailplanes
      { pts: [[-0.9, 0.28, -3.3], [-3.4, 0.25, -4.9], [-3.2, 0.22, -5.7], [-0.85, 0.22, -4.9]], base: [195, 210, 228] },
      { pts: [[0.9, 0.28, -3.3], [0.85, 0.22, -4.9], [3.2, 0.22, -5.7], [3.4, 0.25, -4.9]], base: [182, 198, 218] },
      // Twin canted vertical stabilizers (signature twin-tail Valkyrie silhouette!)
      { pts: [[-0.9, 0.45, -2.9], [-1.7, 2.35, -4.6], [-1.55, 2.35, -5.5], [-0.88, 0.45, -4.9]], base: [44, 72, 108] },
      { pts: [[0.9, 0.45, -2.9], [0.88, 0.45, -4.9], [1.55, 2.35, -5.5], [1.7, 2.35, -4.6]], base: [56, 88, 128] },
      // Twin tail gold squadron tips
      { pts: [[-1.48, 1.85, -4.15], [-1.72, 2.38, -4.62], [-1.56, 2.38, -5.52], [-1.36, 1.85, -5.2]], base: [255, 188, 56] },
      { pts: [[1.48, 1.85, -4.15], [1.36, 1.85, -5.2], [1.56, 2.38, -5.52], [1.72, 2.38, -4.62]], base: [255, 188, 56] },
    ];

    // Retractable tricycle landing gear when deployed
    if (state.gearAnim > 0.12) {
      const g = state.gearAnim;
      parts.push(
        { pts: [[-1.3, -0.1, -0.6], [-1.45, -1.55 * g, -0.7], [-1.15, -1.55 * g, -0.7]], base: [34, 40, 48] },
        { pts: [[1.3, -0.1, -0.6], [1.15, -1.55 * g, -0.7], [1.45, -1.55 * g, -0.7]], base: [34, 40, 48] },
        { pts: [[-0.12, -0.25, 3.1], [0.12, -0.25, 3.1], [0, -1.5 * g, 3.2]], base: [34, 40, 48] }
      );
    }

    const projected = [];
    for (const part of parts) {
      const worldPts = part.pts.map(([lx, ly, lz]) => localToWorld(lx, ly, lz));
      const p = this._clipAndProjectPoly(worldPts, cam, w, h, fov);
      if (!p) continue;

      // Compute face normal in world space for crisp directional sunlight
      const e1 = {
        x: worldPts[1].x - worldPts[0].x,
        y: worldPts[1].y - worldPts[0].y,
        z: worldPts[1].z - worldPts[0].z,
      };
      const e2 = {
        x: worldPts[2].x - worldPts[0].x,
        y: worldPts[2].y - worldPts[0].y,
        z: worldPts[2].z - worldPts[0].z,
      };
      const n = this._norm({
        x: e1.y * e2.z - e1.z * e2.y,
        y: e1.z * e2.x - e1.x * e2.z,
        z: e1.x * e2.y - e1.y * e2.x,
      });
      const light = 0.55 + Math.abs(n.x * this.sunDir.x + n.y * this.sunDir.y + n.z * this.sunDir.z) * 0.52;
      const r = Math.min(255, Math.round(part.base[0] * light));
      const g = Math.min(255, Math.round(part.base[1] * light));
      const b = Math.min(255, Math.round(part.base[2] * light));

      projected.push({ screen: p.screen, avgZ: p.avgZ, color: `rgb(${r},${g},${b})` });
    }

    projected.sort((a, b) => b.avgZ - a.avgZ);
    for (const poly of projected) {
      ctx.fillStyle = poly.color;
      ctx.strokeStyle = 'rgba(15, 28, 45, 0.42)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(poly.screen[0].x, poly.screen[0].y);
      for (let i = 1; i < poly.screen.length; i++) ctx.lineTo(poly.screen[i].x, poly.screen[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Twin engine afterburner plumes
    const power = state.throttle * 0.7 + (state.afterburner ? 0.9 : 0);
    if (power > 0.08) {
      const flicker = 0.88 + 0.12 * Math.sin(time * 38);
      const flameLen = (1.6 + power * 3.4) * flicker;
      for (const nx of [-0.52, 0.52]) {
        const nozzle = this._projectWorld(localToWorld(nx, 0.12, -4.75), cam, w, h, fov);
        const tip = this._projectWorld(localToWorld(nx, 0.12, -4.75 - flameLen), cam, w, h, fov);
        if (nozzle && tip) {
          const rOuter = Math.max(4, Math.min(18, nozzle.scale * (0.42 + power * 0.28)));
          const grad = ctx.createLinearGradient(nozzle.x, nozzle.y, tip.x, tip.y);
          grad.addColorStop(0, state.afterburner ? '#ffffff' : '#ffe39a');
          grad.addColorStop(0.45, state.afterburner ? '#44efff' : '#ff9838');
          grad.addColorStop(1, 'rgba(60, 210, 255, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(nozzle.x, nozzle.y, rOuter, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = grad;
          ctx.lineWidth = rOuter * 1.15;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(nozzle.x, nozzle.y);
          ctx.lineTo(tip.x, tip.y);
          ctx.stroke();
        }
      }
    }

    // Wingtip navigation lights (Port Red, Starboard Green)
    const portNav = this._projectWorld(localToWorld(-7.4, 0.35, -2.5), cam, w, h, fov);
    const stbdNav = this._projectWorld(localToWorld(7.4, 0.35, -2.5), cam, w, h, fov);
    if (portNav) {
      ctx.fillStyle = '#ff3d5e';
      ctx.beginPath();
      ctx.arc(portNav.x, portNav.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (stbdNav) {
      ctx.fillStyle = '#2ef28a';
      ctx.beginPath();
      ctx.arc(stbdNav.x, stbdNav.y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawCockpitFrame(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = '#0c1624';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.72);
    ctx.quadraticCurveTo(w * 0.14, h * 0.18, w * 0.5, h * 0.04);
    ctx.quadraticCurveTo(w * 0.86, h * 0.18, w, h * 0.72);
    ctx.stroke();

    // Lower dashboard glare shield
    ctx.fillStyle = 'rgba(9, 17, 29, 0.88)';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.86);
    ctx.quadraticCurveTo(w * 0.5, h * 0.77, w, h * 0.86);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawGlassHUD(ctx, cam, state, mission, uiState, w, h, fov) {
    const cx = w * 0.5;
    const cy = h * 0.5;
    const hudCol = '#66ffb8';
    const cyanCol = '#58f2ff';
    const warnCol = '#ffca58';
    const critCol = '#ff5468';

    const airspeedKts = Math.round(state.airspeed * 1.94384);
    const altFt = Math.max(0, Math.round(state.y * 3.28084));
    const aglFt = Math.max(0, Math.round((state.y - Math.max(0, getTerrainHeight(state.x, state.z))) * 3.28084));
    const vsiFpm = Math.round(state.verticalSpeed * 196.85);
    const hdgDeg = ((Math.round(state.yaw * RAD_TO_DEG) % 360) + 360) % 360;

    ctx.save();
    ctx.font = '700 13px "Consolas", "Courier New", monospace';
    ctx.textBaseline = 'middle';

    // 1. Center Pitch Ladder, Artificial Horizon & Bank Angle Arc
    const hudRoll = uiState.cameraMode === 'cockpit' ? state.roll : state.roll * 0.48;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 210, cy - 165, 420, 330);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate(-hudRoll);
    const pxPerDeg = 5.4;
    const pitchDeg = state.pitch * RAD_TO_DEG;

    for (let deg = -30; deg <= 30; deg += 5) {
      const yOff = (pitchDeg - deg) * pxPerDeg;
      if (Math.abs(yOff) > 170) continue;
      const isHorizon = deg === 0;
      const span = isHorizon ? 145 : 64;
      ctx.strokeStyle = isHorizon ? 'rgba(90, 244, 255, 0.85)' : 'rgba(102, 255, 184, 0.72)';
      ctx.lineWidth = isHorizon ? 2.0 : 1.4;
      if (deg < 0) ctx.setLineDash([6, 5]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(-span, yOff);
      ctx.lineTo(-24, yOff);
      ctx.moveTo(24, yOff);
      ctx.lineTo(span, yOff);
      ctx.stroke();

      if (deg !== 0 && deg % 10 === 0) {
        ctx.setLineDash([]);
        ctx.fillStyle = hudCol;
        ctx.textAlign = 'right';
        ctx.fillText(String(deg), -span - 6, yOff);
        ctx.textAlign = 'left';
        ctx.fillText(String(deg), span + 6, yOff);
      }
    }
    ctx.setLineDash([]);
    ctx.restore();

    // Bank angle arc & aircraft roll pointer
    ctx.strokeStyle = 'rgba(88, 242, 255, 0.52)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, 138, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.stroke();
    const ptrAng = -Math.PI * 0.5 - state.roll;
    const ptrX = cx + Math.cos(ptrAng) * 130;
    const ptrY = cy + Math.sin(ptrAng) * 130;
    ctx.fillStyle = warnCol;
    ctx.beginPath();
    ctx.arc(ptrX, ptrY, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Fixed boresight (-v-) and flight-path vector (-o-)
    ctx.strokeStyle = warnCol;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 16, cy);
    ctx.lineTo(cx - 6, cy);
    ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx + 6, cy);
    ctx.lineTo(cx + 16, cy);
    ctx.stroke();

    const fpvY = cy - state.aoa * RAD_TO_DEG * 4.5;
    ctx.strokeStyle = hudCol;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, Math.max(cy - 90, Math.min(cy + 90, fpvY)), 7, 0, Math.PI * 2);
    ctx.moveTo(cx - 15, fpvY);
    ctx.lineTo(cx - 7, fpvY);
    ctx.moveTo(cx + 7, fpvY);
    ctx.lineTo(cx + 15, fpvY);
    ctx.stroke();

    // 2. Top Heading Compass Tape (HDG)
    const tapeW = 340;
    const tapeX = cx - tapeW * 0.5;
    const tapeY = 58;
    ctx.fillStyle = 'rgba(6, 16, 28, 0.58)';
    ctx.strokeStyle = 'rgba(88, 242, 255, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.fillRect(tapeX, tapeY, tapeW, 34);
    ctx.strokeRect(tapeX, tapeY, tapeW, 34);

    ctx.save();
    ctx.beginPath();
    ctx.rect(tapeX, tapeY, tapeW, 34);
    ctx.clip();
    const pxPerHdg = 4.2;
    for (let d = -45; d <= 45; d += 5) {
      const markHdg = ((Math.round((hdgDeg + d) / 5) * 5) % 360 + 360) % 360;
      const diff = ((markHdg - hdgDeg + 540) % 360) - 180;
      const mx = cx + diff * pxPerHdg;
      const isMajor = markHdg % 15 === 0;
      ctx.strokeStyle = hudCol;
      ctx.beginPath();
      ctx.moveTo(mx, tapeY + 34);
      ctx.lineTo(mx, tapeY + (isMajor ? 22 : 28));
      ctx.stroke();
      if (isMajor) {
        const card = markHdg === 0 ? 'N' : markHdg === 90 ? 'E' : markHdg === 180 ? 'S' : markHdg === 270 ? 'W' : String(markHdg).padStart(3, '0');
        ctx.fillStyle = cyanCol;
        ctx.textAlign = 'center';
        ctx.fillText(card, mx, tapeY + 12);
      }
    }
    ctx.restore();

    // Center HDG box
    ctx.fillStyle = 'rgba(8, 24, 40, 0.92)';
    ctx.strokeStyle = cyanCol;
    ctx.fillRect(cx - 34, tapeY + 36, 68, 22);
    ctx.strokeRect(cx - 34, tapeY + 36, 68, 22);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(`HDG ${String(hdgDeg).padStart(3, '0')}`, cx, tapeY + 47);

    // 3. Left Airspeed Tape (KTS)
    const leftX = 115;
    const tapeTop = cy - 135;
    const tapeH = 270;
    ctx.fillStyle = 'rgba(6, 16, 28, 0.56)';
    ctx.strokeStyle = 'rgba(102, 255, 184, 0.35)';
    ctx.fillRect(leftX, tapeTop, 82, tapeH);
    ctx.strokeRect(leftX, tapeTop, 82, tapeH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(leftX, tapeTop, 82, tapeH);
    ctx.clip();
    const minKts = Math.floor((airspeedKts - 90) / 20) * 20;
    for (let k = minKts; k <= airspeedKts + 90; k += 20) {
      if (k < 0) continue;
      const ky = cy - (k - airspeedKts) * 1.45;
      ctx.strokeStyle = hudCol;
      ctx.beginPath();
      ctx.moveTo(leftX + 64, ky);
      ctx.lineTo(leftX + 82, ky);
      ctx.stroke();
      ctx.fillStyle = hudCol;
      ctx.textAlign = 'right';
      ctx.fillText(String(k), leftX + 58, ky);
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(6, 20, 35, 0.95)';
    ctx.strokeStyle = state.isStalling ? critCol : cyanCol;
    ctx.fillRect(leftX - 8, cy - 15, 92, 30);
    ctx.strokeRect(leftX - 8, cy - 15, 92, 30);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '800 14px "Consolas", monospace';
    ctx.fillText(`${airspeedKts} KTS`, leftX + 38, cy);
    ctx.font = '700 11px "Consolas", monospace';
    ctx.fillStyle = cyanCol;
    ctx.fillText('IAS', leftX + 41, tapeTop - 10);

    // 4. Right Altitude Tape (ALT FT) + VSI
    const rightX = w - 210;
    ctx.fillStyle = 'rgba(6, 16, 28, 0.56)';
    ctx.strokeStyle = 'rgba(102, 255, 184, 0.35)';
    ctx.fillRect(rightX, tapeTop, 88, tapeH);
    ctx.strokeRect(rightX, tapeTop, 88, tapeH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rightX, tapeTop, 88, tapeH);
    ctx.clip();
    const minAlt = Math.floor((altFt - 400) / 100) * 100;
    for (let a = minAlt; a <= altFt + 400; a += 100) {
      if (a < 0) continue;
      const ay = cy - (a - altFt) * 0.33;
      ctx.strokeStyle = hudCol;
      ctx.beginPath();
      ctx.moveTo(rightX, ay);
      ctx.lineTo(rightX + 16, ay);
      ctx.stroke();
      ctx.fillStyle = hudCol;
      ctx.textAlign = 'left';
      ctx.fillText(String(a), rightX + 22, ay);
    }
    ctx.restore();

    ctx.fillStyle = 'rgba(6, 20, 35, 0.95)';
    ctx.strokeStyle = cyanCol;
    ctx.fillRect(rightX - 4, cy - 15, 96, 30);
    ctx.strokeRect(rightX - 4, cy - 15, 96, 30);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '800 14px "Consolas", monospace';
    ctx.fillText(`${altFt} FT`, rightX + 44, cy);
    ctx.font = '700 11px "Consolas", monospace';
    ctx.fillStyle = cyanCol;
    ctx.fillText('ALT FT', rightX + 44, tapeTop - 10);

    // Vertical Speed Indicator (VSI)
    const vsiText = `${vsiFpm >= 0 ? '+' : ''}${vsiFpm} FPM`;
    ctx.fillStyle = 'rgba(6, 16, 28, 0.78)';
    ctx.fillRect(rightX, tapeTop + tapeH + 8, 92, 38);
    ctx.strokeStyle = Math.abs(vsiFpm) > 900 ? warnCol : 'rgba(102, 255, 184, 0.35)';
    ctx.strokeRect(rightX, tapeTop + tapeH + 8, 92, 38);
    ctx.fillStyle = hudCol;
    ctx.textAlign = 'center';
    ctx.fillText(`VSI ${vsiText}`, rightX + 46, tapeTop + tapeH + 20);
    ctx.fillStyle = '#a4c8e4';
    ctx.fillText(`AGL ${aglFt} FT`, rightX + 46, tapeTop + tapeH + 36);

    // 5. Bottom-Left Engine, Fuel, Hull & Gear/Flaps Systems Panel
    const sysX = 24;
    const sysY = h - 148;
    ctx.fillStyle = 'rgba(6, 16, 28, 0.68)';
    ctx.strokeStyle = 'rgba(88, 242, 255, 0.32)';
    ctx.fillRect(sysX, sysY, 214, 118);
    ctx.strokeRect(sysX, sysY, 214, 118);

    const drawBar = (label, pct, by, col) => {
      ctx.fillStyle = '#cbe2f6';
      ctx.textAlign = 'left';
      ctx.fillText(label, sysX + 10, by);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(sysX + 54, by - 5, 108, 10);
      ctx.fillStyle = col;
      ctx.fillRect(sysX + 54, by - 5, 108 * Math.max(0, Math.min(1, pct / 100)), 10);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(pct)}%`, sysX + 204, by);
    };

    const thrPct = Math.round(state.throttle * 100);
    drawBar('THR', thrPct, sysY + 20, state.afterburner ? '#ff9f43' : cyanCol);
    drawBar('FUEL', state.fuel, sysY + 42, state.fuel < 22 ? critCol : hudCol);
    drawBar('HULL', state.hull, sysY + 64, state.hull < 40 ? critCol : '#4fe0ff');

    // Gear, Flaps, Airbrake, Afterburner pills
    const drawPill = (text, px, py, active, col = hudCol) => {
      ctx.fillStyle = active ? 'rgba(20, 62, 54, 0.85)' : 'rgba(18, 28, 42, 0.72)';
      ctx.strokeStyle = active ? col : 'rgba(140, 175, 205, 0.32)';
      ctx.fillRect(px, py, 60, 20);
      ctx.strokeRect(px, py, 60, 20);
      ctx.fillStyle = active ? col : '#8ca8c2';
      ctx.textAlign = 'center';
      ctx.fillText(text, px + 30, py + 10);
    };
    drawPill(state.gearDown ? 'GEAR DN' : 'GEAR UP', sysX + 10, sysY + 86, state.gearDown, warnCol);
    drawPill(state.flaps > 0 ? 'FLAPS 20' : 'FLAPS 0', sysX + 76, sysY + 86, state.flaps > 0, cyanCol);
    drawPill(state.afterburner ? 'BOOST' : state.airbrake ? 'BRAKE' : 'CRUISE', sysX + 142, sysY + 86, state.afterburner || state.airbrake, state.afterburner ? '#ff9f43' : warnCol);

    // 6. Top-Right Mission Telemetry Card (Ring counter, Timer, Target Range)
    const activeTarget = mission.mode === 'landing' && uiState.nextRing >= mission.rings.length
      ? { x: 0, y: RUNWAY.deckY + 4, z: 120, label: 'RUNWAY 36' }
      : mission.rings[uiState.nextRing];

    const distTarget = activeTarget
      ? Math.round(Math.hypot(activeTarget.x - state.x, activeTarget.y - state.y, activeTarget.z - state.z))
      : 0;

    const cardW = 216;
    const cardX = w - cardW - 24;
    const cardY = h - 148;
    ctx.fillStyle = 'rgba(6, 16, 28, 0.68)';
    ctx.strokeStyle = 'rgba(88, 242, 255, 0.32)';
    ctx.fillRect(cardX, cardY, cardW, 118);
    ctx.strokeRect(cardX, cardY, cardW, 118);

    ctx.textAlign = 'left';
    ctx.fillStyle = cyanCol;
    ctx.fillText('MISSION TELEMETRY', cardX + 12, cardY + 18);

    const counterLabel = mission.mode === 'landing'
      ? (uiState.nextRing < mission.rings.length ? `GATES ${uiState.nextRing}/${mission.rings.length}` : 'FINAL APPR')
      : `RINGS ${uiState.nextRing}/${mission.rings.length}`;

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 16px "Consolas", monospace';
    ctx.fillText(counterLabel, cardX + 12, cardY + 44);

    ctx.font = '700 12px "Consolas", monospace';
    const remSec = Math.max(0, Math.ceil(uiState.timeRemaining));
    const mins = Math.floor(remSec / 60);
    const secs = String(remSec % 60).padStart(2, '0');
    ctx.fillStyle = remSec < 25 ? critCol : warnCol;
    ctx.textAlign = 'right';
    ctx.fillText(`T-${mins}:${secs}`, cardX + cardW - 12, cardY + 44);

    ctx.textAlign = 'left';
    ctx.fillStyle = hudCol;
    const distStr = distTarget >= 1000 ? `${(distTarget / 1852).toFixed(2)} NM` : `${distTarget} M`;
    ctx.fillText(`TGT: ${activeTarget ? activeTarget.label : 'CLEAR'}`, cardX + 12, cardY + 70);
    ctx.fillStyle = '#dcefff';
    ctx.fillText(`RNG: ${distStr}`, cardX + 12, cardY + 90);
    ctx.textAlign = 'right';
    ctx.fillStyle = warnCol;
    ctx.fillText(`PTS ${uiState.score}`, cardX + cardW - 12, cardY + 90);

    // 7. Target Waypoint Diamond & ILS Glide-Slope Crosshair on Runway Approach
    if (activeTarget) {
      const tp = this._projectWorld(activeTarget, cam, w, h, fov);
      if (tp) {
        ctx.strokeStyle = warnCol;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(tp.x, tp.y - 12);
        ctx.lineTo(tp.x + 12, tp.y);
        ctx.lineTo(tp.x, tp.y + 12);
        ctx.lineTo(tp.x - 12, tp.y);
        ctx.closePath();
        ctx.stroke();
      }
    }

    if (mission.mode === 'landing' || (state.gearDown && Math.abs(state.x) < 420 && state.z < 500 && state.z > -2200)) {
      const distRunway = Math.max(20, 60 - state.z);
      const idealAlt = RUNWAY.deckY + Math.tan(RUNWAY.glideSlopeDeg * DEG) * distRunway;
      const gsError = Math.max(-1, Math.min(1, (state.y - idealAlt) / 36));
      const locError = Math.max(-1, Math.min(1, state.x / 120));

      // Glide-slope / localizer scale around center reticle
      ctx.strokeStyle = 'rgba(255, 202, 88, 0.78)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(cx - 56, cy - 56, 112, 112);

      // Localizer vertical needle
      ctx.beginPath();
      ctx.moveTo(cx - locError * 46, cy - 48);
      ctx.lineTo(cx - locError * 46, cy + 48);
      // Glide-slope horizontal needle
      ctx.moveTo(cx - 48, cy + gsError * 46);
      ctx.lineTo(cx + 48, cy + gsError * 46);
      ctx.stroke();

      ctx.fillStyle = Math.abs(gsError) < 0.25 && Math.abs(locError) < 0.25 ? hudCol : warnCol;
      ctx.textAlign = 'center';
      ctx.font = '700 11px "Consolas", monospace';
      ctx.fillText('ILS GLIDE SLOPE 3.2 DEG', cx, cy + 72);
    }

    // 8. Stall Warning Banner
    if (state.isStalling) {
      ctx.fillStyle = 'rgba(255, 52, 72, 0.85)';
      ctx.fillRect(cx - 95, cy - 118, 190, 28);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '900 15px "Consolas", monospace';
      ctx.fillText('STALL WARNING', cx, cy - 104);
    }

    ctx.restore();
  }
}
