import { cubicPath, filletPath, offsetPath, polygonContains, polygonEdges, pointSegmentSquared, regionBoundary, landPolygons } from "./amsterdam-geometry.js";

const pathCache = new WeakMap();
function pathMetrics(points) {
  let metrics = pathCache.get(points);
  if (!metrics) {
    const arc = [0];
    for (let i = 1; i < points.length; i++) arc.push(arc[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    metrics = { arc, length: arc.at(-1) ?? 0 };
    pathCache.set(points, metrics);
  }
  return metrics;
}

export function amsterdamPathLength(points) { return pathMetrics(points).length; }

/** Clamped open-path distance; heading rotates local +X to (cos h, -sin h). */
export function sampleAmsterdamPath(points, distance, offset = 0) {
  if (!points.length) throw new RangeError("Cannot sample an empty Amsterdam path");
  const { arc, length } = pathMetrics(points);
  if (!length) return { x: points[0].x, z: points[0].z + offset, heading: 0 };
  const target = Math.max(0, Math.min(length, distance));
  let low = 1, high = points.length - 1;
  while (low < high) { const mid = (low + high) >> 1; if (arc[mid] < target) low = mid + 1; else high = mid; }
  while (low < points.length - 1 && arc[low] === arc[low - 1]) low++;
  const a = points[low - 1], b = points[low], span = arc[low] - arc[low - 1];
  const t = span ? (target - arc[low - 1]) / span : 0, heading = Math.atan2(a.z - b.z, b.x - a.x);
  return { x: a.x + (b.x - a.x) * t + Math.sin(heading) * offset,
    z: a.z + (b.z - a.z) * t + Math.cos(heading) * offset, heading };
}

const point = (x, z) => ({ x, z });
const strip = (points, width) => [...offsetPath(points, width / 2), ...offsetPath(points, -width / 2).reverse()];
const slicePath = (points, start, end) => {
  const { arc } = pathMetrics(points), a = sampleAmsterdamPath(points, start), b = sampleAmsterdamPath(points, end);
  return [point(a.x, a.z), ...points.filter((_, i) => arc[i] > start && arc[i] < end), point(b.x, b.z)];
};

// Compressed geographic abstraction, not an exact map: three broad, asymmetric
// horseshoes open onto the IJ and flow southeast into a separately curved Amstel.
const canals = [
  { name: "Herengracht", width: 14, points: cubicPath([
    [-103, 292], [-103, 250], [-104, 196], [-103, 151],
    [-98, 74], [-51, 26], [20, 26], [86, 26], [123, 64], [171, 96],
  ]) },
  { name: "Keizersgracht", width: 16, points: cubicPath([
    [-177, 292], [-177, 241], [-190, 189], [-183, 133],
    [-176, 22], [-111, -75], [-19, -78], [65, -81], [125, -38], [188, -11],
  ]) },
  { name: "Prinsengracht", width: 18, points: cubicPath([
    [-263, 292], [-263, 238], [-275, 184], [-265, 121],
    [-249, -44], [-141, -181], [-25, -180], [70, -180], [153, -157], [220, -166],
  ]) },
  { name: "Amstel", width: 28, points: cubicPath([
    [225, 292], [215, 253], [193, 214], [177, 164],
    [153, 99], [181, 27], [201, -67], [226, -165], [224, -195], [207, -250],
    [200, -273], [190, -302], [180, -345],
  ]) },
].map(canal => ({ ...canal, polygon: strip(canal.points, canal.width) }));
canals.push({ name: "IJ", polygon: [point(-1100, 278), point(1100, 278), point(1100, 1100), point(-1100, 1100)] });

const streets = [];
for (const canal of canals.slice(0, 3)) for (const offset of [-24, 24]) {
  const points = offsetPath(canal.points, offset);
  streets.push({ name: `${canal.name} ${offset < 0 ? "Outer" : "Inner"} Quay`,
    points: slicePath(points, canal.name === "Herengracht" && offset > 0 ? 70 : 39, amsterdamPathLength(points) - 49) });
}
const amstel = canals[3];
for (const offset of [-32, 32]) {
  const points = offsetPath(amstel.points, offset);
  streets.push({ name: `Amstel ${offset < 0 ? "West" : "East"} Quay`, points: slicePath(points, 87, amsterdamPathLength(points) - 47) });
}
streets.push(
  { name: "Prins Hendrikkade", points: [point(-296, 210), point(232, 210)] },
  { name: "Brouwersgracht", points: [point(-300, 177), point(-48, 177)] },
  { name: "Leidsestraat", points: [point(-208, -136), point(-45, 92)] },
  { name: "Vijzelstraat", points: [point(18, -220), point(18, 8)] },
  { name: "Museumstraat", points: [point(-70, -220), point(257, -220)] },
);

const outerQuay = streets.find(s => s.name === "Prinsengracht Outer Quay").points;
const eastQuay = streets.find(s => s.name === "Amstel East Quay").points;
const outerStart = outerQuay.findIndex(p => p.z < 100), outerEnd = outerQuay.findIndex(p => p.x > -60 && p.z < -190);
const eastStart = eastQuay.findIndex(p => p.z < 50), eastEnd = eastQuay.findIndex(p => p.z < -145);
const coordinates = p => [p.x, p.z];
function tangentControl(points, index, direction, distance) {
  const a = points[index - 1], b = points[index + 1], length = Math.hypot(b.x - a.x, b.z - a.z), p = points[index];
  return [p.x + direction * distance * (b.x - a.x) / length, p.z + direction * distance * (b.z - a.z) / length];
}
const westApproach = [
  ...cubicPath([coordinates(outerQuay[outerStart]), tangentControl(outerQuay, outerStart, -1, 45), [-308, 125], [-308, 160]]),
  ...filletPath([point(-308, 160), point(-308, 210), point(-248, 210)], 24).slice(1),
];
const eastApproach = [
  ...filletPath([point(232, 210), point(260, 210), point(260, 182)], 28),
  ...cubicPath([[260, 182], [260, 125], tangentControl(eastQuay, eastStart, -1, 40), coordinates(eastQuay[eastStart])]).slice(1),
];
const southApproach = [
  ...cubicPath([coordinates(eastQuay[eastEnd]), tangentControl(eastQuay, eastEnd, 1, 16), [257, -171], [257, -190]]),
  ...filletPath([point(257, -190), point(257, -220), point(227, -220)], 30).slice(1),
];
const museumQuay = cubicPath([[160, -220], [100, -220], tangentControl(outerQuay, outerEnd, 1, 60), coordinates(outerQuay[outerEnd])]);
streets.push({ name: "Haarlemmerplein", points: westApproach }, { name: "Oosterdokskade", points: eastApproach },
  { name: "Amstel Southern Approach", points: southApproach }, { name: "Museum Quay", points: museumQuay });
// The circuit is assembled from the actual street centerlines, not an unrelated
// racing spline. The final straight closes implicitly through the station start.
const lap = [point(0, 210), ...eastApproach, ...eastQuay.slice(eastStart + 1, eastEnd + 1),
  ...southApproach.slice(1), ...museumQuay, ...outerQuay.slice(outerStart, outerEnd).reverse(), ...westApproach.slice(1)];

const bounds = polygon => ({ polygon, xMin: Math.min(...polygon.map(p => p.x)), xMax: Math.max(...polygon.map(p => p.x)),
  zMin: Math.min(...polygon.map(p => p.z)), zMax: Math.max(...polygon.map(p => p.z)) });
const waterBounds = canals.map(c => bounds(c.polygon));
const containsBounds = (b, x, z) => x >= b.xMin - 1e-9 && x <= b.xMax + 1e-9 && z >= b.zMin - 1e-9 && z <= b.zMax + 1e-9
  && polygonContains(b.polygon, x, z);
export function waterAt(x, z) { return waterBounds.some(b => containsBounds(b, x, z)); }

// Each radial crossing gets a deck aligned with its street, including dry
// approaches. The quay on the west Amstel bank also bridges the canal mouths.
const bridges = [];
function addCrossings(street) {
  const points = street.points, { arc } = pathMetrics(points), cuts = [0, arc.at(-1)];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    for (const canal of canals) for (const { a: c, b: d } of polygonEdges(canal.polygon)) {
      const ex = d.x - c.x, ez = d.z - c.z, denominator = dx * ez - dz * ex;
      if (Math.abs(denominator) < 1e-9) continue;
      const t = ((c.x - a.x) * ez - (c.z - a.z) * ex) / denominator;
      const u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) cuts.push(arc[i - 1] + t * (arc[i] - arc[i - 1]));
    }
  }
  cuts.sort((a, b) => a - b);
  const wet = [];
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-7) continue;
    const mid = sampleAmsterdamPath(points, (cuts[i] + cuts[i - 1]) / 2);
    if (!waterAt(mid.x, mid.z)) continue;
    if (wet.length && Math.abs(wet.at(-1)[1] - cuts[i - 1]) < 1e-7) wet.at(-1)[1] = cuts[i];
    else wet.push([cuts[i - 1], cuts[i]]);
  }
  for (const [start, end] of wet) {
    const p = sampleAmsterdamPath(points, (start + end) / 2), canal = canals.find(c => polygonContains(c.polygon, p.x, p.z));
    const magere = street.name === "Museumstraat" && canal.name === "Amstel";
    bridges.push({ name: magere ? "Magere Brug" : `${canal.name} at ${street.name}`, x: p.x, z: p.z,
      heading: p.heading + Math.PI / 2, halfWidth: 10, halfLength: Math.max(22, (end - start) / 2 + 12),
      rise: 0.85, kind: magere ? "drawbridge" : "arch" });
  }
}
for (const street of streets.slice(0, 13).filter(s => !s.name.includes("Quay") || s.name === "Amstel West Quay")) addCrossings(street);

