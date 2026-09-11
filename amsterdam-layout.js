const canals = [
  { name: "Prinsengracht", xMin: -292, xMax: 218, zMin: -161, zMax: -139 },
  { name: "Keizersgracht", xMin: -292, xMax: 218, zMin: -42, zMax: -18 },
  { name: "Herengracht", xMin: -292, xMax: 218, zMin: 77, zMax: 103 },
  { name: "Amstel", xMin: 182, xMax: 218, zMin: -294, zMax: 278 },
  { name: "IJ", xMin: -1100, xMax: 1100, zMin: 278, zMax: 1100 },
];
const crossings = [
  { x: -250, name: "Marnixstraat" }, { x: -80, name: "Leidsestraat" },
  { x: 70, name: "Vijzelstraat" }, { x: 164, name: "Amstel West Quay" },
];
const connectors = [
  { z: -222, name: "Museumstraat" }, { z: -90, name: "Kerkstraat" },
  { z: 30, name: "Damstraat" }, { z: 210, name: "Prins Hendrikkade" },
];

// Shared, read-only geometry in metres. Water rectangles deliberately overlap.
export const AMSTERDAM = Object.freeze({
  halfSize: 320, groundHalfSize: 340, landY: 2.4, waterY: 0.35, bedY: -2.0,
  canals,
  streets: [
    ...canals.slice(0, 3).flatMap(canal => [-24, 24].map(offset => ({
      x1: -270, z1: (canal.zMin + canal.zMax) / 2 + offset,
      x2: 164, z2: (canal.zMin + canal.zMax) / 2 + offset,
      name: `${canal.name} ${offset < 0 ? "South" : "North"} Quay`,
    }))),
    ...[...crossings, { x: 236, name: "Amstel East Quay" }].map(street => ({
      x1: street.x, z1: -266, x2: street.x, z2: 210, name: street.name,
    })),
    // The two inner cross streets begin at the Amstel/Dam approaches, leaving
    // room for the continuous, back-to-back canal-house blocks farther west.
    ...connectors.map(street => ({ x1: street.z === -90 ? 150 : street.z === 30 ? 52 : -270,
      z1: street.z, x2: 260, z2: street.z, name: street.name })),
  ],
  bridges: [
    ...canals.slice(0, 3).flatMap(canal => crossings.map(street => ({
      name: `${canal.name} at ${street.name}`, x: street.x, z: (canal.zMin + canal.zMax) / 2,
      axis: "z", halfWidth: 9, halfLength: (canal.zMax - canal.zMin) / 2 + 10, rise: 0.85, kind: "arch",
    }))),
    ...connectors.map(street => ({
      name: street.z === -90 ? "Magere Brug" : `${street.name} Bridge`, x: 200, z: street.z,
      axis: "x", halfWidth: 9, halfLength: 28, rise: 0.85, kind: street.z === -90 ? "drawbridge" : "arch",
    })),
  ],
  landmarks: [
    { id: "centraal", name: "Amsterdam Centraal", x: 0, z: 251, w: 172, d: 36 },
    { id: "rijksmuseum", name: "Rijksmuseum", x: 0, z: -267, w: 136, d: 40 },
    { id: "westerkerk", name: "Westerkerk", x: -173, z: 158, w: 34, d: 48 },
    { id: "palace", name: "Royal Palace", x: 4, z: 40, w: 60, d: 24 },
    { id: "nemo", name: "NEMO", x: 274, z: 244, w: 56, d: 38 },
    { id: "windmill", name: "De Gooyer", x: 275, z: -263, w: 26, d: 26 },
  ],
});
for (const collection of [AMSTERDAM.canals, AMSTERDAM.streets, AMSTERDAM.bridges, AMSTERDAM.landmarks]) {
  collection.forEach(Object.freeze);
  Object.freeze(collection);
}

const contains = (rect, x, z) => x >= rect.xMin && x <= rect.xMax && z >= rect.zMin && z <= rect.zMax;
const bridgeBounds = AMSTERDAM.bridges.map(bridge => ({
  bridge,
  xMin: bridge.x - (bridge.axis === "x" ? bridge.halfLength : bridge.halfWidth),
  xMax: bridge.x + (bridge.axis === "x" ? bridge.halfLength : bridge.halfWidth),
  zMin: bridge.z - (bridge.axis === "z" ? bridge.halfLength : bridge.halfWidth),
  zMax: bridge.z + (bridge.axis === "z" ? bridge.halfLength : bridge.halfWidth),
}));

// Subtract decks from each water rectangle, not from their bounding box. This
// preserves the water union and permits margins spanning both a deck and land.
const exposedWater = bridgeBounds.reduce((rectangles, cut) => rectangles.flatMap(rect => {
  const xMin = Math.max(rect.xMin, cut.xMin), xMax = Math.min(rect.xMax, cut.xMax);
  const zMin = Math.max(rect.zMin, cut.zMin), zMax = Math.min(rect.zMax, cut.zMax);
  if (xMin >= xMax || zMin >= zMax) return [rect];
  const pieces = [];
  if (rect.xMin < xMin) pieces.push({ xMin: rect.xMin, xMax: xMin, zMin: rect.zMin, zMax: rect.zMax });
  if (xMax < rect.xMax) pieces.push({ xMin: xMax, xMax: rect.xMax, zMin: rect.zMin, zMax: rect.zMax });
  if (rect.zMin < zMin) pieces.push({ xMin, xMax, zMin: rect.zMin, zMax: zMin });
  if (zMax < rect.zMax) pieces.push({ xMin, xMax, zMin: zMax, zMax: rect.zMax });
  return pieces;
}), AMSTERDAM.canals);

/** Raw, inclusive water footprint, including the water underneath bridges. */
export function waterAt(x, z) {
  return AMSTERDAM.canals.some(canal => contains(canal, x, z));
}

/** The shared bridge record covering this point, including approaches, or null. */
export function bridgeAt(x, z) {
  return bridgeBounds.find(bounds => contains(bounds, x, z))?.bridge ?? null;
}

/** A nonnegative circular clearance in metres from exposed water and world edges. */
export function isAmsterdamDry(x, z, margin = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(margin) || margin < 0
      || Math.abs(x) + margin > AMSTERDAM.halfSize || Math.abs(z) + margin > AMSTERDAM.halfSize) return false;
  if (waterAt(x, z) && !bridgeAt(x, z)) return false;
  if (margin === 0) return true;
  return exposedWater.every(rect => Math.hypot(
    Math.max(rect.xMin - x, 0, x - rect.xMax), Math.max(rect.zMin - z, 0, z - rect.zMax),
  ) > margin);
}

export function amsterdamHeightAt(x, z) {
  const bridge = bridgeAt(x, z);
  if (bridge) {
    const along = bridge.axis === "x" ? x - bridge.x : z - bridge.z;
    return AMSTERDAM.landY + bridge.rise * Math.cos(Math.PI * along / (2 * bridge.halfLength)) ** 2;
  }
  return waterAt(x, z) ? AMSTERDAM.bedY : AMSTERDAM.landY;
}
