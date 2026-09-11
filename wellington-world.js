import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WELLINGTON, isWellingtonLand } from "./wellington-layout.js";

const clamp = THREE.MathUtils.clamp;
const cross = (ax, az, bx, bz) => ax * bz - az * bx;
const pointKey = p => `${Math.round(p.x * 1e6)},${Math.round(p.z * 1e6)}`;
const edgeKey = (a, b) => a < b ? `${a}/${b}` : `${b}/${a}`;
const signedArea = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + cross(p.x, p.z, q.x, q.z) / 2;
}, 0);
function contains(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

// Trace the exposed arrangement, with dry land on the left. An edge-crossing
// lagoon becomes a coastline notch, not an invalid Shape.holes contour.
function landContours() {
  const polygons = [WELLINGTON.coast, ...WELLINGTON.wharves.map(p => p.points), ...WELLINGTON.waterHoles.map(p => p.points)];
  const edges = polygons.flatMap(points => points.map((a, i) => ({ a, b: points[(i + 1) % points.length] })));
  const fragments = new Map();
  for (const { a, b } of edges) {
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), cuts = [0, 1];
    for (const { a: c, b: d } of edges) {
      const ex = d.x - c.x, ez = d.z - c.z, determinant = cross(dx, dz, ex, ez);
      if (Math.abs(determinant) > 1e-8) {
        const t = cross(c.x - a.x, c.z - a.z, ex, ez) / determinant;
        const u = cross(c.x - a.x, c.z - a.z, dx, dz) / determinant;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
      } else if (Math.abs(cross(c.x - a.x, c.z - a.z, dx, dz)) < 1e-7) {
        for (const p of [c, d]) cuts.push(clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / length ** 2, 0, 1));
      }
    }
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 1e-10) continue;
      const t = (cuts[i] + cuts[i - 1]) / 2, x = a.x + dx * t, z = a.z + dz * t;
      const nx = -dz / length * 1e-4, nz = dx / length * 1e-4;
      const left = isWellingtonLand(x + nx, z + nz), right = isWellingtonLand(x - nx, z - nz);
      if (left === right) continue;
      let start = { x: a.x + dx * cuts[i - 1], z: a.z + dz * cuts[i - 1] };
      let end = { x: a.x + dx * cuts[i], z: a.z + dz * cuts[i] };
      if (!left) [start, end] = [end, start];
      fragments.set(`${pointKey(start)}/${pointKey(end)}`, { a: start, b: end });
    }
  }
  const boundary = [...fragments.values()], starts = new Map();
  boundary.forEach(edge => {
    const key = pointKey(edge.a);
    if (!starts.has(key)) starts.set(key, []);
    starts.get(key).push(edge);
  });
  const used = new Set(), loops = [];
  for (const first of boundary) {
    if (used.has(first)) continue;
    const loop = [];
    let edge = first;
    do {
      used.add(edge); loop.push(edge.a);
      if (pointKey(edge.b) === pointKey(first.a)) break;
      const next = starts.get(pointKey(edge.b))?.filter(e => !used.has(e));
      if (!next?.length) throw new Error("Wellington land boundary is not closed");
      // At a touching vertex follow the tightest left-facing boundary.
      const dx = edge.b.x - edge.a.x, dz = edge.b.z - edge.a.z;
      next.sort((a, b) => Math.atan2(cross(dx, dz, b.b.x - b.a.x, b.b.z - b.a.z), dx * (b.b.x - b.a.x) + dz * (b.b.z - b.a.z))
        - Math.atan2(cross(dx, dz, a.b.x - a.a.x, a.b.z - a.a.z), dx * (a.b.x - a.a.x) + dz * (a.b.z - a.a.z)));
      edge = next[0];
    } while (edge !== first);
    loops.push(loop);
  }
  return { loops, boundary };
}

