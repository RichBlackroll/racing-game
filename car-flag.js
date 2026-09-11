import * as THREE from "three";
import { createCountryFlagTexture } from "./country-flag-texture.js";

// A small Verlet cloth: the hoist is pinned, with stretch/shear/bend constraints.
export function createCarFlag(country, { poleHeight = 3, mountLength = 1.1, phase = 0 } = {}) {
  const texture = createCountryFlagTexture(country);
  const height = .7, width = height * texture.image.width / texture.image.height;
  const columns = 10, rows = 5, stride = columns + 1, step = 1 / 120;
  const group = new THREE.Group(); group.name = "car-flag"; group.userData.country = country;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.016, .023, poleHeight, 6),
    new THREE.MeshStandardMaterial({ color: 0xd5dee5, metalness: .65, roughness: .35 }));
  pole.name = "flag-pole"; pole.position.y = poleHeight / 2;
  const mount = new THREE.Mesh(new THREE.BoxGeometry(.12, .1, mountLength + .1), pole.material);
  mount.name = "flag-mount"; mount.position.z = mountLength / 2;
  const geometry = new THREE.PlaneGeometry(width, height, columns, rows);
  const cloth = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: texture, side: THREE.DoubleSide, roughness: .95, metalness: 0,
    emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: .12,
  }));
  cloth.name = "flag-cloth";
  for (const mesh of [pole, mount, cloth]) { mesh.userData.castShadow = false; group.add(mesh); }
  const positions = geometry.attributes.position;
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const points = positions.array, previous = new Float32Array(points.length);
  const links = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [0, 2]]) {
      if (x + dx < 0 || x + dx > columns || y + dy > rows) continue;
      const a = y * stride + x, b = (y + dy) * stride + x + dx;
      const wa = x === 0 ? 0 : 1, wb = x + dx === 0 ? 0 : 1;
      if (wa + wb) links.push([a * 3, b * 3, Math.hypot(dx * width / columns, dy * height / rows), wa / (wa + wb), wb / (wa + wb)]);
    }
  }
  let elapsed = 0, accumulator = 0, lastHeading, disposed = false;
  function redraw() {
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.boundingBox = null;
  }
  function reset() {
    elapsed = phase; accumulator = 0; lastHeading = undefined;
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const i = (y * stride + x) * 3, along = x / columns * width;
      points[i] = along * .25;
      points[i + 1] = poleHeight - .04 - y / rows * height - along * Math.sqrt(.375);
      points[i + 2] = -along * .75;
    }
    previous.set(points); redraw();
  }
  function update(dt, vx = 0, vz = 0, heading = 0, reducedMotion = false) {
    if (disposed || reducedMotion || !Number.isFinite(dt) || dt <= 0 ||
        !Number.isFinite(vx) || !Number.isFinite(vz) || !Number.isFinite(heading)) return;
    // Keep existing cloth momentum when the car turns beneath it.
    if (lastHeading !== undefined) {
      const delta = lastHeading - heading, c = Math.cos(delta), s = Math.sin(delta);
      for (const p of [points, previous]) for (let i = 0; i < points.length; i += 3) {
        const x = p[i], z = p[i + 2]; p[i] = c * x + s * z; p[i + 2] = -s * x + c * z;
      }
    }
    lastHeading = heading;
    const speed = Math.hypot(vx, vz), limit = Math.min(1, 100 / (speed || 1));
    const c = Math.cos(heading), s = Math.sin(heading);
    // Relative air includes a light world-space breeze, even when parked.
    const airZ = (.9 - vx * limit) * s + (.3 - vz * limit) * c;
    // Outwash at the rear corner fans the flag outward, not edge-on in chase view.
    const airX = (.9 - vx * limit) * c - (.3 - vz * limit) * s + Math.abs(airZ) * .6;
    const airSpeed = Math.hypot(airX, airZ), frequency = 1.3 + Math.min(airSpeed, 80) * .09;
    accumulator += Math.min(dt, .05);
    while (accumulator + 1e-10 >= step) {
      accumulator -= step; elapsed += step * frequency * Math.PI * 2;
      for (let y = 0; y <= rows; y++) for (let x = 1; x <= columns; x++) {
        const i = (y * stride + x) * 3, u = x / columns;
        const flutter = Math.sin(elapsed - u * 8 + y / rows * .8);
        const pressure = Math.min(220, airSpeed * airSpeed * .085) * u * flutter;
        const dx = (points[i] - previous[i]) * .985;
        const dy = (points[i + 1] - previous[i + 1]) * .985;
        const dz = (points[i + 2] - previous[i + 2]) * .985;
        previous[i] = points[i]; previous[i + 1] = points[i + 1]; previous[i + 2] = points[i + 2];
        const drag = .045 * airSpeed;
        points[i] += dx + ((airX - dx / step) * drag - airZ / (airSpeed || 1) * pressure) * step * step;
        points[i + 1] += dy + (-9.82 - dy / step * drag + pressure * .12) * step * step;
        points[i + 2] += dz + ((airZ - dz / step) * drag + airX / (airSpeed || 1) * pressure) * step * step;
      }
      // Iterative distance projection keeps the fabric from stretching under boost.
      for (let iteration = 0; iteration < 5; iteration++) for (const [a, b, rest, wa, wb] of links) {
        const dx = points[b] - points[a], dy = points[b + 1] - points[a + 1], dz = points[b + 2] - points[a + 2];
        const length = Math.hypot(dx, dy, dz), correction = (length - rest) / (length || 1);
        points[a] += dx * correction * wa; points[a + 1] += dy * correction * wa; points[a + 2] += dz * correction * wa;
        points[b] -= dx * correction * wb; points[b + 1] -= dy * correction * wb; points[b + 2] -= dz * correction * wb;
      }
      // Long-range tethers prevent a sudden boost/impact from stretching the hoist.
      for (let y = 0; y <= rows; y++) for (let x = 1; x <= columns; x++) {
        const pin = y * stride * 3, i = pin + x * 3;
        const dy = points[i + 1] - points[pin + 1];
        const reach = Math.hypot(points[i], dy, points[i + 2]);
        const limit = width * x / columns * 1.02;
        if (reach <= limit) continue;
        const scale = limit / reach;
        points[i] *= scale; points[i + 1] = points[pin + 1] + dy * scale; points[i + 2] *= scale;
      }
    }
    redraw();
  }
  reset();
  return { group, cloth, reset, update,
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent();
      geometry.dispose(); cloth.material.dispose(); texture.dispose();
      pole.geometry.dispose(); pole.material.dispose();
      mount.geometry.dispose();
    },
  };
}
