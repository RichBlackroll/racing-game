import * as THREE from "three";
import { createCarTools } from "./authored-car-geometry.js";

// Original, reference-led AU/NZ export-body approximation, not a Seagull mesh.
// Metres; +Y up, +Z forward. 185/55 R16 tyres on the brochure's unequal tracks.
export function createBydAtto1() {
  const { model, materials, mesh, box, panel, line, loft, wheel, badge } = createCarTools("byd-atto-1");
  const { paint, glass, trim, rubber, alloy, darkAlloy, headlight, taillight } = materials;
  paint.name = "authored-paint";
  paint.color.set(0xe5e7df);
  paint.metalness = 0.22;
  paint.roughness = 0.29;
  glass.name = "authored-window";
  glass.color.set(0x18232e);
  glass.roughness = 0.16;
  glass.metalness = 0.32;
  glass.transparent = false;
  glass.opacity = 1;
  glass.depthWrite = true;
  headlight.name = "authored-headlight";
  taillight.name = "authored-taillight";
  const dots = new THREE.MeshStandardMaterial({ name: "atto-ice-crystal-inlay", color: 0x48525c, roughness: 0.48, metalness: 0.35 });
  const clearLens = new THREE.MeshStandardMaterial({ name: "atto-rear-clear-lens", color: 0xabb6bf, roughness: 0.24, metalness: 0.35 });
  for (const material of [...Object.values(materials), dots, clearLens]) material.side = THREE.DoubleSide;

  const tyreRadius = 0.2032 + 0.185 * 0.55;
  const archRadius = 0.383, archHeight = 0.403, sillY = 0.215, shellY = 0.755;
  const body = [
    [-1.965, 0.729, 1.115], [-1.88, 0.791, 1.158], [-1.65, 0.846, 1.256],
    [-1.25, 0.855, 1.232], [-0.85, 0.844, 1.187], [-0.3, 0.836, 1.129],
    [0.25, 0.838, 1.083], [0.9, 0.851, 1.064], [1.2, 0.855, 1.035],
    [1.58, 0.85, 0.984], [1.82, 0.813, 0.925], [1.965, 0.739, 0.876],
  ];
  const cabin = [
    [-1.855, 0.728, 1.15, 0.671, 1.204], [-1.60, 0.785, 1.259, 0.635, 1.452],
    [-1.28, 0.795, 1.232, 0.654, 1.489], [-0.90, 0.798, 1.194, 0.665, 1.504],
    [-0.30, 0.798, 1.137, 0.665, 1.506], [0.06, 0.794, 1.108, 0.653, 1.489],
    [0.25, 0.791, 1.09, 0.655, 1.435], [0.98, 0.763, 1.075, 0.735, 1.101],
  ];
  function sample(stations, z) {
    let i = 0;
    while (i < stations.length - 2 && stations[i + 1][0] < z) i++;
    const a = stations[i], b = stations[i + 1];
    const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return a.map((v, j) => THREE.MathUtils.lerp(v, b[j], t));
  }
  function bodyRing(z) {
    const [, w, y] = sample(body, z);
    const crease = Math.max(shellY + 0.018, Math.min(y - 0.05, 0.936 + z * 0.105));
    return [[w, shellY], [w - 0.006, crease], [w - 0.035, y - 0.021], [w - 0.15, y + 0.017], [0, y + 0.034]];
  }
  function sideX(z, y) {
    const ring = bodyRing(z);
    if (y <= shellY) {
      const tuck = 0.037 * (shellY - y) / (shellY - sillY);
      const hollow = 0.019 * Math.max(0, 1 - Math.abs(z) / 0.9) * Math.sin(Math.PI * THREE.MathUtils.clamp((y - sillY) / (shellY - sillY), 0, 1));
      return ring[0][0] - tuck - hollow;
    }
    for (let i = 0; i < ring.length - 1; i++) {
      if (y <= ring[i + 1][1]) return THREE.MathUtils.lerp(ring[i][0], ring[i + 1][0], (y - ring[i][1]) / (ring[i + 1][1] - ring[i][1]));
    }
    return ring[ring.length - 2][0];
  }
  function bonnetY(x, z) {
    const ring = bodyRing(z);
    for (let i = 1; i < ring.length; i++) {
      if (Math.abs(x) >= ring[i][0]) return THREE.MathUtils.lerp(ring[i][1], ring[i - 1][1], THREE.MathUtils.clamp((Math.abs(x) - ring[i][0]) / (ring[i - 1][0] - ring[i][0]), 0, 1));
    }
    return ring.at(-1)[1];
  }
  function sidePoint(side, z, y, offset = 0.003) {
    return [side * Math.min(0.86, sideX(z, y) + offset), y, z];
  }
  function cabinPoint(side, z, y, offset = 0.003) {
    const [, bw, by, rw, ry] = sample(cabin, z);
    const t = THREE.MathUtils.clamp((y - by) / (ry - by), 0, 1);
    return [side * (THREE.MathUtils.lerp(bw, rw, t) + offset), y, z];
  }
  // Shared grid topology for curved skins, recessed glazing and annular arch lips.
  function grid(name, material, rows, reverse = false) {
    const positions = rows.flat(2), indices = [], columns = rows[0].length;
    for (let r = 0; r < rows.length - 1; r++) {
      for (let c = 0; c < columns - 1; c++) {
        const a = r * columns + c, b = a + columns;
        if (reverse) indices.push(a, a + 1, b, a + 1, b + 1, b);
        else indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const object = mesh(name, geometry, material);
    if (material === glass) object.receiveShadow = false;
    return object;
  }
  function surfacePanel(name, material, points, project) {
    const faces = THREE.ShapeUtils.triangulateShape(points.map(p => new THREE.Vector2(...p)), []);
    const positions = [], divisions = 6;
    for (const face of faces) {
      const [a, b, c] = face.map(i => points[i]);
      const at = (i, j) => project(...a.map((v, k) => v + (b[k] - v) * i / divisions + (c[k] - v) * j / divisions));
      for (let i = 0; i < divisions; i++) {
        for (let j = 0; j < divisions - i; j++) {
          positions.push(...at(i, j), ...at(i + 1, j), ...at(i, j + 1));
          if (i + j < divisions - 1) positions.push(...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j + 1));
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return mesh(name, geometry, material);
  }

  // The side skins terminate at the arch boundary. No full-width box or disc
  // occupies the wheel openings; the battery floor stays inboard of the tyres.
  const lowerEdge = [[-1.965, 0.275], [-1.82, sillY], [-1.25 - archRadius, sillY]];
  for (const axleZ of [-1.25, 1.25]) {
    if (axleZ > 0) {
      for (const z of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, axleZ - archRadius]) lowerEdge.push([z, sillY]);
    }
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * (1 - i / 40);
      lowerEdge.push([axleZ + archRadius * Math.cos(a), tyreRadius + archHeight * Math.sin(a)]);
    }
    lowerEdge.push([axleZ + archRadius, sillY]);
  }
  lowerEdge.push([1.82, sillY], [1.965, 0.265]);
  const shellRows = [];
  for (let i = 0; i < lowerEdge.length - 1; i++) {
    const a = lowerEdge[i], b = lowerEdge[i + 1];
    const steps = Math.max(1, Math.ceil((b[0] - a[0]) / 0.025));
    for (let j = 0; j < steps; j++) shellRows.push(a.map((v, k) => THREE.MathUtils.lerp(v, b[k], j / steps)));
  }
  shellRows.push(lowerEdge.at(-1));
  const shellRings = shellRows.map(([z, bottom]) => {
    const right = [...Array.from({ length: 7 }, (_, i) => {
      const y = THREE.MathUtils.lerp(bottom, shellY, i / 6);
      return [sideX(z, y), y];
    }), ...bodyRing(z).slice(1)];
    return [...right, ...right.slice(0, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x, y, z]);
  });
  // A single continuous cross-section skin avoids a false horizontal join at
  // arch-top height. End caps close only the nose and tail, not the wheel bays.
  grid("continuous-sculpted-body-with-open-arches", paint, shellRings, true);
  panel("rear-export-body-end", paint, shellRings[0]);
  panel("front-export-body-end", paint, shellRings.at(-1));
  for (const side of [-1, 1]) {
    const label = side < 0 ? "left" : "right";
    for (const axleZ of [-1.25, 1.25]) {
      const end = axleZ < 0 ? "rear" : "front", lip = [], well = [];
      for (let i = -1; i <= 41; i++) {
        const a = Math.PI * (1 - THREE.MathUtils.clamp(i, 0, 40) / 40);
        const innerZ = axleZ + archRadius * Math.cos(a), outerZ = axleZ + 0.418 * Math.cos(a);
        const innerY = i < 0 || i > 40 ? sillY : tyreRadius + archHeight * Math.sin(a);
        const outerY = i < 0 || i > 40 ? sillY : tyreRadius + 0.435 * Math.sin(a);
        lip.push([sidePoint(side, innerZ, innerY, 0.007), sidePoint(side, outerZ, outerY, 0.007)]);
        well.push([sidePoint(side, innerZ, innerY, 0.006), [side * 0.635, innerY, innerZ]]);
      }
      grid(`${label}-${end}-arch-cladding`, trim, lip, side > 0);
      grid(`${label}-${end}-arch-inner-return`, rubber, well);
      panel(`${label}-${end}-inboard-arch-bulkhead`, rubber, well.map(row => row[1]));
      const glint = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * (0.16 + i / 14 * 0.35);
        glint.push(sidePoint(side, axleZ + 0.405 * Math.cos(a), tyreRadius + 0.424 * Math.sin(a), 0.001));
      }
      mesh(`${label}-${end}-arch-bevel`, new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(glint.map(p => new THREE.Vector3(...p))), 32, 0.003, 4, false), darkAlloy);
      wheel({ x: side * (axleZ > 0 ? 0.75 : 0.7415), z: axleZ, radius: tyreRadius, width: 0.185, rimRadius: 0.2032, style: "atto" });
    }
    surfacePanel(`${label}-rising-sill-insert`, trim, [
      [-0.865, 0.224], [-0.69, 0.407], [-0.54, 0.434], [-0.13, 0.395], [0.84, 0.235], [0.84, 0.215], [-0.865, 0.215],
    ], (z, y) => sidePoint(side, z, y, 0.005));
    surfacePanel(`${label}-sill-painted-arrow`, paint, [[-0.65, 0.236], [-0.53, 0.285], [-0.17, 0.277], [0.015, 0.235]],
      (z, y) => sidePoint(side, z, y, 0.010));
    line(`${label}-rocker-bottom`, trim, [-0.86, -0.45, 0, 0.45, 0.86].map(z => sidePoint(side, z, 0.212, 0)), 0.016);
  }
  box("inboard-battery-undertray", trim, [1.23, 0.075, 2.86], [0, 0.1875, 0]);

  const denseCabin = Array.from({ length: 115 }, (_, i) => sample(cabin, THREE.MathUtils.lerp(-1.855, 0.98, i / 114)));
  loft("tapered-glasshouse-surround", trim, denseCabin.map(([z, bw, by, rw, ry]) => ({ z, points: [
    [-bw, by], [bw, by], [rw, ry], [rw * 0.8, ry + 0.012], [0, ry + 0.018], [-rw * 0.8, ry + 0.012], [-rw, ry],
  ] })));
  const roofStations = [-1.61, -1.45, -1.28, -0.9, -0.3, 0.06, 0.19];
  loft("crowned-floating-roof", paint, roofStations.map(z => {
    const [, , , w, y] = sample(cabin, z);
    return { z, points: [[-w - 0.016, y - 0.016], [w + 0.016, y - 0.016], [w + 0.019, y + 0.003],
      [w * 0.8, y + 0.023], [0, y + 0.028], [-w * 0.8, y + 0.023], [-w - 0.019, y + 0.003]] };
  }));
  for (const [name, from, to] of [["swept-front-windscreen", 0.205, 0.934], ["rear-hatch-privacy-glass", -1.838, -1.606]]) {
    grid(name, glass, Array.from({ length: 19 }, (_, i) => {
      const z = THREE.MathUtils.lerp(from, to, i / 18), [, , , w, y] = sample(cabin, z);
      return Array.from({ length: 17 }, (_, j) => {
        const u = (j / 16 * 2 - 1) * 0.952;
        const crown = Math.abs(u) <= 0.8 ? 0.018 - Math.abs(u) * 0.0075 : 0.06 * (1 - Math.abs(u));
        return [u * w, y + crown + 0.004, z];
      });
    }));
  }

  for (const side of [-1, 1]) {
    const label = side < 0 ? "left" : "right";
    for (const [name, from, to] of [["front-door-window", -0.21, 0.83], ["rear-door-privacy-window", -1.27, -0.33]]) {
      const zs = [from, ...denseCabin.map(s => s[0]).filter(z => z > from && z < to), to];
      grid(`${label}-${name}`, glass, zs.map(z => {
        const [, , by, , ry] = sample(cabin, z);
        return Array.from({ length: 7 }, (_, i) => cabinPoint(side, z, THREE.MathUtils.lerp(by + 0.016, ry - 0.025, i / 6), 0.005));
      }), side > 0);
    }
    panel(`${label}-black-b-pillar`, trim, [[-0.327, 1.154], [-0.217, 1.143], [-0.217, 1.497], [-0.327, 1.501]]
      .map(([z, y]) => cabinPoint(side, z, y, 0.008)));
    const pillar = [[0.13, 1.473], [0.24, 1.45], [0.987, 1.078], [0.876, 1.091]];
    panel(`${label}-painted-a-pillar`, paint, pillar.map(([z, y]) => cabinPoint(side, z, y, 0.009)));
    line(`${label}-beltline-seal`, trim, cabin.slice(1).map(([z, , y]) => cabinPoint(side, z, y + 0.006, 0.006)), 0.008);
    panel(`${label}-floating-c-pillar`, trim, [[-1.635, 1.287], [-1.28, 1.258], [-1.28, 1.464], [-1.586, 1.432]]
      .map(([z, y]) => cabinPoint(side, z, y, 0.005)));
    const dotVertices = [];
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 18; column++) {
        const z = -1.59 + column * 0.016 + (row % 2) * 0.008;
        const y = 1.292 + row * 0.019 + (z + 1.59) * 0.06;
        const r = 0.0047 * (1 - row * 0.075);
        const p = [[z - r, y], [z, y + r], [z + r, y], [z, y - r]].map(([pz, py]) => cabinPoint(side, pz, py, 0.010));
        dotVertices.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
      }
    }
    const dotGeometry = new THREE.BufferGeometry();
    dotGeometry.setAttribute("position", new THREE.Float32BufferAttribute(dotVertices, 3));
    dotGeometry.computeVertexNormals();
    mesh(`${label}-c-pillar-ice-crystal-dots`, dotGeometry, dots);

    for (const [name, points] of [
      ["front-door-leading-shutline", [[0.87, 1.07], [0.83, 0.94], [0.805, 0.72], [0.80, 0.43], [0.795, 0.239]]],
      ["front-rear-door-shutline", [[-0.273, 1.134], [-0.275, 0.95], [-0.269, 0.76], [-0.255, 0.50], [-0.247, 0.225]]],
      ["rear-door-trailing-shutline", [[-1.31, 1.241], [-1.35, 1.10], [-1.385, 0.91], [-1.418, 0.721]]],
    ]) {
      const path = points.slice(0, -1).flatMap((a, i) => Array.from({ length: 8 }, (_, j) =>
        a.map((v, k) => THREE.MathUtils.lerp(v, points[i + 1][k], j / 8))));
      path.push(points.at(-1));
      mesh(`${label}-${name}`, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
        path.map(([z, y]) => new THREE.Vector3(...sidePoint(side, z, y, 0.004)))), 40, 0.0025, 4, false), trim);
    }
    for (const [name, z, y] of [["front", 0.29, 0.905], ["rear", -0.9, 0.969]]) {
      surfacePanel(`${label}-${name}-handle-recess`, trim, [[z - 0.112, y - 0.025], [z + 0.105, y - 0.033], [z + 0.11, y + 0.025], [z + 0.071, y + 0.055], [z - 0.101, y + 0.057]],
        (pz, py) => sidePoint(side, pz, py, 0.005));
      surfacePanel(`${label}-${name}-body-colour-pull-handle`, paint, [[z - 0.102, y + 0.002], [z + 0.10, y - 0.006], [z + 0.074, y + 0.045], [z - 0.098, y + 0.047]],
        (pz, py) => sidePoint(side, pz, py, 0.013));
    }
    panel(`${label}-mirror-sail`, trim, [[0.625, 1.119], [0.851, 1.095], [0.71, 1.197]]
      .map(([z, y]) => cabinPoint(side, z, y, 0.012)));
    line(`${label}-mirror-stalk`, trim, [[side * 0.773, 1.119, 0.718], [side * 0.856, 1.144, 0.71]], 0.025);
    loft(`${label}-mirror-painted-cap`, paint, [
      { z: 0.609, points: [[side * 0.816, 1.132], [side * 0.986, 1.146], [side * 0.977, 1.226], [side * 0.859, 1.258], [side * 0.817, 1.222]] },
      { z: 0.68, points: [[side * 0.815, 1.13], [side * 1.008, 1.157], [side * 0.988, 1.235], [side * 0.862, 1.27], [side * 0.806, 1.217]] },
      { z: 0.788, points: [[side * 0.82, 1.151], [side * 0.967, 1.174], [side * 0.945, 1.22], [side * 0.861, 1.239], [side * 0.816, 1.20]] },
    ]);
    panel(`${label}-mirror-reflector`, clearLens, [[side * 0.832, 1.149, 0.605], [side * 0.971, 1.158, 0.605], [side * 0.963, 1.216, 0.605], [side * 0.855, 1.239, 0.605]]);
    line(`${label}-mirror-indicator`, clearLens, [[side * 0.855, 1.142, 0.783], [side * 0.931, 1.15, 0.789], [side * 0.97, 1.167, 0.76]], 0.006);
  }
  line("right-front-charge-flap-seam", trim, [[1.06, 0.879], [1.06, 0.995], [1.235, 0.976], [1.262, 0.949], [1.262, 0.86], [1.06, 0.879]]
    .map(([z, y]) => sidePoint(1, z, y)), 0.0024);
  for (const side of [-1, 1]) {
    line(`${side < 0 ? "left" : "right"}-bonnet-shutline`, trim, [0.99, 1.15, 1.42, 1.63].map(z => {
      const x = side * (0.67 - (z - 0.99) * 0.058);
      return [x, bonnetY(x, z) + 0.002, z];
    }), 0.0025);
  }
  line("windscreen-cowl-seal", trim, [[-0.71, 1.118, 0.944], [0, 1.139, 0.944], [0.71, 1.118, 0.944]], 0.011);
  for (const [i, x] of [-0.33, 0.28].entries()) {
    line(`front-wiper-arm-${i}`, trim, [[x + 0.12, 1.14, 0.925], [x - 0.12, 1.159, 0.886]], 0.006);
    line(`front-wiper-blade-${i}`, rubber, [[x - 0.25, 1.159, 0.89], [x + 0.13, 1.159, 0.895]], 0.008);
  }

  for (const front of [false, true]) {
    const sign = front ? 1 : -1, name = front ? "front" : "rear";
    loft(`${name}-lower-bumper-lip`, trim, [
      { z: sign * 1.70, points: [[-0.798, 0.198], [0.798, 0.198], [0.802, 0.253], [-0.802, 0.253]] },
      { z: sign * 1.95, points: [[-0.734, 0.208], [0.734, 0.208], [0.751, 0.265], [-0.751, 0.265]] },
      { z: sign * 1.995, points: [[-0.655, 0.224], [0.655, 0.224], [0.693, 0.261], [-0.693, 0.261]] },
    ].sort((a, b) => a.z - b.z));
  }
  panel("front-swept-black-bumper-brow", trim, [
    [-0.729, 0.326, 1.97], [-0.666, 0.67, 1.971], [-0.606, 0.721, 1.974], [0.606, 0.721, 1.974],
    [0.666, 0.67, 1.971], [0.729, 0.326, 1.97], [0.615, 0.339, 1.973], [0.471, 0.566, 1.978], [-0.471, 0.566, 1.978], [-0.615, 0.339, 1.973],
  ]);
  panel("front-trapezoidal-lower-intake", rubber, [[-0.60, 0.284, 1.967], [0.60, 0.284, 1.967], [0.397, 0.553, 1.967], [-0.397, 0.553, 1.967]]);
  for (let row = 0; row < 4; row++) {
    const y = 0.306 + row * 0.058, w = 0.58 - row * 0.052;
    line(`front-intake-horizontal-louvre-${row}`, trim, [[-w, y, 1.976], [0, y + 0.004, 1.981], [w, y, 1.976]], 0.011);
    for (let column = -3; column <= 3; column++) {
      const x = column * 0.14 + (row % 2) * 0.045;
      if (Math.abs(x) + 0.03 < w) line(`front-intake-cell-${row}-${column}`, darkAlloy, [[x - 0.022, y + 0.012, 1.975], [x + 0.011, y + 0.046, 1.975]], 0.008);
    }
  }
  box("front-numberplate-plinth", trim, [0.49, 0.153, 0.018], [0, 0.588, 1.978]);
  badge("front-display-plate", "BYD ATTO 1", clearLens, 0.025, [0, 0.588, 1.990]);
  box("front-adas-sensor", trim, [0.118, 0.088, 0.014], [0, 0.394, 1.98]);
  panel("front-camera-mount", trim, [[-0.052, 0.72, 1.971], [0.052, 0.72, 1.971], [0.039, 0.753, 1.971], [-0.023, 0.753, 1.971]]);
  badge("nose-byd-badge", "BYD", alloy, 0.039, [0, 0.851, 1.972], [-0.28, 0, 0]);

  // The eyes follow the bonnet's swept surface instead of facing forward as boxes.
  for (const side of [-1, 1]) {
    const label = side < 0 ? "left" : "right";
    function eye(u, v, lift = 0.006) {
      const x = 0.332 + 0.449 * u;
      const back = 1.889 - 0.293 * u, front = 1.944 - 0.108 * u;
      const z = THREE.MathUtils.lerp(back, front, v);
      return [side * x, bonnetY(x, z) + lift, z];
    }
    grid(`${label}-slanted-headlamp-housing`, darkAlloy, Array.from({ length: 19 }, (_, i) =>
      Array.from({ length: 9 }, (_, j) => eye(i / 18, j / 8))), side > 0);
    const outline = [...Array.from({ length: 19 }, (_, i) => eye(i / 18, 0, 0.008)), ...Array.from({ length: 19 }, (_, i) => eye(1 - i / 18, 1, 0.008))];
    mesh(`${label}-headlamp-perimeter`, new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(outline.map(p => new THREE.Vector3(...p)), true), 64, 0.005, 4, true), trim);
    for (let bar = 0; bar < 6; bar++) {
      const u = [0.13, 0.23, 0.33, 0.45, 0.84, 0.95][bar];
      const width = bar === 3 || bar === 5 ? 0.019 : 0.006;
      grid(`${label}-angled-led-bar-${bar + 1}`, headlight, Array.from({ length: 6 }, (_, j) => {
        const v = 0.13 + j / 5 * 0.73, slant = (v - 0.5) * 0.058;
        return [eye(u + slant - width, v, 0.012), eye(u + slant + width, v, 0.012)];
      }), side < 0);
    }
    grid(`${label}-led-projector`, headlight, [
      [eye(0.59, 0.31, 0.013), eye(0.71, 0.31, 0.013)], [eye(0.59, 0.65, 0.013), eye(0.71, 0.65, 0.013)],
    ], side < 0);
    line(`${label}-projector-lower-reflector`, clearLens, [eye(0.54, 0.86, 0.013), eye(0.75, 0.86, 0.013)], 0.005);
  }

  function rearPoint(x, y, lift = 0) {
    const corner = THREE.MathUtils.smoothstep(Math.abs(x), 0.70, 0.80);
    return [x, y, -1.979 + 0.115 * corner + 0.20 * (y - 1.13) - lift];
  }
  grid("full-width-rear-lamp-smoked-surround", trim, Array.from({ length: 41 }, (_, i) => {
    const x = -0.788 + i / 40 * 1.576;
    return [rearPoint(x, 1.091), rearPoint(x, 1.228)];
  }), true);
  grid("full-width-rear-led-bridge", taillight, Array.from({ length: 41 }, (_, i) => {
    const x = -0.782 + i / 40 * 1.564;
    return [rearPoint(x, 1.20, 0.003), rearPoint(x, 1.22, 0.003)];
  }), true);
  grid("rear-clear-indicator-band", clearLens, Array.from({ length: 41 }, (_, i) => {
    const x = -0.771 + i / 40 * 1.542;
    return [rearPoint(x, 1.16, 0.002), rearPoint(x, 1.178, 0.002)];
  }), true);
  for (const side of [-1, 1]) {
    const label = side < 0 ? "left" : "right";
    panel(`${label}-thick-rear-led-end`, taillight, [[0.54, 1.10], [0.767, 1.10], [0.787, 1.156], [0.576, 1.15]].map(([x, y]) => rearPoint(side * x, y, 0.005)));
    surfacePanel(`${label}-rear-lamp-quarter-wrap`, trim, [[-1.845, 1.222], [-1.66, 1.223], [-1.54, 1.112], [-1.84, 1.095]],
      (z, y) => sidePoint(side, z, y, 0.008));
    line(`${label}-rear-led-return`, taillight, [[-1.84, 1.211], [-1.73, 1.211], [-1.665, 1.211]].map(([z, y]) => sidePoint(side, z, y, 0.012)), 0.009);
    surfacePanel(`${label}-rear-led-return-end`, taillight, [[-1.838, 1.104], [-1.57, 1.12], [-1.60, 1.15], [-1.831, 1.147]],
      (z, y) => sidePoint(side, z, y, 0.012));
    line(`${label}-hatch-side-shutline`, trim, [[side * 0.605, 1.095, -1.969], [side * 0.63, 0.91, -1.969], [side * 0.602, 0.683, -1.969]], 0.0027);
  }
  line("hatch-lower-shutline", trim, [[-0.602, 0.683, -1.969], [0, 0.678, -1.969], [0.602, 0.683, -1.969]], 0.0027);
  const rearMatrix = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 65; column++) {
      const x = -0.53 + column * 0.0165 + (row % 2) * 0.008;
      const y = 1.114 + row * 0.013, r = 0.004;
      const p = [[x - r, y], [x, y + r], [x + r, y], [x, y - r]].map(([px, py]) => rearPoint(px, py, 0.003));
      rearMatrix.push(...p[0], ...p[1], ...p[2], ...p[0], ...p[2], ...p[3]);
    }
  }
  const matrixGeometry = new THREE.BufferGeometry();
  matrixGeometry.setAttribute("position", new THREE.Float32BufferAttribute(rearMatrix, 3));
  matrixGeometry.computeVertexNormals();
  mesh("rear-led-diamond-matrix", matrixGeometry, taillight);
  badge("tailgate-byd-badge", "BYD", alloy, 0.052, [0, 1.023, -1.969], [0, Math.PI, 0]);
  badge("tailgate-atto-1-badge", "ATTO 1", alloy, 0.029, [-0.435, 0.821, -1.968], [0, Math.PI, 0]);
  badge("tailgate-ev-badge", "EV", alloy, 0.022, [0.493, 0.819, -1.968], [0, Math.PI, 0]);
  panel("rear-angular-bumper-valance", trim, [[-0.699, 0.274, -1.974], [0.699, 0.274, -1.974], [0.526, 0.627, -1.973], [0.435, 0.669, -1.973], [-0.435, 0.669, -1.973], [-0.526, 0.627, -1.973]]);
  box("rear-numberplate-recess", rubber, [0.49, 0.147, 0.013], [0, 0.535, -1.975]);
  badge("rear-display-plate", "BYD ATTO 1", clearLens, 0.025, [0, 0.535, -1.986], [0, Math.PI, 0]);
  for (const side of [-1, 1]) {
    const label = side < 0 ? "left" : "right";
    panel(`${label}-rear-painted-bumper-tusk`, paint, [[side * 0.54, 0.30, -1.98], [side * 0.708, 0.295, -1.976], [side * 0.641, 0.595, -1.976], [side * 0.561, 0.603, -1.98]]);
    panel(`${label}-rear-diagonal-reflector`, taillight, [[side * 0.566, 0.347, -1.986], [side * 0.613, 0.352, -1.986], [side * 0.562, 0.573, -1.984], [side * 0.533, 0.567, -1.984]]);
  }
  box("rear-central-fog-lamp", taillight, [0.167, 0.03, 0.011], [0, 0.278, -1.984]);
  for (const x of [-0.31, -0.15, 0.15, 0.31]) panel(`rear-diffuser-rib-${x}`, trim, [[x, 0.209, -1.985], [x, 0.301, -1.932], [x, 0.24, -1.754], [x, 0.191, -1.754]]);
  loft("integrated-roof-spoiler", paint, [
    { z: -1.829, points: [[-0.697, 1.468], [0.697, 1.468], [0.735, 1.508], [0, 1.525], [-0.735, 1.508]] },
    { z: -1.69, points: [[-0.671, 1.445], [0.671, 1.445], [0.696, 1.506], [0, 1.523], [-0.696, 1.506]] },
    { z: -1.495, points: [[-0.639, 1.458], [0.639, 1.458], [0.662, 1.491], [0, 1.507], [-0.662, 1.491]] },
  ]);
  panel("spoiler-black-underside", trim, [[-0.691, 1.464, -1.83], [0.691, 1.464, -1.83], [0.633, 1.437, -1.621], [-0.633, 1.437, -1.621]]);
  box("spoiler-high-mounted-stop-lamp", taillight, [0.278, 0.023, 0.015], [0, 1.478, -1.834]);
  loft("roof-shark-fin-antenna", paint, [
    { z: -1.22, points: [[-0.028, 1.53], [0.028, 1.53], [0.004, 1.59], [-0.004, 1.59]] },
    { z: -1.08, points: [[-0.032, 1.532], [0.032, 1.532], [0.012, 1.555], [-0.012, 1.555]] },
    { z: -0.99, points: [[-0.019, 1.533], [0.019, 1.533], [0.009, 1.535], [-0.009, 1.535]] },
  ]);

  model.userData.dimensions = { length: 3.990, width: 1.720, height: 1.590, wheelbase: 2.500 };
  model.userData.reference = {
    description: "User-approved original custom approximation of the 2025 Australia/New Zealand BYD ATTO 1 Premium export model; extended 3.990 m body, not the shorter domestic Seagull, Dolphin or ATTO 3.",
    sources: ["https://bydautomotive.com.au/atto-1", "https://bydautomotive.com.au/brochures/BYD-ATTO-1-2025.pdf"],
    imagery: ["hero.png", "collage-1.jpg", "collage-2.jpg", "tech-specs.png", "2025 brochure pages 1-4"],
    choices: "Apricity White; four side doors and rear hatch; Premium 185/55 R16 two-tone five-spoke alloys; 1.500/1.483 m front/rear tracks. Dimensions exclude mirrors, include antenna; tyres touch Y=0.",
    limits: "Reference-led exterior, not manufacturer CAD. Simplified alloy machining, lamp optics, geometry-stroke badges and opaque privacy glazing; no interior or opening panels. All geometry is authored in code; no downloaded model, textures or fonts.",
  };
  return model;
}
