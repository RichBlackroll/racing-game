// Geometry-only scenery: coordinates and collider bases are local to each site.
// Eight shared colors keep material-batched sites small; no canvas signs needed.
const C = {
  cream: 0xffedcc,
  teal: 0x288f91,
  coral: 0xf07868,
  yellow: 0xf4c958,
  dark: 0x283f50,
  silver: 0xb8c7cf,
  glass: 0x9edee5,
  green: 0x77b878,
};
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

function panel(s, color, points) {
  // Roof undersides and flags stay visible even with front-sided helper materials.
  s.triangle(color, points);
  s.triangle(color, [points[2], points[1], points[0]]);
}

function wheel(s, x, y, z, radius, width, side) {
  s.cylinder(C.dark, x, y, z, radius, radius, width, 0, 0, HALF_PI);
  s.torus(C.dark, x + side * (width / 2 - 0.08), y, z,
    radius * 0.84, radius * 0.1, 0, HALF_PI);
  s.cylinder(C.cream, x + side * (width / 2 + 0.04), y, z,
    radius * 0.55, radius * 0.55, 0.12, 0, 0, HALF_PI);
  s.cylinder(C.yellow, x + side * (width / 2 + 0.13), y, z,
    radius * 0.2, radius * 0.2, 0.12, 0, 0, HALF_PI);
}

function solarArray(s, x, y, z, width = 10) {
  for (const side of [-1, 1]) {
    s.cylinder(C.silver, x + side * width * 0.3, y + 2, z, 0.18, 0.3, 4);
    s.solid(x + side * width * 0.3, z, 0.35, 0.35, 4, y);
  }
  // A single anchored panel, not a ground-following patchwork of cells.
  s.box(C.cream, x, y + 4.2, z, width, 0.3, 5, -0.25);
  for (let row = 0; row < 2; row++) for (let column = 0; column < 5; column++) {
    const dz = (row - 0.5) * 2.3;
    s.box(C.teal, x + (column - 2) * (width - 0.5) / 5,
      y + 4.39 + dz * Math.sin(0.25), z + dz * Math.cos(0.25),
      (width - 0.9) / 5, 0.08, 2.05, -0.25);
  }
  s.solid(x, z, width / 2, 2.5, 1.6, y + 3.4);
}

// The same lovingly maintained toy-truck chassis serves the repair yard and tow bay.
function workshopTruck(s, x, y, z, color, openHood = false, missingWheel = false) {
  s.box(C.dark, x, y + 2, z, 4.8, 0.65, 10);
  s.box(color, x, y + 2.65, z - 2.2, 5, 0.5, 5.2);
  for (const side of [-1, 1]) {
    s.box(color, x + side * 2.35, y + 3.4, z - 2.2, 0.3, 1.2, 5.2);
    s.box(C.cream, x + side * 2.37, y + 3.6, z - 2.2, 0.34, 0.18, 4.8);
    s.beam(C.silver, [x + side * 2, y + 3.1, z + 0.5],
      [x + side * 2, y + 5.8, z + 0.5], 0.15);
    s.beam(C.cream, [x + side * 2, y + 3.1, z + 3.1],
      [x + side * 2, y + 5.8, z + 2.8], 0.16);
    s.box(color, x + side * 2.2, y + 3.25, z + 1.8, 0.3, 0.9, 3);
    s.box(C.cream, x + side * 2.38, y + 3.55, z + 1, 0.12, 0.13, 0.6);
    s.box(C.dark, x + side * 1.05, y + 3.45, z + 1.4, 1.2, 0.35, 1.2);
    s.box(C.teal, x + side * 1.05, y + 4.05, z + 0.9, 1.2, 1.25, 0.3);
    s.box(C.silver, x + side * 2.7, y + 4.8, z + 2.6, 0.5, 0.7, 0.3);
    for (const dz of [-3.2, 3.2]) {
      if (missingWheel && side === 1 && dz === 3.2) {
        s.cylinder(C.silver, x + 2.85, y + 1.5, z + dz, 0.48, 0.48, 0.7, 0, 0, HALF_PI);
        s.box(C.yellow, x + 2.5, y + 0.35, z + dz, 1.8, 0.7, 1.7);
        s.cylinder(C.silver, x + 2.5, y + 0.95, z + dz, 0.18, 0.32, 0.6);
      } else {
        wheel(s, x + side * 2.8, y + 1.5, z + dz, 1.5, 0.9, side);
      }
    }
  }
  s.box(color, x, y + 3.4, z - 4.75, 5, 1.2, 0.3);
  s.box(C.cream, x, y + 5.9, z + 1.7, 4.8, 0.35, 3.5);
  s.box(C.glass, x, y + 4.65, z + 3.05, 3.75, 1.65, 0.12, -0.1);
  s.beam(C.cream, [x, y + 3.85, z + 3.1], [x, y + 5.5, z + 2.95], 0.08);
  s.torus(C.dark, x - 1.05, y + 4.15, z + 2.65, 0.4, 0.09, -0.6);
  s.box(color, x, y + 3.2, z + 4.3, 4.6, 1, 2.1);
  if (openHood) {
    s.box(C.dark, x, y + 3.82, z + 4.35, 3.8, 0.25, 1.6);
    for (let i = -1; i <= 1; i++) {
      s.cylinder(C.silver, x + i * 0.8, y + 4.08, z + 4.4, 0.25, 0.25, 0.4);
    }
    s.box(color, x, y + 4.55, z + 4.15, 4.65, 0.2, 2.15, -0.95);
    s.beam(C.yellow, [x + 1.7, y + 3.8, z + 4.7], [x + 1.7, y + 5.3, z + 4.7], 0.07);
  } else {
    s.box(C.cream, x, y + 3.75, z + 4.3, 4.6, 0.15, 2.1);
  }
  s.box(C.silver, x, y + 2.45, z + 5.55, 5.3, 0.5, 0.45);
  s.box(C.dark, x, y + 3.1, z + 5.38, 2.4, 0.65, 0.1);
  for (let i = -1; i <= 1; i++) s.box(C.silver, x + i * 0.65, y + 3.1, z + 5.46, 0.12, 0.5, 0.1);
  for (const side of [-1, 1]) {
    s.sphere(C.yellow, x + side * 1.8, y + 3.2, z + 5.4, 0.43, 0.38, 0.16);
    s.box(C.coral, x + side * 1.8, y + 3.1, z - 4.94, 0.55, 0.35, 0.12);
  }
  s.solid(x, z + 0.35, 3.5, 5.45, 6.15, y);
}

