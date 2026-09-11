// Seven shared colors keep five sites within 35 material batches, plus signs.
const C = {
  cream: 0xeee2c6, teal: 0x287d80, coral: 0xd56d5a, honey: 0xe9b957,
  wood: 0x916448, ink: 0x293e43, mist: 0x93c8b3,
};
const HALF_PI = Math.PI / 2;

function windowFrame(s, x, y, z, w = 1.6, h = 1.7) {
  s.box(C.cream, x, y, z, w + 0.28, h + 0.28, 0.2);
  s.window(C.mist, x, y, z + 0.13, w, h, 0.08);
  s.box(C.cream, x, y, z + 0.2, 0.1, h, 0.08);
  s.box(C.cream, x, y, z + 0.2, w, 0.1, 0.08);
}

function gableRoof(s, x, y, z, w, d, rise, color) {
  const slope = Math.atan2(rise, w / 2);
  for (const side of [-1, 1]) {
    s.box(color, x + side * w / 4, y + rise / 2, z,
      Math.hypot(w / 2, rise), 0.25, d, 0, 0, -side * slope);
    for (const offset of [-d * 0.32, 0, d * 0.32]) {
      s.beam(C.cream, [x, y + rise + 0.16, z + offset],
        [x + side * w / 2, y + 0.16, z + offset], 0.055);
    }
  }
  s.triangle(C.cream, [[x - w / 2, y, z + d / 2],
    [x + w / 2, y, z + d / 2], [x, y + rise, z + d / 2]]);
  s.triangle(C.cream, [[x + w / 2, y, z - d / 2],
    [x - w / 2, y, z - d / 2], [x, y + rise, z - d / 2]]);
  s.beam(C.cream, [x, y + rise + 0.13, z - d / 2],
    [x, y + rise + 0.13, z + d / 2], 0.13);
}

// Vehicles face local -Z; each assembly uses one ground anchor.
function wheels(s, x, y, z, width, axles, radius = 0.85) {
  for (const axle of axles) for (const side of [-1, 1]) {
    const wx = x + side * width / 2;
    s.cylinder(C.ink, wx, y + radius, z + axle, radius, radius, 0.5, 0, 0, HALF_PI);
    s.cylinder(C.cream, wx + side * 0.27, y + radius, z + axle,
      radius * 0.47, radius * 0.47, 0.08, 0, 0, HALF_PI);
  }
}

function bunting(s, x1, z1, x2, z2) {
  const a = [x1, s.ground(x1, z1) + 6, z1];
  const b = [x2, s.ground(x2, z2) + 6, z2];
  const mid = [(x1 + x2) / 2, (a[1] + b[1]) / 2 - 0.6, (z1 + z2) / 2];
  for (const p of [a, b]) {
    s.cylinder(C.wood, p[0], p[1] - 3, p[2], 0.12, 0.16, 6);
    s.solid(p[0], p[2], 0.18, 0.18, 6, p[1] - 6);
  }
  s.beam(C.cream, a, mid, 0.04);
  s.beam(C.cream, mid, b, 0.04);
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7, dt = 0.038;
    const y = a[1] + (b[1] - a[1]) * t - 0.6 * (1 - Math.abs(2 * t - 1));
    const points = [
      [x1 + (x2 - x1) * (t - dt), y, z1 + (z2 - z1) * (t - dt)],
      [x1 + (x2 - x1) * t, y - 0.9, z1 + (z2 - z1) * t],
      [x1 + (x2 - x1) * (t + dt), y, z1 + (z2 - z1) * (t + dt)],
    ];
    const color = [C.coral, C.honey, C.teal][i % 3];
    s.triangle(color, points);
    s.triangle(color, [points[2], points[1], points[0]]);
  }
}

function picnicTable(s, x, z) {
  const y = s.ground(x, z);
  s.box(C.wood, x, y + 1.65, z, 4.2, 0.22, 1.6);
  for (const side of [-1, 1]) {
    s.box(C.honey, x, y + 0.85, z + side * 1.35, 4.2, 0.2, 0.65);
    for (const dx of [-1.35, 1.35]) {
      s.beam(C.cream, [x + dx, y, z + side * 1.5],
        [x + dx, y + 1.6, z + side * 0.45], 0.14);
    }
  }
  s.solid(x, z, 2.1, 1.7, 1.8, y);
}

function log(s, x, y, z, length, radius = 0.65) {
  s.cylinder(C.wood, x, y, z, radius, radius, length, 0, 0, HALF_PI);
  for (const side of [-1, 1]) {
    s.cylinder(C.honey, x + side * (length / 2 + 0.02), y, z,
      radius * 0.85, radius * 0.85, 0.05, 0, 0, HALF_PI);
    s.torus(C.wood, x + side * (length / 2 + 0.055), y, z,
      radius * 0.49, 0.045, 0, HALF_PI);
  }
}

function track(s, x, z, length) {
  const count = Math.ceil(length / 3);
  for (let i = 0; i <= count; i++) {
    const zz = z - length / 2 + length * i / count;
    s.box(C.wood, x, s.ground(x, zz) + 0.06, zz, 4.1, 0.12, 0.4);
    if (i === count) continue;
    const next = zz + length / count;
    for (const side of [-1, 1]) {
      const xx = x + side * 1.35;
      s.beam(C.ink, [xx, s.ground(xx, zz) + 0.16, zz],
        [xx, s.ground(xx, next) + 0.16, next], 0.07);
    }
  }
}

