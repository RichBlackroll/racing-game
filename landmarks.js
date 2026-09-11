import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { decorateForestLandmarks, decorateCityLandmarks } from "./landmark-neighborhoods.js";
import { decorateMoonLandmarks, decorateStuntLandmarks } from "./landmark-adventures.js";

// Clearings are separate from solid buildings: trees stay out, cars can drive in.
export function inClearing(clearings, x, z, margin = 0) {
  return clearings.some(c => {
    if (!c.end) return Math.hypot(x - c.x, z - c.z) < c.radius + margin;
    const dx = c.end.x - c.x, dz = c.end.z - c.z;
    const t = THREE.MathUtils.clamp(((x - c.x) * dx + (z - c.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(x - c.x - dx * t, z - c.z - dz * t) < c.radius + margin;
  });
}

export function createLandmarks({ scene, level, terrain, obstacles, buildingInfo, tablet = false }) {
  const group = new THREE.Group();
  group.name = `landmarks/${level}`;
  scene.add(group);
  const sites = [], clearings = level === "moon" ? [{ x: -8, z: 60, radius: 48 }] : [], materials = new Map();
  const counts = { sites: 0, parts: 0, meshes: 0, triangles: 0 };
  const transform = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const detail = tablet ? 12 : 20;
  const colorMaterial = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({
      color, roughness: 0.66, metalness: level === "moon" ? 0.2 : 0.08,
    }));
    return materials.get(color);
  };
  const blocked = (x, z, margin) => obstacles.some(o => o.hx === undefined
    ? Math.hypot(x - o.x, z - o.z) < o.r + margin
    : Math.hypot(Math.max(0, Math.abs(x - o.x) - o.hx), Math.max(0, Math.abs(z - o.z) - o.hz)) < margin);

  function site(name, targetX, targetZ, radius, build) {
    // Prefer gentle ground close to the intended district and within sight of a road.
    let location, best = Infinity;
    for (let dx = -180; dx <= 180; dx += 12) for (let dz = -180; dz <= 180; dz += 12) {
      const x = targetX + dx, z = targetZ + dz;
      if (Math.max(Math.abs(x), Math.abs(z)) + radius + 10 > terrain.halfSize) continue;
      const distance = terrain.roadDistance(x, z);
      if (distance < radius + 12 || blocked(x, z, radius + 8) || inClearing(clearings, x, z, radius + 12)) continue;
      const y = terrain.heightAt(x, z);
      let relief = 0;
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        relief = Math.max(relief, Math.abs(terrain.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) - y));
      }
      const score = Math.hypot(dx, dz) + relief * 34 + Math.max(0, distance - radius - 28) * 2;
      if (score < best) { best = score; location = { x, y, z }; }
    }
    if (!location) throw new Error(`No clear site for ${level}/${name}`);
    const { x, y, z } = location;
    const node = new THREE.Group();
    node.name = `${group.name}/${name}`;
    node.position.set(x, y, z);
    group.add(node);
    const record = { name, x, y, z, radius };
    sites.push(record);
    clearings.push({ x, z, radius: radius + 3 });
    const batches = new Map(), plazas = [];
    const ground = (px, pz) => terrain.heightAt(x + px, z + pz) - y;

    function emit(color, geometry, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) {
      if (geometry.index) {
        const original = geometry;
        geometry = original.toNonIndexed();
        original.dispose();
      }
      geometry.deleteAttribute("uv");
      geometry.clearGroups();
      transform.position.set(px, py, pz);
      transform.rotation.set(rx, ry, rz);
      transform.scale.setScalar(1);
      transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      if (!batches.has(color)) batches.set(color, []);
      batches.get(color).push(geometry);
      counts.parts++;
    }
    const box = (c, px, py, pz, w, h, d, ...rotation) => emit(c, new THREE.BoxGeometry(w, h, d), px, py, pz, ...rotation);
    const solid = (px, pz, hx, hz, height, base = ground(px, pz)) => {
      obstacles.push({ x: x + px, y: y + base, z: z + pz, hx, hz, r: Math.hypot(hx, hz), height, name: node.name });
      if (height > 2 && hx > 1 && hz > 1 && base < ground(px, pz) + 2) {
        buildingInfo.push({ x: x + px, y: y + base, z: z + pz, w: hx * 2, d: hz * 2, h: height });
      }
    };
    function surface(color, points, indices) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap(([px, pz]) => [px, ground(px, pz) + 0.12, pz]), 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      emit(color, geometry);
    }
    function label(text, px, py, pz, color = 0xffedcc, background = 0x287d80, width = 6, height = 1.5, heading = 0) {
      if (typeof document === "undefined") return;
      const canvas = document.createElement("canvas");
      canvas.width = 768; canvas.height = 128;
      const c = canvas.getContext("2d");
      c.fillStyle = `#${background.toString(16).padStart(6, "0")}`; c.fillRect(0, 0, 768, 128);
      c.strokeStyle = c.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
      c.lineWidth = 3; c.strokeRect(7, 7, 754, 114);
      c.font = "600 36px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(text, 384, 66, 724);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.75, side: THREE.DoubleSide }));
      board.position.set(px, py, pz); board.rotation.y = heading;
      node.add(board); counts.meshes++; counts.triangles += 2;
    }
    const s = {
      ground, box, solid, label,
      cylinder: (c, px, py, pz, rt, rb, h, ...rotation) => emit(c, new THREE.CylinderGeometry(rt, rb, h, detail), px, py, pz, ...rotation),
      cone: (c, px, py, pz, r, h, ...rotation) => emit(c, new THREE.ConeGeometry(r, h, detail), px, py, pz, ...rotation),
      sphere: (c, px, py, pz, sx, sy = sx, sz = sx) => emit(c, new THREE.SphereGeometry(1, detail, tablet ? 8 : 12).scale(sx, sy, sz), px, py, pz),
      torus: (c, px, py, pz, r, tube, ...rotation) => emit(c, new THREE.TorusGeometry(r, tube, 6, tablet ? 32 : 48), px, py, pz, ...rotation),
      beam(c, a, b, r) {
        const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
        const geometry = new THREE.CylinderGeometry(r, r, delta.length(), tablet ? 6 : 8);
        geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, delta.normalize()));
        const mid = from.add(to).multiplyScalar(0.5);
        emit(c, geometry, mid.x, mid.y, mid.z);
      },
      triangle(c, points) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
        geometry.computeVertexNormals(); emit(c, geometry);
      },
      disc(c, px, pz, r) {
        plazas.push({ x: x + px, z: z + pz, radius: r });
        const points = [[px, pz]], indices = [], segments = 64, rings = Math.ceil(r / 2);
        for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < segments; i++) {
          const angle = -i * Math.PI * 2 / segments;
          points.push([px + Math.cos(angle) * r * ring / rings, pz + Math.sin(angle) * r * ring / rings]);
          const a = 1 + (ring - 1) * segments + i, b = 1 + (ring - 1) * segments + (i + 1) % segments;
          if (ring === 1) indices.push(0, a, b);
          else indices.push(a - segments, a, b, a - segments, b, b - segments);
        }
        surface(c, points, indices);
      },
      foundation(c, px, pz, w, d, h = 0.4) {
        const heights = [];
        for (const dx of [-w / 2, 0, w / 2]) for (const dz of [-d / 2, 0, d / 2]) heights.push(ground(px + dx, pz + dz));
        const base = Math.min(...heights) - 0.2, top = Math.max(...heights) + h;
        box(c, px, (base + top) / 2, pz, w, top - base, d);
        solid(px, pz, w / 2, d / 2, top - base, base);
        return top;
      },
    };
    build(s);

    // Connect the open edge of each clearing to asphalt, without routing through solids.
    let access;
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12, ex = x + Math.sin(angle) * (radius - 16), ez = z + Math.cos(angle) * (radius - 16);
      const hit = terrain.nearest(ex, ez), a = terrain.route[hit.index], b = terrain.route[(hit.index + 1) % terrain.route.length];
      const starts = [{ x: THREE.MathUtils.lerp(a.x, b.x, hit.t), z: THREE.MathUtils.lerp(a.z, b.z, hit.t) },
        ...terrain.route.filter((_, index) => index % 8 === 0)];
      for (const point of starts) {
        const start = { x: point.x, z: point.z };
        const length = Math.hypot(ex - start.x, ez - start.z), steps = Math.ceil(length / 3);
        if (length < 10 || length > radius + 140 || (access && length >= access.length)) continue;
        let clear = true;
        for (let j = 0; j <= steps; j++) {
          if (blocked(THREE.MathUtils.lerp(start.x, ex, j / steps), THREE.MathUtils.lerp(start.z, ez, j / steps), 4.25)) { clear = false; break; }
        }
        if (clear) access = { start, end: { x: ex, z: ez }, length };
      }
    }
    if (!access) throw new Error(`No driveable approach to ${node.name}`);
    // Meet the plaza rim rather than laying differently tessellated surfaces over
    // one another. The clearance search continues inside, so paths face an opening.
    const ux = (access.end.x - access.start.x) / access.length, uz = (access.end.z - access.start.z) / access.length;
    for (const plaza of plazas) {
      const dx = plaza.x - access.start.x, dz = plaza.z - access.start.z;
      const along = dx * ux + dz * uz, across = dx * uz - dz * ux;
      if (Math.abs(across) > plaza.radius - 4) continue;
      const rim = along - Math.sqrt(plaza.radius ** 2 - across ** 2);
      if (rim > 8 && rim < access.length) {
        access.length = rim;
        access.end = { x: access.start.x + ux * rim, z: access.start.z + uz * rim };
      }
    }
    record.access = access;
    clearings.push({ ...access.start, end: access.end, radius: 7 });
    const { start, end, length } = access;
    const nx = -(end.z - start.z) / length, nz = (end.x - start.x) / length;
    const points = [], indices = [], steps = Math.ceil(length / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      for (const side of [-1, 1]) points.push([THREE.MathUtils.lerp(start.x, end.x, t) - x + nx * side * 4,
        THREE.MathUtils.lerp(start.z, end.z, t) - z + nz * side * 4]);
      if (i < steps) { const j = i * 2; indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const pathColor = level === "moon" ? 0x909fad : 0xb2a18a;
    const pathMaterial = colorMaterial(pathColor);
    pathMaterial.polygonOffset = true;
    pathMaterial.polygonOffsetFactor = pathMaterial.polygonOffsetUnits = -1;
    surface(pathColor, points, indices);
    const signX = start.x - x + (end.x - start.x) * Math.min(0.65, 15 / length) + nx * 6;
    const signZ = start.z - z + (end.z - start.z) * Math.min(0.65, 15 / length) + nz * 6;
    const signY = ground(signX, signZ);
    s.cylinder(0x287d80, signX, signY + 2.6, signZ, 0.14, 0.2, 5.2);
    s.solid(signX, signZ, 0.22, 0.22, 5.2, signY);
    const heading = Math.atan2(start.x - end.x, start.z - end.z);
    label(name.replaceAll("-", " ").toUpperCase(), signX, signY + 5, signZ, 0xffedcc, 0x287d80, 8, 1.3, heading);
    for (const [color, geometries] of batches) {
      const geometry = mergeGeometries(geometries, false);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, colorMaterial(color));
      mesh.name = `${node.name}/material-${color.toString(16)}`;
      mesh.castShadow = mesh.receiveShadow = true;
      node.add(mesh);
      counts.meshes++; counts.triangles += geometry.attributes.position.count / 3;
      geometries.forEach(g => g.dispose());
    }
    counts.sites++;
  }
  const decorate = { forest: decorateForestLandmarks, city: decorateCityLandmarks,
    moon: decorateMoonLandmarks, stunt: decorateStuntLandmarks }[level];
  decorate({ site });
  return { group, sites, clearings, counts };
}
