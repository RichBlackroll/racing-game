import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { occupiedWindowEmission } from "./night-lights.js";

/**
 * Standalone scenery builder. Appends to the supplied collision/shadow arrays;
 * does not remove old scenery or change lighting, environment, fog or background.
 * Call instead of the old architecture/decorators, once per level scene.
 * Returned counts describe this invocation only. No animation or DOM is needed.
 * Terrain heights and record y values exclude the road offset; h/height stay relative.
 */
export function createArchitecture({ scene, level, obstacles = [], buildingInfo = [], tablet = false, terrain }) {
  const counts = {
    blocks: 0, buildings: 0, trees: 0, planters: 0, benches: 0, lights: 0,
    colliders: 0, districts: 0, meshes: 0, triangles: 0, parts: 0,
  };
  if (!["city", "forest", "stunt"].includes(level)) return { group: null, counts };
  const heightAt = (x, z) => terrain?.heightAt(x, z) ?? 0;

  let seed = 0x41c6ce57;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const group = new THREE.Group();
  group.name = `architecture/${level}`;
  group.userData.nightLights = [];
  scene.add(group);
  const standard = (name, color, roughness, metalness = 0) => {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true });
    material.name = `architecture/${name}`;
    return material;
  };
  const materials = {
    travertine: standard("warm-ivory-travertine", 0xeee2ca, 0.72),
    paving: standard("honed-limestone", 0xb8b3a5, 0.88),
    bronze: standard("champagne-bronze", 0xb8a077, 0.3, 0.78),
    reveal: standard("deep-shadow-reveals", 0x283937, 0.8, 0.12),
    wood: standard("oiled-thermowood", 0x856044, 0.73),
    foliage: standard("olive-and-sage-foliage", 0x687951, 0.95),
    paint: standard("warm-white-road-paint", 0xebe6d7, 0.85),
    lane: standard("muted-ochre-lane-paint", 0xcab172, 0.88),
    light: standard("recessed-warm-light", 0xffddb0, 0.42),
    glass: new THREE.MeshPhysicalMaterial({
      name: "architecture/smoked-teal-glazing", color: 0x8aacae,
      roughness: 0.14, metalness: 0.62, clearcoat: 0.75,
      clearcoatRoughness: 0.15, envMapIntensity: 1.45,
      transmission: 0, transparent: false, vertexColors: true,
    }),
  };
  materials.light.emissive.set(0xffc588);
  materials.light.emissiveIntensity = 0;
  materials.light.userData.nightIntensity = 2.1;
  occupiedWindowEmission(materials.glass);

  // All prototypes use the same non-indexed attribute layout. Batches are local
  // to a district, capped at 60k vertices, and use one material without groups.
  const prepare = (geometry) => {
    if (geometry.index) {
      const original = geometry;
      geometry = original.toNonIndexed();
      original.dispose();
    }
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal") geometry.deleteAttribute(name);
    }
    geometry.clearGroups();
    return geometry;
  };
  const prototypes = {
    box: prepare(new THREE.BoxGeometry(1, 1, 1)),
    apron: prepare(new THREE.BoxGeometry(1, 1, 1, 3, 1, 3)),
    joint: prepare(new THREE.PlaneGeometry(1, 1, 3, 1).rotateX(-Math.PI / 2)),
    paint: prepare(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    column: prepare(new THREE.CylinderGeometry(0.5, 0.5, 1, tablet ? 8 : 12)),
    leaf: prepare(new THREE.IcosahedronGeometry(1, tablet ? 0 : 1)),
  };
  // Break the pedestrian apron at the edge of the 17m flat pads. Only its
  // narrow outer strips follow the grade, rather than tilting the whole block.
  for (const prototype of [prototypes.apron, prototypes.joint]) {
    const positions = prototype.attributes.position;
    for (let i = 0; i < positions.count; i++) for (const axis of ["X", "Z"]) {
      const value = positions[`get${axis}`](i);
      if (Math.abs(value) > 0.1 && Math.abs(value) < 0.2) positions[`set${axis}`](i, Math.sign(value) * 17 / 37);
    }
  }
  const rounded = new Map();
  const districts = new Map();
  const transform = new THREE.Object3D();
  const tint = new THREE.Color();
  let district, owner, buildingBase;

  function selectDistrict(key, x, z) {
    buildingBase = undefined;
    if (!districts.has(key)) {
      const node = new THREE.Group();
      node.name = `${group.name}/district-${key}`;
      node.position.set(x, 0, z);
      group.add(node);
      districts.set(key, { node, batches: new Map(), serial: 0 });
      counts.districts++;
    }
    district = districts.get(key);
  }

  function flush(batch) {
    if (!batch.geometries.length) return;
    const geometry = mergeGeometries(batch.geometries, false);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[batch.material]);
    mesh.name = `${district.node.name}/${batch.material}-${district.serial++}`;
    mesh.castShadow = !["light", "paint", "lane", "paving"].includes(batch.material);
    if (!mesh.castShadow) mesh.userData.castShadow = false;
    mesh.receiveShadow = true;
    // Ranges preserve feature inspectability without a draw call per feature.
    mesh.userData.parts = batch.parts;
    district.node.add(mesh);
    counts.meshes++;
    counts.triangles += geometry.attributes.position.count / 3;
    batch.geometries.forEach((g) => g.dispose());
    batch.geometries = [];
    batch.parts = [];
    batch.vertices = 0;
  }

  function emit(prototype, material, x, y, z, sx = 1, sy = 1, sz = 1,
    rx = 0, ry = 0, rz = 0, feature = material, variation = 1) {
    const geometry = prototype.clone();
    const followsGround = prototype === prototypes.apron || prototype === prototypes.joint;
    if (!followsGround) y += buildingBase ?? heightAt(x, z);
    transform.position.set(x - district.node.position.x, y, z - district.node.position.z);
    transform.scale.set(sx, sy, sz);
    transform.rotation.set(rx, ry, rz);
    transform.updateMatrix();
    geometry.applyMatrix4(transform.matrix);
    const positions = geometry.attributes.position;
    if (followsGround) {
      for (let i = 0; i < positions.count; i++) {
        positions.setY(i, positions.getY(i) + heightAt(positions.getX(i) + district.node.position.x,
          positions.getZ(i) + district.node.position.z));
      }
      geometry.computeVertexNormals();
    }
    const colors = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      // Subtle mineral bedding follows height, not a stretched facade image.
      const grain = material === "travertine"
        ? 0.975 + 0.025 * Math.sin(positions.getY(i) * 24 + positions.getX(i) * 0.13)
        : 1;
      tint.setRGB(variation * grain, variation * grain, variation * grain);
      tint.toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (!district.batches.has(material)) {
      district.batches.set(material, { material, geometries: [], parts: [], vertices: 0 });
    }
    const batch = district.batches.get(material);
    if (batch.vertices + positions.count > 60000) flush(batch);
    batch.parts.push({ name: `${owner}/${feature}`, start: batch.vertices, count: positions.count });
    batch.geometries.push(geometry);
    batch.vertices += positions.count;
    counts.parts++;
  }

  function box(material, x, y, z, w, h, d, feature = material, variation = 1) {
    if (terrain && feature === "paving-joints") {
      emit(prototypes.joint, material, x, y + h / 2, z, Math.max(w, d), 1, Math.min(w, d),
        0, d > w ? Math.PI / 2 : 0, 0, feature, variation);
      return;
    }
    if (material === "paint" || material === "lane") {
      emit(prototypes.paint, material, x, y + h / 2, z, w, 1, d, 0, 0, 0, feature, variation);
      return;
    }
    const prototype = terrain && ["curb", "sidewalk"].includes(feature) ? prototypes.apron : prototypes.box;
    emit(prototype, material, x, y, z, w, h, d, 0, 0, 0, feature, variation);
  }

  function prism(material, x, y, z, w, h, d, radius, feature = material) {
    const key = `${w},${d},${radius}`;
    if (!rounded.has(key)) {
      const a = w / 2, b = d / 2, r = Math.min(radius, a, b);
      const shape = new THREE.Shape();
      shape.moveTo(-a + r, -b);
      shape.lineTo(a - r, -b);
      shape.quadraticCurveTo(a, -b, a, -b + r);
      shape.lineTo(a, b - r);
      shape.quadraticCurveTo(a, b, a - r, b);
      shape.lineTo(-a + r, b);
      shape.quadraticCurveTo(-a, b, -a, b - r);
      shape.lineTo(-a, -b + r);
      shape.quadraticCurveTo(-a, -b, -a + r, -b);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 1, bevelEnabled: false, steps: 1, curveSegments: tablet ? 2 : 5,
      });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, -0.5, 0);
      rounded.set(key, prepare(geometry));
    }
    emit(rounded.get(key), material, x, y, z, 1, h, 1, 0, 0, 0, feature);
  }

  function beam(material, a, b, width, depth, feature) {
    const direction = new THREE.Vector3().subVectors(b, a);
    transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const rotation = new THREE.Euler().setFromQuaternion(transform.quaternion);
    emit(prototypes.box, material, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2,
      width, direction.length(), depth, rotation.x, rotation.y, rotation.z, feature);
  }

  function collider(name, kind, x, z, w, d, height) {
    const obstacle = { x, y: heightAt(x, z), z, hx: w / 2, hz: d / 2, r: Math.hypot(w, d) / 2, height, name, kind };
    obstacles.push(obstacle);
    counts.colliders++;
    return obstacle;
  }

  function building(name, x, z, w, d, h, style) {
    owner = name;
    const base = heightAt(x, z);
    let minimum = base, maximum = base;
    if (terrain) {
      const nx = Math.ceil(w / 2), nz = Math.ceil(d / 2);
      for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
        const y = heightAt(x - w / 2 + w * ix / nx, z - d / 2 + d * iz / nz);
        minimum = Math.min(minimum, y);
        maximum = Math.max(maximum, y);
      }
    }
    // Preserve the 0.64m floor unless the high side needs extra clearance.
    const lift = Math.max(0, maximum - base - 0.6);
    buildingBase = base + lift;
    const node = new THREE.Group();
    node.name = name;
    node.position.set(x - district.node.position.x, base, z - district.node.position.z);
    const info = { x, y: base, z, w, d, h: h + lift, name, style };
    node.userData.building = info;
    district.node.add(node);
    buildingInfo.push(info);
    collider(name, "building", x, z, w, d, h + lift);
    counts.buildings++;
    // Keep roofs, ribs and floors on one datum, including the unpadded stunt
    // site. Sink the solid footprint to the lowest ground beneath the plinth.
    const depth = buildingBase - minimum;
    box("travertine", x, 0.32 - depth / 2, z, w, 0.64 + depth, d, "plinth");
    return node;
  }

  function foliage(x, y, z, scale, feature) {
    const clusters = scale > 1 ? (tablet ? 4 : 7) : (tablet ? 2 : 3);
    for (let i = 0; i < clusters; i++) {
      const a = i * 2.39996;
      const spread = i === 0 ? 0 : scale * (0.28 + random() * 0.35);
      emit(prototypes.leaf, "foliage", x + Math.cos(a) * spread,
        y + (random() - 0.35) * scale * 0.6, z + Math.sin(a) * spread,
        scale * (0.45 + random() * 0.28), scale * (0.55 + random() * 0.45),
        scale * (0.4 + random() * 0.25), random() * 0.7, a, random() * 0.65,
        feature, 0.7 + random() * 0.5);
    }
  }

  function planter(x, y, z, w, d, ground, feature = "planter") {
    box("travertine", x, y + 0.38, z, w, 0.76, d, `${feature}/vessel`);
    box("reveal", x, y + 0.77, z, w - 0.2, 0.035, d - 0.2, `${feature}/soil`);
    for (let i = 0; i < Math.max(1, Math.floor(w / 1.2)); i++) {
      const px = x - w / 2 + 0.6 + i * 1.2;
      foliage(px, y + 1.02, z, Math.min(d * 0.45, 0.55), `${feature}/planting`);
    }
    if (ground) collider(`${owner}/${feature}`, "planter", x, z, w, d, y + 0.8);
    counts.planters++;
  }

  function tree(x, z, feature) {
    planter(x, 0.24, z, 2.25, 2.25, true, `${feature}/planter`);
    emit(prototypes.column, "wood", x, 2.14, z, 0.24, 3.8, 0.24, 0, 0, 0, `${feature}/trunk`);
    obstacles.push({ x, y: heightAt(x, z), z, r: 0.12, height: 4.04, name: `${owner}/${feature}`, kind: "tree" });
    counts.colliders++;
    for (const side of [-1, 1]) {
      beam("wood", new THREE.Vector3(x, 2.5, z), new THREE.Vector3(x + side * 0.65, 3.7, z + side * 0.35),
        0.09, 0.1, `${feature}/branches`);
    }
    foliage(x, 4.1, z, 1.18, `${feature}/crown`);
    counts.trees++;
  }

  function streetLight(x, z, inward, feature) {
    box("bronze", x, 3.15, z, 0.12, 5.82, 0.18, `${feature}/mast`);
    box("bronze", x + inward * 0.6, 6.02, z, 1.32, 0.14, 0.24, `${feature}/head`);
    box("light", x + inward * 0.65, 5.942, z, 1.0, 0.025, 0.12, `${feature}/recess`);
    group.userData.nightLights.push({ position: [x + inward * 0.65, heightAt(x + inward * 0.65, z) + 5.9, z],
      color: 0xffc588, intensity: 95, distance: 24 });
    counts.lights++;
  }

  function bench(x, z, feature) {
    for (const dx of [-0.88, 0.88]) box("bronze", x + dx, 0.48, z, 0.12, 0.48, 0.64, `${feature}/legs`);
    for (let i = 0; i < 4; i++) box("wood", x, 0.76, z - 0.24 + i * 0.16, 2.4, 0.12, 0.13, `${feature}/slats`);
    collider(`${owner}/${feature}`, "bench", x, z, 2.4, 0.64, 0.82);
    counts.benches++;
  }

  function facade(x, z, w, d, bottom, top, radius, style) {
    const height = top - bottom;
    prism("glass", x, (top + bottom) / 2, z, w - 0.76, height, d - 0.76,
      Math.max(0.4, radius - 0.38), "curved-glazing");
    const floors = Math.max(1, Math.round(height / 3.4));
    for (let floor = 0; floor <= floors; floor++) {
      const y = bottom + height * floor / floors;
      prism("travertine", x, y, z, w, 0.24, d, radius, "layered-floor-plates");
      if (floor < floors) prism("reveal", x, y + 0.18, z, w - 0.28, 0.1, d - 0.28,
        Math.max(0.2, radius - 0.14), "slab-shadow-lines");
    }
    // Actual projecting fins frame all four road-facing elevations. Rounded
    // corners remain uninterrupted glazing rather than boxy corner pilasters.
    for (let axis = 0; axis < 2; axis++) {
      const length = axis ? d : w;
      const span = length - radius * 2 - 1.4;
      const bays = Math.max(2, Math.floor(span / (tablet ? 3.1 : 2.25)));
      for (const side of [-1, 1]) for (let i = 0; i <= bays; i++) {
        const along = -span / 2 + span * i / bays;
        const fx = axis ? x + side * (w / 2 - 0.21) : x + along;
        const fz = axis ? z + along : z + side * (d / 2 - 0.21);
        const thick = style === 1 && i % 3 === 0 ? 0.38 : 0.115;
        box(style === 1 && i % 3 === 0 ? "travertine" : "bronze", fx, (top + bottom) / 2, fz,
          axis ? 0.62 : thick, height, axis ? thick : 0.62, "vertical-fins");
      }
    }
    for (const side of [-1, 1]) {
      box("light", x, bottom + 0.27, z + side * (d / 2 - 0.14),
        w - 2 * radius - 0.5, 0.045, 0.065, "recessed-soffit-accents");
    }
  }

  function roofGarden(x, z, w, d, y, feature) {
    // A solid pale parapet, dark coping and inset planting read from street level.
    for (const side of [-1, 1]) {
      box("travertine", x, y + 0.38, z + side * (d / 2 - 0.16), w - 1.6, 0.76, 0.16, `${feature}/parapet`);
      box("bronze", x, y + 0.79, z + side * (d / 2 - 0.16), w - 1.6, 0.06, 0.2, `${feature}/coping`);
    }
    planter(x, y + 0.12, z - d / 2 + 1.3, w * 0.58, 1.1, false, `${feature}/garden`);
    const px = x + w * 0.19, pz = z + d * 0.13, pw = w * 0.38, pd = d * 0.36;
    for (const dx of [-pw / 2, pw / 2]) for (const dz of [-pd / 2, pd / 2]) {
      box("bronze", px + dx, y + 1.0, pz + dz, 0.1, 1.8, 0.1, `${feature}/pergola-posts`);
    }
    for (let i = 0; i <= 6; i++) box("wood", px - pw / 2 + pw * i / 6,
      y + 1.94, pz, 0.18, 0.16, pd + 0.3, `${feature}/pergola-blades`);
  }

  if (level === "city") {
    for (let ix = 0; ix < 6; ix++) for (let iz = 0; iz < 6; iz++) {
      // Per-block seeds keep the skyline/collisions identical across detail levels.
      seed = (0x41c6ce57 ^ Math.imul(ix + 1, 73856093) ^ Math.imul(iz + 1, 19349663)) >>> 0;
      const x = -125 + ix * 50, z = -125 + iz * 50;
      selectDistrict(`${Math.floor(ix / 2)}-${Math.floor(iz / 2)}`,
        -100 + Math.floor(ix / 2) * 100, -100 + Math.floor(iz / 2) * 100);
      owner = `city/block-${ix}-${iz}`;
      box("travertine", x, 0.07, z, 37, 0.14, 37, "curb");
      box("paving", x, 0.185, z, 36.65, 0.09, 36.65, "sidewalk");
      // Expansion joints articulate the generous pedestrian apron geometrically.
      for (const offset of [-15, -10, -5, 0, 5, 10, 15]) {
        box("reveal", x + offset, 0.233, z, 0.018, 0.004, 36.5, "paving-joints");
        box("reveal", x, 0.234, z + offset, 36.5, 0.004, 0.018, "paving-joints");
      }
      const style = (ix + iz * 2) % 4;
      const w = 24 + Math.floor(random() * 4), d = 23 + Math.floor(random() * 5);
      // Curated skyline: lower perimeter galleries, slender inner landmarks.
      const centrality = 1 - Math.hypot(x, z) / 177;
      const h = ix === 2 && iz === 2 ? 65 : ix === 0 && iz === 0 ? 14
        : Math.min(62, 18 + Math.round(centrality * 27 + random() * 19));
      const node = building(owner, x, z, w, d, h,
        ["terraced-ribbon", "travertine-fins", "offset-lantern", "split-crown"][style]);
      counts.blocks++;

      // Recessed shop glazing sits behind a continuous shaded colonnade.
      prism("glass", x, 2.68, z, w - 3.4, 4.08, d - 3.4, 0.8, "podium/storefront-glazing");
      for (let axis = 0; axis < 2; axis++) {
        const span = (axis ? d : w) - 1.8;
        const bays = Math.round(span / 4.2);
        for (const side of [-1, 1]) for (let i = 0; i <= bays; i++) {
          const along = -span / 2 + i * span / bays;
          box("travertine", axis ? x + side * (w / 2 - 0.45) : x + along, 2.66,
            axis ? z + along : z + side * (d / 2 - 0.45), 0.42, 4.04, 0.42, "podium/colonnade");
          box("bronze", axis ? x + side * (w / 2 - 1.68) : x + along * 0.9, 2.6,
            axis ? z + along * 0.9 : z + side * (d / 2 - 1.68),
            axis ? 0.12 : 0.075, 3.9, axis ? 0.075 : 0.12, "podium/shop-mullions");
        }
      }
      prism("travertine", x, 4.86, z, w, 0.34, d, 0.9, "podium/floating-entablature");
      for (const side of [-1, 1]) {
        box("reveal", x, 4.61, z + side * (d / 2 - 0.6), w - 2, 0.12, 0.25, "podium/recess");
        box("light", x, 4.54, z + side * (d / 2 - 0.6), w - 2.4, 0.025, 0.1, "podium/recessed-light");
        // Dark bronze door portals and warm interior display slots, not decals.
        box("bronze", x, 2.18, z + side * (d / 2 - 1.62), 2.3, 3.08, 0.16, "podium/entry-portal");
        box("glass", x, 2.1, z + side * (d / 2 - 1.51), 1.98, 2.88, 0.06, "podium/entry-door");
        box("light", x + w * 0.23, 2.8, z + side * (d / 2 - 1.63), 1.4, 0.1, 0.12, "podium/display-light");
      }

      const crown = h - 2.02;
      const tiers = h < 23 ? 1 : h < 42 ? 2 : 3;
      node.userData.tiers = [];
      for (let tier = 0; tier < tiers; tier++) {
        const bottom = 5.08 + (crown - 5.08) * tier / tiers;
        const top = 5.08 + (crown - 5.08) * (tier + 1) / tiers;
        const tw = w - 2.4 - tier * (style === 0 ? 3.8 : 3.0);
        const td = d - 2.4 - tier * 3.4;
        const tx = x + (style === 2 ? tier * 0.85 : 0);
        const tz = z + (style === 0 ? tier * 0.65 : 0);
        node.userData.tiers.push({ x: tx, z: tz, w: tw, d: td, bottom, top });
        if (style === 3 && tier === tiers - 1 && tiers > 1) {
          const wing = (tw - 1.6) / 2;
          for (const side of [-1, 1]) facade(tx + side * (wing / 2 + 0.8), tz,
            wing, td, bottom, top, 1.3, style);
          box("bronze", tx, top - 0.1, tz, 1.6, 0.16, td * 0.5, "crown/bridge");
        } else facade(tx, tz, tw, td, bottom, top, style === 0 ? 2.6 : 1.35, style);
        if (tier < tiers - 1) {
          planter(tx, top + 0.13, tz - td / 2 + 0.65, tw * 0.62, 0.95, false, `terrace-${tier}`);
          for (const side of [-1, 1]) box("bronze", tx, top + 0.82,
            tz + side * (td / 2 - 0.14), tw - 3.2, 0.055, 0.075, "terrace/handrail");
        } else roofGarden(tx, tz, tw, td, top, "roof");
      }

      // Street furniture stays behind the 37m curb, with a clear circulation
      // strip between the building plinth and the planted street edge.
      buildingBase = undefined;
      tree(x - 16.55, z - 10, "street-tree-west");
      tree(x + 16.55, z + 10, "street-tree-east");
      streetLight(x - 17.2, z + 7, 1, "street-light-west");
      streetLight(x + 17.2, z - 7, -1, "street-light-east");
      bench(x - 6, z + 16.3, "street-bench");
      planter(x + 5, 0.24, z - 16.25, 4.5, 1.25, true, "street-garden");
    }

    // Stop lines and four zebra crossings frame each intersection. All paint
    // stays flat and non-colliding; dashed center lines stop before crossings.
    for (let ix = 0; ix <= 6; ix++) for (let iz = 0; iz <= 6; iz++) {
      const x = -150 + ix * 50, z = -150 + iz * 50;
      const dx = Math.min(2, Math.floor(ix / 2)), dz = Math.min(2, Math.floor(iz / 2));
      selectDistrict(`${dx}-${dz}`, -100 + dx * 100, -100 + dz * 100);
      owner = `city/intersection-${ix}-${iz}`;
      for (const side of [-1, 1]) for (let stripe = -5; stripe <= 5; stripe += 1.65) {
        box("paint", x + stripe, 0.112, z + side * 9.2, 0.78, 0.012, 3.6, "zebra-north-south");
        box("paint", x + side * 9.2, 0.114, z + stripe, 3.6, 0.012, 0.78, "zebra-east-west");
      }
      for (const side of [-1, 1]) {
        box("paint", x + side * 3.25, 0.112, z + side * 12.3, 5.4, 0.012, 0.25, "stop-line");
        box("paint", x + side * 12.3, 0.114, z - side * 3.25, 0.25, 0.012, 5.4, "stop-line");
      }
      for (const offset of [17, 25, 33]) {
        if (ix < 6) box("lane", x + offset, 0.112, z, 3.6, 0.012, 0.12, "lane-dash");
        if (iz < 6) box("lane", x, 0.114, z + offset, 0.12, 0.012, 3.6, "lane-dash");
      }
    }
  }

  // Closed, smoothly curved roof ribbons, with real thickness and edge fascia.
  // The profile is swept across x; its lift and cant vary continuously along x.
  function curvedRoof(x, z, w, d, base, rise, sweep, feature) {
    const nx = tablet ? 12 : 24, nz = tablet ? 8 : 16, thickness = 0.22;
    const roofY = (u, v) => base + rise * Math.sin(Math.PI * (v + 0.5))
      + sweep * (Math.pow(u * 2, 2) * 0.7 + u * v);
    const point = (u, v, underside = false) => new THREE.Vector3(
      x + u * w, roofY(u, v) - (underside ? thickness : 0), z + v * d);
    const positions = [], under = [];
    function quad(target, a, b, c, e) {
      for (const p of [a, b, c, a, c, e]) target.push(p.x - x, p.y, p.z - z);
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const u = i / nx - 0.5, v = j / nz - 0.5, du = 1 / nx, dv = 1 / nz;
      quad(positions, point(u, v), point(u, v + dv), point(u + du, v + dv), point(u + du, v));
      quad(under, point(u, v, true), point(u + du, v, true), point(u + du, v + dv, true), point(u, v + dv, true));
    }
    for (let i = 0; i < nx; i++) for (const side of [-0.5, 0.5]) {
      const u = i / nx - 0.5, v = side;
      const a = point(u, v), b = point(u + 1 / nx, v);
      const c = point(u + 1 / nx, v, true), e = point(u, v, true);
      if (side < 0) quad(positions, a, b, c, e); else quad(positions, b, a, e, c);
    }
    for (let j = 0; j < nz; j++) for (const side of [-0.5, 0.5]) {
      const v = j / nz - 0.5;
      const a = point(side, v), b = point(side, v + 1 / nz);
      const c = point(side, v + 1 / nz, true), e = point(side, v, true);
      if (side > 0) quad(positions, a, b, c, e); else quad(positions, b, a, e, c);
    }
    for (const [vertices, material] of [[positions, "travertine"], [under, "wood"]]) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      // Analytic surface normals keep the sweep smooth without softening fascia.
      geometry.computeVertexNormals();
      const normals = geometry.attributes.normal;
      const surfaceVertices = nx * nz * 6;
      for (let i = 0; i < surfaceVertices; i++) {
        const u = vertices[i * 3] / w, v = vertices[i * 3 + 2] / d;
        const dhdx = sweep * (5.6 * u + v) / w;
        const dhdz = (rise * Math.PI * Math.cos(Math.PI * (v + 0.5)) + sweep * u) / d;
        const normal = new THREE.Vector3(-dhdx, 1, -dhdz).normalize();
        if (material === "wood") normal.negate();
        normals.setXYZ(i, normal.x, normal.y, normal.z);
      }
      emit(geometry, material, x, 0, z, 1, 1, 1, 0, 0, 0, `${feature}/${material}`);
      geometry.dispose();
    }
    // Transverse glulam ribs trace the underside, with a recessed light at the
    // front eave. Segments stay in the same material batch as all other timber.
    const ribs = tablet ? 8 : 12;
    for (let i = 0; i <= ribs; i++) {
      const u = -0.47 + 0.94 * i / ribs;
      for (let j = 0; j < nz; j++) {
        const a = point(u, j / nz - 0.5, true), b = point(u, (j + 1) / nz - 0.5, true);
        a.y -= 0.1; b.y -= 0.1;
        beam("wood", a, b, 0.12, 0.2, `${feature}/glulam-ribs`);
      }
    }
    for (let i = 0; i < nx; i++) {
      const a = point(i / nx - 0.5, 0.475, true), b = point((i + 1) / nx - 0.5, 0.475, true);
      a.y -= 0.025; b.y -= 0.025;
      beam("light", a, b, 0.055, 0.055, `${feature}/eave-light`);
    }
    return roofY;
  }

  if (level === "forest") {
    for (const [index, x, z] of [[0, -30, 68], [1, 118, 25]]) {
      selectDistrict(`pavilion-${index}`, x, z);
      // The western route lobe passes within 6.60m of an 18x10 footprint.
      // Compact that site to preserve >8m centerline clearance at its corner.
      const w = index === 0 ? 16 : 18, d = index === 0 ? 8 : 10;
      const sx = w / 18, sz = d / 10, rw = w - 0.3, rd = d - 0.3;
      building(`forest/visitor-pavilion-${index}`, x, z, w, d, 6.2, "swept-glulam-shell");
      const roofY = curvedRoof(x, z, rw, rd, 4.25, 1.4, 0.65, "curved-roof");
      box("glass", x, 2.23, z, 15.2 * sx, 3.18, 7.15 * sz, "recessed-glass-envelope");
      box("wood", x - 4.9 * sx, 2.24, z - 0.4 * sz, 3.4 * sx, 3.2, 5.9 * sz, "timber-service-core");
      for (const side of [-1, 1]) for (let i = -3; i <= 3; i++) {
        const px = x + i * 2.35 * sx;
        box("bronze", px, 2.28, z + side * 3.62 * sz, 0.065, 3.28, 0.1, "glazing-mullions");
        const top = roofY((px - x) / rw, side * 4.05 * sz / rd) - 0.26;
        box("wood", px, (top + 0.64) / 2, z + side * 4.05 * sz, 0.14, top - 0.64, 0.18, "glulam-columns");
      }
      // Clerestory glass closes the curved gable without transparent sorting.
      for (const side of [-1, 1]) for (let j = 0; j < 16; j++) {
        const dz = (-3.55 + (j + 0.5) * 7.1 / 16) * sz;
        const top = roofY(side * 7.6 * sx / rw, dz / rd) - 0.4;
        box("glass", x + side * 7.59 * sx, (top + 3.82) / 2, z + dz,
          0.06, Math.max(0.05, top - 3.82), 7.1 * sz / 16 + 0.005, "curved-clerestory");
      }
      for (let i = 0; i < (tablet ? 12 : 22); i++) {
        box("wood", x + (-6.45 + i * (tablet ? 0.28 : 0.15)) * sx, 2.24, z + 3.69 * sz,
          0.065, 3.2, 0.16, "entry-screen-battens");
      }
      planter(x + 4.9 * sx, 0.64, z + 4.0 * sz, 3.8 * sx, 1.15 * sz, false, "entry-garden");
    }
  }

  if (level === "stunt") {
    selectDistrict("infield", 0, 60);
    building("stunt/spectator-canopy", 0, 60, 36, 12, 10.2, "sweeping-spectator-shell");
    const roofY = curvedRoof(0, 60, 35.7, 11.7, 6.3, 2.25, 1.8, "sweeping-canopy");
    // The enclosed hospitality lounge occupies one end of the shared plinth;
    // stepped spectator seating faces the home straight at z=100.
    box("glass", -11.3, 2.47, 59.1, 10.0, 3.66, 8.0, "motorsport-pavilion/glazing");
    box("travertine", -11.3, 4.4, 59.1, 10.5, 0.2, 8.5, "motorsport-pavilion/roof");
    box("wood", -15.9, 2.47, 59.1, 0.3, 3.66, 8.0, "motorsport-pavilion/service-wall");
    for (let i = 0; i < 5; i++) {
      box("bronze", -15.8 + i * 2.25, 2.47, 63.15, 0.07, 3.66, 0.12, "motorsport-pavilion/mullions");
    }
    for (let row = 0; row < 4; row++) {
      const z = 64.6 - row * 1.5, top = 1.05 + row * 0.64;
      box("travertine", 5.8, (top + 0.64) / 2, z, 20.4, top - 0.64, 1.45, "spectator-terraces");
      box("wood", 5.8, top + 0.09, z + 0.18, 19.5, 0.18, 0.68, "spectator-seating");
      box("light", 5.8, top - 0.12, z + 0.731, 18.8, 0.045, 0.025, "recessed-step-lights");
    }
    for (const x of [-15.5, -5.2, 5.2, 15.5]) {
      const foot = new THREE.Vector3(x, 0.64, 56);
      for (const side of [-1, 1]) {
        const tx = x + side * 1.4, tz = 60 + side * 3.8;
        beam("bronze", foot, new THREE.Vector3(tx, roofY(tx / 35.7, (tz - 60) / 11.7) - 0.26, tz),
          0.24, 0.3, "branching-canopy-supports");
      }
    }
    planter(5.7, 0.64, 55.0, 17.0, 1.2, false, "infield-roof-garden");
  }

  for (const value of districts.values()) {
    district = value;
    for (const batch of district.batches.values()) flush(batch);
  }
  Object.values(prototypes).forEach((geometry) => geometry.dispose());
  rounded.forEach((geometry) => geometry.dispose());
  // Unused materials never reach the renderer and should not survive this call.
  const used = new Set();
  group.traverse((object) => { if (object.isMesh) used.add(object.material); });
  Object.values(materials).forEach((material) => { if (!used.has(material)) material.dispose(); });
  group.userData.counts = counts;
  return { group, counts };
}