function locomotive(s, x, z, color) {
  const y = s.ground(x, z) + 0.15;
  s.box(C.ink, x, y + 1.1, z, 3.4, 0.45, 8.2);
  wheels(s, x, y, z, 3.1, [-2.8, -0.3, 2.2], 0.95);
  s.cylinder(color, x, y + 2.8, z - 1.2, 1.25, 1.25, 5, HALF_PI);
  s.cylinder(C.ink, x, y + 2.8, z - 3.75, 1.18, 1.18, 0.15, HALF_PI);
  for (const zz of [-3.1, 0.4]) s.torus(C.honey, x, y + 2.8, z + zz, 1.26, 0.09);
  s.cylinder(C.ink, x, y + 4.7, z - 2.4, 0.55, 0.35, 1.6);
  s.cylinder(C.honey, x, y + 5.52, z - 2.4, 0.65, 0.65, 0.15);
  s.sphere(C.honey, x, y + 4, z - 0.3, 0.58, 0.55, 0.58);
  s.cylinder(C.honey, x, y + 3.3, z - 3.93, 0.38, 0.38, 0.22, HALF_PI);
  s.cylinder(C.cream, x, y + 3.3, z - 4.06, 0.27, 0.27, 0.05, HALF_PI);
  s.box(color, x, y + 2.2, z + 2.5, 3.5, 1.8, 2.7);
  for (const dx of [-1.55, 1.55]) for (const dz of [1.35, 3.65]) {
    s.box(C.cream, x + dx, y + 3.9, z + dz, 0.18, 2, 0.18);
  }
  s.box(C.ink, x, y + 5, z + 2.5, 4, 0.28, 3.3);
  windowFrame(s, x, y + 3.9, z + 3.87, 2.4, 1.4);
  for (const side of [-1, 1]) {
    s.beam(C.honey, [x + side * 1.9, y + 0.95, z - 2.8],
      [x + side * 1.9, y + 0.95, z + 2.2], 0.11);
    s.cylinder(C.ink, x + side * 1.05, y + 1.25, z - 4.3, 0.3, 0.3, 0.4, HALF_PI);
  }
  s.box(C.coral, x, y + 0.65, z - 4.15, 3.6, 0.32, 0.65);
  s.solid(x, z - 0.2, 2, 4.4, 5.6, y);
  s.beam(C.ink, [x, y + 1, z + 4], [x, y + 1, z + 5.4], 0.16);
  s.box(C.wood, x, y + 1.2, z + 7.2, 3.4, 0.35, 3.6);
  s.box(color, x, y + 2.1, z + 7.2, 3.4, 1.5, 3.6);
  s.box(C.cream, x, y + 2.9, z + 7.2, 3.7, 0.16, 3.9);
  wheels(s, x, y, z + 7.2, 3.2, [-1.1, 1.1], 0.68);
  s.sphere(C.ink, x, y + 2.85, z + 7.2, 1.3, 0.45, 1.4);
  s.solid(x, z + 7.2, 1.95, 1.95, 3.3, y);
}