export function decorateMoonLandmarks(kit) {
  kit.site("Moonbeam Launch Garden", -270, -225, 32, (s) => {
    const x = -5, z = 0;
    const y = s.ground(x, z);
    s.disc(C.silver, x, z, 12);
    s.cylinder(C.dark, x, y + 3, z, 1.9, 2.8, 4);
    s.cylinder(C.silver, x, y + 5.6, z, 3.8, 2.8, 2.8);
    s.cylinder(C.cream, x, y + 19.5, z, 3.8, 3.8, 25);
    s.cone(C.coral, x, y + 36, z, 3.8, 8);
    for (const h of [9, 18, 29]) {
      s.cylinder(h === 18 ? C.teal : C.coral, x, y + h, z, 3.84, 3.84, 0.65);
      s.torus(C.silver, x, y + h + 0.55, z, 3.81, 0.08, HALF_PI);
    }
    for (const side of [-1, 1]) {
      const bx = x + side * 5.4;
      s.cylinder(C.cream, bx, y + 11.5, z, 1.65, 1.65, 17);
      s.cone(C.teal, bx, y + 22, z, 1.65, 4);
      s.cylinder(C.coral, bx, y + 6, z, 1.7, 1.7, 1.2);
      s.cylinder(C.dark, bx, y + 2, z, 0.9, 1.4, 2);
      s.beam(C.silver, [x + side * 3.5, y + 15, z], [bx, y + 15, z], 0.35);
      s.solid(bx, z, 1.7, 1.7, 24, y);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * HALF_PI;
      const dx = Math.cos(a), dz = Math.sin(a);
      panel(s, i % 2 ? C.teal : C.coral, [
        [x + dx * 3.6, y + 13, z + dz * 3.6],
        [x + dx * 7.8, y + 2, z + dz * 7.8],
        [x + dx * 3.6, y + 3, z + dz * 3.6],
      ]);
      s.beam(C.cream, [x + dx * 3.6, y + 13, z + dz * 3.6],
        [x + dx * 7.8, y + 2, z + dz * 7.8], 0.12);
      s.solid(x + dx * 5.7, z + dz * 5.7, Math.abs(dx) * 2.1 + 0.18,
        Math.abs(dz) * 2.1 + 0.18, 12, y + 1);
    }
    for (const a of [0.3, HALF_PI, Math.PI - 0.3]) {
      const wx = x + Math.cos(a) * 3.55, wz = z + Math.sin(a) * 3.55;
      s.sphere(C.teal, wx, y + 26, wz, 0.88, 1.05, 0.88);
      s.sphere(C.glass, x + Math.cos(a) * 3.94, y + 26.1, z + Math.sin(a) * 3.94, 0.6, 0.72, 0.6);
    }
    s.solid(x, z, 3.9, 3.9, 40, y);

    const gx = -17, gz = -4;
    const gy = s.ground(gx, gz);
    for (const dx of [-2, 2]) for (const dz of [-2, 2]) {
      s.box(C.teal, gx + dx, gy + 15, gz + dz, 0.45, 30, 0.45);
      s.box(C.yellow, gx + dx, gy + 0.4, gz + dz, 1.5, 0.8, 1.5);
    }
    s.solid(gx, gz + 0.15, 2.8, 2.9, 30, gy);
    for (let h = 5; h <= 30; h += 5) {
      s.beam(C.silver, [gx - 2, gy + h, gz - 2], [gx + 2, gy + h, gz - 2], 0.15);
      s.beam(C.silver, [gx - 2, gy + h, gz + 2], [gx + 2, gy + h, gz + 2], 0.15);
      s.beam(C.teal, [gx - 2, gy + h - 5, gz - 2], [gx + 2, gy + h, gz - 2], 0.12);
    }
    s.beam(C.yellow, [gx + 2, gy + 28, gz], [x - 3.6, y + 28, z], 0.38);
    for (const dx of [-0.65, 0.65]) s.beam(C.yellow,
      [gx + dx, gy + 0.5, gz + 2.3], [gx + dx, gy + 29, gz + 2.3], 0.08);
    for (let h = 1; h <= 28; h += 2) s.beam(C.silver,
      [gx - 0.65, gy + h, gz + 2.3], [gx + 0.65, gy + h, gz + 2.3], 0.075);
    const sy = s.ground(16, -10);
    solarArray(s, 16, sy, -10, 10);
    const fy = s.ground(13, 13);
    s.cylinder(C.silver, 13, fy + 4, 13, 0.12, 0.18, 8);
    panel(s, C.coral, [[13, fy + 8, 13], [17, fy + 7.5, 13], [13, fy + 6, 13]]);
    s.solid(13, 13, 0.25, 0.25, 8, fy);
  });

  kit.site("Little Orbit Village", 270, -230, 35, (s) => {
    s.disc(C.silver, 0, 0, 28);
    const bases = [];
    for (const side of [-1, 1]) {
      const x = side * 13, z = 0;
      const y = s.foundation(C.silver, x, z, 8.5, 22, 0.45);
      bases.push(y);
      s.cylinder(C.cream, x, y + 5, z, 4, 4, 18, HALF_PI);
      for (const dz of [-9, 9]) s.sphere(C.cream, x, y + 5, z + dz, 4, 4, 1.8);
      for (const dz of [-6, 0, 6]) s.torus(C.teal, x, y + 5, z + dz, 4.03, 0.1);
      for (const dz of [-5, 0, 5]) {
        s.box(C.teal, x - side * 3.86, y + 5.3, z + dz, 0.28, 2.4, 2.8);
        s.box(C.glass, x - side * 4.03, y + 5.4, z + dz, 0.12, 1.8, 2.15);
        s.box(C.cream, x - side * 4.12, y + 5.4, z + dz, 0.1, 1.8, 0.12);
      }
      s.cylinder(C.teal, x, y + 4, z + 11, 2.2, 2.2, 1.4, HALF_PI);
      s.torus(C.yellow, x, y + 4, z + 11.75, 1.85, 0.18);
      s.cylinder(C.silver, x, y + 4, z + 11.77, 1.65, 1.65, 0.12, HALF_PI);
      s.box(C.dark, x, y + 4, z + 11.85, 0.09, 2.7, 0.08);
      s.sphere(C.glass, x, y + 4.6, z + 11.92, 0.65, 0.45, 0.08);
      s.box(C.coral, x + 1.2, y + 3.7, z + 11.88, 0.3, 0.5, 0.12);
      for (const dx of [-2.7, 2.7]) for (const dz of [-6, 6]) {
        s.cylinder(C.teal, x + dx, y + 1, z + dz, 0.35, 0.55, 2);
      }
      s.beam(C.silver, [x + side * 3, y + 7.8, z - 7], [x + side * 3, y + 7.8, z + 7], 0.2);
      s.solid(x, z + 0.6, 4.2, 11.4, 9.1, y);
    }
    const y = s.foundation(C.silver, 0, -14, 22, 8.5, 0.45);
    s.cylinder(C.cream, 0, y + 5, -14, 4, 4, 20, 0, 0, HALF_PI);
    for (const x of [-10, 10]) s.sphere(C.teal, x, y + 5, -14, 1.6, 4, 4);
    for (const x of [-6, 0, 6]) {
      s.torus(C.silver, x, y + 5, -14, 4.02, 0.1, 0, HALF_PI);
      s.box(C.teal, x, y + 5, -10.05, 3.5, 2.4, 0.2);
      s.box(C.glass, x, y + 5, -9.91, 2.9, 1.8, 0.12);
    }
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      s.beam(C.teal, [side * 13, bases[i] + 5, -8], [side * 9, y + 5, -14], 2);
      s.solid(side * 11, -11, 4, 5, Math.abs(bases[i] - y) + 7, Math.min(bases[i], y));
    }
    s.solid(0, -14, 11.6, 4.2, 9.1, y);
    s.cylinder(C.teal, 0, y + 10.4, -14, 0.2, 0.45, 3);
    s.cone(C.cream, 0, y + 12.6, -14, 2.3, 1.5, Math.PI);
    s.torus(C.coral, 0, y + 13.35, -14, 2.3, 0.12, HALF_PI);
    s.sphere(C.yellow, 0, y + 13.8, -14, 0.4);
    const sy = s.ground(0, -25);
    solarArray(s, 0, sy, -25, 14);
  });

  kit.site("Moonberry Biosphere", -280, 205, 32, (s) => {
    const x = 0, z = -3;
    const y = s.ground(x, z);
    s.disc(C.silver, x, z, 19);
    const rings = [[16, 0.8], [11, 11], [5, 18]];
    const point = (ring, i) => {
      const a = i * TAU / 10;
      return [x + Math.cos(a) * rings[ring][0], y + rings[ring][1], z + Math.sin(a) * rings[ring][0]];
    };
    for (let i = 0; i < 10; i++) {
      const foot = point(0, i);
      s.cylinder(C.teal, foot[0], y + 0.5, foot[2], 0.42, 0.65, 1);
      s.solid(foot[0], foot[2], 0.65, 0.65, 2, y);
      for (let ring = 0; ring < 2; ring++) {
        s.beam(C.cream, point(ring, i), point(ring + 1, i), 0.18);
        s.beam(C.cream, point(ring + 1, i), point(ring + 1, i + 1), 0.15);
        // Omit low diagonals across the two 8m-plus, ground-level portals.
        if (ring !== 0 || (i !== 2 && i !== 7)) {
          s.beam(C.silver, point(ring, i), point(ring + 1, i + 1), 0.11);
        }
        if (ring === 0) {
          // Only the low rib sections need driving obstacles; keep the crown open below.
          for (const next of i === 2 || i === 7 ? [i] : [i, i + 1]) {
            const upper = point(1, next);
            const dx = (upper[0] - foot[0]) * 0.35, dz = (upper[2] - foot[2]) * 0.35;
            s.solid(foot[0] + dx / 2, foot[2] + dz / 2,
              Math.abs(dx) / 2 + 0.2, Math.abs(dz) / 2 + 0.2, 4.4, y + 0.5);
          }
        }
      }
      s.beam(C.cream, point(2, i), [x, y + 20, z], 0.16);
      // Alternating opaque upper facets leave the produce visible through open strips.
      if (i % 2 === 0) {
        panel(s, C.glass, [point(1, i), point(2, i), point(2, i + 1)]);
        panel(s, C.glass, [point(2, i), [x, y + 20, z], point(2, i + 1)]);
      }
    }
    s.sphere(C.yellow, x, y + 20.25, z, 0.55);
    for (const px of [-10, 10]) for (const pz of [-10, -2, 6]) {
      const py = s.ground(px, pz);
      s.box(C.teal, px, py + 0.65, pz, 4.2, 1.3, 4.2);
      s.box(C.dark, px, py + 1.3, pz, 3.7, 0.12, 3.7);
      s.beam(C.green, [px, py + 1.3, pz], [px, py + 4.6, pz], 0.16);
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        const dx = Math.cos(a), dz = Math.sin(a);
        s.sphere(C.green, px + dx * 0.9, py + 3.3 + i * 0.35, pz + dz * 0.9, 1.25, 0.48, 0.8);
        s.sphere(pz === -2 ? C.yellow : C.coral,
          px + dx * 1.1, py + 2.65 + i * 0.35, pz + dz * 1.1, 0.5, 0.6, 0.5);
      }
      s.solid(px, pz, 2.1, 2.1, 4.8, py);
    }
    const ty = s.ground(-24, -3);
    s.cylinder(C.cream, -24, ty + 2.5, -3, 1.7, 1.7, 5);
    s.sphere(C.teal, -24, ty + 5, -3, 1.7, 0.6, 1.7);
    s.torus(C.coral, -24, ty + 1, -3, 1.72, 0.12, HALF_PI);
    s.box(C.glass, -24, ty + 2.8, -1.28, 0.45, 2.6, 0.1);
    s.beam(C.teal, [-24, ty + 1.4, -3], [-21, ty + 1.4, -3], 0.2);
    s.cylinder(C.yellow, -21, ty + 1.5, -3, 0.5, 0.5, 0.18);
    s.solid(-22.7, -3, 3, 1.8, 5.6, ty);
  });

  kit.site("Six Wheel Discovery Depot", 255, 215, 34, (s) => {
    const y = s.ground(0, -6);
    s.disc(C.silver, 0, -2, 28);
    // No foundation or floor collider: the broad service lane stays on actual terrain.
    for (const x of [-15, 15]) for (const z of [-17, -6, 5]) {
      s.box(C.teal, x, y + 6.8, z, 0.65, 13.6, 0.65);
      s.box(C.yellow, x, y + 0.55, z, 1.1, 1.1, 1.1);
      s.solid(x, z, 0.55, 0.55, 13.6, y);
    }
    s.box(C.cream, 0, y + 6, -17, 30, 12, 0.5);
    s.solid(0, -17, 15, 0.3, 12, y);
    for (const side of [-1, 1]) {
      panel(s, C.silver, [[side * 16, y + 13.6, -18], [0, y + 17, -18], [0, y + 17, 6]]);
      panel(s, C.silver, [[side * 16, y + 13.6, -18], [0, y + 17, 6], [side * 16, y + 13.6, 6]]);
      s.beam(C.coral, [side * 16, y + 13.6, 6], [0, y + 17, 6], 0.3);
    }
    for (const x of [-10, -5, 0, 5, 10]) s.box(C.teal, x, y + 6, -16.7, 0.1, 11.5, 0.12);
    s.beam(C.yellow, [-15, y + 12.8, 5], [15, y + 12.8, 5], 0.18);

    const rx = -7.5, rz = -5;
    const ry = s.ground(rx, rz);
    s.box(C.silver, rx, ry + 2.5, rz, 4.8, 0.65, 9);
    s.box(C.cream, rx, ry + 3.2, rz - 0.3, 4.5, 1.2, 7.8);
    for (const side of [-1, 1]) {
      s.beam(C.teal, [rx + side * 2.2, ry + 2.4, rz - 3.3], [rx + side * 2.2, ry + 2.4, rz + 3.3], 0.22);
      for (const dz of [-3.3, 0, 3.3]) {
        wheel(s, rx + side * 3, ry + 1.55, rz + dz, 1.55, 1.15, side);
        s.beam(C.silver, [rx + side * 1.8, ry + 2.6, rz + dz], [rx + side * 3, ry + 1.55, rz + dz], 0.16);
      }
      for (const dz of [0.3, 3]) s.beam(C.teal,
        [rx + side * 2, ry + 3.5, rz + dz], [rx + side * 1.8, ry + 6.2, rz + dz], 0.13);
      s.box(C.teal, rx + side * 1.05, ry + 4.6, rz + 0.9, 1.3, 1.4, 0.4);
      s.box(C.dark, rx + side * 1.05, ry + 3.95, rz + 1.4, 1.3, 0.3, 1.3);
      s.sphere(C.yellow, rx + side * 1.6, ry + 3.25, rz + 4.2, 0.4, 0.4, 0.2);
    }
    s.box(C.cream, rx, ry + 6.35, rz + 1.7, 4.5, 0.3, 3.7);
    s.box(C.glass, rx, ry + 5, rz + 3.05, 3.65, 2.1, 0.1);
    s.box(C.coral, rx, ry + 2.8, rz + 4.5, 4.8, 0.35, 0.4);
    s.torus(C.dark, rx - 1, ry + 4.6, rz + 2.5, 0.42, 0.09, -0.6);
    s.box(C.teal, rx, ry + 4.25, rz - 2.5, 3.2, 1, 2.5);
    for (const dx of [-0.9, 0.9]) s.box(C.yellow, rx + dx, ry + 4.8, rz - 2.5, 0.12, 0.08, 2.5);
    s.beam(C.silver, [rx + 1.5, ry + 4, rz - 3], [rx + 1.5, ry + 7.7, rz - 3], 0.12);
    s.box(C.cream, rx + 1.5, ry + 7.8, rz - 3, 1.4, 0.65, 0.75);
    s.sphere(C.glass, rx + 1.5, ry + 7.8, rz - 2.58, 0.36, 0.25, 0.14);
    s.solid(rx, rz, 3.8, 5, 6.5, ry);
    for (const z of [-11, -4]) {
      const cy = s.ground(10, z);
      s.box(C.teal, 10, cy + 1.4, z, 4, 2.8, 3.6);
      for (const dx of [-1.2, 1.2]) s.box(C.yellow, 10 + dx, cy + 1.45, z + 1.84, 0.22, 2.6, 0.12);
      s.box(C.cream, 10, cy + 2.9, z, 4.2, 0.2, 3.8);
      s.box(C.silver, 10, cy + 1.5, z + 1.95, 0.75, 0.35, 0.15);
      s.solid(10, z, 2.1, 2.05, 3, cy);
    }
    const sy = s.ground(12, 16);
    solarArray(s, 12, sy, 16, 10);
  });

  kit.site("Starlight Listening Station", 0, 310, 34, (s) => {
    const x = 0, z = -4;
    const y = s.ground(x, z);
    s.disc(C.silver, x, z, 16);
    s.cylinder(C.teal, x, y + 1, z, 4, 5, 2);
    s.cylinder(C.cream, x, y + 7.5, z, 2.5, 3, 13);
    s.torus(C.coral, x, y + 11, z, 2.65, 0.25, HALF_PI);
    s.sphere(C.silver, x, y + 14, z, 3, 2, 3);
    s.solid(x, z, 5, 5, 2, y);
    s.solid(x, z, 3, 3, 14, y + 2);
    const tilt = 0.48;
    const point = (r, a) => {
      const rise = r * r * 0.035, dz = Math.sin(a) * r;
      return [x + Math.cos(a) * r,
        y + 16 + rise * Math.cos(tilt) - dz * Math.sin(tilt),
        z + rise * Math.sin(tilt) + dz * Math.cos(tilt)];
    };
    const center = point(0, 0);
    const feed = [x, y + 16 + 10 * Math.cos(tilt), z + 10 * Math.sin(tilt)];
    // A real open, concave bowl rather than a flattened sphere or solid cone.
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12, b = (i + 1) * TAU / 12;
      panel(s, C.cream, [center, point(5, b), point(5, a)]);
      panel(s, C.cream, [point(5, a), point(5, b), point(13, b)]);
      panel(s, C.cream, [point(5, a), point(13, b), point(13, a)]);
      if (i % 2 === 0) {
        s.beam(C.silver, center, point(5, a), 0.09);
        s.beam(C.silver, point(5, a), point(13, a), 0.09);
      }
      if (i % 4 === 0) s.beam(C.teal, point(13, a), feed, 0.16);
    }
    s.torus(C.teal, x, y + 16 + 5.915 * Math.cos(tilt), z + 5.915 * Math.sin(tilt),
      13, 0.28, HALF_PI + tilt);
    s.sphere(C.yellow, ...feed, 0.9);
    s.cylinder(C.teal, feed[0], feed[1] + 0.65 * Math.cos(tilt), feed[2] + 0.65 * Math.sin(tilt),
      0.48, 0.65, 1.5, tilt);

    const by = s.foundation(C.silver, -20, 8, 8, 10, 0.4);
    s.box(C.cream, -20, by + 3.6, 8, 8, 7.2, 10);
    s.box(C.teal, -20, by + 7.3, 8, 8.5, 0.35, 10.5);
    s.box(C.coral, -20, by + 1.1, 13.04, 8, 0.45, 0.12);
    for (const wx of [-22.3, -17.7]) {
      s.box(C.teal, wx, by + 4.8, 13.08, 2.5, 2, 0.15);
      s.box(C.glass, wx, by + 4.8, 13.2, 2, 1.5, 0.12);
    }
    s.box(C.teal, -20, by + 2, 13.1, 1.8, 4, 0.18);
    s.box(C.yellow, -19.4, by + 2, 13.24, 0.16, 0.45, 0.12);
    s.solid(-20, 8, 4, 5.2, 7.5, by);
    const ly = s.ground(19, 9);
    s.cylinder(C.teal, 19, ly + 5, 9, 0.25, 0.65, 10);
    for (const h of [2, 5, 8]) s.torus(C.cream, 19, ly + h, 9, 0.4, 0.1, HALF_PI);
    s.sphere(C.yellow, 19, ly + 10.5, 9, 0.9, 1.3, 0.9);
    s.torus(C.coral, 19, ly + 10.4, 9, 1.1, 0.12, HALF_PI);
    s.solid(19, 9, 0.7, 0.7, 11.8, ly);
    const sy = s.ground(12, -23);
    solarArray(s, 12, sy, -23, 9);
  });
}

