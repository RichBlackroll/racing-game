import { AMSTERDAM } from "./amsterdam-layout.js";

// Compressed architectural studies, not surveyed replicas. All heights are
// relative to the site's land datum; only the supplied kit creates geometry.
function sheet(k, material, points, options) {
  k.panel(material, points, options);
  k.panel(material, [...points].reverse(), { ...options, name: `${options.name}-reverse` });
}

function hipRoof(k, x, y, z, w, d, rise, options, ridge = w * 0.55) {
  const a = [x - w / 2, y, z - d / 2], b = [x + w / 2, y, z - d / 2];
  const c = [x + w / 2, y, z + d / 2], e = [x - w / 2, y, z + d / 2];
  const left = [x - ridge / 2, y + rise, z], right = [x + ridge / 2, y + rise, z];
  for (const [face, points] of [["front", [e, c, right, left]], ["rear", [b, a, left, right]],
    ["left", [a, e, left]], ["right", [c, b, right]], ["soffit", [a, b, c, e]]]) {
    k.panel("roof", points, { ...options, name: `${options.name}-${face}` });
  }
  k.beam("metal", left, right, 0.18, 0.22, { ...options, name: `${options.name}-ridge` });
}

// Closed, outward-wound octagonal frusta keep the mill and lantern silhouettes
// independent of the parent's cylinder tessellation. Here y is the bottom.
function octagon(k, material, x, y, z, r0, r1, h, options) {
  const ring = (r, py) => Array.from({ length: 8 }, (_, i) => {
    const a = Math.PI / 8 + i * Math.PI / 4;
    return [x + Math.cos(a) * r, py, z + Math.sin(a) * r];
  });
  const bottom = ring(r0, y), top = ring(r1, y + h);
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8;
    k.panel(material, [bottom[i], top[i], top[j], bottom[j]], { ...options, name: `${options.name}-facet-${i}` });
  }
  k.panel(material, bottom, { ...options, name: `${options.name}-bottom` });
  k.panel(material, [...top].reverse(), { ...options, name: `${options.name}-top` });
}

function facadeWindow(k, x, y, z, w, h, p, tablet, { shape = "square", ry = 0, name = "window" } = {}) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const box = (material, u, v, out, width, height, depth, color, feature) => {
    k.box(material, x + c * u + s * out, y + v, z - s * u + c * out, width, height, depth,
      { color, ry, name: `${name}-${feature}` });
  };
  if (shape === "square") {
    box("stone", 0, h / 2 + 0.05, 0, w + 0.48, h + 0.4, 0.28, p.stone, "stone-surround");
    box("glass", 0, h / 2, 0.22, w, h, 0.12, p.glass, "glazing");
  } else {
    const profile = (width, height) => {
      if (shape === "pointed") return [[-width / 2, 0], [width / 2, 0], [width / 2, height * 0.65],
        [0, height], [-width / 2, height * 0.65]];
      const r = width / 2, spring = height - r, segments = tablet ? 6 : 10;
      return [[-r, 0], [r, 0], ...Array.from({ length: segments + 1 }, (_, i) => {
        const a = i * Math.PI / segments;
        return [Math.cos(a) * r, spring + Math.sin(a) * r];
      })];
    };
    k.extrude("stone", profile(w + 0.5, h + 0.4), 0.28, x, y - 0.16, z,
      { color: p.stone, ry, name: `${name}-${shape}-surround` });
    k.extrude("glass", profile(w, h), 0.12, x + s * 0.22, y, z + c * 0.22,
      { color: p.glass, ry, name: `${name}-${shape}-glazing` });
  }
  box("stone", 0, -0.12, 0.12, w + 0.78, 0.24, 0.66, p.stone, "projecting-sill");
  box("stone", 0, h * 0.45, 0.33, 0.12, h * 0.9, 0.12, p.stone, "mullion");
  if (!tablet) {
    for (const fraction of [0.32, 0.65]) {
      box("stone", 0, h * fraction, 0.33, w, 0.11, 0.12, p.stone, "transom");
    }
    box("stone", 0, h + 0.12, 0.2, shape === "square" ? w + 0.8 : 0.42, 0.28, 0.52,
      p.stone, shape === "square" ? "lintel-hood" : "arch-keystone");
  }
}

function steppedGable(k, x, y, z, w, h, p, name) {
  const points = [[-0.5, 0], [0.5, 0], [0.5, 0.22], [0.34, 0.22], [0.34, 0.48],
    [0.2, 0.48], [0.2, 0.74], [0.08, 0.74], [0.08, 1], [-0.08, 1], [-0.08, 0.74],
    [-0.2, 0.74], [-0.2, 0.48], [-0.34, 0.48], [-0.34, 0.22], [-0.5, 0.22]]
    .map(([px, py]) => [px * w, py * h]);
  k.extrude("masonry", points, 0.6, x, y, z, { color: p.brick, name: `${name}-stepped-gable` });
  for (let i = 2; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a[1] !== b[1]) continue;
    k.box("stone", x + (a[0] + b[0]) / 2, y + a[1] + 0.08, z,
      Math.abs(b[0] - a[0]) + 0.2, 0.2, 0.86, { color: p.stone, name: `${name}-step-coping` });
  }
  k.cone("stone", x, y + h + 0.58, z, 0.23, 0.9, { color: p.stone, name: `${name}-gable-finial` });
}

function clock(k, x, y, z, r, p, ry = 0, name = "tower") {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (u, v, out) => [x + c * u + s * out, y + v, z - s * u + c * out];
  const disc = radius => Array.from({ length: 24 }, (_, i) => {
    const a = i * Math.PI / 12;
    return [Math.cos(a) * radius, Math.sin(a) * radius];
  });
  k.extrude("metal", disc(r + 0.17), 0.18, x, y, z, { color: p.gold, ry, name: `${name}-clock-rim` });
  k.extrude("paint", disc(r), 0.08, ...at(0, 0, 0.14), { color: p.stone, ry, name: `${name}-clock-face` });
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, inside = i % 3 === 0 ? 0.69 : 0.78;
    k.beam("metal", at(Math.sin(a) * r * inside, Math.cos(a) * r * inside, 0.21),
      at(Math.sin(a) * r * 0.91, Math.cos(a) * r * 0.91, 0.21), r * 0.065, 0.07,
      { color: p.metal, name: `${name}-clock-hour-marker` });
  }
  for (const [angle, length, hand] of [[-Math.PI / 3, 0.5, "hour"], [Math.PI * 0.27, 0.76, "minute"]]) {
    k.beam("metal", at(0, 0, 0.26), at(Math.sin(angle) * r * length, Math.cos(angle) * r * length, 0.26),
      r * 0.085, 0.08, { color: p.metal, name: `${name}-clock-${hand}-hand` });
  }
  k.extrude("metal", disc(r * 0.1), 0.08, ...at(0, 0, 0.3), { color: p.gold, ry, name: `${name}-clock-hub` });
}

function cityShield(k, x, y, z, w, h, p, name) {
  const shield = scale => [[0, -h / 2], [w / 2, -h * 0.2], [w / 2, h / 2],
    [-w / 2, h / 2], [-w / 2, -h * 0.2]].map(([px, py]) => [px * scale, py * scale]);
  k.extrude("metal", shield(1.13), 0.2, x, y, z, { color: p.gold, name: `${name}-shield-border` });
  k.extrude("paint", shield(1), 0.12, x, y, z + 0.15, { color: 0xa63c36, name: `${name}-amsterdam-coat-of-arms` });
  k.box("paint", x, y + h * 0.06, z + 0.25, w * 0.31, h * 0.76, 0.08,
    { color: p.metal, name: `${name}-shield-pale` });
  for (const v of [-0.2, 0.06, 0.32]) for (const direction of [-1, 1]) {
    const a = w * 0.115;
    k.beam("paint", [x - a, y + v * h - a * direction, z + 0.33],
      [x + a, y + v * h + a * direction, z + 0.33], w * 0.065, 0.08,
      { color: p.stone, name: `${name}-amsterdam-saltire` });
  }
}