export function decorateForestLandmarks(kit) {
  kit.site("mushroom-village", -350, -260, 32, (s) => {
    s.disc(C.mist, 0, 0, 28);
    // A broad central lane separates the three inhabited mushroom caps.
    for (const [x, z, r, color] of [[-13, -10, 3.6, C.coral], [12, -11, 4.2, C.teal], [-13, 12, 3.2, C.honey]]) {
      const y = s.foundation(C.wood, x, z, r * 1.8, r * 1.8, 0.35);
      s.cylinder(C.cream, x, y + 2.9, z, r * 0.82, r, 5.8);
      s.cylinder(C.wood, x, y + 0.3, z, r * 1.02, r * 1.02, 0.35);
      s.sphere(color, x, y + 6.2, z, r * 1.65, 2.6, r * 1.65);
      s.cylinder(C.cream, x, y + 5.9, z, r * 1.62, r * 1.62, 0.22);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, ring = r * 1.1;
        s.sphere(C.cream, x + Math.cos(a) * ring, y + 8.16, z + Math.sin(a) * ring,
          0.6, 0.12, 0.6);
      }
      s.box(C.wood, x, y + 1.45, z + r * 0.94, 1.6, 2.7, 0.2);
      s.sphere(C.honey, x + 0.48, y + 1.35, z + r + 0.1, 0.12);
      for (const dx of [-r * 0.52, r * 0.52]) {
        windowFrame(s, x + dx, y + 3.6, z + r * 0.76, 1, 1.3);
      }
      s.torus(C.wood, x, y + 4.8, z + r * 0.88, 0.46, 0.1);
      s.solid(x, z, r, r, 6, y);
      const py = s.ground(x + r + 1.4, z + 1);
      s.cylinder(C.wood, x + r + 1.4, py + 0.5, z + 1, 0.75, 0.55, 1);
      s.sphere(C.mist, x + r + 1.4, py + 1.2, z + 1, 1, 0.8, 1);
      s.sphere(color, x + r + 1.4, py + 1.9, z + 1, 0.32);
      s.solid(x + r + 1.4, z + 1, 0.8, 0.8, 1.6, py);
    }
    picnicTable(s, 12, 11);
    bunting(s, -6, -18, 6, -18);
    for (const [x, z] of [[19, 8], [20, 11], [18, 14]]) {
      const y = s.ground(x, z);
      s.cylinder(C.cream, x, y + 0.65, z, 0.25, 0.35, 1.3);
      s.sphere(C.coral, x, y + 1.4, z, 0.95, 0.5, 0.95);
      s.sphere(C.cream, x, y + 1.85, z, 0.22, 0.08, 0.22);
    }
    s.label?.("MUSHROOM MEADOW", 12, s.ground(12, -11) + 11, -11, C.cream, C.teal, 9, 1.5);
  });

  kit.site("timber-camp", 350, -300, 34, (s) => {
    const x = -13, z = -10;
    const y = s.foundation(C.wood, x, z, 10, 8, 0.5);
    s.box(C.honey, x, y + 2.7, z, 9.5, 5.4, 7.5);
    for (let i = 0; i < 6; i++) s.box(C.wood, x, y + 0.45 + i * 0.85, z + 3.8, 9.6, 0.12, 0.14);
    for (const dx of [-4.5, 4.5]) s.box(C.cream, x + dx, y + 2.7, z + 3.85, 0.25, 5.5, 0.24);
    s.box(C.teal, x, y + 1.6, z + 3.88, 1.9, 3.2, 0.2);
    windowFrame(s, x - 3, y + 3, z + 3.9);
    windowFrame(s, x + 3, y + 3, z + 3.9);
    gableRoof(s, x, y + 5.5, z, 11, 9, 2.3, C.teal);
    s.solid(x, z, 4.8, 3.8, 7.8, y);

    const tx = 12, tz = -10, ty = s.ground(tx, tz);
    s.box(C.ink, tx, ty + 1.1, tz, 4, 0.5, 10.5);
    wheels(s, tx, ty, tz, 4, [-3.2, 2.1, 3.8], 1);
    s.box(C.teal, tx, ty + 2.25, tz - 3.5, 3.8, 1.7, 3.1);
    s.box(C.teal, tx, ty + 3.25, tz - 1.7, 3.9, 3.1, 2.5);
    s.box(C.cream, tx, ty + 4.85, tz - 1.7, 4.2, 0.25, 2.9);
    s.box(C.mist, tx, ty + 3.9, tz - 3.02, 3.3, 1.2, 0.08);
    s.box(C.cream, tx, ty + 3.9, tz - 3.09, 0.12, 1.25, 0.08);
    s.box(C.ink, tx, ty + 2.1, tz - 5.09, 1.9, 1, 0.1);
    for (const dx of [-0.55, 0, 0.55]) s.box(C.cream, tx + dx, ty + 2.1, tz - 5.17, 0.09, 0.9, 0.08);
    for (const side of [-1, 1]) {
      s.sphere(C.honey, tx + side * 1.35, ty + 2.45, tz - 5.1, 0.33, 0.33, 0.16);
      s.box(C.mist, tx + side * 1.97, ty + 3.85, tz - 1.65, 0.08, 1.25, 1.7);
      s.box(C.cream, tx + side * 2.18, ty + 3.9, tz - 2.9, 0.4, 0.65, 0.25);
    }
    s.box(C.cream, tx, ty + 1.3, tz - 5.4, 4.3, 0.35, 0.3);
    s.box(C.wood, tx, ty + 1.65, tz + 2.2, 4.3, 0.35, 5.5);
    for (const zz of [0.3, 4.1]) for (const side of [-1, 1]) {
      s.box(C.coral, tx + side * 2, ty + 2.7, tz + zz, 0.18, 2.2, 0.18);
    }
    for (const zz of [0.8, 2.2, 3.6]) log(s, tx, ty + 2.4, tz + zz, 3.7, 0.58);
    s.solid(tx, tz - 0.2, 2.35, 5.5, 5, ty);

    const ly = s.ground(-13, 12);
    for (let row = 0; row < 2; row++) for (let i = 0; i < 3 - row; i++) {
      log(s, -13, ly + 0.7 + row * 1.16, 10.5 + i * 1.45 + row * 0.72, 9, 0.7);
    }
    s.solid(-13, 12, 4.55, 2.2, 2.65, ly);
    picnicTable(s, 12, 13);
    s.label?.("LITTLE TIMBER CO.", x, y + 5, z + 4.15, C.cream, C.teal, 7, 1.1);
  });

  kit.site("ranger-lookout", -370, 220, 30, (s) => {
    const x = -10, z = -7, y = s.ground(x, z), deck = y + 12;
    s.disc(C.mist, x, z, 11);
    // Feet meet terrain independently; the deck and cabin share one level datum.
    for (const dx of [-4, 4]) for (const dz of [-4, 4]) {
      const bottom = s.ground(x + dx, z + dz), height = deck - bottom;
      s.box(C.cream, x + dx, bottom + 0.25, z + dz, 1.6, 0.5, 1.6);
      s.box(C.wood, x + dx, bottom + height / 2, z + dz, 0.8, height, 0.8);
      s.solid(x + dx, z + dz, 0.8, 0.8, height + 0.3, bottom);
    }
    for (const side of [-1, 1]) {
      s.beam(C.wood, [x - 4, y + 1, z + side * 4], [x + 4, deck - 0.5, z + side * 4], 0.2);
      s.beam(C.wood, [x + 4, y + 1, z + side * 4], [x - 4, deck - 0.5, z + side * 4], 0.2);
      s.solid(x, z + side * 4, 4.4, 0.25, 12, y);
    }
    s.box(C.wood, x, deck, z, 11, 0.5, 11);
    s.solid(x, z, 5.5, 5.5, 0.5, deck - 0.25);
    s.box(C.honey, x, deck + 2.4, z, 6.5, 4.3, 6);
    for (const dx of [-1.7, 1.7]) windowFrame(s, x + dx, deck + 2.9, z + 3.1, 2.2, 2.1);
    for (const side of [-1, 1]) {
      s.box(C.mist, x + side * 3.3, deck + 2.9, z, 0.1, 2.2, 4.4);
      s.box(C.cream, x + side * 3.38, deck + 2.9, z, 0.1, 2.3, 0.15);
      for (const dz of [-5, 5]) s.box(C.cream, x + side * 5, deck + 1.4, z + dz, 0.2, 2.7, 0.2);
      s.box(C.cream, x, deck + 2.3, z + side * 5, 10, 0.18, 0.18);
      s.box(C.cream, x + side * 5, deck + 2.3, z, 0.18, 0.18, 10);
    }
    gableRoof(s, x, deck + 4.7, z, 8.5, 8, 2.5, C.teal);
    s.solid(x, z, 3.3, 3.1, 7.2, deck);
    for (const dx of [-0.6, 0.6]) s.beam(C.wood, [x + dx, y, z + 6], [x + dx, deck, z + 4.5], 0.12);
    for (let i = 1; i < 12; i++) s.box(C.cream, x, y + i, z + 6 - i / 8, 1.5, 0.12, 0.2);
    s.solid(x, z + 5.3, 0.85, 0.95, 12, y);
    s.cylinder(C.wood, x, deck + 9.2, z, 0.09, 0.09, 4);
    s.triangle(C.coral, [[x, deck + 11.2, z], [x, deck + 9.7, z], [x + 3, deck + 10.45, z]]);
    s.triangle(C.coral, [[x + 3, deck + 10.45, z], [x, deck + 9.7, z], [x, deck + 11.2, z]]);

    const mx = 11, mz = -8, my = s.ground(mx, mz);
    for (const dx of [-2.7, 2.7]) {
      s.box(C.wood, mx + dx, my + 2.7, mz, 0.4, 5.4, 0.4);
      s.solid(mx + dx, mz, 0.25, 0.25, 5.4, my);
    }
    s.box(C.cream, mx, my + 3.4, mz, 5.8, 3.3, 0.3);
    s.box(C.mist, mx, my + 3.4, mz + 0.18, 5.1, 2.6, 0.08);
    for (const dx of [-1.5, 0, 1.5]) {
      s.triangle(C.teal, [[mx + dx - 0.5, my + 2.7, mz + 0.24],
        [mx + dx + 0.5, my + 2.7, mz + 0.24], [mx + dx, my + 4.1, mz + 0.24]]);
    }
    s.beam(C.honey, [mx - 2, my + 2.5, mz + 0.28], [mx + 1.8, my + 3.8, mz + 0.28], 0.1);
    s.solid(mx, mz, 2.9, 0.25, 3.3, my + 1.75);
    picnicTable(s, 11, 10);
    s.label?.("RANGER LOOKOUT", mx, my + 5.7, mz, C.cream, C.teal, 7, 1.2);
  });

  kit.site("camp-fern", 310, 300, 34, (s) => {
    s.disc(C.mist, 0, 0, 28);
    const x = -13, z = -9, y = s.ground(x, z);
    s.box(C.ink, x, y + 0.9, z, 5, 0.35, 10);
    wheels(s, x, y, z, 5.1, [1.4], 0.8);
    s.box(C.cream, x, y + 2.8, z, 5.2, 3.4, 9.5);
    s.sphere(C.cream, x, y + 4.35, z, 2.6, 1.05, 4.75);
    s.box(C.teal, x, y + 1.7, z, 5.3, 1.2, 9.6);
    windowFrame(s, x, y + 3.3, z + 4.82, 3.5, 1.6);
    s.box(C.wood, x + 2.69, y + 2.7, z + 1.2, 0.12, 2.8, 1.6);
    s.box(C.mist, x + 2.76, y + 3.4, z + 1.2, 0.1, 1, 1.1);
    s.box(C.mist, x + 2.69, y + 3.4, z - 2, 0.1, 1.5, 2.5);
    for (const zz of [-3.4, -0.6]) s.box(C.cream, x + 2.77, y + 3.4, z + zz, 0.1, 1.8, 0.12);
    for (const zz of [-4, 4]) s.box(C.cream, x, y + 1.1, z + zz, 5.6, 0.2, 0.3);
    s.beam(C.ink, [x - 1.5, y + 0.9, z - 4.8], [x, y + 0.9, z - 7], 0.12);
    s.beam(C.ink, [x + 1.5, y + 0.9, z - 4.8], [x, y + 0.9, z - 7], 0.12);
    s.cylinder(C.ink, x, y + 0.45, z - 6.5, 0.09, 0.09, 0.9);
    s.solid(x, z, 2.8, 4.85, 5.4, y);
    s.solid(x, z - 5.8, 1.55, 1.3, 1.1, y);
    for (let i = 0; i < 5; i++) {
      s.box(i % 2 ? C.cream : C.coral, x + 4.7, y + 4.1, z - 2.4 + i * 1.2,
        4.2, 0.16, 1.2, 0, 0, -0.12);
    }
    for (const zz of [-3, 3]) {
      const py = s.ground(x + 6.8, z + zz), height = y + 3.85 - py;
      s.cylinder(C.wood, x + 6.8, py + height / 2, z + zz, 0.09, 0.09, height);
      s.solid(x + 6.8, z + zz, 0.15, 0.15, height, py);
    }

    for (const [tx, tz, color] of [[12, -12, C.honey], [14, 10, C.coral]]) {
      const ty = s.ground(tx, tz);
      s.box(C.wood, tx, ty + 0.1, tz, 6.6, 0.2, 7.5);
      for (const side of [-1, 1]) {
        s.box(color, tx + side * 1.6, ty + 1.8, tz, Math.hypot(3.2, 3.6), 0.13, 7,
          0, 0, -side * Math.atan2(3.6, 3.2));
      }
      s.triangle(C.cream, [[tx - 3.2, ty + 0.12, tz + 3.5], [tx + 3.2, ty + 0.12, tz + 3.5], [tx, ty + 3.6, tz + 3.5]]);
      s.triangle(C.ink, [[tx - 1.1, ty + 0.13, tz + 3.52], [tx + 1.1, ty + 0.13, tz + 3.52], [tx, ty + 2.8, tz + 3.52]]);
      s.triangle(color, [[tx + 3.2, ty + 0.12, tz - 3.5], [tx - 3.2, ty + 0.12, tz - 3.5], [tx, ty + 3.6, tz - 3.5]]);
      s.beam(C.cream, [tx, ty + 3.7, tz - 3.7], [tx, ty + 3.7, tz + 3.7], 0.09);
      s.solid(tx, tz, 3.3, 3.75, 3.7, ty);
    }
    picnicTable(s, -12, 10);
    const fy = s.ground(-12, 19);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      s.sphere(C.cream, -12 + Math.cos(a) * 1.6, fy + 0.25, 19 + Math.sin(a) * 1.6, 0.5, 0.3, 0.45);
    }
    log(s, -12, fy + 0.35, 19, 2.5, 0.25);
    s.cone(C.coral, -12, fy + 0.95, 19, 0.65, 1.25);
    s.cone(C.honey, -12, fy + 0.8, 19, 0.35, 1);
    s.solid(-12, 19, 2.1, 2.1, 1.5, fy);
    bunting(s, -5, -20, 6, -20);
    s.label?.("CAMP FERN", x, y + 5.9, z, C.cream, C.teal, 6, 1.2);
  });

  kit.site("woodland-steam-station", 30, 450, 36, (s) => {
    track(s, -12, -1, 30);
    locomotive(s, -12, -5, C.teal);
    const x = 10, z = -8, y = s.foundation(C.wood, x, z, 10, 8, 0.45);
    s.box(C.honey, x, y + 2.4, z, 9.5, 4.8, 7.5);
    for (const dx of [-4.3, 4.3]) s.box(C.cream, x + dx, y + 2.4, z + 3.8, 0.24, 4.8, 0.2);
    s.box(C.teal, x, y + 1.6, z + 3.84, 1.8, 3.2, 0.18);
    windowFrame(s, x - 3, y + 2.8, z + 3.85);
    windowFrame(s, x + 3, y + 2.8, z + 3.85);
    gableRoof(s, x, y + 5, z, 11.5, 9.5, 2.4, C.coral);
    s.solid(x, z, 4.8, 3.8, 7.4, y);
    s.cylinder(C.cream, x, y + 6.1, z + 4.86, 0.72, 0.72, 0.12, HALF_PI);
    s.beam(C.ink, [x, y + 6.1, z + 4.95], [x, y + 6.58, z + 4.95], 0.05);
    s.beam(C.ink, [x, y + 6.1, z + 4.95], [x + 0.35, y + 5.95, z + 4.95], 0.05);
    picnicTable(s, 12, 10);
    for (const [bx, bz, color] of [[7, 18, C.teal], [10, 18, C.coral]]) {
      const by = s.ground(bx, bz);
      s.box(color, bx, by + 0.75, bz, 2, 1.5, 1.4);
      s.box(C.cream, bx, by + 0.75, bz + 0.73, 0.2, 1.5, 0.08);
      s.torus(C.wood, bx, by + 1.55, bz, 0.32, 0.09);
      s.solid(bx, bz, 1, 0.75, 1.9, by);
    }
    const by = s.ground(-12, 16);
    for (const dx of [-1.4, 1.4]) s.box(C.wood, -12 + dx, by + 0.55, 16, 0.45, 1.1, 1);
    s.box(C.coral, -12, by + 1, 16, 4.3, 0.5, 0.55);
    s.solid(-12, 16, 2.15, 0.5, 1.3, by);
    s.label?.("FERN VALLEY RAILWAY", x, y + 4.3, z + 3.98, C.cream, C.teal, 8, 1.1);
  });
}