export function decorateStuntLandmarks(kit) {
  kit.site("Confetti Big Top", -265, -245, 36, (s) => {
    const y = s.ground(0, 0);
    s.disc(C.cream, 0, 0, 28);
    // An unsupported center and 15m eaves leave a genuine drive-through tent.
    for (let i = 0; i < 16; i++) {
      const a = i * TAU / 16, b = (i + 1) * TAU / 16;
      const p = [Math.cos(a) * 24, y + 15, Math.sin(a) * 24];
      const q = [Math.cos(b) * 24, y + 15, Math.sin(b) * 24];
      panel(s, i % 2 === 0 ? C.coral : C.cream, [p, [0, y + 29, 0], q]);
      if (i % 2 === 1) {
        s.beam(C.yellow, p, [0, y + 29, 0], 0.1);
        s.cylinder(C.teal, p[0], y + 7.5, p[2], 0.3, 0.4, 15);
        s.cylinder(C.yellow, p[0], y + 0.4, p[2], 0.8, 0.8, 0.8);
        s.solid(p[0], p[2], 0.8, 0.8, 15, y);
      }
    }
    s.torus(C.yellow, 0, y + 15, 0, 24, 0.2, HALF_PI);
    s.cylinder(C.teal, 0, y + 30.5, 0, 0.13, 0.18, 4);
    panel(s, C.yellow, [[0, y + 32.5, 0], [5, y + 31.5, 0], [0, y + 30, 0]]);
    for (const side of [-1, 1]) {
      s.box(C.coral, side * 22, y + 7, 0, 0.3, 14, 12);
      for (const z of [-4, 0, 4]) s.box(C.cream, side * 22, y + 7, z, 0.34, 14, 1.8);
      s.solid(side * 22, 0, 0.2, 6, 14, y);
    }
    for (let i = 0; i < 12; i++) {
      const x1 = -17 + i * 34 / 12, x2 = -17 + (i + 1) * 34 / 12;
      const h1 = 14 + (x1 / 17) ** 2, h2 = 14 + (x2 / 17) ** 2;
      s.beam(C.teal, [x1, y + h1, 16.9], [x2, y + h2, 16.9], 0.055);
      panel(s, [C.teal, C.yellow, C.coral][i % 3], [
        [x1 + 0.2, y + h1 - 0.15, 16.9], [x2 - 0.2, y + h2 - 0.15, 16.9],
        [(x1 + x2) / 2, y + Math.min(h1, h2) - 1.1, 16.9],
      ]);
    }
    for (const x of [-17, 17]) for (const z of [-7, 7]) {
      const by = s.ground(x, z);
      s.box(C.teal, x, by + 1.4, z, 3.2, 0.35, 5);
      s.box(C.coral, x + Math.sign(x) * 1.4, by + 2.15, z, 0.3, 1.6, 5);
      for (const dz of [-1.8, 1.8]) s.box(C.yellow, x, by + 0.6, z + dz, 2.8, 1.2, 0.3);
      s.solid(x, z, 1.7, 2.5, 3, by);
    }
    for (const x of [-17, 17]) {
      const py = s.ground(x, 0);
      s.cylinder(C.coral, x, py + 1.2, 0, 1.6, 1.6, 2.4);
      s.torus(C.yellow, x, py + 2.4, 0, 1.6, 0.12, HALF_PI);
      s.sphere(C.teal, x, py + 3.6, 0, 1.2);
      s.solid(x, 0, 1.7, 1.7, 4.8, py);
    }
  });

  kit.site("Rainbow Truck Tinker Yard", 270, -240, 36, (s) => {
    s.disc(C.cream, 0, -3, 30);
    for (const [x, z, color, openHood, missingWheel] of [
      [-16, -5, C.coral, true, false],
      [16, -5, C.teal, false, true],
      [0, -22, C.yellow, true, false],
    ]) {
      const y = s.ground(x, z);
      workshopTruck(s, x, y, z, color, openHood, missingWheel);
    }
    // Neatly sorted spare parts, not wreckage; the middle lane is over 24m wide.
    for (const x of [-17, 17]) {
      const y = s.ground(x, 13);
      for (let i = 0; i < 3; i++) {
        s.cylinder(C.dark, x, y + 0.5 + i * 0.9, 13, 1.65, 1.65, 0.8);
        s.torus(C.cream, x, y + 0.92 + i * 0.9, 13, 0.95, 0.14, HALF_PI);
      }
      s.solid(x, 13, 1.7, 1.7, 2.8, y);
    }
    const y = s.ground(-25, -14);
    for (const x of [-27, -23]) {
      s.box(C.teal, x, y + 2, -14, 0.2, 4, 0.3);
      s.solid(x, -14, 0.25, 0.3, 4, y);
    }
    for (const h of [0.7, 2.3, 3.9]) s.box(C.cream, -25, y + h, -14, 4.5, 0.15, 2.1);
    for (const x of [-26, -24]) {
      s.sphere(C.coral, x, y + 1.25, -14, 0.7, 0.5, 0.7);
      s.box(C.yellow, x, y + 2.8, -14, 1.2, 0.8, 1.2);
    }
    s.solid(-25, -14, 2.3, 1.1, 4, y);
  });

  kit.site("Sunshine Spectator Wheel", -265, 235, 36, (s) => {
    const y = s.ground(0, -8), z = -8;
    s.disc(C.cream, 0, 0, 28);
    s.torus(C.coral, 0, y + 24, z, 18, 0.55);
    s.torus(C.yellow, 0, y + 24, z, 16.8, 0.2);
    s.cylinder(C.teal, 0, y + 24, z, 2, 2, 6, HALF_PI);
    s.cylinder(C.yellow, 0, y + 24, z + 3.2, 1.2, 1.2, 0.4, HALF_PI);
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      s.beam(i % 2 ? C.cream : C.teal, [0, y + 24, z],
        [Math.cos(a) * 18, y + 24 + Math.sin(a) * 18, z], 0.16);
    }
    for (const dz of [-4, 4]) for (const side of [-1, 1]) {
      s.beam(C.teal, [side * 11, y + 0.5, z + dz], [0, y + 24, z + dz * 0.65], 0.5);
      s.box(C.yellow, side * 11, y + 0.4, z + dz, 2.4, 0.8, 2.4);
      // Segment the sloping supports instead of placing an invisible wall under the wheel.
      for (let step = 0; step < 4; step++) {
        s.solid(side * 11 * (1 - (step + 0.5) / 4), z + dz * (1 - 0.35 * (step + 0.5) / 4),
          1.9, 0.75, 6.5, y + step * 5.875);
      }
      s.solid(side * 11, z + dz, 1.2, 1.2, 0.8, y);
    }
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      const x = Math.cos(a) * 18, cy = y + 24 + Math.sin(a) * 18 - 1.8;
      const color = [C.coral, C.teal, C.yellow, C.cream][i % 4];
      s.beam(C.silver, [x, cy + 1.8, z], [x, cy + 0.6, z], 0.16);
      s.box(color, x, cy - 0.4, z, 3.5, 1.5, 3.2);
      s.box(C.cream, x, cy + 1.7, z, 3.9, 0.25, 3.6);
      for (const dx of [-1.5, 1.5]) s.box(C.teal, x + dx, cy + 0.65, z + 1.3, 0.12, 2, 0.12);
      s.box(C.dark, x, cy + 0.45, z - 0.5, 2.7, 0.25, 1.1);
      s.box(C.teal, x, cy + 0.9, z - 1.05, 2.7, 1, 0.2);
      s.beam(C.yellow, [x - 1.5, cy + 0.7, z + 1.45], [x + 1.5, cy + 0.7, z + 1.45], 0.09);
      s.solid(x, z, 1.95, 1.8, 3.1, cy - 1.2);
    }
    const by = s.foundation(C.teal, -22, 12, 6, 6, 0.35);
    s.box(C.cream, -22, by + 3, 12, 6, 6, 6);
    s.cone(C.coral, -22, by + 7.2, 12, 4.4, 2.4);
    s.box(C.teal, -22, by + 3.9, 15.04, 4.7, 2.2, 0.15);
    s.box(C.glass, -22, by + 4, 15.16, 4, 1.6, 0.1);
    s.box(C.yellow, -22, by + 2.7, 15.35, 5, 0.25, 0.8);
    for (const x of [-24, -22, -20]) s.box(C.coral, x, by + 1.1, 15.06, 0.8, 2, 0.12);
    s.solid(-22, 12.25, 3, 3.5, 6, by);
    s.solid(-22, 12, 4.4, 4.4, 2.4, by + 6);
  });

  kit.site("Happy Hooks Service Garage", 260, 240, 36, (s) => {
    const y = s.ground(0, -6);
    s.disc(C.cream, 0, 0, 29);
    s.box(C.cream, 0, y + 14.5, -6, 34, 0.8, 24);
    s.box(C.coral, 0, y + 14.5, 6.1, 34, 1.25, 0.3);
    for (const x of [-12, -6, 0, 6, 12]) s.box(C.teal, x, y + 14.94, -6, 0.14, 0.08, 23.5);
    for (const x of [-16, 16]) for (const z of [-17, 5]) {
      s.box(C.teal, x, y + 7, z, 0.65, 14, 0.65);
      s.box(C.yellow, x, y + 0.6, z, 1.1, 1.2, 1.1);
      s.solid(x, z, 0.55, 0.55, 14, y);
    }
    s.beam(C.silver, [-16, y + 13.2, -16], [16, y + 13.2, -16], 0.23);
    const by = s.foundation(C.teal, -12, -7, 7, 19, 0.35);
    s.box(C.cream, -12, by + 5.3, -7, 7, 10.6, 19);
    s.box(C.teal, -12, by + 3, 2.58, 2.5, 6, 0.16);
    s.box(C.glass, -12, by + 4.4, 2.7, 1.8, 1.8, 0.12);
    s.box(C.coral, -8.43, by + 8, -7, 0.14, 0.7, 18);
    s.solid(-12, -7, 3.5, 9.7, 10.6, by);

    const ty = s.ground(3, -5);
    workshopTruck(s, 3, ty, -5, C.yellow);
    s.cylinder(C.teal, 3, ty + 4.4, -8, 0.8, 1.1, 3);
    s.beam(C.coral, [3, ty + 4.5, -8], [3, ty + 9.6, -10], 0.45);
    s.beam(C.coral, [3, ty + 9.6, -10], [3, ty + 10.2, -13], 0.35);
    s.beam(C.silver, [3, ty + 4, -9], [3, ty + 8.3, -9.7], 0.18);
    s.beam(C.dark, [3, ty + 10.1, -13], [3, ty + 6.8, -13], 0.06);
    s.torus(C.yellow, 3, ty + 6.35, -13, 0.5, 0.13);
    s.solid(3, -8, 1.1, 1.1, 5.9, ty);
    s.solid(3, -9, 0.5, 1.5, 5.9, ty + 4.1);
    s.solid(3, -11.5, 0.45, 1.95, 1.4, ty + 9.1);

    const ry = s.ground(6, -17);
    s.box(C.teal, 6, ry + 3.6, -17, 10, 6.4, 0.4);
    s.box(C.cream, 6, ry + 1.8, -16.2, 10, 0.3, 1.8);
    for (const x of [2.5, 5, 7.5]) {
      s.beam(C.silver, [x, ry + 3, -16.7], [x + 0.3, ry + 5.2, -16.7], 0.14);
      s.torus(C.yellow, x + 0.3, ry + 5.3, -16.7, 0.32, 0.11);
      s.torus(C.silver, x, ry + 2.9, -16.7, 0.27, 0.09);
    }
    s.box(C.coral, 9.2, ry + 2.3, -16, 2.1, 0.7, 1.2);
    s.solid(6, -16.5, 5, 1.3, 6.8, ry);
    const cy = s.ground(-13, 14);
    s.cylinder(C.coral, -13, cy + 1.4, 14, 1.1, 1.1, 3.7, 0, 0, HALF_PI);
    s.box(C.teal, -13, cy + 2.75, 14, 1.7, 1, 1.1);
    for (const side of [-1, 1]) wheel(s, -13 + side * 1.6, cy + 0.55, 14, 0.55, 0.35, side);
    s.torus(C.dark, -13, cy + 2, 15.25, 0.8, 0.1);
    s.solid(-13, 14, 2, 1.4, 3.3, cy);
  });

  kit.site("Giggle Gear Monster Motor Show", 0, 315, 34, (s) => {
    s.disc(C.cream, 0, -3, 23);
    const x = 0, z = -5;
    const y = s.ground(x, z);
    // The truck is a parked exhibit, not a jump or a raised driving platform.
    s.box(C.dark, x, y + 5, z, 8.2, 0.8, 15);
    for (const dz of [-5.5, 5.5]) {
      s.beam(C.silver, [-6, y + 3.3, z + dz], [6, y + 3.3, z + dz], 0.3);
      for (const side of [-1, 1]) {
        wheel(s, side * 6, y + 3.3, z + dz, 3.3, 2.2, side);
        s.beam(C.teal, [side * 2, y + 5, z], [side * 5.8, y + 3.3, z + dz], 0.25);
        s.beam(C.silver, [side * 4.1, y + 3.4, z + dz], [side * 4.1, y + 5.8, z + dz], 0.16);
        for (const h of [3.8, 4.5, 5.2]) s.torus(C.yellow, side * 4.1, y + h, z + dz, 0.48, 0.12, HALF_PI);
        s.box(C.cream, side * 4.3, y + 6.35, z + dz, 1.4, 0.45, 5.5);
      }
    }
    s.box(C.coral, 0, y + 6.1, z, 8.7, 1.5, 14.5);
    s.box(C.teal, 0, y + 7.1, z - 4.2, 7.6, 0.25, 5.5);
    for (const side of [-1, 1]) {
      s.box(C.coral, side * 4.1, y + 7.6, z - 4.2, 0.35, 1.7, 5.5);
      s.box(C.yellow, side * 4.48, y + 6.3, z, 0.12, 0.4, 12.8);
      for (const dz of [-1.8, 2.6]) s.beam(C.teal,
        [side * 3.65, y + 6.7, z + dz], [side * 3.4, y + 10.5, z + dz - 0.25], 0.2);
      s.box(C.dark, side * 1.7, y + 7.6, z, 2, 0.4, 2);
      s.box(C.teal, side * 1.7, y + 8.4, z - 0.8, 2, 1.9, 0.4);
      s.box(C.silver, side * 4.8, y + 9.2, z + 2.1, 0.7, 1, 0.5);
      for (const dx of [2.6, 3.5]) s.sphere(C.yellow, side * dx, y + 7.2, z + 7.35, 0.38, 0.5, 0.18);
    }
    s.box(C.cream, 0, y + 10.6, z + 0.3, 8.2, 0.4, 5.5);
    s.box(C.glass, 0, y + 9, z + 2.45, 6.5, 2.4, 0.15, -0.08);
    s.beam(C.teal, [0, y + 7.8, z + 2.55], [0, y + 10.2, z + 2.35], 0.13);
    s.box(C.coral, 0, y + 7.3, z + 4.9, 8.1, 1, 4.3);
    s.box(C.yellow, 0, y + 7.84, z + 4.9, 1.4, 0.12, 4.3);
    s.box(C.dark, 0, y + 6.95, z + 7.35, 4.1, 1.25, 0.12);
    for (let i = -2; i <= 2; i++) s.box(C.silver, i * 0.7, y + 6.95, z + 7.45, 0.17, 1.05, 0.12);
    s.box(C.cream, 0, y + 5.8, z + 7.7, 9, 0.55, 0.65);
    s.torus(C.dark, -1.7, y + 8.6, z + 1.65, 0.65, 0.13, -0.6);
    s.solid(0, z, 7.4, 9, 10.9, y);

    const ty = s.ground(-19, 12);
    s.box(C.teal, -19, ty + 0.6, 12, 4.5, 1.2, 4.5);
    s.cylinder(C.yellow, -19, ty + 2.1, 12, 0.45, 0.9, 1.8);
    s.cylinder(C.yellow, -19, ty + 4.6, 12, 2.3, 0.8, 3.2);
    s.torus(C.cream, -19, ty + 6.2, 12, 2.3, 0.14, HALF_PI);
    for (const side of [-1, 1]) s.torus(C.yellow, -19 + side * 2.2, ty + 4.7, 12, 1.15, 0.22);
    s.solid(-19, 12, 3.6, 2.4, 6.4, ty);
    for (const fx of [-21, 21]) {
      const fy = s.ground(fx, -15);
      s.cylinder(C.teal, fx, fy + 5, -15, 0.13, 0.22, 10);
      panel(s, C.coral, [[fx, fy + 10, -15], [fx + 4, fy + 9, -15], [fx, fy + 7.7, -15]]);
      panel(s, C.yellow, [[fx, fy + 7.4, -15], [fx + 3, fy + 6.7, -15], [fx, fy + 5.9, -15]]);
      s.solid(fx, -15, 0.3, 0.3, 10, fy);
    }
    const sy = s.ground(19, 12);
    s.torus(C.dark, 19, sy + 3.6, 12, 2.7, 0.9, 0, HALF_PI);
    s.cylinder(C.cream, 19, sy + 3.6, 12, 1.9, 1.9, 0.7, 0, 0, HALF_PI);
    s.cylinder(C.yellow, 19.4, sy + 3.6, 12, 0.65, 0.65, 0.2, 0, 0, HALF_PI);
    s.solid(19, 12, 1, 3.6, 7.2, sy);
  });
}