const bridgeBounds = bridges.map(bridge => {
  const sin = Math.sin(bridge.heading), cos = Math.cos(bridge.heading);
  const polygon = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([side, along]) => point(
    bridge.x + cos * bridge.halfWidth * side + sin * bridge.halfLength * along,
    bridge.z - sin * bridge.halfWidth * side + cos * bridge.halfLength * along));
  return { ...bounds(polygon), bridge, sin, cos };
});
export function bridgeAt(x, z) {
  return bridgeBounds.find(b => Math.abs((x - b.bridge.x) * b.cos - (z - b.bridge.z) * b.sin) <= b.bridge.halfWidth + 1e-9
    && Math.abs((x - b.bridge.x) * b.sin + (z - b.bridge.z) * b.cos) <= b.bridge.halfLength + 1e-9)?.bridge ?? null;
}
const polygons = canals.map(c => c.polygon);
const waterBoundary = regionBoundary(polygons, waterAt);
const exposedBoundary = regionBoundary([...polygons, ...bridgeBounds.map(b => b.polygon)], (x, z) => waterAt(x, z) && !bridgeAt(x, z));

// Cache nearby exposed edges once. A margin query only visits cells touched by
// its disc; exact segment distances, not sampled rays, decide circular clearance.
const edgeCells = new Map(), cellSize = 32;
for (const edge of exposedBoundary) {
  for (let gz = Math.floor(Math.min(edge.a.z, edge.b.z) / cellSize); gz <= Math.floor(Math.max(edge.a.z, edge.b.z) / cellSize); gz++) {
    for (let gx = Math.floor(Math.min(edge.a.x, edge.b.x) / cellSize); gx <= Math.floor(Math.max(edge.a.x, edge.b.x) / cellSize); gx++) {
      const key = `${gx},${gz}`;
      if (!edgeCells.has(key)) edgeCells.set(key, []);
      edgeCells.get(key).push(edge);
    }
  }
}