function dutchFlag(k, x, y, z, w, h, name) {
  k.beam("metal", [x, y - h - 2.5, z], [x, y + 0.45, z], 0.12, 0.12,
    { color: 0x5a625e, name: `${name}-flagpole` });
  for (let stripe = 0; stripe < 3; stripe++) for (let i = 0; i < 3; i++) {
    const edge = (t, bottom) => [x + t * w, y - (stripe + bottom) * h / 3 - Math.sin(t * Math.PI) * 0.12,
      z + Math.sin(t * Math.PI * 2) * 0.22];
    sheet(k, "paint", [edge(i / 3, 1), edge((i + 1) / 3, 1), edge((i + 1) / 3, 0), edge(i / 3, 0)],
      { color: [0xb74642, 0xeee8d8, 0x2e5186][stripe], name: `${name}-dutch-flag-${stripe}-${i}` });
  }
}

/** Decorate exactly the six reserved sites using the parent's local mesh kit. */
export function decorateAmsterdamLandmarks({ site, tablet = false }) {
  const builders = {
    centraal(k) {
      const p = { brick: 0x9b4d38, stone: 0xddc8a5, roof: 0x3c4954, glass: 0x304c55,
        metal: 0x25363a, gold: 0xc7a359 };
      for (const side of [-1, 1]) {
        const x = side * 46;
        k.building("station-museum-wing", x, 0, 54, 22, 18.5);
        k.box("masonry", x, 9.5, 0, 54, 18, 22, { color: p.brick, name: "red-brick-station-wing" });
        for (const y of [0.6, 8.6, 10.3, 18.5]) {
          k.box("stone", x, y, 0, 54.4, y === 0.6 ? 1.2 : 0.36, 22.4,
            { color: p.stone, name: "wing-stone-string-course" });
        }
        hipRoof(k, x, 18.8, 0, 54.8, 23, 6.1, { color: p.roof, name: "wing-slate-hipped-roof" }, 45);
        for (let i = 0; i < 8; i++) {
          const bay = side * (28 + i * 5.45);
          facadeWindow(k, bay, 2, 11.07, 2.9, 5.9, p, tablet, { shape: "arched", name: "station-arcade-window" });
          facadeWindow(k, bay, 11.5, 11.07, 2.8, 5.4, p, tablet, { shape: "arched", name: "station-tall-window" });
          facadeWindow(k, bay, 13.5, -11.07, 2.6, 3.5, p, tablet, { ry: Math.PI, name: "platform-clerestory" });
          if (!tablet) {
            k.box("stone", bay + side * 2.1, 13.9, 11.25, 0.27, 7.1, 0.4,
              { color: p.stone, name: "wing-carved-pilaster" });
          }
        }
        for (const bay of [29, 41, 53, 65]) {
          k.extrude("roof", [[-2, 0], [2, 0], [0, 3.2]], 3.7, side * bay, 20.4, 7.2,
            { color: p.roof, name: "station-slate-dormer-roof" });
          k.extrude("masonry", [[-1.8, 0], [1.8, 0], [0, 3]], 0.4, side * bay, 20.4, 9.15,
            { color: p.brick, name: "station-dormer-gable" });
          facadeWindow(k, side * bay, 20.7, 9.4, 1.05, 1.6, p, tablet, { shape: "arched", name: "station-dormer-window" });
        }

        const end = side * 78.3;
        k.building("station-end-pavilion", end, 1, 14.4, 26, 24.2);
        k.box("masonry", end, 12.3, 1, 14.4, 23.8, 26, { color: p.brick, name: "projecting-end-pavilion" });
        for (const y of [0.65, 8.9, 17.2, 24.2]) {
          k.box("stone", end, y, 1, 14.9, y < 1 ? 1.3 : 0.5, 26.5,
            { color: p.stone, name: "pavilion-stone-cornice" });
        }
        hipRoof(k, end, 24.5, 1, 15.2, 27, 7.4, { color: p.roof, name: "pavilion-mansard-silhouette" }, 5.2);
        for (const dx of [-4.4, 0, 4.4]) for (const [y, h] of [[2, 5.8], [10.3, 5.5], [18.3, 3.8]]) {
          facadeWindow(k, end + dx, y, 14.08, 2.1, h, p, tablet, { shape: "arched", name: "pavilion-arched-window" });
        }
        for (const z of [-7, 0, 7]) for (const y of [3, 12]) {
          facadeWindow(k, side * 85.56, y, z, 2.6, 5.7, p, tablet,
            { shape: "arched", ry: side * Math.PI / 2, name: "pavilion-side-window" });
        }
        for (const dx of [-6.4, 6.4]) for (let j = 0; j < (tablet ? 6 : 10); j++) {
          k.box("stone", end + dx, 2 + j * (tablet ? 3.65 : 2.2), 14.16, 0.85, 0.6, 0.5,
            { color: p.stone, name: "pavilion-rusticated-quoin" });
        }
        k.beam("metal", [end, 31.8, 1], [end, 34.4, 1], 0.17, 0.17, { color: p.gold, name: "pavilion-roof-finial" });
      }

      k.building("station-central-hall", 0, 1, 34, 26, 23);
      k.box("masonry", 0, 11.7, 1, 34, 22.6, 26, { color: p.brick, name: "central-ticket-hall" });
      for (const y of [0.6, 9.3, 18.2, 23]) {
        k.box("stone", 0, y, 1, 34.4, y < 1 ? 1.2 : 0.5, 26.4, { color: p.stone, name: "central-hall-stone-course" });
      }
      hipRoof(k, 0, 23.3, 1, 35, 27, 8.5, { color: p.roof, name: "central-hall-slate-roof" }, 13);
      k.extrude("masonry", [[-12, 0], [12, 0], [9.5, 3], [6, 3], [0, 10], [-6, 3], [-9.5, 3]],
        0.8, 0, 22.5, 14, { color: p.brick, name: "central-ornamental-gable" });
      for (const side of [-1, 1]) {
        k.beam("stone", [side * 10, 25.4, 14.5], [0, 32.8, 14.5], 0.38, 0.5,
          { color: p.stone, name: "central-gable-stone-rake" });
      }
      cityShield(k, 0, 27.5, 14.55, 2.7, 4.3, p, "central-gable");
      for (const x of [-11, -5.5, 0, 5.5, 11]) {
        facadeWindow(k, x, 1.2, 14.1, 3.5, 7.2, p, tablet, { shape: "arched", name: "ticket-hall-entrance-arch" });
        facadeWindow(k, x, 11, 14.1, 2.9, 5.7, p, tablet, { shape: "arched", name: "ticket-hall-upper-window" });
      }
      for (const side of [-1, 1]) {
        const x = side * 20.2;
        k.building("station-clock-pavilion", x, 10.6, 7.8, 10, 33);
        k.box("masonry", x, 16.7, 10.6, 7.8, 32.6, 10, { color: p.brick, name: "twin-clock-badge-tower" });
        for (const y of [1, 10, 20, 26, 33]) {
          k.box("stone", x, y, 10.6, 8.4, 0.5, 10.6, { color: p.stone, name: "clock-tower-stone-course" });
        }
        for (const dx of [-3.25, 3.25]) {
          k.box("stone", x + dx, 16.5, 15.73, 0.5, 32, 0.46, { color: p.stone, name: "clock-tower-corner-pilaster" });
        }
        for (const y of [2, 12, 21]) {
          facadeWindow(k, x, y, 15.72, 2.6, y === 21 ? 3.8 : 5.5, p, tablet,
            { shape: "arched", name: "clock-tower-lancet" });
        }
        if (side < 0) clock(k, x, 29.6, 15.86, 2.3, p, 0, "station");
        else cityShield(k, x, 29.5, 15.95, 3, 4.5, p, "station-badge");
        hipRoof(k, x, 33.3, 10.6, 9.1, 11.3, 7.4, { color: p.roof, name: "clock-tower-steep-slate-roof" }, 2.4);
        k.beam("metal", [x, 40.7, 10.6], [x, 43, 10.6], 0.18, 0.18, { color: p.gold, name: "clock-tower-finial" });
        k.sphere("metal", x, 41.7, 10.6, 0.32, 0.4, 0.32, { color: p.gold, name: "clock-tower-gilded-orb" });
      }
      for (let i = 0; i < 3; i++) {
        k.box("stone", 0, 0.12 + i * 0.14, 16.8 - i * 0.6, 29, 0.24, 1.2,
          { color: p.stone, name: "station-entrance-step" });
      }
      k.sign("AMSTERDAM CENTRAAL", 0, 19.9, 14.5, 25, 1.7,
        { name: "station-name-sign", background: "#26373b", ink: "#f0dfb7" });

      const arc = Array.from({ length: 9 }, (_, i) => {
        const a = i * Math.PI / 8;
        return [10 + Math.sin(a) * 3.3, -14 + Math.cos(a) * 3.3];
      });
      k.box("stone", 0, 0.15, -14.1, 148, 0.3, 6.4, { color: 0xa69d88, name: "rear-platform-paving" });
      for (let i = 0; i < 8; i++) {
        const [y0, z0] = arc[i], [y1, z1] = arc[i + 1];
        sheet(k, "glass", [[-74, y0, z0], [74, y0, z0], [74, y1, z1], [-74, y1, z1]],
          { color: 0x749b9e, name: "rear-platform-glass-barrel-canopy" });
        if (i % 2 === 0) k.beam("metal", [-74, y0, z0], [74, y0, z0], 0.12, 0.12,
          { color: p.metal, name: "platform-canopy-longitudinal-purlin" });
      }
      for (let x = -72; x <= 72; x += tablet ? 24 : 12) {
        for (let i = 0; i < 8; i++) {
          k.beam("metal", [x, ...arc[i]], [x, ...arc[i + 1]], 0.16, 0.19,
            { color: p.metal, name: "platform-canopy-arched-iron-rib" });
        }
        k.cylinder("metal", x, 5.1, -17.25, 0.15, 9.9, { color: p.metal, name: "platform-canopy-iron-column" });
        k.beam("metal", [x, 8.1, -17.25], [x, 11.25, -15.7], 0.13, 0.13,
          { color: p.metal, name: "platform-canopy-knee-brace" });
      }
    },

    rijksmuseum(k) {
      const p = { brick: 0x954d3e, stone: 0xd4c4a6, roof: 0x39434f, glass: 0x304754,
        metal: 0x303839, gold: 0xc5a05f };
      // Full-width rear pavilions sit beyond the ends of the cross streets.
      // Front wings are inset symmetrically, especially clear of x=70.
      k.box("stone", 0, 0.065, 17.8, 119, 0.13, 4.1, { color: 0xb6aaa0, name: "museum-courtyard-paving" });
      k.box("stone", 0, 0.07, -1, 13.7, 0.14, 38, { color: 0xb6aaa0, name: "open-passage-paving" });
      for (let x = -56; x <= 56; x += tablet ? 14 : 7) {
        k.box("stone", x, 0.14, 17.8, 0.07, 0.035, 4, { color: p.stone, name: "courtyard-paving-joint" });
      }
      for (const side of [-1, 1]) {
        const x = side * 39;
        k.building("museum-gallery-wing", x, -4, 40, 28, 21);
        k.box("masonry", x, 10.7, -4, 40, 20.6, 28, { color: p.brick, name: "museum-red-brick-gallery-wing" });
        for (const y of [0.6, 7.1, 9.2, 15.4, 21]) {
          k.box("stone", x, y, -4, 40.4, y < 1 ? 1.2 : 0.34, 28.35, { color: p.stone, name: "museum-stone-belt-course" });
        }
        hipRoof(k, x, 21.3, -4, 41.1, 28.9, 7.5, { color: p.roof, name: "museum-gallery-slate-hipped-roof" }, 28);
        for (const bay of [25, 32, 39, 46]) for (const y of [1.7, 10.3]) {
          facadeWindow(k, side * bay, y, 10.08, 3.4, 5.2, p, tablet,
            { shape: y < 2 ? "arched" : "square", name: "museum-stone-ornamented-window" });
        }
        for (const bay of [25, 32, 39, 46, 53]) for (const y of [2.3, 11.3]) {
          facadeWindow(k, side * bay, y, -18.08, 3, 5.8, p, tablet, { ry: Math.PI, name: "museum-rear-window" });
        }
        for (const z of [-13, -6, 1]) for (const y of [3, 11.5]) {
          facadeWindow(k, side * 59.08, y, z, 3.2, 5.4, p, tablet,
            { ry: side * Math.PI / 2, shape: "arched", name: "museum-side-arched-window" });
        }
        for (const bay of [27, 38, 49]) {
          k.extrude("roof", [[-2.5, 0], [2.5, 0], [0, 6]], 4.4, side * bay, 22, 8.3,
            { color: p.roof, name: "museum-dormer-slate-roof" });
          steppedGable(k, side * bay, 22, 10.65, 5.4, 6.2, p, "museum-dormer");
          facadeWindow(k, side * bay, 22.7, 11, 1.5, 2.3, p, tablet, { shape: "arched", name: "museum-dormer-window" });
        }

        const end = side * 53;
        k.building("museum-front-pavilion", end, 5, 13.6, 16, 25.1);
        k.box("masonry", end, 12.8, 5, 13.6, 24.6, 16, { color: p.brick, name: "museum-projecting-front-pavilion" });
        for (const y of [0.65, 8, 16.2, 25.1]) {
          k.box("stone", end, y, 5, 14, y < 1 ? 1.3 : 0.45, 16.4,
            { color: p.stone, name: "museum-pavilion-cornice" });
        }
        hipRoof(k, end, 25.4, 5, 14.4, 16.8, 8.2, { color: p.roof, name: "museum-pavilion-steep-roof" }, 3.4);
        for (const dx of [-3.3, 3.3]) for (const [y, h] of [[2, 5.4], [9.5, 5.2], [18, 4.8]]) {
          facadeWindow(k, end + dx, y, 13.08, 2.8, h, p, tablet,
            { shape: "arched", name: "museum-pavilion-window" });
        }
        for (const dx of [-6, 6]) {
          k.box("stone", end + dx, 12.6, 13.13, 0.5, 24, 0.54,
            { color: p.stone, name: "museum-pavilion-corner-quoin" });
        }
        const rear = side * 61.5;
        k.building("museum-rear-return", rear, -16.4, 12, 6.2, 18.2);
        k.box("masonry", rear, 9.3, -16.4, 12, 17.8, 6.2, { color: p.brick, name: "museum-wide-rear-return" });
        k.box("stone", rear, 18.2, -16.4, 12.5, 0.45, 6.5, { color: p.stone, name: "rear-return-cornice" });
        hipRoof(k, rear, 18.5, -16.4, 13, 6.8, 3.8, { color: p.roof, name: "rear-return-hipped-roof" }, 7);
        for (const dx of [-3.4, 0, 3.4]) {
          facadeWindow(k, rear + dx, 9.5, -19.56, 1.75, 5, p, tablet, { ry: Math.PI, name: "rear-return-window" });
        }

        const tower = side * 14.6;
        k.building("museum-portal-tower", tower, 9.2, 9.2, 13.8, 33);
        k.box("masonry", tower, 16.7, 9.2, 9.2, 32.6, 13.8, { color: p.brick, name: "museum-twin-tower" });
        for (const y of [0.7, 8.5, 17.5, 26, 33]) {
          k.box("stone", tower, y, 9.2, 9.8, 0.5, 14.3, { color: p.stone, name: "museum-tower-stone-band" });
        }
        for (const dx of [-3.9, 3.9]) {
          k.box("stone", tower + dx, 17, 16.24, 0.45, 31.5, 0.5, { color: p.stone, name: "museum-tower-quoin" });
        }
        for (const y of [2, 10.4, 19]) {
          facadeWindow(k, tower, y, 16.24, 3, 5.8, p, tablet, { shape: "pointed", name: "museum-tower-pointed-window" });
        }
        for (const dx of [-1.8, 1.8]) {
          facadeWindow(k, tower + dx, 27.1, 16.25, 1.3, 4.3, p, tablet,
            { shape: "arched", name: "museum-tower-paired-lancet" });
        }
        hipRoof(k, tower, 33.4, 9.2, 10.6, 15, 14.7, { color: p.roof, name: "museum-twin-steep-slate-spire" }, 1.4);
        for (const dx of [-4.3, 4.3]) for (const dz of [-6, 6]) {
          k.cone("roof", tower + dx, 34.4, 9.2 + dz, 0.6, 3.1,
            { color: p.roof, name: "museum-tower-corner-pinnacle" });
        }
        k.beam("metal", [tower, 48.1, 9.2], [tower, 50.4, 9.2], 0.17, 0.17,
          { color: p.gold, name: "museum-tower-spire-finial" });
      }

      // Piers, separate spandrels and a raised hall leave a real pointed opening:
      // no wall, glazing or ground-level AABB spans the central 14m passage.
      for (const side of [-1, 1]) {
        k.building("museum-portal-pier", side * 8.5, 3.7, 3, 25.4, 14);
        k.box("masonry", side * 8.5, 7, 3.7, 3, 14, 25.4, { color: p.brick, name: "open-portal-pier" });
        const points = side < 0 ? [[-10, 7], [-7, 7], [0, 14], [-10, 14]]
          : [[0, 14], [7, 7], [10, 7], [10, 14]];
        k.extrude("masonry", points, 25.4, 0, 0, 3.7, { color: p.brick, name: "pointed-portal-spandrel" });
        k.box("stone", side * 7.08, 3.5, 16.55, 0.48, 7, 0.65, { color: p.stone, name: "portal-stone-jamb" });
        for (const z of [16.6, -9.15]) {
          k.beam("stone", [side * 7.08, 7, z], [0, 14.05, z], 0.55, 0.65,
            { color: p.stone, name: "pointed-portal-arch-rib" });
        }
        if (!tablet) for (const t of [0.2, 0.4, 0.6, 0.8]) {
          k.box("stone", side * 7 * (1 - t), 7 + 7 * t, 16.62, 0.55, 0.8, 0.76,
            { color: p.stone, rz: side * Math.PI / 4, name: "portal-arch-voussoir" });
        }
      }
      k.building("museum-raised-portal-hall", 0, 3.7, 20, 25.4, 12, 14);
      k.box("masonry", 0, 20, 3.7, 20, 12, 25.4, { color: p.brick, name: "raised-hall-over-open-portal" });
      for (const y of [15.4, 23, 26]) {
        k.box("stone", 0, y, 3.7, 20.5, 0.4, 25.8, { color: p.stone, name: "portal-hall-stone-frieze" });
      }
      for (const x of [-6, -2, 2, 6]) {
        facadeWindow(k, x, 17, 16.48, 2.1, 4.8, p, tablet, { shape: "arched", name: "portal-hall-gallery-window" });
      }
      k.extrude("roof", [[-10.7, 0], [10.7, 0], [0, 10.2]], 26.4, 0, 26.3, 3.7,
        { color: p.roof, name: "museum-central-gabled-roof" });
      steppedGable(k, 0, 26, 17.02, 19.8, 10.2, p, "museum-central");
      facadeWindow(k, 0, 27.3, 17.37, 3.4, 4.5, p, tablet, { shape: "pointed", name: "central-gable-lancet" });
      k.sign("RIJKSMUSEUM", 0, 24.55, 16.9, 16.4, 1.35,
        { name: "museum-name-sign", background: "#813e34", ink: "#f2e4c9" });
      for (const side of [-1, 1]) for (let i = 0; i < (tablet ? 3 : 6); i++) {
        const x = side * (24 + i * (tablet ? 12 : 6));
        k.box("stone", x, 19.2, 10.3, 1.35, 1.6, 0.32, { color: p.stone, name: "museum-facade-relief-tablet" });
        k.extrude("masonry", [[0, -0.47], [0.47, 0], [0, 0.47], [-0.47, 0]], 0.12, x, 19.2, 10.51,
          { color: p.brick, name: "museum-diamond-relief" });
      }
    },

    westerkerk(k) {
      const p = { brick: 0x947255, stone: 0xd9ccb0, roof: 0x57948b, glass: 0x314e53,
        metal: 0x283a3b, gold: 0xd8b557 };
      k.building("church-nave", 0, -3, 14, 38, 21);
      k.box("masonry", 0, 10.7, -3, 14, 20.6, 38, { color: p.brick, name: "basilica-raised-nave" });
      for (const y of [0.6, 12, 21]) {
        k.box("stone", 0, y, -3, 14.5, y < 1 ? 1.2 : 0.46, 38.4,
          { color: p.stone, name: "church-nave-stone-cornice" });
      }
      k.extrude("roof", [[-8, 0], [8, 0], [0, 8]], 40, 0, 21.3, -3,
        { color: p.roof, name: "basilica-pitched-copper-roof" });
      for (const z of [-23.06, 17.06]) {
        k.extrude("masonry", [[-7, 0], [7, 0], [0, 7.1]], 0.2, 0, 21.3, z,
          { color: p.brick, name: "church-nave-end-gable" });
        for (const side of [-1, 1]) {
          k.beam("stone", [side * 7.2, 21.3, z], [0, 28.65, z], 0.3, 0.38,
            { color: p.stone, name: "church-gable-stone-rake" });
        }
      }
      for (let x = -6; x <= 6; x += tablet ? 3 : 1.5) {
        const y = 29.34 - Math.abs(x);
        k.beam("metal", [x, y, -23], [x, y, 17], 0.075, 0.08, { color: 0x376e69, name: "copper-roof-standing-seam" });
      }
      k.beam("metal", [0, 29.4, -23], [0, 29.4, 17], 0.2, 0.2, { color: p.roof, name: "church-copper-ridge" });
      for (const side of [-1, 1]) {
        k.building("church-side-aisle", side * 11, -3, 8, 37, 12.3);
        k.box("masonry", side * 11, 6.4, -3, 8, 11.8, 37, { color: p.brick, name: "basilica-low-side-aisle" });
        k.box("stone", side * 11, 0.6, -3, 8.5, 1.2, 37.6, { color: p.stone, name: "aisle-stone-plinth" });
        k.box("stone", side * 11, 12.3, -3, 8.6, 0.42, 37.6, { color: p.stone, name: "aisle-eaves-cornice" });
        k.extrude("roof", [[-4.5, 0], [4.5, 0], [-4.5, 4.6]], 38.3, side * 11, 12.55, -3,
          { color: p.roof, ry: side < 0 ? Math.PI : 0, name: "copper-aisle-lean-to-roof" });
        for (const z of [-19, -12, -5, 2, 9, 15]) {
          k.box("masonry", side * 15.35, 6.5, z, 1.3, 12.3, 1.5, { color: p.brick, name: "church-masonry-buttress" });
          k.box("stone", side * 15.35, 12.7, z, 1.65, 0.38, 1.85, { color: p.stone, name: "buttress-stone-cap" });
          k.beam("stone", [side * 15.35, 12.9, z], [side * 11.4, 16.3, z], 0.38, 0.8,
            { color: p.stone, name: "buttress-sloped-shoulder" });
          if (!tablet) for (const y of [3.2, 7, 10.7]) {
            k.box("stone", side * 15.35, y, z, 1.4, 0.27, 1.6, { color: p.stone, name: "buttress-stone-course" });
          }
        }
        for (const z of [-15.5, -8.5, -1.5, 5.5, 12.5]) {
          facadeWindow(k, side * 15.08, 2.5, z, 3.3, 8.1, p, tablet,
            { shape: "arched", ry: side * Math.PI / 2, name: "church-tall-aisle-window" });
          facadeWindow(k, side * 7.08, 16.7, z - 1.1, 2.7, 3.4, p, tablet,
            { shape: "arched", ry: side * Math.PI / 2, name: "nave-clerestory-window" });
        }
      }
      for (const x of [-10.7, 0, 10.7]) {
        facadeWindow(k, x, x === 0 ? 11.8 : 3, -22.1, 3.6, x === 0 ? 7.4 : 7.8, p, tablet,
          { shape: "arched", ry: Math.PI, name: "church-rear-apse-window" });
      }

      k.building("westertoren-base", 0, 18, 10, 10, 23);
      k.box("masonry", 0, 11.7, 18, 10, 22.6, 10, { color: p.brick, name: "westertoren-square-base" });
      for (const y of [0.6, 7.8, 15.5, 23]) {
        k.box("stone", 0, y, 18, 10.7, y < 1 ? 1.2 : 0.48, 10.7, { color: p.stone, name: "westertoren-base-cornice" });
      }
      for (const x of [-4.3, 4.3]) {
        k.box("stone", x, 11.7, 23.1, 0.65, 22.6, 0.5, { color: p.stone, name: "westertoren-base-pilaster" });
      }
      facadeWindow(k, 0, 1, 23.12, 3.5, 6.2, p, tablet, { shape: "arched", name: "church-entrance-arch" });
      facadeWindow(k, 0, 11.4, 23.12, 3.1, 6.8, p, tablet, { shape: "arched", name: "westertoren-lower-lancet" });
      cityShield(k, 0, 20.6, 23.3, 1.6, 2.5, p, "westertoren");
      k.solid("westertoren-clock-stage", 0, 18, 8.8, 8.8, 9, 23);
      k.box("stone", 0, 27.5, 18, 8.8, 9, 8.8, { color: p.stone, name: "westertoren-narrowing-clock-stage" });
      for (const y of [23.4, 31.8]) {
        k.box("stone", 0, y, 18, 9.5, 0.55, 9.5, { color: p.stone, name: "clock-stage-projecting-cornice" });
      }
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        clock(k, Math.sin(a) * 4.48, 27.5, 18 + Math.cos(a) * 4.48, 1.75, p, a, `westertoren-side-${i}`);
      }
      for (const x of [-2.8, 2.8]) for (const dz of [-2.8, 2.8]) {
        k.box("stone", x, 36.1, 18 + dz, 0.72, 7.8, 0.72, { color: p.stone, name: "open-belfry-corner-column" });
        k.box("stone", x, 39.6, 18 + dz, 1.05, 0.45, 1.05, { color: p.stone, name: "belfry-column-capital" });
      }
      k.box("stone", 0, 32.3, 18, 7.3, 0.55, 7.3, { color: p.stone, name: "open-belfry-floor" });
      k.box("stone", 0, 40, 18, 7.4, 0.6, 7.4, { color: p.stone, name: "open-belfry-entablature" });
      k.beam("wood", [-2.8, 38.5, 18], [2.8, 38.5, 18], 0.38, 0.38, { color: p.metal, name: "belfry-bell-yoke" });
      k.cylinder("metal", 0, 36.2, 18, 1.18, 1.25, { color: p.gold, name: "visible-bronze-bell" });
      k.cone("metal", 0, 37.2, 18, 1.12, 1.1, { color: p.gold, name: "bell-shoulder" });
      k.cylinder("metal", 0, 35.52, 18, 1.48, 0.25, { color: p.gold, name: "bell-flared-lip" });
      k.beam("metal", [0, 35.1, 18], [0, 38.5, 18], 0.14, 0.14, { color: p.metal, name: "bell-clapper" });
      octagon(k, "roof", 0, 40.3, 18, 4.05, 2.65, 1.5, { color: p.roof, name: "belfry-copper-shoulder" });
      octagon(k, "stone", 0, 41.8, 18, 2.65, 2.4, 4.9, { color: p.stone, name: "narrow-octagonal-lantern" });
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        facadeWindow(k, Math.sin(a) * 2.52, 42.5, 18 + Math.cos(a) * 2.52, 1.45, 3.2, p, tablet,
          { shape: "arched", ry: a, name: "lantern-arched-vent" });
      }
      octagon(k, "roof", 0, 46.7, 18, 2.8, 3.15, 0.75, { color: p.roof, name: "crown-copper-onion-eave" });
      octagon(k, "roof", 0, 47.45, 18, 3.15, 1.5, 1.25, { color: p.roof, name: "crown-copper-onion-shoulder" });
      k.cylinder("metal", 0, 49.05, 18, 2.1, 0.65, { color: p.gold, name: "amsterdam-crown-gold-circlet" });
      k.sphere("paint", 0, 50, 18, 1.98, 1.7, 1.98, { color: 0x2865bb, name: "amsterdam-crown-blue-velvet" });
      for (let plane = 0; plane < 2; plane++) for (let i = 0; i < 8; i++) {
        const point = t => {
          const u = Math.cos(t) * 2.15;
          return [plane === 0 ? u : 0, 49.5 + Math.sin(t) * 2.8, 18 + (plane === 1 ? u : 0)];
        };
        k.beam("metal", point(i * Math.PI / 8), point((i + 1) * Math.PI / 8), 0.17, 0.17,
          { color: p.gold, name: "amsterdam-crown-gold-arch" });
      }
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        k.cone("metal", Math.sin(a) * 1.95, 49.83, 18 + Math.cos(a) * 1.95, 0.24, 0.75,
          { color: p.gold, name: "amsterdam-crown-fleur" });
      }
      k.sphere("metal", 0, 52.85, 18, 0.5, 0.5, 0.5, { color: p.gold, name: "amsterdam-crown-orb" });
      k.beam("metal", [0, 53.1, 18], [0, 54.8, 18], 0.2, 0.2, { color: p.gold, name: "amsterdam-crown-cross-upright" });
      k.beam("metal", [-0.57, 54.15, 18], [0.57, 54.15, 18], 0.2, 0.2, { color: p.gold, name: "amsterdam-crown-cross-arms" });
      k.sign("WESTERKERK", 0, 9.3, 23.45, 7.4, 1.25,
        { name: "church-name-sign", background: "#375d59", ink: "#f0e4c8" });
    },

    palace(k) {
      const p = { brick: 0xc7baa2, stone: 0xe0d5bd, roof: 0x596464, glass: 0x3f5154,
        metal: 0x343e3d, gold: 0xc3a260 };
      // Damstraat crosses the southern strip of this reserve. The shallow main
      // block and recessed end returns leave it open, rather than moving a road.
      k.building("palace-central-block", 0, -6, 46, 10.6, 22);
      k.box("masonry", 0, 11.2, -6, 46, 21.6, 10.6, { color: p.brick, name: "palace-sandstone-main-block" });
      for (const y of [0.55, 6.2, 14, 20.2, 22]) {
        k.box("stone", 0, y, -6, 46.7, y < 1 ? 1.1 : 0.44, 11.2, { color: p.stone, name: "palace-continuous-stone-course" });
      }
      hipRoof(k, 0, 22.3, -6, 47.4, 11.8, 5.3, { color: p.roof, name: "palace-low-hipped-roof" }, 30);
      for (const side of [-1, 1]) {
        k.building("palace-recessed-end-return", side * 26.1, -8.2, 6.2, 6, 22);
        k.box("masonry", side * 26.1, 11.2, -8.2, 6.2, 21.6, 6, { color: p.brick, name: "palace-recessed-end-pavilion" });
        for (const y of [0.55, 6.2, 14, 20.2, 22]) {
          k.box("stone", side * 26.1, y, -8.2, 6.65, 0.44, 6.45,
            { color: p.stone, name: "palace-end-pavilion-cornice" });
        }
        hipRoof(k, side * 26.1, 22.3, -8.2, 6.9, 6.9, 3.7, { color: p.roof, name: "palace-end-pavilion-roof" }, 1.5);
        for (const y of [1.4, 7.6, 15.3]) {
          facadeWindow(k, side * 26.1, y, -5.13, 2.3, y === 7.6 ? 4.7 : 3.6, p, tablet, { name: "palace-return-window" });
          facadeWindow(k, side * 29.27, y, -8.2, 2.2, y === 7.6 ? 4.7 : 3.6, p, tablet,
            { ry: side * Math.PI / 2, name: "palace-end-window" });
        }
      }
      for (const x of [-20, -16, -12, -6, 0, 6, 12, 16, 20]) {
        for (const [y, h] of [[1.3, 3.8], [7.5, 5], [15.3, 3.8]]) {
          facadeWindow(k, x, y, -0.63, 2.2, h, p, tablet,
            { shape: y < 2 && Math.abs(x) < 7 ? "arched" : "square", name: "palace-classical-facade-window" });
          facadeWindow(k, x, y, -11.37, 2.2, h, p, tablet,
            { ry: Math.PI, name: "palace-rear-sash-window" });
        }
        if (!tablet) {
          k.box("stone", x, 5.8, -0.36, 1.8, 0.45, 0.4, { color: p.stone, name: "palace-carved-spandrel" });
          k.box("stone", x, 13.3, -0.34, 2, 0.36, 0.45, { color: p.stone, name: "palace-window-frieze" });
        }
      }
      for (const x of [-22.4, -18, -14, -10, 10, 14, 18, 22.4]) {
        k.box("stone", x, 13.1, -0.37, 0.52, 13.2, 0.65, { color: p.stone, name: "palace-giant-order-pilaster" });
        k.box("stone", x, 19.85, -0.3, 1, 0.46, 0.8, { color: p.stone, name: "palace-pilaster-capital" });
        k.box("stone", x, 6.6, -0.3, 0.9, 0.36, 0.8, { color: p.stone, name: "palace-pilaster-base" });
      }
      for (const x of [-8.5, -2.7, 2.7, 8.5]) {
        k.cylinder("stone", x, 13, 0.12, 0.32, 12.1, { color: p.stone, name: "palace-classical-column-shaft" });
        k.cylinder("stone", x, 6.86, 0.12, 0.49, 0.32, { color: p.stone, name: "palace-column-attic-base" });
        k.box("stone", x, 19.3, 0.12, 1.06, 0.46, 0.93, { color: p.stone, name: "palace-column-capital" });
      }
      k.box("stone", 0, 20.15, -0.1, 20.6, 0.7, 1.2, { color: p.stone, name: "palace-portico-entablature" });
      k.extrude("stone", [[-10.6, 0], [10.6, 0], [0, 5.9]], 0.7, 0, 22, 0.05,
        { color: p.stone, name: "palace-neoclassical-pediment" });
      k.extrude("masonry", [[-8.7, 0.7], [8.7, 0.7], [0, 4.95]], 0.12, 0, 22, 0.47,
        { color: p.brick, name: "palace-recessed-tympanum" });
      for (const side of [-1, 1]) {
        k.beam("stone", [side * 10.8, 22.05, 0.55], [0, 28.05, 0.55], 0.35, 0.5,
          { color: p.stone, name: "palace-pediment-raking-cornice" });
        for (const x of [3, 5.3, 7.2]) {
          k.sphere("stone", side * x, 23.2, 0.64, 0.7, 0.4, 0.18,
            { color: p.stone, name: "palace-pediment-allegorical-relief" });
        }
        dutchFlag(k, side * 17.5, 25.5, 0.05, side * 3.2, 1.85, `palace-${side < 0 ? "west" : "east"}`);
      }
      cityShield(k, 0, 24.25, 0.65, 1.7, 2.3, p, "palace-pediment");
      if (!tablet) for (let x = -21; x <= 21; x += 1.5) {
        k.box("stone", x, 21.35, -0.25, 0.38, 0.46, 0.6, { color: p.stone, name: "palace-cornice-dentil" });
      }

      octagon(k, "stone", 0, 26.3, -6, 3.3, 3.3, 4, { color: p.stone, name: "palace-cupola-octagonal-drum" });
      clock(k, 0, 28.25, -2.89, 1.18, p, 0, "palace-cupola");
      for (let i = 1; i < 4; i++) {
        const a = i * Math.PI / 2;
        facadeWindow(k, Math.sin(a) * 3.11, 27, -6 + Math.cos(a) * 3.11, 1.65, 2.5, p, tablet,
          { shape: "arched", ry: a, name: "palace-cupola-drum-window" });
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + i * Math.PI / 4, x = Math.cos(a) * 2.45, z = -6 + Math.sin(a) * 2.45;
        k.beam("stone", [x, 30.3, z], [x, 33.1, z], 0.32, 0.32, { color: p.stone, name: "palace-open-cupola-column" });
      }
      octagon(k, "stone", 0, 33, -6, 2.95, 2.95, 0.4, { color: p.stone, name: "palace-cupola-capital-ring" });
      for (const [y, h, r0, r1] of [[33.4, 1.3, 3.2, 2.8], [34.7, 1.25, 2.8, 1.65], [35.95, 0.8, 1.65, 0.55]]) {
        octagon(k, "roof", 0, y, -6, r0, r1, h, { color: 0x618d83, name: "palace-copper-cupola-dome" });
      }
      k.sphere("metal", 0, 37.05, -6, 0.32, 0.38, 0.32, { color: p.gold, name: "palace-cupola-gilded-finial" });
      k.beam("metal", [0, 36.7, -6], [0, 39, -6], 0.12, 0.12, { color: p.gold, name: "palace-weather-ship-mast" });
      k.extrude("metal", [[-1.4, 0], [1.4, 0], [0.9, -0.48], [-1, -0.48]], 0.12, 0, 37.85, -6,
        { color: p.gold, name: "palace-weather-ship-hull" });
      k.extrude("metal", [[-0.1, 0], [-0.1, 1], [-1, 0]], 0.1, 0, 37.9, -6,
        { color: p.gold, name: "palace-weather-ship-sail" });
      k.sphere("stone", 0, 29.5, -9.7, 0.45, 0.45, 0.45, { color: p.stone, name: "palace-atlas-head" });
      k.box("stone", 0, 28.65, -9.7, 0.82, 1.25, 0.6, { color: p.stone, name: "palace-atlas-torso" });
      for (const side of [-1, 1]) {
        k.beam("stone", [side * 0.35, 29, -9.7], [side * 0.8, 30.1, -9.7], 0.28, 0.28,
          { color: p.stone, name: "palace-atlas-raised-arm" });
        k.beam("stone", [side * 0.24, 28.2, -9.7], [side * 0.55, 27.25, -9.7], 0.29, 0.3,
          { color: p.stone, name: "palace-atlas-leg" });
      }
      k.sphere("metal", 0, 30.7, -9.7, 1.25, 1.25, 1.25, { color: 0x618d83, name: "palace-atlas-globe" });

      k.box("stone", 0, 0.08, 0.55, 45, 0.16, 0.8, { color: 0xb6ad9b, name: "dam-square-front-paving" });
      k.box("stone", 26.9, 0.08, -2.1, 4.8, 0.16, 5.7, { color: 0xb6ad9b, name: "dam-square-monument-court" });
      const mx = 26.9, mz = -1.9;
      k.cylinder("stone", mx, 0.24, mz, 1.7, 0.32, { color: p.stone, name: "dam-monument-circular-step" });
      k.cylinder("stone", mx, 0.52, mz, 1.3, 0.3, { color: p.stone, name: "dam-monument-upper-step" });
      k.box("stone", mx, 1.2, mz, 1.65, 1.05, 1.65, { color: p.stone, name: "dam-monument-pedestal" });
      k.cylinder("stone", mx, 3.95, mz, 0.55, 4.6, { color: p.stone, name: "dam-square-memorial-column" });
      k.cone("stone", mx, 6.5, mz, 0.55, 0.5, { color: p.stone, name: "dam-monument-crown" });
      k.box("metal", mx, 1.3, mz + 0.84, 1.05, 0.48, 0.08, { color: p.gold, name: "dam-monument-relief-plaque" });
      for (const side of [-1, 1]) {
        k.sphere("stone", mx + side * 1.1, 0.86, mz, 0.3, 0.42, 0.5, { color: p.stone, name: "dam-monument-flanking-sculpture" });
        k.beam("stone", [mx, 5.3, mz + 0.54], [mx + side * 0.65, 5.8, mz + 0.54], 0.18, 0.2,
          { color: p.stone, name: "dam-monument-peace-relief" });
      }
      k.solid("dam-square-monument", mx, mz, 1.65, 1.65, 6.1, 0.67);
      k.sign("ROYAL PALACE - DAM", 0, 5.8, 0.12, 16.2, 1,
        { name: "palace-name-sign", background: "#4c5756", ink: "#f1e7cf" });
    },

    nemo(k) {
      const p = { copper: 0x488d82, dark: 0x2c625c, pale: 0x79a79a, stone: 0xb9bcb0,
        glass: 0x365961, metal: 0x526d6b, deck: 0xb2ac8c };
      const roofY = x => 5.5 + 24 * ((26 - x) / 52) ** 0.8;
      const roof = Array.from({ length: 14 }, (_, i) => {
        const x = 26 - i * 4;
        return [x, roofY(x)];
      });
      const profile = [[-24.5, 0.4], [24, 0.4], [27.7, 4.3], ...roof, [-27.7, 27.5], [-27, 10]];
      k.extrude("metal", profile, 29, 0, 0, -2.5, { color: p.copper, name: "nemo-sweeping-oxidized-copper-ship-hull" });
      // Short stacked solid bounds follow the rising hull, not an oversized box
      // spanning the glass entrance or the space above its low stern.
      for (let i = 0; i < 8; i++) {
        const x0 = -24 + i * 6, x1 = x0 + 6;
        k.building("nemo-stepped-hull-section", (x0 + x1) / 2, -2.5, 6, 29, roofY(x1), 0.4);
      }
      for (const side of [-1, 1]) {
        const z = -2.5 + side * 14.62;
        k.extrude("metal", profile, 0.16, 0, 0, z, { color: p.copper, name: "nemo-copper-flank-cladding" });
        for (let x = -24; x <= 24; x += tablet ? 6 : 3) {
          k.beam("metal", [x, 1.2, z + side * 0.12], [x, roofY(x) - 0.28, z + side * 0.12], 0.085, 0.095,
            { color: p.dark, name: "nemo-copper-standing-seam" });
        }
        for (let i = 0; i < roof.length - 1; i++) {
          const [x0, y0] = roof[i], [x1, y1] = roof[i + 1];
          k.beam("metal", [x0, y0, z], [x1, y1, z], 0.26, 0.26,
            { color: p.pale, name: "nemo-sweeping-gunwale" });
        }
        for (const x of [-18, -8, 2, 12]) {
          k.box("glass", x, 4.3, z + side * 0.13, 5.5, 0.95, 0.15,
            { color: p.glass, name: "nemo-hull-ribbon-window" });
        }
      }
      k.box("stone", 4, 0.12, 15.4, 40, 0.24, 6.6, { color: p.stone, name: "nemo-glass-entry-apron" });
      k.building("nemo-glass-entry", 4, 14.9, 36, 5.6, 5.3);
      k.box("glass", 4, 2.8, 14.9, 36, 5, 5.6, { color: p.glass, name: "nemo-glass-entry-pavilion" });
      k.box("metal", 4, 5.4, 15.1, 37, 0.32, 6, { color: p.pale, name: "nemo-entry-copper-canopy" });
      for (let x = -14; x <= 22; x += tablet ? 6 : 3) {
        k.box("metal", x, 2.8, 17.77, 0.12, 5, 0.17, { color: p.metal, name: "nemo-entry-glass-mullion" });
      }
      k.box("metal", 4, 2.4, 17.8, 36, 0.12, 0.15, { color: p.metal, name: "nemo-entry-glass-transom" });

      const terraces = 10, span = 4.4;
      for (let i = 0; i < terraces; i++) {
        const x0 = -22 + i * span, x1 = x0 + span, y0 = roofY(x0) + 0.2, y1 = roofY(x1) + 0.2;
        k.extrude("stone", [[x0, y0 - 0.4], [x1, y1 - 0.4], [x1, y0], [x0, y0]], 25, 0, 0, -2.5,
          { color: p.deck, name: "nemo-roof-terrace-step" });
        for (const z of [-15.05, 10.05]) {
          for (const x of [x0 + 0.15, x1 - 0.15]) {
            k.beam("metal", [x, y0, z], [x, y0 + 1.15, z], 0.11, 0.11,
              { color: p.metal, name: "nemo-roof-terrace-railing-post" });
          }
          k.beam("metal", [x0, y0 + 1.15, z], [x1, y0 + 1.15, z], 0.11, 0.12,
            { color: p.metal, name: "nemo-roof-terrace-railing" });
          if (!tablet) k.beam("metal", [x0, y0 + 0.55, z], [x1, y0 + 0.55, z], 0.07, 0.08,
            { color: p.metal, name: "nemo-roof-railing-midrail" });
        }
        // A narrow stair flight beside each broad terrace follows the same rise.
        const treads = tablet ? 3 : 5;
        for (let j = 0; j < treads; j++) {
          const t = (j + 0.5) / treads, x = x0 + span * t, y = y0 + (y1 - y0) * t;
          k.box("stone", x, y + 0.09, 12.1, span / treads + 0.03, 0.18, 3.3,
            { color: p.stone, name: "nemo-rooftop-public-stair-tread" });
        }
        k.beam("metal", [x0, y0 + 1.15, 13.88], [x1, y1 + 1.15, 13.88], 0.11, 0.12,
          { color: p.metal, name: "nemo-rooftop-stair-handrail" });
        if (i % 3 === 0) {
          const x = x0 + 2, z = -10.8;
          k.box("stone", x, y0 + 0.38, z, 2.4, 0.7, 2.3, { color: p.pale, name: "nemo-rooftop-planter" });
          k.sphere("foliage", x, y0 + 1, z, 1.05, 0.65, 0.95, { color: 0x668867, name: "nemo-rooftop-planting" });
        }
        if (!tablet) for (const offset of [1.1, 2.2, 3.3]) {
          k.beam("wood", [x0 + offset, y0 + 0.025, -14.7], [x0 + offset, y0 + 0.025, 9.7], 0.035, 0.035,
            { color: 0x807f69, name: "nemo-terrace-deck-joint" });
        }
      }
      const top = roofY(-22) + 0.2;
      k.beam("metal", [-22, top + 1.15, -15.05], [-22, top + 1.15, 10.05], 0.12, 0.12,
        { color: p.metal, name: "nemo-bow-roof-guardrail" });
      k.box("metal", -23.5, top + 0.45, -2.5, 2.2, 0.9, 5, { color: p.pale, name: "nemo-rooftop-science-plinth" });
      k.sphere("metal", -23.5, top + 1.6, -2.5, 0.9, 0.9, 0.9, { color: p.metal, name: "nemo-rooftop-science-sphere" });
      k.sign("NEMO SCIENCE MUSEUM", 4, 4.25, 17.98, 20, 1.35,
        { name: "nemo-name-sign", background: "#326b64", ink: "#f4edd9" });
    },

    windmill(k) {
      const p = { brick: 0x977257, stone: 0xded8bd, roof: 0x343d38, glass: 0x344b4c,
        wood: 0x403e32, metal: 0x29332f };
      const apothem = Math.cos(Math.PI / 8);
      k.building("mill-octagonal-brick-base", 0, 0, 12.8 * apothem, 12.8 * apothem, 7.1);
      octagon(k, "masonry", 0, 0, 0, 6.4, 6.4, 7.1, { color: p.brick, name: "de-gooyer-octagonal-brick-base" });
      for (const y of [0.35, 3.7, 6.8]) {
        octagon(k, "stone", 0, y, 0, 6.52, 6.52, 0.25, { color: p.stone, name: "mill-brick-base-stone-course" });
      }
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        facadeWindow(k, Math.sin(a) * 5.98, i === 0 ? 0.8 : 2, Math.cos(a) * 5.98, i === 0 ? 2.25 : 1.6,
          i === 0 ? 3.6 : 2.7, p, tablet, { shape: "arched", ry: a, name: i === 0 ? "mill-arched-door" : "mill-base-window" });
      }
      octagon(k, "wood", 0, 7.1, 0, 5.3, 3.15, 14.3, { color: p.wood, name: "mill-tapering-octagonal-timber-body" });
      for (let i = 0; i < 3; i++) {
        const base = 7.1 + i * 14.3 / 3, radius = 5.3 - i * 2.15 / 3;
        k.solid("mill-tapered-timber-stage", 0, 0, radius * apothem * 2, radius * apothem * 2, 14.3 / 3, base);
      }
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + i * Math.PI / 4, b = a + Math.PI / 4;
        k.beam("paint", [Math.cos(a) * 5.34, 7.1, Math.sin(a) * 5.34],
          [Math.cos(a) * 3.19, 21.4, Math.sin(a) * 3.19], 0.16, 0.17,
          { color: p.stone, name: "mill-white-corner-timber" });
        const boards = tablet ? 1 : 3;
        for (let j = 1; j <= boards; j++) {
          const t = j / (boards + 1), dx = Math.cos(a) * (1 - t) + Math.cos(b) * t;
          const dz = Math.sin(a) * (1 - t) + Math.sin(b) * t;
          k.beam("wood", [dx * 5.32, 7.15, dz * 5.32], [dx * 3.17, 21.35, dz * 3.17], 0.065, 0.08,
            { color: 0x5a5544, name: "mill-vertical-weatherboard-seam" });
        }
      }
      for (const [y, r] of [[8.5, 5.14], [15.2, 4.13], [20.8, 3.29]]) {
        octagon(k, "wood", 0, y, 0, r, r - 0.035, 0.23, { color: p.roof, name: "mill-timber-hoop-band" });
      }
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        facadeWindow(k, Math.sin(a) * 4.9, 9.5, Math.cos(a) * 4.9, 1.5, 2.5, p, tablet,
          { ry: a, name: "mill-white-framed-timber-window" });
      }

      octagon(k, "wood", 0, 7.1, 0, 9.8, 9.8, 0.35, { color: 0x82765b, name: "mill-raised-octagonal-gallery-deck" });
      k.solid("mill-raised-gallery-deck", 0, 0, 19.6 * apothem, 19.6 * apothem, 0.35, 7.1);
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + i * Math.PI / 4, b = a + Math.PI / 4;
        const point = (angle, r, y) => [Math.cos(angle) * r, y, Math.sin(angle) * r];
        k.beam("wood", point(a, 5.7, 3.9), point(a, 9.6, 7.15), 0.3, 0.35,
          { color: p.wood, name: "mill-gallery-diagonal-support" });
        for (const t of [0, 0.5]) {
          const x = (Math.cos(a) * (1 - t) + Math.cos(b) * t) * 9.7;
          const z = (Math.sin(a) * (1 - t) + Math.sin(b) * t) * 9.7;
          k.beam("paint", [x, 7.45, z], [x, 8.9, z], 0.14, 0.15, { color: p.stone, name: "mill-gallery-white-baluster" });
        }
        for (const y of [8.05, 8.9]) {
          k.beam("paint", point(a, 9.7, y), point(b, 9.7, y), 0.16, 0.17,
            { color: p.stone, name: "mill-gallery-octagonal-railing" });
        }
        if (!tablet) {
          k.beam("paint", point(a, 9.7, 7.5), point(b, 9.7, 8.85), 0.085, 0.1,
            { color: p.stone, name: "mill-gallery-cross-brace" });
        }
      }
      const deckBoards = tablet ? 16 : 32;
      for (let i = 0; i < deckBoards; i++) {
        const a = i * Math.PI * 2 / deckBoards;
        k.beam("wood", [Math.cos(a) * 5.25, 7.48, Math.sin(a) * 5.25],
          [Math.cos(a) * 9.02, 7.48, Math.sin(a) * 9.02], 0.055, 0.065,
          { color: p.wood, name: "mill-gallery-radial-deck-board" });
      }
      for (let i = 0; i < 12; i++) {
        k.box("wood", 7.2, 0.6 + i * 0.565, -9.5 + i * 0.72, 2.1, 0.2, 0.87,
          { color: p.stone, name: "mill-gallery-access-stair-tread" });
      }
      for (const x of [6.12, 8.28]) {
        k.beam("wood", [x, 0.45, -10], [x, 7.28, -1], 0.22, 0.25,
          { color: p.wood, name: "mill-gallery-stair-stringer" });
        k.beam("paint", [x, 1.6, -10], [x, 8.6, -1], 0.13, 0.15,
          { color: p.stone, name: "mill-gallery-stair-handrail" });
      }

      octagon(k, "wood", 0, 21.25, 0, 3.55, 4.1, 0.8, { color: p.roof, name: "mill-rotating-cap-eave" });
      octagon(k, "roof", 0, 22.05, 0, 4.1, 3.3, 1.5, { color: p.roof, name: "mill-rounded-cap-shoulder" });
      octagon(k, "roof", 0, 23.55, 0, 3.3, 1.15, 1.5, { color: p.roof, name: "mill-rounded-cap-crown" });
      k.cone("roof", 0, 25.35, 0, 1.15, 0.6, { color: p.roof, name: "mill-cap-ridge" });
      k.beam("wood", [0, 21.6, -3.8], [0, 3.2, -12], 0.3, 0.35, { color: p.wood, name: "mill-long-rear-tailpole" });
      for (const side of [-1, 1]) {
        k.beam("wood", [side * 3, 21.2, -1.8], [0, 8, -10], 0.24, 0.27,
          { color: p.wood, name: "mill-tailpole-outrigger" });
      }
      k.cylinder("wood", 0, 21.6, 5.7, 0.57, 5.3, { color: p.wood, rx: Math.PI / 2, name: "mill-horizontal-windshaft" });
      k.cylinder("metal", 0, 21.6, 8.45, 0.83, 0.32, { color: p.metal, rx: Math.PI / 2, name: "mill-sail-hub" });
      // Static diagonal sails fit the reserved width. Their open cells, trailing
      // cloth and white leading spars read as a Dutch mill, not solid propellers.
      for (let sail = 0; sail < 4; sail++) {
        const a = Math.PI / 4 + sail * Math.PI / 2, ux = Math.sin(a), uy = Math.cos(a);
        const point = (r, t, z = 8.25) => [ux * r + uy * t, 21.6 + uy * r - ux * t, z];
        k.beam("paint", point(0, 0), point(15.3, 0), 0.3, 0.35,
          { color: p.stone, name: `mill-sail-${sail}-leading-spar` });
        for (const t of [0.15, 1.15, 2.2]) {
          k.beam("wood", point(3.3, t), point(15.3, t), 0.12, 0.14,
            { color: p.wood, name: `mill-sail-${sail}-lattice-longeron` });
        }
        const cells = tablet ? 7 : 12;
        for (let j = 0; j <= cells; j++) {
          const r = 3.3 + j * 12 / cells;
          k.beam("wood", point(r, 0), point(r, 2.2), 0.105, 0.12,
            { color: p.wood, name: `mill-sail-${sail}-lattice-crossbar` });
        }
        for (const r of [4.5, 8.5, 12.5]) {
          k.beam("wood", point(r, 0.15), point(Math.min(r + 2.8, 15.3), 2.2), 0.075, 0.09,
            { color: p.wood, name: `mill-sail-${sail}-diagonal-lattice-brace` });
        }
        sheet(k, "paint", [point(10.2, 0.2, 8.31), point(15.2, 0.2, 8.31),
          point(15.2, 1.02, 8.31), point(10.2, 1.02, 8.31)],
          { color: 0xc6bea1, name: `mill-sail-${sail}-partial-sailcloth` });
      }
      k.sign("DE GOOYER", 0, 5.55, 6.18, 5.7, 1.1,
        { name: "windmill-name-sign", background: "#36463c", ink: "#eee5c6" });
    },
  };

  for (const { id, x, z } of AMSTERDAM.landmarks) {
    const heading = ["centraal", "palace", "nemo"].includes(id) ? Math.PI : 0;
    site(id, x, z, heading, builders[id]);
  }
}