function terrainGeometry(loops, heightAt) {
  const outers = loops.filter(p => signedArea(p) > 0), holes = loops.filter(p => signedArea(p) < 0);
  const shapes = outers.map(points => {
    const shape = new THREE.Shape(points.map(p => new THREE.Vector2(p.x, p.z)));
    shape.holes = holes.filter(h => contains(points, h[0].x, h[0].z)).map(h => new THREE.Path(h.map(p => new THREE.Vector2(p.x, p.z))));
    return shape;
  });
  const source = new THREE.ShapeGeometry(shapes);
  const positions = source.attributes.position;
  const vertices = Array.from({ length: positions.count }, (_, i) => ({ x: positions.getX(i), z: positions.getY(i) }));
  let triangles = Array.from(source.index.array);
  source.dispose();
  // Shared midpoint indices and red/green splits keep every interior edge
  // conforming. Independent per-triangle recursion would leave hillside cracks.
  for (;;) {
    const splits = new Map();
    for (let i = 0; i < triangles.length; i += 3) for (let j = 0; j < 3; j++) {
      const a = triangles[i + j], b = triangles[i + (j + 1) % 3], key = edgeKey(a, b);
      const p = vertices[a], q = vertices[b];
      if (Math.hypot(q.x - p.x, q.z - p.z) <= 35 || splits.has(key)) continue;
      splits.set(key, vertices.length);
      vertices.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
    }
    if (!splits.size) break;
    const next = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const ids = triangles.slice(i, i + 3), mids = ids.map((a, j) => splits.get(edgeKey(a, ids[(j + 1) % 3])));
      const count = mids.filter(m => m !== undefined).length;
      if (!count) { next.push(...ids); continue; }
      if (count === 3) {
        const [a, b, c] = ids, [ab, bc, ca] = mids;
        next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      } else {
        const j = count === 1 ? mids.findIndex(m => m !== undefined) : (mids.findIndex(m => m === undefined) + 1) % 3;
        const [a, b, c] = [ids[j], ids[(j + 1) % 3], ids[(j + 2) % 3]];
        const ab = mids[j], bc = mids[(j + 1) % 3];
        if (count === 1) next.push(a, ab, c, ab, b, c);
        else next.push(ab, b, bc, a, ab, c, ab, bc, c);
      }
    }
    triangles = next;
  }
  const geometry = new THREE.BufferGeometry(), colors = [], xyz = [];
  const paving = new THREE.Color(0xb5b6a6), grass = new THREE.Color(0x657e58), hill = new THREE.Color(0x4c7056), color = new THREE.Color();
  for (const p of vertices) {
    // Float32 contour rounding can put an exact lagoon edge just in the water.
    const y = Math.max(WELLINGTON.landY, heightAt(p.x, p.z));
    xyz.push(p.x, y, p.z);
    color.copy(paving).lerp(grass, THREE.MathUtils.smoothstep(y, 4, 22)).lerp(hill, THREE.MathUtils.smoothstep(y, 40, 170));
    color.multiplyScalar(0.97 + 0.03 * Math.sin(p.x * 0.023) * Math.cos(p.z * 0.019)).toArray(colors, colors.length);
  }
  for (let i = 0; i < triangles.length; i += 3) [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]];
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(xyz, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(triangles); geometry.computeVertexNormals();
  return geometry;
}

/** Owns Wellington ground/scenery only. Appends metadata; never changes atmosphere
 * or course/session state. Landscape is a separate scene root for camera exclusion.
 * Heights are metres; time is seconds; map origin/clip/route/markers belong to caller.
 */
