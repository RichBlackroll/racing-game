import * as THREE from "three";
import { createCarTools } from "./authored-car-geometry.js";

// Original, texture-free interpretation of the facelift EX40, not Volvo CAD.
// Reference photographs are documentation only; nothing is fetched at runtime.
export function createVolvoEx40() {
  const { model, materials, mesh, box, panel, line, loft, wheel, badge } = createCarTools("volvo-ex40");
  const { paint, glass, trim, rubber, alloy, darkAlloy, headlight, taillight } = materials;
  paint.name = "authored-paint";
  glass.name = "authored-window";
  headlight.name = "authored-headlight";
  taillight.name = "authored-taillight";
  paint.color.set(0xb8b4a5);
  paint.metalness = 0.38;
  paint.roughness = 0.3;
  glass.color.set(0x24333b);
  glass.metalness = 0.38;
  glass.roughness = 0.13;
  glass.transparent = false;
  glass.opacity = 1;
  trim.color.set(0x111518);
  const roof = new THREE.MeshStandardMaterial({
    name: "ex40-gloss-black-roof", color: 0x11161b, metalness: 0.35, roughness: 0.22,
  });
  const lampHousing = new THREE.MeshStandardMaterial({
    name: "ex40-smoked-lamp-housing", color: 0x111b22, metalness: 0.45, roughness: 0.18,
  });
  const redLens = new THREE.MeshStandardMaterial({
    name: "ex40-red-lens-surround", color: 0x570b16, metalness: 0.18, roughness: 0.22,
  });
  const frontAxle = 1.395, rearAxle = -1.307;
  const frontRadius = 0.359, rearRadius = 0.356;
  const archRadius = 0.416, bodyJoin = 0.823;

  // z, maximum half-width, shoulder height, hood/deck crown. The narrow upper
  // hull stays above both tire openings; it is not a solid box behind the wheels.
  const stations = [
    [-2.14, 0.851, 1.102, 1.107], [-2.02, 0.894, 1.11, 1.112],
    [-1.72, 0.924, 1.117, 1.117], [-1.307, 0.9365, 1.121, 1.121],
    [-0.92, 0.917, 1.108, 1.122], [-0.3, 0.904, 1.103, 1.126],
    [0.48, 0.907, 1.107, 1.131], [0.86, 0.919, 1.106, 1.123],
    [1.395, 0.9365, 1.071, 1.09], [1.8, 0.916, 1.043, 1.063],
    [2.04, 0.878, 1.02, 1.044], [2.19, 0.824, 1.008, 1.027],
  ];
  function sectionAt(z) {
    const i = Math.max(0, Math.min(stations.length - 2, stations.findIndex(s => s[0] >= z) - 1));
    const a = z >= stations.at(-1)[0] ? stations.at(-2) : stations[i];
    const b = z >= stations.at(-1)[0] ? stations.at(-1) : stations[i + 1];
    const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return a.map((v, k) => k === 0 ? z : THREE.MathUtils.lerp(v, b[k], t));
  }
  function sideProfile(z) {
    const [, w, h] = sectionAt(z);
    const doorInset = 0.022 * Math.exp(-(((z - 0.02) / 0.85) ** 4));
    return [
      [w - 0.09, 0.23], [w - 0.041, 0.31], [w - 0.018, 0.4],
      [w - 0.034 - doorInset, 0.51], [w - 0.025 - doorInset, 0.61],
      [w - 0.011, 0.74], [w - 0.006, bodyJoin], [w, 0.885],
      [w - 0.014, h - 0.058], [w - 0.048, h - 0.016], [w - 0.095, h + 0.008],
    ];
  }
  function bodyX(y, z) {
    const p = sideProfile(z);
    for (let i = 1; i < p.length; i++) {
      if (y <= p[i][1]) {
        const t = THREE.MathUtils.clamp((y - p[i - 1][1]) / (p[i][1] - p[i - 1][1]), 0, 1);
        return THREE.MathUtils.lerp(p[i - 1][0], p[i][0], t);
      }
    }
    return p.at(-1)[0];
  }
  function cabinX(y, z) {
    return 0.867 - (y - 1.09) * 0.275 - 0.025 * THREE.MathUtils.clamp((-z - 1.05) / 0.9, 0, 1);
  }
  function surface(name, material, columns, rows, point, reverse = false) {
    const vertices = [], indices = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= columns; i++) vertices.push(...point(i / columns, j / rows));
    }
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    function triangle(i, j, k) {
      a.fromArray(vertices, i * 3); b.fromArray(vertices, j * 3); c.fromArray(vertices, k * 3);
      if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) return;
      indices.push(i, reverse ? k : j, reverse ? j : k);
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const a = j * (columns + 1) + i, b = a + columns + 1;
        triangle(a, b, a + 1); triangle(a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(name, geometry, material);
  }
  function crease(name, material, points, radius = 0.003) {
    const path = new THREE.CurvePath();
    for (let i = 1; i < points.length; i++) {
      path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i - 1]), new THREE.Vector3(...points[i])));
    }
    return mesh(name, new THREE.TubeGeometry(path, Math.max(12, points.length * 3), radius, 4, false), material);
  }
  const upperSections = [];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < 3; j++) {
      const z = THREE.MathUtils.lerp(stations[i][0], stations[i + 1][0], j / 3);
      const [, w, , crown] = sectionAt(z);
      const side = sideProfile(z).slice(6);
      const right = [...side, [w - 0.18, crown + 0.008], [w - 0.38, crown + 0.003]];
      upperSections.push({ z, points: [...right, [0, crown], ...right.toReversed().map(([x, y]) => [-x, y])] });
    }
  }
  const last = stations.at(-1), lastSide = sideProfile(last[0]).slice(6);
  const lastRight = [...lastSide, [last[1] - 0.18, last[3] + 0.008], [last[1] - 0.38, last[3] + 0.003]];
  upperSections.push({ z: last[0], points: [...lastRight, [0, last[3]], ...lastRight.toReversed().map(([x, y]) => [-x, y])] });
  const upperBody = loft("sculpted-hood-shoulders-and-upper-body", paint, upperSections);
  const upperPositions = upperBody.geometry.attributes.position, upperNormals = upperBody.geometry.attributes.normal;
  // Continue the side tangent across the separate loft/arch-panel join instead
  // of averaging in the loft's hidden horizontal bottom face.
  for (let i = 0; i < upperPositions.count; i++) {
    if (Math.abs(upperPositions.getY(i) - bodyJoin) > 1e-6) continue;
    const x = upperPositions.getX(i), z = upperPositions.getZ(i);
    if (Math.abs(x) < 0.7) continue;
    const slope = (bodyX(bodyJoin, z + 0.002) - bodyX(bodyJoin, z - 0.002)) / 0.004;
    const n = new THREE.Vector3(Math.sign(x), -0.08, -slope).normalize();
    upperNormals.setXYZ(i, n.x, n.y, n.z);
  }

  // Separate strips end at the circular arch boundary, including the vertical
  // arch legs. No face, hidden body block, or black disc spans either opening.
  const spans = [
    { a: -1.77, b: rearAxle - archRadius },
    { axle: rearAxle, radius: rearRadius },
    { a: rearAxle + archRadius, b: frontAxle - archRadius },
    { axle: frontAxle, radius: frontRadius },
    { a: frontAxle + archRadius, b: 1.86 },
  ];
  function claddingTop(z) {
    return 0.377 + 0.048 * THREE.MathUtils.smoothstep(Math.abs(z), 0.65, 1.8);
  }
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? "left" : "right";
    spans.forEach((span, index) => {
      const along = u => span.axle === undefined
        ? [THREE.MathUtils.lerp(span.a, span.b, u), 0.235]
        : [span.axle - archRadius * Math.cos(u * Math.PI), span.radius + archRadius * Math.sin(u * Math.PI)];
      for (const isTrim of [false, true]) {
        surface(`${side}-${isTrim ? "rocker-cladding" : "sculpted-side"}-${index}`, isTrim ? trim : paint,
          span.axle === undefined ? 24 : 36, isTrim ? 2 : 7, (u, v) => {
            const [z, bottom] = along(u), divide = Math.max(bottom, claddingTop(z));
            const y = THREE.MathUtils.lerp(isTrim ? bottom : divide, isTrim ? divide : bodyJoin, v);
            return [sign * bodyX(y, z), y, z];
          }, sign < 0);
      }
    });
    for (const [axle, tireRadius, end] of [[frontAxle, frontRadius, "front"], [rearAxle, rearRadius, "rear"]]) {
      // The lip is an annular strip with inward returns, not a filled circle.
      surface(`${side}-${end}-open-arch-moulding`, trim, 48, 3, (u, v) => {
        const angle = u * Math.PI, r = archRadius + v * 0.031;
        const z = axle - r * Math.cos(angle), y = tireRadius + r * Math.sin(angle);
        const x = Math.min(0.9365, bodyX(y, z) + 0.004 * Math.sin(v * Math.PI));
        return [sign * x, y, z];
      }, sign < 0);
      surface(`${side}-${end}-arch-inner-return`, rubber, 48, 2, (u, v) => {
        const angle = u * Math.PI, z = axle - archRadius * Math.cos(angle);
        const y = tireRadius + archRadius * Math.sin(angle);
        return [sign * THREE.MathUtils.lerp(bodyX(y, z), 0.635, v), y, z];
      }, sign > 0);
      for (const endSign of [-1, 1]) {
        surface(`${side}-${end}-arch-leg-${endSign}`, trim, 2, 6, (u, v) => {
          const z = axle + endSign * (archRadius + 0.031 * u);
          const y = THREE.MathUtils.lerp(0.235, tireRadius, v);
          return [sign * bodyX(y, z), y, z];
        }, sign < 0);
      }
      wheel({ x: sign * (end === "front" ? 1.601 : 1.608) / 2, z: axle,
        radius: tireRadius, width: end === "front" ? 0.235 : 0.255, rimRadius: 0.2413, style: "volvo" });
    }
  }

  // Bumper volumes occupy only the overhangs, outside the open arch spans.
  for (const [end, zs] of [["rear", [-2.22, -2.18, -2.05, -1.77]], ["front", [1.86, 2.06, 2.19, 2.22]]]) {
    for (const lower of [true, false]) {
      loft(`${end}-${lower ? "lower-protective-bumper" : "sculpted-bumper"}`, lower ? trim : paint, zs.map(z => {
        const cladding = end === "rear" ? 0.425 + 0.165 * THREE.MathUtils.clamp((-z - 1.77) / 0.45, 0, 1) : 0.405;
        const tip = Math.abs(z) > 2.19, bottom = lower ? 0.255 : cladding, top = lower ? cladding : bodyJoin;
        const w = sectionAt(z)[1] - (tip ? 0.033 : 0);
        const points = [[w - 0.07, bottom], [w - 0.012, bottom + 0.035], [w, top - 0.045],
          [w - 0.006, top], [-w + 0.006, top], [-w, top - 0.045], [-w + 0.012, bottom + 0.035], [-w + 0.07, bottom]];
        // The painted face sits behind its grille/lights; the low rub strip sets length.
        return { z: lower ? z : THREE.MathUtils.clamp(z, -2.19, 2.185), points };
      }).filter((s, i, all) => i === 0 || s.z !== all[i - 1].z));
    }
  }
  box("battery-undertray", trim, [1.18, 0.075, 3.96], [0, 0.2375, 0]);

  function sidePanel(name, material, points, sign, offset = 0, holes = []) {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    for (const hole of holes) shape.holes.push(new THREE.Path(hole.map(([z, y]) => new THREE.Vector2(z, y))));
    const geometry = new THREE.ShapeGeometry(shape, 6);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getX(i), y = p.getY(i);
      p.setXYZ(i, sign * (cabinX(y, z) + offset), y, z);
    }
    if (sign > 0) {
      const idx = geometry.index;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a);
      }
    }
    geometry.computeVertexNormals();
    return mesh(name, geometry, material);
  }
  const windows = [
    [[0.762, 1.146], [0.084, 1.528], [-0.395, 1.546], [-0.459, 1.148]],
    [[-0.522, 1.148], [-0.461, 1.546], [-0.99, 1.538], [-1.043, 1.223], [-0.925, 1.161]],
    [[-1.087, 1.247], [-1.034, 1.535], [-1.281, 1.514], [-1.43, 1.428]],
  ];
  const cabinOutline = [[0.907, 1.099], [0.141, 1.566], [-0.22, 1.591], [-1.414, 1.579],
    [-1.705, 1.482], [-2.06, 1.121], [-1.925, 1.105], [-0.92, 1.106]];
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? "left" : "right";
    sidePanel(`${side}-A-B-C-pillars-and-window-surround`, roof, cabinOutline, sign, 0, windows);
    windows.forEach((points, index) => {
      sidePanel(`${side}-${["front-door-window", "rear-door-window", "rear-quarter-glass"][index]}`, glass, points, sign, 0.002);
      crease(`${side}-window-${index}-seal`, trim,
        [...points, points[0]].map(([z, y]) => [sign * (cabinX(y, z) + 0.003), y, z]), 0.004);
    });
    sidePanel(`${side}-broad-stepped-painted-C-pillar`, paint,
      [[-0.948, 1.11], [-1.466, 1.404], [-1.74, 1.419], [-1.992, 1.155], [-1.982, 1.105]], sign, 0.005);
    crease(`${side}-rising-window-belt-trim`, roof,
      [[0.824, 1.134], [-0.46, 1.135], [-0.947, 1.15], [-1.456, 1.413]]
        .map(([z, y]) => [sign * (cabinX(y, z) + 0.006), y, z]), 0.006);

    const frontDoor = [[0.876, 1.101], [0.909, 1.023], [0.934, 0.77], [0.935, 0.48],
      [0.87, 0.289], [-0.435, 0.289], [-0.452, 0.72], [-0.465, 1.101]];
    const rearDoor = [[-0.465, 1.101], [-0.452, 0.72], [-0.435, 0.289], [-0.852, 0.289],
      [-0.874, 0.408], [-0.967, 0.656], [-1.14, 0.816], [-1.556, 1.096]];
    for (const [name, points] of [["front", frontDoor], ["rear", rearDoor]]) {
      const sampled = points.flatMap(([z, y], i) => {
        if (i === 0) return [[sign * (bodyX(y, z) + 0.003), y, z]];
        return Array.from({ length: 4 }, (_, j) => {
          const pz = THREE.MathUtils.lerp(points[i - 1][0], z, (j + 1) / 4);
          const py = THREE.MathUtils.lerp(points[i - 1][1], y, (j + 1) / 4);
          return [sign * (bodyX(py, pz) + 0.003), py, pz];
        });
      });
      crease(`${side}-${name}-door-shutline`, trim, sampled, 0.0028);
    }
    crease(`${side}-rear-door-upper-shutline`, trim,
      [[-1.556, 1.096], [-1.581, 1.212], [-1.526, 1.402]]
        .map(([z, y]) => [sign * (cabinX(y, z) + 0.007), y, z]), 0.0025);
    for (const [name, z] of [["front", -0.265], ["rear", -1.205]]) {
      const x = bodyX(0.99, z);
      box(`${side}-${name}-handle-recess`, trim, [0.009, 0.028, 0.181], [sign * (x + 0.003), 0.98, z]);
      box(`${side}-${name}-body-colour-door-handle`, paint, [0.021, 0.029, 0.169], [sign * (x + 0.012), 0.997, z]);
    }
    crease(`${side}-lower-door-sculpture-crease`, paint,
      [[0.826, 0.49], [0.686, 0.574], [-0.59, 0.58], [-0.79, 0.492]]
        .map(([z, y]) => [sign * (bodyX(y, z) + 0.001), y, z]), 0.003);

    box(`${side}-mirror-stalk`, trim, [0.1, 0.032, 0.057], [sign * 0.888, 1.137, 0.639], [0, 0, sign * 0.23]);
    loft(`${side}-gloss-black-mirror-shell`, roof, [
      { z: 0.518, points: [[sign * 0.896, 1.15], [sign * 1.0, 1.15], [sign * 1.017, 1.177], [sign * 1.005, 1.231], [sign * 0.91, 1.247]] },
      { z: 0.592, points: [[sign * 0.9, 1.146], [sign * 1.003, 1.146], [sign * 1.017, 1.175], [sign * 0.998, 1.229], [sign * 0.912, 1.242]] },
      { z: 0.684, points: [[sign * 0.91, 1.159], [sign * 0.981, 1.159], [sign * 0.994, 1.18], [sign * 0.98, 1.217], [sign * 0.919, 1.224]] },
    ].map(section => ({ ...section, points: sign < 0 ? section.points.toReversed() : section.points })));
    panel(`${side}-mirror-reflective-glass`, glass,
      [[sign * 0.909, 1.167, 0.515], [sign * 0.993, 1.167, 0.515], [sign * 1.001, 1.184, 0.515],
        [sign * 0.99, 1.226, 0.515], [sign * 0.917, 1.234, 0.515]]);
    crease(`${side}-mirror-indicator`, alloy,
      [[sign * 0.916, 1.165, 0.69], [sign * 0.974, 1.165, 0.685], [sign * 0.992, 1.174, 0.665]], 0.0028);
  }

  // Bowed glass patches retain a full-height SUV greenhouse and separate seals.
  function windscreenPoint(u, v, rear = false, inset = false) {
    const s = (u * 2 - 1) * (inset ? 0.952 : 1);
    const t = inset ? 0.046 + v * 0.908 : v;
    const width = THREE.MathUtils.lerp(rear ? 0.71 : 0.811, rear ? 0.641 : 0.686, t);
    const y = THREE.MathUtils.lerp(rear ? 1.153 : 1.126, rear ? 1.486 : 1.562, t) + 0.009 * (1 - s * s);
    const z = THREE.MathUtils.lerp(rear ? -2.103 : 0.858, rear ? -1.756 : 0.145, t)
      + (rear ? -1 : 1) * ((1 - s * s) * 0.023 * Math.sin(t * Math.PI) + (inset ? 0.004 : 0));
    return [s * width, y, z];
  }
  for (const rear of [false, true]) {
    const name = rear ? "rear" : "front";
    surface(`${name}-windscreen-surround`, roof, 20, 12, (u, v) => windscreenPoint(u, v, rear), !rear);
    surface(`${name}-curved-windscreen`, glass, 20, 12, (u, v) => windscreenPoint(u, v, rear, true), !rear);
  }
  for (const sign of [-1, 1]) {
    crease(`front-windscreen-wiper-${sign}`, trim,
      [[sign * 0.07, 1.154, 0.823], [sign * 0.26, 1.165, 0.808], [sign * 0.595, 1.178, 0.784]], 0.006);
    crease(`hood-pressed-edge-${sign}`, trim,
      [[sign * 0.77, 1.021, 2.183], [sign * 0.808, 1.061, 1.786], [sign * 0.812, 1.111, 0.928]], 0.0023);
  }
  loft("long-level-black-SUV-roof", roof, [
    [-1.765, 0.665, 1.499], [-1.535, 0.724, 1.577], [-1.15, 0.736, 1.595],
    [-0.5, 0.737, 1.6], [-0.07, 0.721, 1.594], [0.168, 0.692, 1.568],
  ].map(([z, w, y]) => ({ z, points: [[-w, y - 0.018], [w, y - 0.018], [w, y],
    [w * 0.82, y + 0.006], [0, y + 0.009], [-w * 0.82, y + 0.006], [-w, y]] })));
  for (const sign of [-1, 1]) {
    loft(`roof-rail-${sign}`, roof, [
      [-1.514, 0.693, 1.585], [-1.39, 0.704, 1.623], [-1.23, 0.703, 1.631],
      [-0.35, 0.699, 1.631], [-0.132, 0.689, 1.617], [0.055, 0.671, 1.587],
    ].map(([z, x, y]) => ({ z, points: Array.from({ length: 10 }, (_, i) => {
      const angle = i * Math.PI / 5;
      return [sign * x + Math.cos(angle) * 0.014, y + Math.sin(angle) * 0.016 / Math.sin(2 * Math.PI / 5)];
    }) })));
  }
  loft("integrated-rear-roof-spoiler", roof, [
    { z: -1.947, points: [[-0.69, 1.517], [0.69, 1.517], [0.721, 1.543], [0.675, 1.559], [-0.675, 1.559], [-0.721, 1.543]] },
    { z: -1.699, points: [[-0.68, 1.508], [0.68, 1.508], [0.716, 1.549], [0.68, 1.567], [-0.68, 1.567], [-0.716, 1.549]] },
  ]);
  box("spoiler-high-mounted-brake-light", taillight, [0.38, 0.012, 0.009], [0, 1.526, -1.947]);
  loft("roof-shark-fin-aerial", roof, [
    { z: -1.412, points: [[-0.019, 1.598], [0.019, 1.598], [0.008, 1.625], [-0.008, 1.625]] },
    { z: -1.277, points: [[-0.023, 1.6], [0.023, 1.6], [0.004, 1.644], [-0.004, 1.644]] },
    { z: -1.25, points: [[-0.015, 1.601], [0.015, 1.601], [0.004, 1.609], [-0.004, 1.609]] },
  ]);

  // Facelift shield, angular lamp pockets and the outward upright of each hammer.
  panel("closed-grille-perimeter", trim, [[-0.486, 0.81, 2.196], [0.486, 0.81, 2.196],
    [0.51, 0.853, 2.196], [0.51, 0.998, 2.196], [0.471, 1.02, 2.196], [-0.471, 1.02, 2.196], [-0.51, 0.998, 2.196], [-0.51, 0.853, 2.196]]);
  panel("body-colour-closed-electric-grille", paint, [[-0.468, 0.833, 2.2], [0.468, 0.833, 2.2],
    [0.495, 0.856, 2.2], [0.495, 0.992, 2.2], [0.467, 1.009, 2.2], [-0.467, 1.009, 2.2], [-0.495, 0.992, 2.2], [-0.495, 0.856, 2.2]]);
  line("Volvo-diagonal-grille-slash", alloy, [[-0.174, 0.839, 2.207], [0.174, 1.002, 2.207]], 0.006);
  mesh("Volvo-iron-mark-black-centre", new THREE.CircleGeometry(0.071, 40), roof, [0, 0.92, 2.212]);
  mesh("Volvo-iron-mark-ring", new THREE.TorusGeometry(0.074, 0.006, 8, 40), alloy, [0, 0.92, 2.211]);
  line("Volvo-iron-mark-arrow-shaft", alloy, [[0.05, 0.971, 2.212], [0.091, 1.012, 2.212]], 0.005);
  panel("Volvo-iron-mark-arrowhead", alloy, [[0.068, 1.011, 2.214], [0.094, 1.016, 2.214], [0.088, 0.99, 2.214]]);
  badge("Volvo-front-wordmark", "VOLVO", alloy, 0.018, [0, 0.915, 2.215]);
  for (const sign of [-1, 1]) {
    const lampZ = x => 2.208 - (x - 0.5) * 0.028;
    const lampPoints = [[0.518, 0.994], [0.83, 1.031], [0.849, 1.003], [0.844, 0.894],
      [0.806, 0.869], [0.697, 0.888], [0.558, 0.935]];
    panel(`facelift-headlamp-pocket-${sign}`, lampHousing, lampPoints.map(([x, y]) => [sign * x, y, lampZ(x)]));
    panel(`angular-Thors-hammer-horizontal-${sign}`, headlight,
      [[0.535, 0.972], [0.821, 1.007], [0.82, 0.983], [0.547, 0.947]]
        .map(([x, y]) => [sign * x, y, lampZ(x) + 0.004]));
    panel(`angular-Thors-hammer-upright-${sign}`, headlight,
      [[0.813, 1.016], [0.836, 1.028], [0.835, 0.921], [0.816, 0.893], [0.805, 0.895]]
        .map(([x, y]) => [sign * x, y, lampZ(x) + 0.005]));
    for (let i = 0; i < 3; i++) {
      const x = 0.58 + 0.063 * i;
      box(`headlamp-pixel-optic-${sign}-${i}`, alloy, [0.036, 0.016, 0.005],
        [sign * x, 0.986 + 0.0075 * i, lampZ(x) + 0.004]);
    }
    panel(`lower-headlamp-projector-${sign}`, darkAlloy,
      [[0.716, 0.908], [0.779, 0.915], [0.779, 0.948], [0.716, 0.941]]
        .map(([x, y]) => [sign * x, y, lampZ(x) + 0.004]));
    panel(`front-bumper-angular-air-curtain-${sign}`, trim,
      [[sign * 0.697, 0.485, 2.19], [sign * 0.801, 0.474, 2.15], [sign * 0.812, 0.711, 2.148],
        [sign * 0.76, 0.719, 2.17], [sign * 0.69, 0.617, 2.19]]);
    box(`front-fog-lamp-surround-${sign}`, lampHousing, [0.126, 0.035, 0.014], [sign * 0.733, 0.592, 2.19]);
    box(`front-fog-lamp-lens-${sign}`, alloy, [0.047, 0.016, 0.007], [sign * 0.728, 0.592, 2.2]);
  }
  panel("trapezoidal-lower-radiator-opening", trim,
    [[-0.591, 0.425, 2.199], [0.591, 0.425, 2.199], [0.457, 0.592, 2.199], [-0.457, 0.592, 2.199]]);
  for (let i = 0; i < 4; i++) {
    const y = 0.449 + i * 0.037, w = 1.105 - i * 0.07;
    box(`lower-intake-horizontal-louvre-${i}`, darkAlloy, [w, 0.007, 0.012], [0, y, 2.203]);
  }
  for (let i = -5; i <= 5; i++) {
    box(`lower-intake-vertical-vane-${i}`, trim, [0.006, 0.12, 0.009], [i * 0.077, 0.508, 2.21]);
  }
  panel("front-lower-skid-surface", darkAlloy,
    [[-0.59, 0.331, 2.21], [0.59, 0.331, 2.21], [0.533, 0.376, 2.218], [-0.533, 0.376, 2.218]]);

  const hatchZ = (y, u = 0) => -2.205 + Math.max(0, y - 0.79) * 0.18 + 0.004 * u * u;
  surface("sculpted-upright-tailgate", paint, 24, 12, (u, v) => {
    const s = 2 * u - 1, y = 0.675 + 0.475 * v;
    const w = 0.65 + 0.055 * Math.sin(v * Math.PI * 0.85);
    return [s * w, y, hatchZ(y, s) - 0.007 * Math.sin(v * Math.PI) * (1 - s * s)];
  });
  crease("tailgate-perimeter-shutline", trim,
    [[-0.696, 1.133], [-0.713, 0.978], [-0.671, 0.694], [-0.626, 0.672],
      [0.626, 0.672], [0.671, 0.694], [0.713, 0.978], [0.696, 1.133]]
      .map(([x, y]) => [x, y, hatchZ(y, x / 0.71) - 0.004]), 0.003);
  crease("rear-window-wiper", trim, [[0.018, 1.185, -2.094], [-0.038, 1.179, -2.096], [-0.475, 1.173, -2.099]], 0.009);
  box("rear-wiper-pivot", roof, [0.074, 0.035, 0.025], [0.017, 1.184, -2.078]);
  for (const sign of [-1, 1]) {
    const path = [[0.644, 1.467, -1.793], [0.675, 1.34, -1.927], [0.699, 1.191, -2.079],
      [0.735, 1.13, -2.137], [0.838, 1.103, -2.146], [0.856, 1.079, -2.153],
      [0.856, 1.015, -2.168], [0.838, 0.991, -2.175], [0.721, 0.993, -2.176]]
      .map(([x, y, z]) => [sign * x, y, z]);
    for (const [name, material, offset, radius] of [
      ["black-housing", lampHousing, 0, 0.035], ["red-lens", redLens, -0.013, 0.026],
      ["inward-hook-LED", taillight, -0.025, 0.011],
    ]) {
      const curve = new THREE.CatmullRomCurve3(path.map(([x, y, z]) => new THREE.Vector3(x, y, z + offset)));
      const geometry = new THREE.TubeGeometry(curve, 48, radius, 6, false);
      const p = geometry.attributes.position;
      // Shallow lens depth, with a broad luminous face rather than a round hose.
      for (let i = 0; i < p.count; i++) {
        const centre = curve.getPointAt(Math.floor(i / 7) / 48);
        p.setZ(i, centre.z + (p.getZ(i) - centre.z) * 0.45);
      }
      geometry.computeVertexNormals();
      mesh(`rear-vertical-lamp-${name}-${sign}`, geometry, material);
    }
    panel(`rear-lamp-side-wrap-${sign}`, redLens,
      [[sign * 0.88, 1.104, -1.852], [sign * 0.916, 1.068, -1.896], [sign * 0.879, 1.015, -2.097],
        [sign * 0.847, 1.041, -2.147], [sign * 0.838, 1.103, -2.147]]);
    box(`rear-lamp-clear-reversing-insert-${sign}`, alloy, [0.091, 0.014, 0.006], [sign * 0.793, 1.038, -2.18]);
    box(`rear-bumper-reflector-recess-${sign}`, trim, [0.298, 0.049, 0.012], [sign * 0.601, 0.545, -2.202]);
    box(`rear-bumper-red-reflector-${sign}`, redLens, [0.266, 0.023, 0.006], [sign * 0.601, 0.553, -2.211]);
  }
  // Individual spaced letters are actual geometry, with their front facing -Z.
  "VOLVO".split("").forEach((letter, index) => {
    badge(`rear-VOLVO-letter-${index}`, letter, alloy, 0.034, [(2 - index) * 0.147, 1.066, hatchZ(1.066) - 0.01], [0, Math.PI, 0]);
  });
  badge("rear-EX40-model-badge", "EX40", alloy, 0.027, [0.528, 0.969, hatchZ(0.969) - 0.011], [0, Math.PI, 0]);
  panel("rear-number-plate-recess", trim,
    [[-0.36, 0.473, -2.208], [0.36, 0.473, -2.208], [0.399, 0.569, -2.208],
      [0.329, 0.632, -2.208], [-0.329, 0.632, -2.208], [-0.399, 0.569, -2.208]]);
  box("rear-number-plate-border", alloy, [0.516, 0.107, 0.004], [0, 0.549, -2.213]);
  box("rear-number-plate", roof, [0.501, 0.094, 0.003], [0, 0.549, -2.216]);
  badge("rear-number-plate-EX40", "EX40", alloy, 0.045, [0, 0.548, -2.218], [0, Math.PI, 0]);
  panel("rear-integrated-diffuser", darkAlloy,
    [[-0.721, 0.285, -2.155], [0.721, 0.285, -2.155], [0.774, 0.341, -2.201],
      [0.733, 0.376, -2.217], [-0.733, 0.376, -2.217], [-0.774, 0.341, -2.201]]);
  for (const x of [-0.5, -0.26, 0.26, 0.5]) {
    box(`rear-diffuser-fin-${x}`, trim, [0.015, 0.049, 0.145], [x, 0.287, -2.094]);
  }
  for (const front of [false, true]) {
    for (const x of [-0.751, -0.338, 0.338, 0.751]) {
      const sensor = mesh(`${front ? "front" : "rear"}-parking-sensor-${x}`,
        new THREE.CircleGeometry(0.009, 12), front ? paint : trim,
        [x, front ? 0.678 : 0.474, front ? 2.19 : -2.216]);
      sensor.rotation.y = front ? 0 : Math.PI;
    }
  }
  const chargeOutline = [[-1.808, 0.948], [-1.787, 1.035], [-1.569, 1.044], [-1.531, 1.025],
    [-1.553, 0.95], [-1.587, 0.932], [-1.782, 0.933], [-1.808, 0.948]];
  crease("left-rear-charge-port-door", trim,
    chargeOutline.map(([z, y]) => [-bodyX(y, z) - 0.002, y, z]), 0.0025);

  model.userData.dimensions = { length: 4.44, width: 1.873, height: 1.647, wheelbase: 2.702 };
  model.userData.widthIncludingMirrors = 2.034;
  model.userData.tracks = { front: 1.601, rear: 1.608 };
  model.userData.reference = {
    description: "Original custom approximation of the facelift Volvo EX40 compact electric SUV, based on Volvo MY26 exterior photographs; not an EC40, EX30, scan, or manufacturer CAD model.",
    overview: "https://www.volvocars.com/uk/cars/ex40-electric/",
    specifications: "https://www.volvocars.com/uk/cars/ex40-electric/specifications/",
    front: "https://www.volvocars.com/images/cs/v3/assets/blt0feaa88e629251fc/blted1764dfad0fd826/684c2c59106bd7ebcef02c24/Exterior-bento-front-4x5-EX40.jpg",
    rear: "https://www.volvocars.com/images/cs/v3/assets/blt0feaa88e629251fc/blt66c4bda44f67d320/684c2c9cc6e1432272d97a71/Exterior-bento-rear-4x5-EX40.jpg",
    side: "https://www.volvocars.com/images/cs/v3/assets/blt0feaa88e629251fc/blt0c322a290736fe14/684c2be08319c43f4bd8d5e8/my26_ex40_ext_side_left_16x9.jpg",
    limitations: "Exterior-only, closed doors, opaque reflective glazing, simplified optics, seals, underbody and geometry-stroke lettering. 19-inch five-spoke wheels use the shared authored wheel helper.",
  };
  return model;
}
