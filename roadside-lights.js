import * as THREE from "three";
import { inClearing } from "./landmarks.js";
import { retroreflectiveMaterial } from "./road-reflectors.js";

// Fixtures stay physical by day; only their lenses and pooled downlights wake at dusk.
export function createRoadsideLights({ scene, course, level, obstacles = [], clearings = [] }) {
  const group = new THREE.Group();
  group.name = "course/roadside-lights";
  group.userData.nightLights = [];
  const counts = { studs: 0, guides: 0, lanterns: 0, meshes: 0 };
  group.userData.counts = counts;
  const urban = ["city", "amsterdam", "wellington"].includes(level), lunar = level === "moon";
  const { route, heightAt } = course;
  const existingLights = [];
  scene.updateWorldMatrix(true, true);
  scene.traverse(object => {
    for (const light of object.userData.nightLights ?? []) {
      existingLights.push(new THREE.Vector3().fromArray(light.position).applyMatrix4(object.matrixWorld));
    }
  });
  scene.add(group);
  const standard = (color, roughness = 0.65, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const warm = standard(lunar ? 0xc9e5eb : 0xffd5a0, 0.3);
  warm.emissive.set(lunar ? 0xb5e8ff : 0xffbc70);
  warm.userData.nightIntensity = 3.2;
  warm.emissiveIntensity = 0;
  const guide = standard(lunar ? 0xafdbe7 : 0xaedbca, 0.3);
  guide.emissive.set(lunar ? 0x83d8ff : 0x70d9bb);
  guide.userData.nightIntensity = 1.7;
  guide.emissiveIntensity = 0;
  const materials = {
    housing: standard(0x303c3a, 0.42, 0.55),
    post: standard(0xd9d5bf, 0.74),
    timber: standard(lunar || urban ? 0x919fa3 : 0x795239, 0.66, lunar || urban ? 0.5 : 0),
    panel: standard(0x203e55, 0.22, 0.48),
    reflector: retroreflectiveMaterial(standard(0xffffff, 0.48)),
    warm, guide,
  };
  const batches = new Map(), dummy = new THREE.Object3D();
  function part(material, x, y, z, width, height, depth, heading, tint = 0xffffff) {
    if (!batches.has(material)) batches.set(material, []);
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, heading, 0);
    dummy.scale.set(width, height, depth);
    dummy.updateMatrix();
    batches.get(material).push({ matrix: dummy.matrix.clone(), tint });
  }
  function clear(x, z, radius) {
    if (course.roadDistance(x, z) < 7 + radius
      || (course.isSafePosition && !course.isSafePosition(x, z, radius))
      || inClearing(clearings, x, z, radius)) return false;
    return !obstacles.some(o => o.hx !== undefined
      ? Math.hypot(Math.max(0, Math.abs(x - o.x) - o.hx), Math.max(0, Math.abs(z - o.z) - o.hz)) < radius + 0.5
      : Math.hypot(x - o.x, z - o.z) < o.r + radius + 0.5);
  }
  const step = Math.max(1, Math.round(14 / (course.length / route.length)));
  for (let i = 0, index = 0; i < route.length; i += step, index++) {
    const p = route[i], a = route[(i + route.length - 1) % route.length], b = route[(i + 1) % route.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    for (const side of [-1, 1]) {
      // Low cat's-eyes are drive-over road hardware, not collision obstacles.
      const sx = p.x + nx * side * 5.3, sz = p.z + nz * side * 5.3;
      if ((!course.isSafePosition || course.isSafePosition(sx, sz, 0.2)) && course.roadDistance(sx, sz) > 4.7) {
        const sy = heightAt(sx, sz);
        part("housing", sx, sy + 0.10, sz, 0.24, 0.05, 0.19, heading);
        for (const face of [-1, 1]) {
          const rx = sx + Math.sin(heading) * face * 0.097, rz = sz + Math.cos(heading) * face * 0.097;
          part("reflector", rx, heightAt(rx, rz) + 0.125, rz, 0.17, 0.055, 0.015, heading, side < 0 ? 0xffdda0 : 0xe1efed);
        }
        counts.studs++;
      }
      if (index % 2) continue;
      const x = p.x + nx * side * 7.9, z = p.z + nz * side * 7.9;
      if (!clear(x, z, 0.18)) continue;
      const y = heightAt(x, z);
      part("post", x, y + 0.43, z, 0.15, 0.86, 0.17, heading);
      part("housing", x, y + 0.70, z, 0.16, 0.30, 0.18, heading);
      for (const face of [-1, 1]) {
        part("reflector", x + Math.sin(heading) * face * 0.096, y + 0.71,
          z + Math.cos(heading) * face * 0.096, 0.095, 0.20, 0.018, heading);
      }
      part("guide", x, y + 0.90, z, 0.19, 0.075, 0.21, heading);
      part("housing", x, y + 0.97, z, 0.25, 0.065, 0.26, heading);
      part("panel", x, y + 1.007, z, 0.205, 0.01, 0.21, heading);
      counts.guides++;
    }
    if (index % 7 !== 2) continue;
    const side = Math.floor(index / 7) % 2 ? -1 : 1;
    const x = p.x + nx * side * 9.8, z = p.z + nz * side * 9.8;
    if (!clear(x, z, 0.4) || existingLights.some(light => Math.hypot(light.x - x, light.z - z) < 40)) continue;
    const y = heightAt(x, z), inward = Math.atan2(-nx * side, -nz * side);
    const lx = x - nx * side * 1.75, lz = z - nz * side * 1.75;
    part("housing", x, y + 0.13, z, 0.44, 0.26, 0.44, inward);
    part("timber", x, y + 2.48, z, 0.20, 4.96, 0.22, inward);
    part("housing", x - nx * side * 0.92, y + 4.89, z - nz * side * 0.92, 0.16, 0.17, 2.02, inward);
    part("housing", lx, y + 4.65, lz, 0.12, 0.42, 0.12, inward);
    part("housing", lx, y + 4.43, lz, 0.73, 0.14, 0.73, inward);
    part("warm", lx, y + 4.30, lz, 0.48, 0.15, 0.48, inward);
    // The source sits below its opaque shade, never inside the mast or lens.
    group.userData.nightLights.push({ position: [lx, y + 4.18, lz],
      color: lunar ? 0xb5e8ff : 0xffc184, intensity: 310, distance: 28 });
    counts.lanterns++;
  }
  const geometry = new THREE.BoxGeometry();
  for (const [name, material] of Object.entries(materials)) {
    const parts = batches.get(name);
    if (!parts?.length) { material.dispose(); continue; }
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    mesh.name = `${group.name}/${name}`;
    material.name = mesh.name;
    mesh.castShadow = !["warm", "guide", "panel"].includes(name);
    mesh.userData.castShadow = mesh.castShadow;
    mesh.receiveShadow = true;
    parts.forEach((part, i) => {
      mesh.setMatrixAt(i, part.matrix);
      if (name === "reflector") mesh.setColorAt(i, new THREE.Color(part.tint));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
    counts.meshes++;
  }
  if (!group.children.length) geometry.dispose();
  // Scenic posts deliberately never enter the shared player/physics obstacles.
  return { group, counts };
}
