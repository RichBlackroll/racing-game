import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Small modeling primitives shared by the two independently profiled exteriors.
// Every invocation owns its geometry/materials, just like a loaded GLB scene.
export function createCarTools(name) {
  const model = new THREE.Group();
  model.name = name;
  const materials = Object.fromEntries([
    ["paint", "paint", 0xd7d9ce, 0.25, 0.28],
    ["glass", "window", 0x24333b, 0.35, 0.14],
    ["trim", "trim", 0x14191d, 0.05, 0.43],
    ["rubber", "rubber", 0x17191a, 0, 0.87],
    ["alloy", "alloy", 0xc4cbd0, 0.8, 0.25],
    ["darkAlloy", "dark-alloy", 0x30373c, 0.55, 0.3],
    ["headlight", "headlight", 0xd7e8f4, 0.2, 0.18],
    ["taillight", "taillight", 0x9e0010, 0.12, 0.2],
  ].map(([key, suffix, color, metalness, roughness]) => [key, new THREE.MeshStandardMaterial({
    name: `authored-${suffix}`, color, metalness, roughness, side: THREE.DoubleSide,
  })]));
  function mesh(name, geometry, material, position = [0, 0, 0]) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.position.fromArray(position);
    model.add(object);
    return object;
  }
  function box(name, material, size, position, rotation = [0, 0, 0]) {
    const geometry = new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.16);
    const object = mesh(name, geometry, material, position);
    object.rotation.set(...rotation);
    return object;
  }
  function panel(name, material, points) {
    const normal = new THREE.Vector3();
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      normal.x += (a[1] - b[1]) * (a[2] + b[2]);
      normal.y += (a[2] - b[2]) * (a[0] + b[0]);
      normal.z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const axis = normal.toArray().map(Math.abs);
    const drop = axis.indexOf(Math.max(...axis));
    const contour = points.map(p => new THREE.Vector2(...p.filter((_, i) => i !== drop)));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setIndex(THREE.ShapeUtils.triangulateShape(contour, []).flat());
    geometry.computeVertexNormals();
    return mesh(name, geometry, material);
  }
  function line(name, material, points, radius = 0.008) {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    return mesh(name, new THREE.TubeGeometry(path, Math.max(8, Math.min(80, points.length * 5)), radius, 5, false), material);
  }
  function loft(name, material, sections) {
    const count = sections[0].points.length, positions = [], indices = [];
    for (const { z, points } of sections) for (const [x, y] of points) positions.push(x, y, z);
    for (let s = 1; s < sections.length; s++) for (let i = 0; i < count; i++) {
      const a = (s - 1) * count + i, b = (s - 1) * count + (i + 1) % count;
      indices.push(a, b, a + count, b, b + count, a + count);
    }
    for (const s of [0, sections.length - 1]) {
      // Separate cap vertices prevent their normals flattening the curved skin.
      const offset = positions.length / 3;
      for (const [x, y] of sections[s].points) positions.push(x, y, sections[s].z);
      const faces = THREE.ShapeUtils.triangulateShape(sections[s].points.map(p => new THREE.Vector2(...p)), []);
      for (const face of faces) indices.push(...(s === 0 ? [...face].reverse() : face).map(i => offset + i));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return mesh(name, geometry, material);
  }
  function wheel({ x, z, radius, width, rimRadius, style }) {
    const side = Math.sign(x), prefix = `wheel-${z > 0 ? "front" : "rear"}-${side < 0 ? "left" : "right"}`;
    const centre = [x, radius, z], face = x + side * width * 0.46;
    const profile = [
      [rimRadius * 0.96, -width * 0.42], [rimRadius + 0.013, -width * 0.5],
      [radius - 0.027, -width * 0.48], [radius - 0.009, -width * 0.38],
      [radius, -width * 0.27], [radius, width * 0.27], [radius - 0.009, width * 0.38],
      [radius - 0.027, width * 0.48], [rimRadius + 0.013, width * 0.5], [rimRadius * 0.96, width * 0.42],
    ];
    const tire = mesh(`${prefix}-tire`, new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(...p)), 48), materials.rubber, centre);
    tire.rotation.z = Math.PI / 2;
    const barrel = mesh(`${prefix}-rim-barrel`, new THREE.CylinderGeometry(rimRadius, rimRadius, width * 0.85, 48), materials.darkAlloy, centre);
    barrel.rotation.z = Math.PI / 2;
    const disc = mesh(`${prefix}-brake-disc`, new THREE.CylinderGeometry(rimRadius * 0.83, rimRadius * 0.83, 0.008, 40), materials.alloy,
      [x + side * width * 0.39, radius, z]);
    disc.rotation.z = Math.PI / 2;
    const rim = mesh(`${prefix}-polished-rim`, new THREE.TorusGeometry(rimRadius * 0.965, 0.008, 5, 48), materials.alloy, [face, radius, z]);
    rim.rotation.y = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      const point = (r, a, lift = 0) => [face + side * lift, radius + Math.cos(angle + a) * r, z + Math.sin(angle + a) * r];
      panel(`${prefix}-spoke-${i}`, materials.darkAlloy, [point(rimRadius * 0.2, -0.36), point(rimRadius * 0.98, -0.13),
        point(rimRadius * 0.98, 0.25), point(rimRadius * 0.54, 0.29), point(rimRadius * 0.2, 0.44)]);
      if (style === "volvo") {
        panel(`${prefix}-diamond-cut-${i}`, materials.alloy, [point(rimRadius * 0.24, -0.24, 0.003), point(rimRadius * 0.95, -0.11, 0.003),
          point(rimRadius * 0.96, 0.065, 0.003), point(rimRadius * 0.51, 0.10, 0.003)]);
      } else {
        for (const offset of [-0.07, 0.16]) panel(`${prefix}-split-spoke-${i}-${offset}`, materials.alloy,
          [point(rimRadius * 0.27, offset - 0.06, 0.003), point(rimRadius * 0.96, offset - 0.04, 0.003),
            point(rimRadius * 0.97, offset + 0.025, 0.003), point(rimRadius * 0.46, offset + 0.07, 0.003)]);
      }
      const bolt = mesh(`${prefix}-bolt-${i}`, new THREE.SphereGeometry(0.009, 6, 4), materials.alloy, point(rimRadius * 0.24, 0, 0.006));
      bolt.scale.x = 0.3;
    }
    const cap = mesh(`${prefix}-centre-cap`, new THREE.CylinderGeometry(rimRadius * 0.2, rimRadius * 0.2, 0.014, 24), materials.darkAlloy,
      [face + side * 0.004, radius, z]);
    cap.rotation.z = Math.PI / 2;
    const ring = mesh(`${prefix}-cap-ring`, new THREE.TorusGeometry(rimRadius * 0.18, 0.0025, 4, 24), materials.alloy,
      [face + side * 0.012, radius, z]);
    ring.rotation.y = Math.PI / 2;
  }
  function badge(name, text, material, height, position, rotation = [0, 0, 0]) {
    // Only the letters used by the badges, with no font or canvas dependency.
    const glyphs = {
      A: [[[0, 0], [0.3, 1], [0.6, 0]], [[0.13, 0.42], [0.47, 0.42]]],
      B: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.84], [0.6, 0.68], [0.43, 0.52], [0, 0.52]], [[0.43, 0.52], [0.6, 0.37], [0.6, 0.16], [0.43, 0], [0, 0]]],
      D: [[[0, 0], [0, 1], [0.38, 1], [0.6, 0.78], [0.6, 0.22], [0.38, 0], [0, 0]]],
      E: [[[0.6, 1], [0, 1], [0, 0], [0.6, 0]], [[0, 0.5], [0.47, 0.5]]],
      L: [[[0, 1], [0, 0], [0.6, 0]]],
      O: [[[0.15, 0], [0, 0.2], [0, 0.8], [0.15, 1], [0.45, 1], [0.6, 0.8], [0.6, 0.2], [0.45, 0], [0.15, 0]]],
      T: [[[0, 1], [0.6, 1]], [[0.3, 1], [0.3, 0]]],
      V: [[[0, 1], [0.3, 0], [0.6, 1]]],
      X: [[[0, 1], [0.6, 0]], [[0, 0], [0.6, 1]]],
      Y: [[[0, 1], [0.3, 0.52], [0.6, 1]], [[0.3, 0.52], [0.3, 0]]],
      1: [[[0.1, 0.8], [0.32, 1], [0.32, 0]], [[0.05, 0], [0.59, 0]]],
      4: [[[0.43, 0], [0.43, 1], [0, 0.33], [0.6, 0.33]]],
    };
    glyphs[0] = glyphs.O;
    const parts = [], width = (text.length * 0.85 - 0.25) * height;
    for (const [i, letter] of [...text].entries()) for (const stroke of glyphs[letter] || []) {
      for (let j = 1; j < stroke.length; j++) {
        const a = new THREE.Vector3((i * 0.85 + stroke[j - 1][0]) * height - width / 2, (stroke[j - 1][1] - 0.5) * height, 0);
        const b = new THREE.Vector3((i * 0.85 + stroke[j][0]) * height - width / 2, (stroke[j][1] - 0.5) * height, 0);
        parts.push(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, height * 0.035, 4, false));
      }
    }
    const geometry = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    const object = mesh(name, geometry, material, position);
    object.rotation.set(...rotation);
    return object;
  }
  return { model, materials, mesh, box, panel, line, loft, wheel, badge };
}