export const AMSTERDAM = {
  halfSize: 320, groundHalfSize: 340, landY: 2.4, waterY: 0.35, bedY: -2,
  canals, streets, bridges, lap, waterBoundary, landPolygons: landPolygons(polygons, 340),
  landmarks: [
    { id: "centraal", name: "Amsterdam Centraal", x: 0, z: 251, w: 172, d: 36 },
    { id: "rijksmuseum", name: "Rijksmuseum", x: 0, z: -267, w: 136, d: 40 },
    { id: "westerkerk", name: "Westerkerk", x: -43, z: 143, w: 34, d: 48 },
    { id: "palace", name: "Royal Palace", x: 12, z: 116, w: 60, d: 24 },
    { id: "nemo", name: "NEMO", x: 274, z: 244, w: 56, d: 38 },
    { id: "windmill", name: "De Gooyer", x: 275, z: -263, w: 26, d: 26 },
  ],
};
function freeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } }
freeze(AMSTERDAM);

/** Nonnegative circular clearance from exposed water and gameplay boundaries. */
export function isAmsterdamDry(x, z, margin = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(margin) || margin < 0
      || Math.abs(x) + margin > AMSTERDAM.halfSize || Math.abs(z) + margin > AMSTERDAM.halfSize) return false;
  if (waterAt(x, z) && !bridgeAt(x, z)) return false;
  if (!margin) return true;
  for (let gz = Math.floor((z - margin) / cellSize); gz <= Math.floor((z + margin) / cellSize); gz++) {
    for (let gx = Math.floor((x - margin) / cellSize); gx <= Math.floor((x + margin) / cellSize); gx++) {
      for (const edge of edgeCells.get(`${gx},${gz}`) ?? []) if (pointSegmentSquared(x, z, edge.a, edge.b) <= margin * margin) return false;
    }
  }
  return true;
}

export function amsterdamHeightAt(x, z) {
  const bridge = bridgeAt(x, z);
  if (bridge) {
    const along = (x - bridge.x) * Math.sin(bridge.heading) + (z - bridge.z) * Math.cos(bridge.heading);
    return AMSTERDAM.landY + bridge.rise * Math.cos(Math.PI * along / (2 * bridge.halfLength)) ** 2;
  }
  return waterAt(x, z) ? AMSTERDAM.bedY : AMSTERDAM.landY;
}