export function createWellingtonWorld({ scene, course, obstacles = [], buildingInfo = [], tablet = false }) {
  const heightAt = (x, z) => course.heightAt(x, z);
  const group = new THREE.Group(), landscapeGroup = new THREE.Group();
  group.name = "wellington/world"; landscapeGroup.name = "wellington/landscape";
  scene.add(group, landscapeGroup);
  const counts = { sites: 0, landmarks: 0, buildings: 0, urbanBuildings: 0, trees: 0, colliders: 0,
    parts: 0, meshes: 0, triangles: 0, instances: 0, drawCalls: 0, terrainTriangles: 0, labels: 0, wharves: WELLINGTON.wharves.length };
  const sites = WELLINGTON.landmarks.map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z,
    radius: Math.hypot(p.w, p.d) / 2, access: [], ...(p.type === "wharenui" ? { interior: "tepapa" } : {}) }));
  counts.sites = sites.length;
  const footprints = [], { loops, boundary } = landContours();
  group.userData.landContours = loops;
  const material = (name, color, roughness = 0.85, metalness = 0) => new THREE.MeshStandardMaterial({ name: `wellington/${name}`, color, roughness, metalness });
  const materials = {
    stone: material("pale-stone", 0xd7d3bb), brick: material("warm-masonry", 0xa76349),
    cream: material("painted-cream", 0xe4e1cd), dark: material("charcoal", 0x263237),
    glass: material("blue-green-glazing", 0x6d9b9f, 0.2, 0.55), gold: material("takina-bronze", 0xba944a, 0.35, 0.65),
    copper: material("aged-copper", 0x586e61, 0.55, 0.45), blue: material("boathouse-blue", 0x477d9b),
    roof: material("slate-roof", 0x596568), foliage: material("pohutukawa-foliage", 0x416b51),
  };
  function mesh(name, geometry, mat, parent = group) {
    const object = new THREE.Mesh(geometry, mat); object.name = `wellington/${name}`;
    object.receiveShadow = true; parent.add(object); return object;
  }
  const terrain = mesh("land", terrainGeometry(loops, heightAt), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }));
  terrain.userData.surface = "land-union-minus-lagoons";
  counts.terrainTriangles = terrain.geometry.index.count / 3;
  const seawall = [];
  for (const { a, b } of boundary) {
    if (["x", "z"].some(axis => Math.abs(a[axis]) === 1500 && a[axis] === b[axis])) continue;
    seawall.push(a.x, -1, a.z, a.x, 3, a.z, b.x, 3, b.z, a.x, -1, a.z, b.x, 3, b.z, b.x, -1, b.z);
  }
  const wallGeometry = new THREE.BufferGeometry(); wallGeometry.setAttribute("position", new THREE.Float32BufferAttribute(seawall, 3)); wallGeometry.computeVertexNormals();
  mesh("quay-edges", wallGeometry, new THREE.MeshStandardMaterial({ color: 0x777e76, roughness: 1, side: THREE.DoubleSide }));

  const time = { value: 0 }, reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const waterMaterial = material("harbour-water", 0x397b83, 0.29, 0.32);
  waterMaterial.userData.time = time;
  waterMaterial.onBeforeCompile = shader => {
    shader.uniforms.uWellingtonTime = time;
    shader.vertexShader = "varying vec3 vHarbour;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvHarbour = (modelMatrix * vec4(position, 1.)).xyz;");
    shader.fragmentShader = "varying vec3 vHarbour;\nuniform float uWellingtonTime;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      vec2 p = vHarbour.xz;
      vec2 ripple = vec2(sin(dot(p, vec2(.43, .31)) + uWellingtonTime * .8), cos(dot(p, vec2(-.24, .57)) + uWellingtonTime * .65));
      vec3 waterNormal = normalize(vec3(ripple.x * .055, 1., ripple.y * .055));
      normal = normalize(mat3(viewMatrix) * waterNormal);`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      float swell = sin(dot(vHarbour.xz, vec2(.032, .021)) + uWellingtonTime * .28);
      diffuseColor.rgb *= .98 + swell * .025;`);
  };
  waterMaterial.customProgramCacheKey = () => "wellington-harbour-v1";
  const water = mesh("harbour-water", new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), waterMaterial, landscapeGroup);
  water.position.y = WELLINGTON.waterY; water.receiveShadow = false;
  // A single asymmetric eastern shore, not a mountain ring. These are scenic
  // silhouettes beyond the georeferenced playable square, not a claimed DEM.
  const hillVertices = [], hillIndices = [], columns = tablet ? 64 : 96, rows = tablet ? 10 : 16;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    const t = i / columns, r = j / rows, z = -1000 + t * 8500;
    const shoreX = 4450 + 330 * Math.sin(t * 5.2) + 190 * Math.sin(t * 12);
    const profile = Math.sin(Math.PI * r) ** 1.35;
    const endFade = THREE.MathUtils.smoothstep(t, 0, 0.12) * (1 - THREE.MathUtils.smoothstep(t, 0.85, 1));
    hillVertices.push(shoreX + r * 2600, -3 + profile * endFade * (290 + 70 * Math.sin(t * 19) + 50 * Math.cos(t * 37)), z);
    if (i < columns && j < rows) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      hillIndices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const hills = new THREE.BufferGeometry(); hills.setAttribute("position", new THREE.Float32BufferAttribute(hillVertices, 3)); hills.setIndex(hillIndices); hills.computeVertexNormals();
  mesh("east-harbour-hills", hills, material("distant-blue-green-hills", 0x557f80, 1), landscapeGroup);

  const streets = WELLINGTON.streets.flatMap(s => s.points.slice(1).map((b, i) => ({ a: s.points[i], b, width: s.width })));
  const roadClear = (x, z, radius) => streets.every(s => segmentDistance(x, z, s.a, s.b) > s.width / 2 + radius + 2);
  const surfaceBatches = new Map();
  function surfaceTriangle(name, a, b, c, color, offset) {
    const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3;
    const radius = Math.max(...[a, b, c].map(p => Math.hypot(p.x - x, p.z - z)));
    if (!isWellingtonLand(x, z, radius + 0.005)) return;
    if (!surfaceBatches.has(name)) surfaceBatches.set(name, { vertices: [], color });
    const vertices = surfaceBatches.get(name).vertices;
    const points = cross(b.x - a.x, b.z - a.z, c.x - a.x, c.z - a.z) < 0 ? [a, b, c] : [a, c, b];
    for (const p of points) vertices.push(p.x, heightAt(p.x, p.z) + offset, p.z);
  }
  function surfaceStrip(name, a, b, width, color, offset) {
    const length = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    const along = Math.ceil(length / 5), across = Math.ceil(width / 4);
    for (let i = 0; i < along; i++) for (let j = 0; j < across; j++) {
      const point = (t, u) => ({ x: a.x + (b.x - a.x) * t + nx * u, z: a.z + (b.z - a.z) * t + nz * u });
      const p = point(i / along, width * (j / across - 0.5)), q = point((i + 1) / along, width * (j / across - 0.5));
      const r = point((i + 1) / along, width * ((j + 1) / across - 0.5)), s = point(i / along, width * ((j + 1) / across - 0.5));
      surfaceTriangle(name, p, q, r, color, offset); surfaceTriangle(name, p, r, s, color, offset);
    }
  }
  for (const s of streets) {
    surfaceStrip("street-paving", s.a, s.b, s.width + 4, 0xc5c3b3, 0.025);
    surfaceStrip("streets", s.a, s.b, s.width, 0x667476, 0.055);
    const length = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
    for (let along = 8; along < length - 8; along += 12) {
      const point = distance => ({ x: s.a.x + (s.b.x - s.a.x) * distance / length, z: s.a.z + (s.b.z - s.a.z) * distance / length });
      surfaceStrip("street-markings", point(along), point(Math.min(along + 4, length - 5)), .18, 0xe7e0c8, .105);
    }
  }
  // Joined paving at bends and junctions, rather than gaps between butt-ended strips.
  for (const street of WELLINGTON.streets) for (const p of street.points) {
    for (const [name, width, color, offset] of [["street-paving", street.width + 4, 0xc5c3b3, .025], ["streets", street.width, 0x667476, .055]]) {
      for (let i = 0; i < 16; i++) {
        const corner = j => ({ x: p.x + Math.cos(j * Math.PI / 8) * width / 2, z: p.z + Math.sin(j * Math.PI / 8) * width / 2 });
        surfaceTriangle(name, p, corner(i), corner(i + 1), color, offset);
      }
    }
  }
  for (const p of WELLINGTON.landmarks.filter(p => p.type === "park")) {
    const c = Math.cos(p.rotation), s = Math.sin(p.rotation);
    surfaceStrip("parks", { x: p.x - s * p.d / 2, z: p.z - c * p.d / 2 },
      { x: p.x + s * p.d / 2, z: p.z + c * p.d / 2 }, p.w, 0x80966b, 0.075);
  }
  for (const { a, b } of boundary) {
    if (Math.min(a.x, b.x) < 780 || Math.max(a.x, b.x) > 1240 || Math.max(a.z, b.z) > -300 || Math.min(a.z, b.z) < -640) continue;
    const length = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / length, nz = (b.x - a.x) / length;
    surfaceStrip("oriental-bay-beach", { x: a.x + nx * 8, z: a.z + nz * 8 }, { x: b.x + nx * 8, z: b.z + nz * 8 }, 15, 0xdec995, 0.085);
  }
  for (const [name, batch] of surfaceBatches) {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.vertices, 3)); geometry.computeVertexNormals();
    mesh(name, geometry, material(name, batch.color, 1));
  }

  const prepare = geometry => {
    if (geometry.index) { const old = geometry; geometry = old.toNonIndexed(); old.dispose(); }
    geometry.deleteAttribute("uv"); geometry.clearGroups(); return geometry;
  };
  const roofShape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  const roundedShape = new THREE.Shape();
  roundedShape.moveTo(-0.3, -0.5); roundedShape.lineTo(0.3, -0.5); roundedShape.quadraticCurveTo(0.5, -0.5, 0.5, -0.25);
  roundedShape.lineTo(0.5, 0.25); roundedShape.quadraticCurveTo(0.5, 0.5, 0.3, 0.5); roundedShape.lineTo(-0.3, 0.5);
  roundedShape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.25); roundedShape.lineTo(-0.5, -0.25); roundedShape.quadraticCurveTo(-0.5, -0.5, -0.3, -0.5);
  const prototypes = {
    box: prepare(new THREE.BoxGeometry(1, 1, 1)),
    round: prepare(new THREE.CylinderGeometry(0.5, 0.5, 1, tablet ? 24 : 40)),
    dome: prepare(new THREE.SphereGeometry(0.5, tablet ? 24 : 40, tablet ? 8 : 12, 0, Math.PI * 2, 0, Math.PI / 2)),
    roof: prepare(new THREE.ExtrudeGeometry(roofShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5)),
    curved: prepare(new THREE.ExtrudeGeometry(roundedShape, { depth: 1, bevelEnabled: false, curveSegments: tablet ? 5 : 10 }).rotateX(-Math.PI / 2).translate(0, -0.5, 0)),
    leaf: prepare(new THREE.IcosahedronGeometry(1, tablet ? 0 : 1)),
  };
  const batches = new Map(), transform = new THREE.Object3D(), instanceBatches = new Map();
  let owner, baseY = 3;
  function part(prototype, mat, feature, x, y, z, w, h, d, rotation = 0) {
    const c = Math.cos(owner.rotation), s = Math.sin(owner.rotation);
    transform.position.set(owner.x + c * x + s * z, baseY + y, owner.z - s * x + c * z);
    transform.rotation.set(0, owner.rotation + rotation, 0); transform.scale.set(w, h, d); transform.updateMatrix();
    const geometry = prototypes[prototype].clone().applyMatrix4(transform.matrix);
    if (!batches.has(mat)) batches.set(mat, { geometries: [], parts: [], vertices: 0 });
    const batch = batches.get(mat);
    batch.parts.push({ id: owner.id, feature, start: batch.vertices, count: geometry.attributes.position.count });
    batch.vertices += geometry.attributes.position.count; batch.geometries.push(geometry); counts.parts++;
  }
  function instance(prototype, mat, x, y, z, w, h, d, color = 0xffffff, rotation = 0) {
    const key = `${prototype}/${mat}/${Math.floor(x / 600)}/${Math.floor(z / 600)}`;
    if (!instanceBatches.has(key)) instanceBatches.set(key, { prototype, mat, matrices: [], colors: [] });
    transform.position.set(x, y, z); transform.rotation.set(0, rotation, 0); transform.scale.set(w, h, d); transform.updateMatrix();
    const batch = instanceBatches.get(key); batch.matrices.push(transform.matrix.clone()); batch.colors.push(color); counts.parts++;
  }
  function foundation(p) {
    let min = Math.max(3, heightAt(p.x, p.z)), max = min;
    const c = Math.cos(p.rotation), s = Math.sin(p.rotation), nx = Math.ceil(p.w / 6), nz = Math.ceil(p.d / 6);
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = (i / nx - 0.5) * p.w, z = (j / nz - 0.5) * p.d;
      const y = Math.max(3, heightAt(p.x + c * x + s * z, p.z - s * x + c * z));
      min = Math.min(min, y); max = Math.max(max, y);
    }
    return { min, max };
  }
  function recordBuilding(p, ground, urban = false) {
    const info = { ...p, y: ground.min, h: p.h + ground.max - ground.min, foundationY: ground.max, architecturalHeight: p.h, kind: urban ? "urban" : "landmark" };
    buildingInfo.push(info); footprints.push(p); counts.buildings++;
    if (urban) {
      counts.urbanBuildings++;
      obstacles.push({ x: p.x, y: info.y, z: p.z, hx: p.w / 2, hz: p.d / 2, r: Math.hypot(p.w, p.d) / 2, height: info.h, name: p.name, id: p.id, kind: "building" });
      counts.colliders++; return;
    }
    counts.landmarks++;
    // Inscribed circle chains never create a rotated building's oversized AABB.
    const radius = Math.min(p.w, p.d) / 2 - 0.3, span = Math.max(p.w, p.d) - 2 * radius;
    const steps = Math.max(1, Math.ceil(span / (radius * 1.35))), c = Math.cos(p.rotation), s = Math.sin(p.rotation);
    for (let i = 0; i <= steps; i++) {
      const t = span * (i / steps - 0.5), x = p.w > p.d ? t : 0, z = p.w > p.d ? 0 : t;
      obstacles.push({ x: p.x + c * x + s * z, y: info.y, z: p.z - s * x + c * z,
        r: radius, height: info.h, name: p.name, id: p.id, kind: "building" }); counts.colliders++;
    }
  }
  const labelNames = { beehive: "THE BEEHIVE", parliament: "PARLIAMENT", railway: "WELLINGTON STATION", majestic: "MAJESTIC CENTRE",
    stateinsurance: "AON CENTRE", tepapa: "TE PAPA", takina: "TAKINA", michaelfowler: "MICHAEL FOWLER CENTRE", stgerard: "ST GERARD'S", clydequay: "CLYDE QUAY", queensshed1: "QUEENS WHARF" };
  for (const p of WELLINGTON.landmarks) {
    if (!p.h || p.type === "wharenui") continue;
    owner = p;
    const ground = foundation(p); baseY = ground.max; recordBuilding(p, ground);
    const anchor = new THREE.Group(); anchor.name = `wellington/landmark/${p.id}`;
    anchor.position.set(p.x, baseY, p.z); anchor.rotation.y = p.rotation; anchor.userData.landmark = { ...p, y: baseY }; group.add(anchor);
    const { w, d, h } = p;
    const box = (mat, feature, x, y, z, width, height, depth) => part("box", mat, feature, x, y, z, width, height, depth);
    const form = (shape, mat, feature, x, y, z, width, height, depth) => part(shape, mat, feature, x, y, z, width, height, depth);
    if (ground.max - ground.min > 0.0001) box("stone", "hillside-foundation", 0, -(ground.max - ground.min) / 2, 0, w, ground.max - ground.min, d);
    if (p.type === "beehive") {
      form("round", "stone", "circular-podium", 0, 6, 0, w, 12, d);
      for (let i = 0; i < 8; i++) {
        const width = w * (0.94 - i * 0.055), bottom = 12 + i * 6;
        form("round", "glass", "tiered-circular-glazing", 0, bottom + 2.7, 0, width - 0.9, 5.4, width - 0.9);
        form("round", "stone", "circular-floor-bands", 0, bottom + 5.7, 0, width, 0.6, width);
      }
      form("dome", "copper", "copper-dome", 0, 60, 0, w * 0.57, 24, d * 0.57);
    } else if (["parliament", "railway", "gallery"].includes(p.type)) {
      box(p.type === "railway" ? "brick" : "stone", "neoclassical-main-mass", 0, h * 0.42, d * 0.045, w, h * 0.84, d * 0.91);
      box("stone", "cornice", 0, h * 0.87, 0, w, h * 0.06, d);
      box("roof", "recessed-roof", 0, h * 0.95, d * 0.06, w * 0.94, h * 0.1, d * 0.81);
      const columns = p.type === "railway" ? 12 : 8;
      for (let i = 0; i < columns; i++) {
        const x = w * 0.68 * (i / (columns - 1) - 0.5);
        form("round", "cream", "portico-colonnade", x, h * 0.4, -d * 0.46, w * 0.018, h * 0.66, w * 0.018);
        box("stone", "column-capital", x, h * 0.74, -d * 0.46, w * 0.029, h * 0.035, d * 0.075);
      }
      form("roof", "stone", "classical-pediment", 0, h * 0.8, -d * 0.38, w * 0.77, h * 0.2, d * 0.24);
      const bays = Math.floor(w / 5);
      for (let i = 0; i < bays; i++) for (const side of [-1, 1]) box("glass", "stone-window-bays", w * 0.86 * (i / (bays - 1) - 0.5), h * 0.5, side * d * 0.455, 2, h * 0.35, 0.15);
    } else if (["majestic", "black-tower", "glass-tower", "hotel"].includes(p.type)) {
      const majestic = p.type === "majestic", dark = p.type === "black-tower", shape = majestic ? "curved" : "box";
      box(dark ? "dark" : "stone", "tower-podium", 0, 4, 0, w, 8, d);
      form(shape, dark ? "dark" : "glass", majestic ? "curved-glazed-shaft" : "tower-shaft", 0, h * 0.48, 0, w * 0.91, h * 0.88, d * 0.91);
      for (let y = 10; y < h * 0.9; y += 3.7) form(shape, dark ? "glass" : "stone", "slender-floor-bands", 0, y, 0, w * 0.92, dark ? 0.28 : 0.38, d * 0.92);
      for (let i = -3; i <= 3; i++) for (const side of [-1, 1]) box(dark ? "dark" : "cream", "vertical-mullions", i * w * 0.115, h * 0.49, side * d * 0.455, 0.45, h * 0.8, 0.32);
      if (majestic) {
        form("curved", "stone", "pale-crown-lower", 0, h * 0.94, 0, w * 0.89, h * 0.04, d * 0.89);
        form("curved", "cream", "pale-crown-upper", 0, h * 0.98, 0, w * 0.69, h * 0.04, d * 0.69);
      } else box(dark ? "dark" : "stone", "flat-tower-crown", 0, h * 0.96, 0, w * 0.92, h * 0.08, d * 0.92);
    } else if (p.type === "museum") {
      box("stone", "museum-plinth", 0, 2, 0, w, 4, d);
      box("brick", "terracotta-west-volume", -w * 0.23, h * 0.45, 0, w * 0.49, h * 0.9, d * 0.9);
      box("stone", "pale-east-volume", w * 0.235, h * 0.38, -d * 0.03, w * 0.48, h * 0.76, d * 0.88);
      box("glass", "harbour-glazed-gallery", w * 0.1, h * 0.51, d * 0.43, w * 0.64, h * 0.38, d * 0.08);
      form("roof", "roof", "angular-museum-roof", -w * 0.2, h * 0.9, 0, w * 0.48, h * 0.1, d * 0.89);
      box("brick", "museum-upper-volume", w * 0.14, h * 0.86, 0, w * 0.28, h * 0.28, d * 0.52);
      anchor.userData.interior = ["wharenui"];
    } else if (p.type === "convention-centre") {
      form("curved", "glass", "curved-glass-base", 0, h * 0.23, 0, w * 0.98, h * 0.46, d * 0.98);
      form("curved", "gold", "curving-gold-facade", 0, h * 0.69, 0, w, h * 0.62, d);
      form("curved", "roof", "inset-convention-roof", 0, h * 0.98, 0, w * 0.87, h * 0.04, d * 0.82);
      for (const point of roundedShape.getSpacedPoints(tablet ? 28 : 48).slice(0, -1)) {
        box("gold", "bronze-facade-fins", point.x * w * 1.004, h * 0.67, -point.y * d * 1.004, 0.45, h * 0.53, 0.45);
      }
    } else if (p.type === "concert-hall") {
      form("round", "glass", "rounded-hall-foyer", 0, h * 0.23, 0, w, h * 0.46, d);
      for (const side of [-1, 1]) form("dome", "stone", "sculpted-hall-roof", side * w * 0.18, h * 0.42, 0, w * 0.63, h * 1.16, d * 0.98);
      box("brick", "hall-stage-house", 0, h * 0.45, d * 0.23, w * 0.52, h * 0.9, d * 0.37);
    } else if (p.type === "monastery") {
      for (const side of [-1, 1]) {
        box("brick", "twin-warm-masonry-wings", side * w * 0.31, h * 0.39, 0, w * 0.38, h * 0.78, d);
        form("roof", "roof", "church-and-monastery-gables", side * w * 0.31, h * 0.78, 0, w * 0.38, h * 0.22, d);
        for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) box("cream", "masonry-window-surrounds", side * w * 0.31 + (i - 1) * w * 0.09, 4 + j * 5, -d * 0.502, w * 0.045, 2.6, 0.18);
      }
      box("brick", "church-link", 0, h * 0.22, d * 0.24, w * 0.3, h * 0.44, d * 0.3);
    } else if (p.type === "pier-apartments") {
      box("stone", "pier-apartment-base", 0, 2, 0, w, 4, d);
      box("glass", "long-glazed-apartments", 0, h * 0.55, 0, w * 0.92, h * 0.66, d * 0.97);
      for (let i = 0; i < 4; i++) box("cream", "continuous-balcony-bands", 0, 4 + i * 3.4, 0, w, 0.5, d);
      for (let i = 0; i < 9; i++) box("cream", "segmented-rooftop-apartments", 0, h * 0.9, d * (i / 9 - 0.444), w * 0.79, h * 0.2, d / 11);
    } else if (p.type === "boat-sheds") {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const x = w * ((i + 0.5) / n - 0.5);
        box(i % 3 ? "blue" : "cream", "blue-boat-shed-row", x, h * 0.35, 0, w / n * 0.98, h * 0.7, d);
        box("dark", "boat-shed-doors", x, h * 0.3, d * 0.501, w / n * 0.72, h * 0.55, 0.12);
        form("roof", "roof", "small-gabled-roofs", x, h * 0.7, 0, w / n, h * 0.3, d);
      }
    } else if (["wharf-shed", "boat-shed", "arena", "wharewaka"].includes(p.type)) {
      box(p.type === "boat-shed" ? "blue" : p.type === "wharewaka" ? "dark" : "brick", "waterfront-shed-mass", 0, h * 0.34, 0, w, h * 0.68, d);
      form("roof", p.type === "boat-shed" ? "cream" : "roof", p.type === "wharewaka" ? "folded-waka-house-roof" : "wharf-gabled-roof", 0, h * 0.68, 0, w, h * 0.32, d);
      for (let i = 0; i < Math.floor(d / 7); i++) for (const side of [-1, 1]) box("cream", "shed-window-trim", side * w * 0.501, h * 0.42, -d * 0.43 + i * 7, 0.12, h * 0.25, 2.6);
    } else {
      box("cream", "waterfront-low-rise", 0, h * 0.46, 0, w, h * 0.92, d);
      box("roof", "flat-parapet", 0, h * 0.96, 0, w, h * 0.08, d);
      for (let y = 3; y < h - 2; y += 3.5) for (const side of [-1, 1]) box("glass", "horizontal-waterfront-windows", 0, y, side * d * 0.501, w * 0.89, 1.5, 0.13);
    }
    if (labelNames[p.id] && typeof document !== "undefined") {
      const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = 768; canvas.height = 96;
        ctx.fillStyle = "rgba(23,48,53,.88)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#f4eedb"; ctx.font = "600 40px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(labelNames[p.id], 384, 50, 720);
        const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false, toneMapped: false }));
        sprite.name = `wellington/label/${p.id}`; sprite.position.set(0, h + 5, 0); sprite.scale.set(26, 3.25, 1); anchor.add(sprite); counts.labels++;
      }
    }
  }

  let seed = 0x57544e31;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const clearLandmark = (x, z, radius) => WELLINGTON.landmarks.every(p => {
    const dx = x - p.x, dz = z - p.z, c = Math.cos(p.rotation), s = Math.sin(p.rotation);
    return Math.hypot(Math.max(0, Math.abs(c * dx - s * dz) - p.w / 2), Math.max(0, Math.abs(s * dx + c * dz) - p.d / 2)) > radius + 8;
  });
  // Fixed parcels, variable facades. Detail mode never changes urban positions,
  // massing, foundations or collision geometry.
  const urban = [];
  for (let z = -1120; z <= 1120; z += 48) for (let x = -1120; x <= 200; x += 48) {
    const px = x + (random() - 0.5) * 11, pz = z + (random() - 0.5) * 11;
    const w = 17 + random() * 16, d = 17 + random() * 16, radius = Math.hypot(w, d) / 2;
    const density = random(), tone = random(), rawHeight = random();
    if ((px > -360 && pz > -730) || density > (px < -930 ? 0.5 : 0.87) || !isWellingtonLand(px, pz, radius + 3)
      || !roadClear(px, pz, radius) || !clearLandmark(px, pz, radius) || course.nearest(px, pz).distance < radius + 10.5) continue;
    const p = { id: `urban-${urban.length}`, name: "Wellington CBD streetscape", x: px, z: pz, w, d,
      h: 10 + Math.floor(rawHeight * (px > -780 && pz > -650 ? 47 : 22) / 3.3) * 3.3, rotation: 0, type: "urban" };
    const ground = foundation(p);
    if (ground.max > 72 || ground.max - ground.min > 5) continue;
    urban.push(p); recordBuilding(p, ground, true);
    const h = p.h, base = ground.max, color = [0xcac4ac, 0xb6b9b3, 0xb9947c, 0xe0dcca, 0x9daaad][Math.floor(tone * 5)];
    instance("box", "cream", px, (ground.min + base + h - 0.6) / 2, pz, w, h + base - ground.min - 0.6, d, color);
    instance("box", "roof", px, base + h - 0.3, pz, w * 0.94, 0.6, d * 0.94);
    for (let y = 3.1; y < h - 1; y += tablet ? 6.6 : 3.3) for (const side of [-1, 1]) {
      instance("box", "glass", px, base + y, pz + side * (d / 2 + 0.04), w - 2.4, 1.45, 0.09);
      instance("box", "glass", px + side * (w / 2 + 0.04), base + y, pz, 0.09, 1.45, d - 2.4);
    }
    if (!tablet) for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) instance("box", "stone", px + i * w * 0.26, base + h / 2, pz + side * (d / 2 + 0.1), 0.42, h - 1, 0.15);
  }
  for (let i = 0; i < 1400; i++) {
    const x = -1390 + random() * 2760, z = -1380 + random() * 2730, y = heightAt(x, z);
    if (y < 14 || !isWellingtonLand(x, z, 7) || !roadClear(x, z, 6) || !clearLandmark(x, z, 6)
      || urban.some(p => Math.abs(x - p.x) < p.w / 2 + 7 && Math.abs(z - p.z) < p.d / 2 + 7)) continue;
    const h = 5 + random() * 5;
    obstacles.push({ x, y, z, r: 0.35, height: h, kind: "tree" }); counts.colliders++; counts.trees++;
    instance("box", "dark", x, y + h * 0.3, z, 0.5, h * 0.6, 0.5);
    instance("leaf", "foliage", x, y + h * 0.72, z, h * 0.48, h * 0.33, h * 0.45);
  }
  for (const [mat, batch] of batches) {
    const geometry = mergeGeometries(batch.geometries, false); batch.geometries.forEach(g => g.dispose());
    const object = mesh(`landmarks/${mat}`, geometry, materials[mat]); object.castShadow = true; object.userData.parts = batch.parts;
  }
  for (const [name, batch] of instanceBatches) {
    const object = new THREE.InstancedMesh(prototypes[batch.prototype], materials[batch.mat], batch.matrices.length);
    object.name = `wellington/instances/${name}`;
    batch.matrices.forEach((matrix, i) => { object.setMatrixAt(i, matrix); object.setColorAt(i, new THREE.Color(batch.colors[i])); });
    object.computeBoundingBox(); object.computeBoundingSphere(); object.castShadow = true; object.receiveShadow = true; group.add(object);
  }
  const usedPrototypes = new Set([...instanceBatches.values()].map(b => b.prototype));
  for (const [name, geometry] of Object.entries(prototypes)) if (!usedPrototypes.has(name)) geometry.dispose();
  for (const root of [group, landscapeGroup]) root.traverse(object => {
    if (object.isSprite) { counts.drawCalls++; counts.triangles += 2; }
    if (!object.isMesh) return;
    counts.meshes++; counts.drawCalls++;
    const instances = object.isInstancedMesh ? object.count : 1;
    if (object.isInstancedMesh) counts.instances += instances;
    counts.triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * instances;
  });
  return {
    group, landscapeGroup, sites, counts,
    animate(timeSeconds) { if (Number.isFinite(timeSeconds)) time.value = reducedMotion?.matches ? 0 : timeSeconds; },
    drawMap(ctx, scale) {
      ctx.save();
      ctx.fillStyle = "#397b83"; ctx.fillRect(-8000 * scale, -8000 * scale, 16000 * scale, 16000 * scale);
      const path = points => {
        points.forEach((p, i) => i ? ctx.lineTo(p.x * scale, -p.z * scale) : ctx.moveTo(p.x * scale, -p.z * scale)); ctx.closePath();
      };
      ctx.beginPath(); loops.forEach(path); ctx.fillStyle = "#aab5a0"; ctx.fill("evenodd");
      ctx.save(); ctx.clip("evenodd");
      for (const wharf of WELLINGTON.wharves) { ctx.beginPath(); path(wharf.points); ctx.fillStyle = "#c2bd9f"; ctx.fill(); }
      for (const p of WELLINGTON.landmarks.filter(p => p.type === "park")) {
        const c = Math.cos(p.rotation), s = Math.sin(p.rotation);
        ctx.beginPath(); path([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({ x: p.x + c * x * p.w / 2 + s * z * p.d / 2, z: p.z - s * x * p.w / 2 + c * z * p.d / 2 })));
        ctx.fillStyle = "#738f65"; ctx.fill();
      }
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const street of WELLINGTON.streets) {
        ctx.beginPath(); street.points.forEach((p, i) => i ? ctx.lineTo(p.x * scale, -p.z * scale) : ctx.moveTo(p.x * scale, -p.z * scale));
        ctx.strokeStyle = "#e0ddc7"; ctx.lineWidth = Math.max(0.65, street.width * scale); ctx.stroke();
      }
      ctx.restore();
      for (const p of footprints) {
        const c = Math.cos(p.rotation), s = Math.sin(p.rotation);
        ctx.beginPath(); path([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => ({ x: p.x + c * x * p.w / 2 + s * z * p.d / 2, z: p.z - s * x * p.w / 2 + c * z * p.d / 2 })));
        ctx.fillStyle = p.type === "urban" ? "#7c8983" : "#856f57"; ctx.fill();
      }
      ctx.font = "600 8px sans-serif";
      for (const [id, title, dx, dy] of [["beehive", "Parliament", -6, -7], ["queensshed1", "Queens Wharf", 9, -2],
        ["tepapa", "Te Papa", 6, 13], ["freyberg", "Oriental Bay", 2, -9]]) {
        const p = WELLINGTON.landmarks.find(site => site.id === id);
        ctx.textAlign = dx < 0 ? "right" : "left";
        ctx.lineWidth = 2.5; ctx.strokeStyle = "#183c4a"; ctx.fillStyle = "#fff3d2";
        ctx.strokeText(title, p.x * scale + dx, -p.z * scale + dy);
        ctx.fillText(title, p.x * scale + dx, -p.z * scale + dy);
      }
      ctx.restore();
    },
  };
}