export function decorateCityLandmarks(kit) {
  kit.site("little-wheel-fairground", -240, -210, 36, (s) => {
    s.disc(C.mist, 0, 0, 31);
    const x = -10, z = -7, y = s.ground(x, z), cy = y + 15, radius = 10.5;
    for (const side of [-1, 1]) {
      for (const dx of [-6, 6]) {
        const bottom = s.ground(x + dx, z + side * 3.4);
        s.box(C.cream, x + dx, bottom + 0.25, z + side * 3.4, 2, 0.5, 2.2);
        s.beam(C.teal, [x + dx, bottom + 0.5, z + side * 3.4], [x, cy, z + side * 1.4], 0.4);
        s.solid(x + dx, z + side * 3.4, 1, 1.1, 3.4, bottom);
      }
      s.torus(C.cream, x, cy, z + side * 0.8, radius, 0.22);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        s.beam(C.honey, [x, cy, z + side * 0.8],
          [x + Math.sin(a) * radius, cy + Math.cos(a) * radius, z + side * 0.8], 0.1);
      }
    }
    s.cylinder(C.coral, x, cy, z, 1, 1, 3.2, HALF_PI);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, gx = x + Math.sin(a) * radius, gy = cy + Math.cos(a) * radius;
      const color = [C.coral, C.teal, C.honey, C.mist][i % 4];
      s.beam(C.ink, [gx, gy, z - 1.3], [gx, gy, z + 1.3], 0.12);
      for (const side of [-1, 1]) s.beam(C.cream, [gx, gy, z + side * 1.2], [gx, gy - 2.2, z + side * 1.2], 0.09);
      s.box(color, gx, gy - 2.4, z, 2.8, 1.3, 2.6);
      s.box(C.cream, gx, gy - 1.7, z, 3, 0.15, 2.8);
      s.box(color, gx, gy - 0.4, z, 3.1, 0.22, 2.9);
      s.solid(gx, z, 1.55, 1.45, 3, gy - 3.1);
    }
    // Only the machinery strip is blocked, not the whole fairground plaza.
    s.solid(x, z, 7, 4.5, 15, y);
    const bx = 13, bz = -8, by = s.foundation(C.wood, bx, bz, 5, 5, 0.3);
    s.box(C.coral, bx, by + 2, bz, 4.7, 4, 4.7);
    windowFrame(s, bx, by + 2.6, bz + 2.4, 3.3, 1.6);
    s.box(C.honey, bx, by + 1.65, bz + 2.75, 4.3, 0.2, 1);
    s.cone(C.teal, bx, by + 5.4, bz, 4, 2.7);
    s.sphere(C.honey, bx, by + 6.85, bz, 0.25);
    s.solid(bx, bz + 0.25, 2.5, 3, 6.9, by);
    picnicTable(s, 12, 12);
    bunting(s, -19, 14, 2, 14);
    s.label?.("LITTLE WHEEL FAIR", bx, by + 4.1, bz + 2.55, C.cream, C.teal, 7, 1.2);
  });

  kit.site("neighborhood-fire-station", 235, -150, 34, (s) => {
    const x = -11, z = -9, y = s.foundation(C.cream, x, z, 15, 10, 0.5);
    s.box(C.coral, x, y + 4, z, 14.5, 8, 9.5);
    s.box(C.cream, x, y + 0.55, z, 14.7, 0.65, 9.7);
    s.box(C.cream, x, y + 7.8, z, 15, 0.45, 10);
    gableRoof(s, x, y + 8.1, z, 16, 11, 2.4, C.teal);
    for (const dx of [-3.7, 3.7]) {
      s.box(C.cream, x + dx, y + 2.7, z + 4.83, 6, 5.3, 0.25);
      s.box(C.teal, x + dx, y + 2.6, z + 5, 5.4, 4.7, 0.1);
      for (let i = 0; i < 4; i++) s.box(C.cream, x + dx, y + 0.9 + i, z + 5.08, 5.4, 0.08, 0.08);
      windowFrame(s, x + dx, y + 6.5, z + 4.88, 3.6, 1.2);
    }
    s.solid(x, z, 7.5, 5.1, 10.5, y);
    const towerX = x - 4;
    s.box(C.coral, towerX, y + 11, z - 1.5, 4.5, 6, 4.5);
    windowFrame(s, towerX, y + 12, z + 0.81, 2, 2.6);
    s.cone(C.teal, towerX, y + 15.6, z - 1.5, 3.7, 3.2);
    s.cylinder(C.honey, towerX, y + 11.9, z + 0.95, 0.45, 0.75, 0.85);
    s.solid(towerX, z - 1.5, 2.3, 2.3, 9.2, y + 8);

    const tx = 12, tz = -3, ty = s.ground(tx, tz);
    s.box(C.ink, tx, ty + 1.1, tz, 4.5, 0.45, 11.5);
    wheels(s, tx, ty, tz, 4.4, [-3.7, 2.5, 4.2], 1);
    s.box(C.coral, tx, ty + 2.6, tz + 1.8, 4.4, 2.8, 7.3);
    s.box(C.coral, tx, ty + 3, tz - 3.5, 4.4, 3.7, 3.1);
    s.box(C.cream, tx, ty + 4.9, tz - 3.5, 4.6, 0.25, 3.35);
    s.box(C.mist, tx, ty + 3.75, tz - 5.1, 3.8, 1.6, 0.1);
    s.box(C.cream, tx, ty + 3.75, tz - 5.18, 0.15, 1.6, 0.08);
    s.box(C.ink, tx, ty + 2, tz - 5.1, 2.5, 0.8, 0.12);
    s.box(C.cream, tx, ty + 1.25, tz - 5.4, 4.7, 0.35, 0.35);
    for (const side of [-1, 1]) {
      s.box(C.cream, tx + side * 2.25, ty + 2.1, tz + 1.6, 0.1, 0.25, 7.5);
      s.box(C.mist, tx + side * 2.25, ty + 3.7, tz - 3.45, 0.1, 1.5, 2.3);
      s.box(C.honey, tx + side * 1.65, ty + 2.4, tz - 5.19, 0.6, 0.5, 0.14);
      s.sphere(C.teal, tx + side * 1.4, ty + 5.3, tz - 3.5, 0.45, 0.4, 0.45);
      for (const zz of [-0.6, 1.8, 4.2]) {
        s.box(C.cream, tx + side * 2.27, ty + 3.1, tz + zz, 0.12, 1.5, 2);
        s.box(C.ink, tx + side * 2.36, ty + 2.8, tz + zz, 0.08, 0.12, 0.6);
      }
      s.torus(C.ink, tx + side * 2.43, ty + 3.1, tz + 2, 0.62, 0.15, 0, HALF_PI);
      s.box(C.cream, tx + side * 0.72, ty + 4.55, tz + 0.7, 0.16, 0.2, 9.4);
    }
    for (let i = 0; i < 11; i++) s.box(C.cream, tx, ty + 4.55, tz - 3.5 + i * 0.83, 1.5, 0.14, 0.14);
    s.solid(tx, tz + 0.1, 2.6, 5.7, 5.8, ty);
    const hy = s.ground(-14, 12);
    s.cylinder(C.coral, -14, hy + 0.9, 12, 0.45, 0.6, 1.8);
    s.sphere(C.coral, -14, hy + 1.85, 12, 0.5, 0.25, 0.5);
    s.cylinder(C.cream, -14, hy + 1.2, 12, 0.27, 0.27, 1.5, 0, 0, HALF_PI);
    s.solid(-14, 12, 0.8, 0.6, 2.1, hy);
    s.label?.("FIRE & RESCUE", x, y + 7.75, z + 5.25, C.cream, C.teal, 10, 1.2);
  });

  kit.site("toy-railway-depot", 235, 185, 36, (s) => {
    track(s, -12, -1, 30);
    locomotive(s, -12, -6, C.coral);
    const x = 10, z = -10, y = s.foundation(C.wood, x, z, 12, 10, 0.45);
    s.box(C.teal, x, y + 3.1, z, 11.5, 6.2, 9.5);
    for (const dx of [-5.5, 0, 5.5]) s.box(C.cream, x + dx, y + 3.1, z + 4.82, 0.24, 6.2, 0.22);
    for (const dx of [-2.8, 2.8]) {
      s.box(C.wood, x + dx, y + 2, z + 4.9, 4.4, 4, 0.2);
      s.beam(C.cream, [x + dx - 2, y + 0.2, z + 5.05], [x + dx + 2, y + 3.8, z + 5.05], 0.1);
      windowFrame(s, x + dx, y + 5.1, z + 4.88, 3.4, 1.2);
    }
    gableRoof(s, x, y + 6.4, z, 13.5, 11.5, 3, C.ink);
    s.box(C.honey, x, y + 9.6, z, 4, 1, 6);
    s.box(C.cream, x, y + 10.25, z, 4.7, 0.3, 6.5);
    s.solid(x, z, 6, 5.1, 10.5, y);
    const wx = 13, wz = 12, wy = s.ground(wx, wz);
    for (const dx of [-1.8, 1.8]) for (const dz of [-1.8, 1.8]) {
      s.box(C.wood, wx + dx, wy + 3.6, wz + dz, 0.35, 7.2, 0.35);
      s.solid(wx + dx, wz + dz, 0.25, 0.25, 7.2, wy);
    }
    s.cylinder(C.teal, wx, wy + 8, wz, 2.8, 2.8, 3.4);
    for (const yy of [6.5, 9.4]) s.torus(C.cream, wx, wy + yy, wz, 2.85, 0.1, HALF_PI);
    s.cone(C.ink, wx, wy + 10.2, wz, 3.1, 1.1);
    s.beam(C.cream, [wx, wy + 7, wz], [wx - 4.3, wy + 7, wz], 0.18);
    s.beam(C.cream, [wx - 4.3, wy + 7, wz], [wx - 4.3, wy + 4.8, wz], 0.18);
    s.solid(wx, wz, 2.85, 2.85, 4.5, wy + 6.3);
    for (const [cx, cz] of [[5, 19], [8, 20]]) {
      const cy = s.ground(cx, cz);
      s.box(C.honey, cx, cy + 0.9, cz, 2.4, 1.8, 2.4);
      for (const side of [-1, 1]) s.box(C.wood, cx + side * 0.8, cy + 0.9, cz + 1.23, 0.16, 1.8, 0.08);
      s.solid(cx, cz, 1.2, 1.25, 1.8, cy);
    }
    s.label?.("SUNNY SIDINGS", x, y + 6.2, z + 5.15, C.cream, C.teal, 8, 1.1);
  });

  kit.site("busy-builders-yard", -220, 190, 35, (s) => {
    s.disc(C.mist, 0, 0, 30);
    const x = -13, z = -10, y = s.ground(x, z);
    s.box(C.ink, x, y + 0.35, z, 6, 0.7, 6);
    for (const dx of [-1.2, 1.2]) for (const dz of [-1.2, 1.2]) {
      s.box(C.honey, x + dx, y + 10, z + dz, 0.25, 20, 0.25);
    }
    for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
      const low = y + i * 4;
      s.beam(C.honey, [x - 1.2, low, z + side * 1.2], [x + 1.2, low + 4, z + side * 1.2], 0.13);
      s.box(C.cream, x, low + 4, z + side * 1.2, 2.6, 0.14, 0.14);
    }
    s.solid(x, z, 3, 3, 20.5, y);
    s.box(C.honey, x + 6, y + 20.2, z, 28, 0.35, 2.7);
    s.box(C.honey, x + 6, y + 22, z, 28, 0.2, 2.7);
    for (let i = 0; i < 7; i++) {
      const xx = x - 8 + i * 4;
      s.beam(C.cream, [xx, y + 20.4, z + 1.4], [xx + 4, y + 22, z + 1.4], 0.1);
      s.beam(C.cream, [xx, y + 20.4, z - 1.4], [xx + 4, y + 22, z - 1.4], 0.1);
    }
    s.box(C.ink, x - 5.8, y + 19.3, z, 3.5, 1.6, 3.4);
    s.box(C.teal, x + 2.8, y + 19, z + 1.8, 3.4, 2.8, 3);
    windowFrame(s, x + 2.8, y + 19.3, z + 3.34, 2.6, 1.7);
    s.beam(C.ink, [x + 16, y + 20, z], [x + 16, y + 8, z], 0.06);
    s.torus(C.ink, x + 16, y + 7.6, z, 0.45, 0.12);
    s.solid(x + 6, z, 14, 1.75, 3.3, y + 18.8);

    const ex = 13, ez = 7, ey = s.ground(ex, ez);
    for (const side of [-1, 1]) {
      s.box(C.ink, ex + side * 1.75, ey + 0.7, ez, 1, 1.4, 6.4);
      for (const zz of [-2.2, 0, 2.2]) {
        s.cylinder(C.honey, ex + side * 2.28, ey + 0.7, ez + zz, 0.46, 0.46, 0.1, 0, 0, HALF_PI);
      }
      for (const zz of [-2.7, -0.9, 0.9, 2.7]) s.box(C.cream, ex + side * 1.75, ey + 1.43, ez + zz, 1.05, 0.09, 0.18);
    }
    s.cylinder(C.ink, ex, ey + 1.65, ez, 1.7, 1.7, 0.5);
    s.box(C.honey, ex, ey + 2.5, ez + 0.3, 4.6, 1.4, 4.5);
    s.box(C.teal, ex - 0.9, ey + 4, ez + 0.1, 2.5, 2.6, 2.7);
    s.box(C.mist, ex - 0.9, ey + 4.3, ez - 1.29, 2.1, 1.7, 0.1);
    s.box(C.mist, ex - 2.2, ey + 4.3, ez + 0.1, 0.1, 1.7, 2.2);
    s.box(C.cream, ex - 0.9, ey + 5.4, ez + 0.1, 2.8, 0.2, 3);
    s.beam(C.honey, [ex + 1.1, ey + 2.8, ez - 1], [ex + 1.1, ey + 7, ez - 4.3], 0.45);
    s.beam(C.honey, [ex + 1.1, ey + 7, ez - 4.3], [ex + 1.1, ey + 1.5, ez - 7], 0.35);
    s.beam(C.cream, [ex + 1.5, ey + 3, ez - 1.5], [ex + 1.5, ey + 6.5, ez - 4], 0.13);
    s.beam(C.ink, [ex + 1.5, ey + 6.5, ez - 4], [ex + 1.5, ey + 3.4, ez - 6.2], 0.1);
    s.box(C.ink, ex + 1.1, ey + 0.65, ez - 7.2, 2.8, 1.3, 2.2, -0.2);
    for (const dx of [-0.9, 0, 0.9]) s.box(C.honey, ex + 1.1 + dx, ey + 0.2, ez - 8.45, 0.3, 0.3, 0.8);
    s.solid(ex, ez, 2.35, 3.2, 5.5, ey);
    s.solid(ex + 1.1, ez - 7.5, 1.45, 1.4, 1.8, ey);
    s.solid(ex + 1.1, ez - 4.2, 0.5, 2.3, 7.2, ey);
    const py = s.ground(-12, 12);
    for (const dz of [-1.7, 0, 1.7]) {
      s.cylinder(C.cream, -12, py + 0.85, 12 + dz, 0.82, 0.82, 5.5, 0, 0, HALF_PI);
      for (const side of [-1, 1]) s.cylinder(C.ink, -12 + side * 2.79, py + 0.85, 12 + dz,
        0.58, 0.58, 0.04, 0, 0, HALF_PI);
    }
    s.solid(-12, 12, 2.85, 2.55, 1.7, py);
    s.label?.("BUSY BUILDERS", x, y + 5, z + 1.5, C.ink, C.honey, 7, 1.3);
  });

  kit.site("sundae-market", 0, 245, 34, (s) => {
    s.disc(C.mist, 0, 0, 29);
    const x = -12, z = -10, y = s.foundation(C.cream, x, z, 9, 8, 0.4);
    s.box(C.teal, x, y + 2.5, z, 8.6, 5, 7.6);
    s.box(C.cream, x, y + 0.5, z, 8.8, 0.6, 7.8);
    windowFrame(s, x, y + 3, z + 3.9, 6.5, 2.2);
    s.box(C.honey, x, y + 1.8, z + 4.3, 8.3, 0.2, 1.2);
    for (let i = 0; i < 7; i++) {
      s.box(i % 2 ? C.cream : C.coral, x - 3.9 + i * 1.3, y + 4.9, z + 4.4, 1.3, 0.16, 2.4, 0.12);
      s.box(i % 2 ? C.cream : C.coral, x - 3.9 + i * 1.3, y + 4.5, z + 5.55, 1.3, 0.6, 0.15);
    }
    s.box(C.cream, x, y + 5.2, z, 9.6, 0.3, 8.6);
    s.cone(C.honey, x, y + 7.4, z, 1.8, 4, Math.PI);
    for (const yy of [6.4, 7.5, 8.4]) {
      const r = (yy - 5.4) * 0.45;
      s.torus(C.wood, x, y + yy, z, r, 0.055, HALF_PI);
    }
    s.sphere(C.cream, x, y + 9.5, z, 2.1, 1.9, 2.1);
    s.sphere(C.coral, x + 0.85, y + 10.8, z, 1.6, 1.5, 1.6);
    s.sphere(C.coral, x - 0.4, y + 11.4, z, 0.4);
    s.solid(x, z + 0.6, 4.8, 5.1, 5.5, y);

    for (const [sx, sz, color] of [[12, -12, C.honey], [13, 9, C.coral]]) {
      const sy = s.ground(sx, sz);
      s.box(C.wood, sx, sy + 1.4, sz, 7, 2.4, 3.5);
      s.box(C.cream, sx, sy + 2.65, sz, 7.4, 0.2, 4);
      for (const dx of [-3.4, 3.4]) {
        s.box(C.wood, sx + dx, sy + 2.75, sz, 0.18, 5.5, 0.18);
      }
      for (let i = 0; i < 5; i++) {
        s.box(i % 2 ? C.cream : color, sx - 3.2 + i * 1.6, sy + 5.2, sz,
          1.6, 0.18, 5.2, 0.1);
        s.box(i % 2 ? C.cream : color, sx - 3.2 + i * 1.6, sy + 4.75, sz + 2.55,
          1.6, 0.6, 0.15);
      }
      for (const dx of [-2.2, 0, 2.2]) {
        s.box(C.wood, sx + dx, sy + 2.9, sz, 1.8, 0.5, 2.4);
        for (const dz of [-0.6, 0.6]) s.sphere(dx === 0 ? C.honey : color,
          sx + dx, sy + 3.35, sz + dz, 0.5, 0.45, 0.5);
      }
      s.solid(sx, sz, 3.7, 2, 5.5, sy);
    }
    picnicTable(s, -12, 11);
    const uy = s.ground(-12, 11);
    s.cylinder(C.cream, -12, uy + 3, 11, 0.1, 0.1, 6);
    s.cone(C.coral, -12, uy + 6, 11, 4.3, 1.5);
    s.sphere(C.honey, -12, uy + 6.85, 11, 0.22);
    bunting(s, -5, 20, 6, 20);
    s.label?.("SUNDAE MARKET", x, y + 5.6, z + 4.45, C.cream, C.teal, 8, 1.2);
  });
}
