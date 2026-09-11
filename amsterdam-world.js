import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { AMSTERDAM, waterAt, bridgeAt, isAmsterdamDry, amsterdamPathLength, sampleAmsterdamPath } from "./amsterdam-layout.js";
import { offsetPath } from "./amsterdam-geometry.js";
import { decorateAmsterdamLandmarks } from "./amsterdam-landmarks.js";

// Cut at the actual quay edges, not at heightfield samples: no land triangles
// span the canals. Bridge decks are separate, sampled from the driving surface.
export function createAmsterdamGroundGeometry() {
  const size = AMSTERDAM.groundHalfSize, positions = [], uv = [];
  for (const polygon of AMSTERDAM.landPolygons) for (let i = 1; i < polygon.length - 1; i++) {
    for (const { x, z } of [polygon[0], polygon[i + 1], polygon[i]]) {
      positions.push(x, AMSTERDAM.landY, z);
      uv.push(x / (size * 2) + 0.5, 0.5 - z / (size * 2));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Fixed-layout canal district. All generated resources and records are owned here. */
export function createAmsterdamWorld({ scene, terrain, obstacles = [], buildingInfo = [], treeInfo = [], tablet = false }) {
  const group = new THREE.Group(), decoration = new THREE.Group();
  group.name = "amsterdam/architecture";
  group.userData.nightLights = [];
  decoration.name = "amsterdam/landscape";
  scene.add(group, decoration);
  const counts = { houses: 0, buildings: 0, bridges: 0, bicycles: 0, houseboats: 0, tourBoats: 0,
    trees: 0, lights: 0, benches: 0, cafes: 0, marketStalls: 0, landmarks: 6,
    districts: 0, meshes: 0, triangles: 0, parts: 0, colliders: 0 };
  const ownedObstacles = new Set(), ownedBuildings = new Set(), ownedTrees = new Set();
  const time = { value: 0 };
  const motion = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let disposed = false, previousTime, elapsed = 0;
  const materials = {};
  for (const [name, roughness, metalness] of [["masonry", .9, 0], ["stone", .85, 0], ["roof", .8, .08],
    ["glass", .2, .55], ["metal", .44, .65], ["wood", .83, 0], ["foliage", .95, 0],
    ["light", .4, 0], ["paint", .78, 0], ["street", .93, 0]]) {
    materials[name] = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness, vertexColors: true });
    materials[name].name = `amsterdam/${name}`;
  }
  materials.light.emissive.set(0xffc786);
  materials.light.emissiveIntensity = 0;
  materials.light.userData.nightIntensity = 1.2;
  materials.glass.envMapIntensity = 1.2;
  materials.masonry.onBeforeCompile = shader => {
    shader.vertexShader = "varying vec3 vBrickPosition; varying vec3 vBrickNormal;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vBrickPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vBrickNormal = mat3(modelMatrix) * normal;
    `);
    shader.fragmentShader = "varying vec3 vBrickPosition; varying vec3 vBrickNormal;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float row = vBrickPosition.y / 0.24;
      float across = abs(vBrickNormal.z) > 0.5 ? vBrickPosition.x : vBrickPosition.z;
      vec2 brick = vec2(across / 0.62 + mod(floor(row), 2.0) * 0.5, row);
      vec2 joint = min(fract(brick), 1.0 - fract(brick));
      vec2 aa = max(fwidth(brick), vec2(0.015));
      float mortar = 1.0 - min(smoothstep(0.02, 0.02 + aa.x, joint.x), smoothstep(0.025, 0.025 + aa.y, joint.y));
      float grain = fract(sin(dot(floor(brick), vec2(12.9898, 78.233))) * 43758.5453);
      diffuseColor.rgb *= (0.94 + grain * 0.12) * (1.0 - mortar * 0.22);
    `);
  };
  materials.masonry.customProgramCacheKey = () => "amsterdam-brick-v1";
  materials.foliage.onBeforeCompile = shader => {
    shader.uniforms.uCanalTime = time;
    shader.vertexShader = "uniform float uCanalTime;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vec3 treeWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      transformed.x += sin(uCanalTime * 0.8 + treeWorld.z * 0.25) * 0.10;
      transformed.z += cos(uCanalTime * 0.7 + treeWorld.x * 0.2) * 0.07;
    `);
  };
  materials.foliage.customProgramCacheKey = () => "amsterdam-elm-wind-v1";

  const atlas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const tileW = tablet ? 128 : 256, tileH = tileW / 4;
  if (atlas) { atlas.width = tileW * 8; atlas.height = tileH * 32; }
  const ink = atlas?.getContext("2d");
  const signTexture = ink ? new THREE.CanvasTexture(atlas)
    : new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  signTexture.needsUpdate = true;
  materials.sign = new THREE.MeshStandardMaterial({ map: signTexture, roughness: .84, vertexColors: true });
  materials.sign.name = "amsterdam/lettering-atlas";
  let signIndex = 0;

  const prepare = source => {
    let geometry = source;
    if (geometry.index) { geometry = source.toNonIndexed(); source.dispose(); }
    for (const attr of Object.keys(geometry.attributes)) if (!["position", "normal", "uv"].includes(attr)) geometry.deleteAttribute(attr);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
    geometry.clearGroups();
    return geometry;
  };
  const prototypes = {
    box: prepare(new THREE.BoxGeometry(1, 1, 1)),
    cylinder: prepare(new THREE.CylinderGeometry(1, 1, 1, tablet ? 6 : 10)),
    cone: prepare(new THREE.ConeGeometry(1, 1, tablet ? 6 : 10)),
    sphere: prepare(new THREE.IcosahedronGeometry(1, tablet ? 0 : 1)),
    smallSphere: prepare(new THREE.IcosahedronGeometry(1, 0)),
    thinCylinder: prepare(new THREE.CylinderGeometry(1, 1, 1, 6)),
    plane: prepare(new THREE.PlaneGeometry(1, 1)),
  };
  const toruses = new Map(), districts = new Map();
  const transform = new THREE.Object3D(), originMatrix = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  let origin = { x: 0, z: 0, heading: 0, name: "streets", decorative: false };
  const coordinates = (x, z) => ({
    x: origin.x + Math.cos(origin.heading) * x + Math.sin(origin.heading) * z,
    z: origin.z - Math.sin(origin.heading) * x + Math.cos(origin.heading) * z,
  });
  function flush(batch) {
    if (!batch.geometries.length) return;
    const geometry = mergeGeometries(batch.geometries, false);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    if (batch.material === "foliage") geometry.boundingSphere.radius += .2;
    const mesh = new THREE.Mesh(geometry, materials[batch.material]);
    mesh.name = `${batch.node.name}/${batch.material}-${batch.node.children.length}`;
    mesh.castShadow = !["sign", "street", "light"].includes(batch.material);
    if (!mesh.castShadow) mesh.userData.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.parts = batch.parts;
    batch.node.add(mesh);
    batch.geometries.forEach(g => g.dispose());
    batch.geometries = []; batch.parts = []; batch.vertices = 0;
  }
  function emit(prototype, material, x, y, z, sx, sy, sz, options = {}) {
    const point = coordinates(x, z);
    const decorative = origin.decorative || material === "foliage";
    const cellSize = origin.name === "flat-dutch-horizon" ? 512 : 128;
    const cx = Math.floor(point.x / cellSize) * cellSize, cz = Math.floor(point.z / cellSize) * cellSize;
    const key = `${decorative}/${cx}/${cz}`;
    if (!districts.has(key)) {
      const node = new THREE.Group();
      node.name = `amsterdam/district-${cx}-${cz}${decorative ? "-detail" : ""}`;
      node.position.set(cx, 0, cz);
      (decorative ? decoration : group).add(node);
      districts.set(key, { node, batches: new Map() });
      counts.districts++;
    }
    const district = districts.get(key);
    transform.position.set(x, y + AMSTERDAM.landY, z);
    transform.scale.set(sx, sy, sz);
    transform.rotation.set(options.rx ?? 0, options.ry ?? 0, options.rz ?? 0);
    transform.updateMatrix();
    originMatrix.makeRotationY(origin.heading);
    originMatrix.setPosition(origin.x - cx, 0, origin.z - cz);
    matrix.multiplyMatrices(originMatrix, transform.matrix);
    const geometry = prototype.clone().applyMatrix4(matrix);
    const count = geometry.attributes.position.count;
    color.set(options.color ?? 0xe7dfca);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (options.tile !== undefined) {
      const uv = geometry.attributes.uv, col = options.tile % 8, row = Math.floor(options.tile / 8);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + .01 + uv.getX(i) * .98) / 8, 1 - (row + .01 + (1 - uv.getY(i)) * .98) / 32);
    }
    if (!district.batches.has(material)) district.batches.set(material, { material, node: district.node, geometries: [], parts: [], vertices: 0 });
    const batch = district.batches.get(material);
    if (batch.vertices + count > 60000) flush(batch);
    batch.parts.push({ name: `${origin.name}/${options.name ?? material}`, start: batch.vertices, count });
    batch.geometries.push(geometry); batch.vertices += count; counts.parts++;
  }
  const flatFacade = new Set(["sash-window-frame", "recessed-window-glazing", "window-mullion", "window-transom",
    "fine-sash-bar", "dutch-shutter", "recessed-door-panel", "painted-front-door", "attic-window", "door-transom-light", "facade-string-course"]);
  const kit = {
    box(m, x, y, z, w, h, d, o = {}) {
      // Faces buried inside a solid facade need no hidden side/back triangles.
      const panel = origin.name.startsWith("canal-house-") && flatFacade.has(o.name)
        && (tablet || o.name === "recessed-window-glazing" || o.name === "attic-window");
      if (panel) emit(prototypes.plane, m, x, y, z + d / 2, w, h, 1, o);
      else emit(prototypes.box, m, x, y, z, w, h, d, o);
    },
    cylinder: (m, x, y, z, r, h, o) => emit(r < .1 ? prototypes.thinCylinder : prototypes.cylinder, m, x, y, z, r, h, r, o),
    cone: (m, x, y, z, r, h, o) => emit(prototypes.cone, m, x, y, z, r, h, r, o),
    sphere: (m, x, y, z, rx, ry, rz, o) => emit(Math.max(rx, ry, rz) < .6 ? prototypes.smallSphere : prototypes.sphere, m, x, y, z, rx, ry, rz, o),
    beam(m, a, b, w, d = w, o = {}) {
      const direction = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const length = direction.length();
      if (length < 1e-8) return;
      const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length)));
      emit(prototypes.box, m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, w, length, d,
        { ...o, rx: rotation.x, ry: rotation.y, rz: rotation.z });
    },
    torus(m, x, y, z, r, tube, o) {
      const ratio = Math.round(tube / r * 1000) / 1000;
      const radial = r < .18 || tablet ? 4 : 5, tubular = r < .18 ? 8 : tablet ? 10 : 16;
      const key = `${ratio}/${radial}/${tubular}`;
      if (!toruses.has(key)) toruses.set(key, prepare(new THREE.TorusGeometry(1, ratio, radial, tubular)));
      emit(toruses.get(key), m, x, y, z, r, r, r, o);
    },
    extrude(m, points, depth, x, y, z, o) {
      const shape = new THREE.Shape(points.map(p => new THREE.Vector2(...p)));
      const geometry = prepare(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4, steps: 1 }).translate(0, 0, -depth / 2));
      emit(geometry, m, x, y, z, 1, 1, 1, o); geometry.dispose();
    },
    panel(m, points, o) {
      const vertices = [];
      for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      prepare(geometry);
      emit(geometry, m, 0, 0, 0, 1, 1, 1, o); geometry.dispose();
    },
    sign(text, x, y, z, w, h, o = {}) {
      if (signIndex >= 256) throw new RangeError("Amsterdam sign atlas is full");
      const tile = signIndex++;
      if (ink) {
        const tx = tile % 8 * tileW, ty = Math.floor(tile / 8) * tileH;
        ink.fillStyle = o.background ?? "#263f42"; ink.fillRect(tx, ty, tileW, tileH);
        ink.strokeStyle = o.ink ?? "#f0e4cb"; ink.lineWidth = 1;
        ink.strokeRect(tx + 3, ty + 3, tileW - 6, tileH - 6);
        ink.fillStyle = o.ink ?? "#f0e4cb";
        ink.font = `600 ${tileH * .45}px Georgia, serif`;
        ink.textAlign = "center"; ink.textBaseline = "middle";
        ink.fillText(text, tx + tileW / 2, ty + tileH * .52, tileW - 16);
      }
      emit(prototypes.plane, "sign", x, y, z, w, h, 1, { ...o, tile, color: 0xffffff, name: o.name ?? `sign-${text}` });
    },
    solid(name, x, z, w, d, height, base = 0) {
      // Short rail colliders follow oblique banks without a long enclosing box
      // projecting invisible barriers into the adjacent driving lane.
      if ((name === "bridge-rail" || name === "quay-railing") && Math.max(w, d) > 2.5) {
        const count = Math.ceil(Math.max(w, d) / 2.5);
        for (let i = 0; i < count; i++) kit.solid(name,
          x + (w > d ? (i + .5) * w / count - w / 2 : 0),
          z + (d >= w ? (i + .5) * d / count - d / 2 : 0),
          w > d ? w / count : w, d >= w ? d / count : d, height, base);
        return;
      }
      const point = coordinates(x, z), c = Math.abs(Math.cos(origin.heading)), s = Math.abs(Math.sin(origin.heading));
      const obstacle = { ...point, y: AMSTERDAM.landY + base, hx: (c * w + s * d) / 2,
        hz: (s * w + c * d) / 2, r: Math.hypot(w, d) / 2, height, name: `${origin.name}/${name}`, kind: name };
      obstacles.push(obstacle); ownedObstacles.add(obstacle); counts.colliders++;
      return obstacle;
    },
    building(name, x, z, w, d, h, base = 0) {
      const solid = kit.solid(name, x, z, w, d, h, base);
      const info = { x: solid.x, y: solid.y, z: solid.z, w: solid.hx * 2, d: solid.hz * 2, h, name: solid.name, style: "amsterdam" };
      buildingInfo.push(info); ownedBuildings.add(info); counts.buildings++;
    },
  };
  function site(name, x, z, heading, build, decorative = false) {
    const previous = origin;
    origin = { name, x, z, heading, decorative };
    build(kit);
    origin = previous;
  }

  buildStreets();
  buildCanals();
  buildHouses();
  decorateAmsterdamLandmarks({ site, tablet });
  buildStreetLife();
  buildHorizon();
  for (const district of districts.values()) for (const batch of district.batches.values()) flush(batch);
  Object.values(prototypes).forEach(g => g.dispose());
  toruses.forEach(g => g.dispose());
  signTexture.needsUpdate = true;
  for (const root of [group, decoration]) root.traverse(object => {
    if (!object.isMesh) return;
    counts.meshes++;
    counts.triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  const sites = AMSTERDAM.landmarks.map(landmark => ({ ...landmark, y: AMSTERDAM.landY,
    radius: Math.max(landmark.w, landmark.d) / 2 }));
  return {
    group, decoration, landscapeGroup: decoration, counts, sites, clearings: [],
    drawMap(map, scale) {
      map.fillStyle = "#65b7bc55";
      for (const canal of AMSTERDAM.canals) {
        map.beginPath();
        canal.polygon.forEach((p, i) => map[i ? "lineTo" : "moveTo"](p.x * scale, -p.z * scale));
        map.closePath(); map.fill();
      }
      map.strokeStyle = "#ddccb347"; map.lineWidth = 2.2;
      for (const street of AMSTERDAM.streets) {
        map.beginPath();
        street.points.forEach((p, i) => map[i ? "lineTo" : "moveTo"](p.x * scale, -p.z * scale));
        map.stroke();
      }
    },
    animate(seconds) {
      if (disposed) return;
      if (previousTime !== undefined && !motion?.matches) elapsed += Math.max(0, Math.min(.1, seconds - previousTime));
      previousTime = seconds; time.value = elapsed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const geometries = new Set(), allMaterials = new Set(Object.values(materials)), textures = new Set([signTexture]);
      for (const root of [group, decoration]) {
        root.removeFromParent();
        root.traverse(object => {
          if (object.geometry) geometries.add(object.geometry);
          if (object.material) allMaterials.add(object.material);
        });
      }
      allMaterials.forEach(material => { if (material.map) textures.add(material.map); material.dispose(); });
      geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose());
      for (const [records, owned] of [[obstacles, ownedObstacles], [buildingInfo, ownedBuildings], [treeInfo, ownedTrees]]) {
        for (let i = records.length - 1; i >= 0; i--) if (owned.has(records[i])) records.splice(i, 1);
      }
    },
  };

  function buildStreets() {
    site("street-network", 0, 0, 0, k => {
      for (const street of AMSTERDAM.streets) {
        for (const [left, right, material, tint, lift] of [[-5.8, 5.8, "street", 0x626461, .04],
          [-9, -5.9, "stone", 0x9a9686, .055], [5.9, 9, "stone", 0x9a9686, .055],
          [6.1, 8.1, "paint", 0x9b6255, .066]]) {
          const l = offsetPath(street.points, left), r = offsetPath(street.points, right);
          for (let j = 1; j < street.points.length; j++) {
            const a = street.points[j - 1], b = street.points[j], steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2);
            for (let i = 0; i < steps; i++) {
              const points = [[i / steps, l], [i / steps, r], [(i + 1) / steps, r], [(i + 1) / steps, l]].map(([t, edge]) => {
                const x = edge[j - 1].x + (edge[j].x - edge[j - 1].x) * t;
                const z = edge[j - 1].z + (edge[j].z - edge[j - 1].z) * t;
                return [x, terrain.heightAt(x, z) - AMSTERDAM.landY + lift, z];
              });
              if (points.some(p => waterAt(p[0], p[2]) && !bridgeAt(p[0], p[2]))) continue;
              k.panel(material, points, { color: tint, name: material === "paint" ? "red-cycle-lane" : "paved-street" });
            }
          }
        }
      }
      for (const x of [-60, 70, 130]) for (let j = -4; j <= 4; j++) k.box("paint", x, .086, 210 + j * 1.05, 2.3, .025, .55,
        { color: 0xe6dfcd, name: "zebra-crossing" });
      for (const x of [-270, -115, 120, 252]) for (const z of [-208, 195]) {
        if (!isAmsterdamDry(x, z, 1) || terrain.roadDistance(x, z) < 7.5) continue;
        k.cylinder("metal", x, 1.6, z, .065, 3.2, { color: 0x3c4b47, name: "street-sign-post" });
        k.sign(z < 0 ? "MUSEUMPLEIN" : "PRINS HENDRIKKADE", x, 2.9, z + .08, 4.5, .7, { name: "blue-street-name" });
      }
    }, true);
  }

  function buildCanals() {
    const waterMaterial = new THREE.MeshPhysicalMaterial({ color: 0x376663, roughness: .28, metalness: .3,
      clearcoat: .6, clearcoatRoughness: .25, envMapIntensity: .65 });
    waterMaterial.name = "amsterdam/rippling-canal-water";
    waterMaterial.onBeforeCompile = shader => {
      shader.uniforms.uCanalTime = time;
      shader.vertexShader = "varying vec3 vCanalPosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvCanalPosition = (modelMatrix * vec4(position, 1.0)).xyz;");
      shader.fragmentShader = "uniform float uCanalTime; varying vec3 vCanalPosition;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
        #include <normal_fragment_maps>
        vec2 p = vCanalPosition.xz;
        vec3 ripple = vec3(sin(p.x * 1.7 + p.y * 0.8 + uCanalTime * 0.65) * 0.055,
          1.0, cos(p.y * 2.1 - p.x * 0.45 + uCanalTime * 0.5) * 0.045);
        normal = normalize(normal + mat3(viewMatrix) * vec3(ripple.x, 0.0, ripple.z));
      `);
    };
    waterMaterial.customProgramCacheKey = () => "amsterdam-water-v1";
    for (const canal of AMSTERDAM.canals) {
      const shape = new THREE.Shape(canal.polygon.map(p => new THREE.Vector2(p.x, -p.z)));
      const geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geometry, waterMaterial);
      water.name = `amsterdam/water/${canal.name}`;
      water.userData.castShadow = false;
      water.position.y = AMSTERDAM.waterY;
      decoration.add(water);
    }
    const quay = (name, x, z, length, heading) => site(name, x, z, heading, k => {
      if (length < .1) return;
      k.box("masonry", 0, -1.45, 0, length, 3, .85, { color: 0x6e6250, name: "brick-quay-wall" });
      k.box("stone", 0, .08, 0, length, .22, 1.12, { color: 0xbfb6a2, name: "quay-coping" });
      k.solid("quay-railing", 0, .05, length, .45, 1.35, -.05);
      for (const y of [.62, 1.16]) k.box("metal", 0, y, .05, length, .075, .075, { color: 0x2b3c37, name: "canal-iron-rail" });
      const n = Math.max(1, Math.ceil(length / 2.7));
      for (let j = 0; j < n; j++) {
        const along = -length / 2 + j * length / n;
        k.cylinder("metal", along, .64, .05, .065, 1.28, { color: 0x283c37, name: "canal-railing-post" });
        if (!tablet) k.sphere("metal", along, 1.31, .05, .085, .085, .085, { color: 0x283c37, name: "railing-finial" });
      }
    });
    // Coalesce nearly collinear bank facets for masonry/rails, while retaining
    // the exact shoreline for land and water safety. Maximum bow is under 12 cm.
    const quayEdges = [];
    for (const edge of AMSTERDAM.waterBoundary) {
      const previous = quayEdges.at(-1);
      if (previous && Math.hypot(previous.b.x - edge.a.x, previous.b.z - edge.a.z) < 1e-7) {
        const dx = edge.b.x - previous.a.x, dz = edge.b.z - previous.a.z, length = Math.hypot(dx, dz);
        const bow = Math.abs(dx * (edge.a.z - previous.a.z) - dz * (edge.a.x - previous.a.x)) / length;
        if (length <= 8 && bow < .06) { previous.b = edge.b; continue; }
      }
      quayEdges.push({ ...edge });
    }
    for (const [index, { a, b }] of quayEdges.entries()) {
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
      const steps = Math.ceil(length / 8), heading = Math.atan2(-dz, dx);
      for (let j = 0; j < steps; j++) {
        const t = (j + .5) / steps, x = a.x + dx * t, z = a.z + dz * t;
        if (Math.abs(x) > 339 || Math.abs(z) > 339) continue;
        const blocked = AMSTERDAM.bridges.some(bridge => {
          const along = (x - bridge.x) * Math.sin(bridge.heading) + (z - bridge.z) * Math.cos(bridge.heading);
          const across = (x - bridge.x) * Math.cos(bridge.heading) - (z - bridge.z) * Math.sin(bridge.heading);
          return Math.abs(along) < bridge.halfLength + length / steps / 2 && Math.abs(across) < bridge.halfWidth + length / steps / 2 + 1;
        });
        if (!blocked) quay(`curved-quay-${index}-${j}`, x, z, length / steps, heading);
      }
    }
    for (const bridge of AMSTERDAM.bridges) {
      counts.bridges++;
      site(bridge.name, bridge.x, bridge.z, bridge.heading, k => {
        // Keep Float32-transformed edge vertices inside the analytic footprint.
        const w = bridge.halfWidth - .0001, l = bridge.halfLength;
        const y = along => bridge.rise * Math.cos(Math.PI * along / (2 * l)) ** 2;
        const railLength = l - 7.5;
        const segments = Math.ceil(l * 2);
        for (let i = 0; i < segments; i++) {
          const a = -l + i * l * 2 / segments, b = -l + (i + 1) * l * 2 / segments;
          k.panel("stone", [[-w, y(a) + .028, a], [-w, y(b) + .028, b], [w, y(b) + .028, b], [w, y(a) + .028, a]],
            { color: 0xb7ac99, name: "terrain-matched-bridge-deck" });
          for (const side of [-1, 1]) {
            const x = side * (w - .25);
            k.beam("stone", [x, y(a) - .13, a], [x, y(b) - .13, b], .65, .4, { color: 0xad9d85, name: "bridge-edge-stone" });
            if (Math.abs(a) <= railLength && Math.abs(b) <= railLength) {
              if (i % 3 === 0) k.cylinder("metal", x, y(a) + .58, a, .065, 1.15, { color: 0x243d37, name: "bridge-railing-baluster" });
              k.beam("metal", [x, y(a) + 1.16, a], [x, y(b) + 1.16, b], .1, .1, { color: 0x29453d, name: "bridge-arched-handrail" });
            }
          }
        }
        for (const side of [-1, 1]) {
          k.solid("bridge-rail", side * (w - .25), 0, .42, 2 * railLength, 2.2, -.1);
          // Separate stone arch spandrels leave a genuine boat passage below.
          const span = l - 10, points = [[-span, .08], [span, .08], [span, -2.35]];
          for (let j = 0; j <= 16; j++) {
            const t = j / 16 * Math.PI;
            points.push([Math.cos(t) * span, -2.35 + Math.sin(t) * 2.4]);
          }
          k.extrude("masonry", points, .7, side * (w - .4), 0, 0, { color: 0x81634c, ry: Math.PI / 2, name: "open-masonry-bridge-arch" });
          for (const end of [-1, 1]) {
            k.box("stone", side * (w - .5), -.9, end * (span + .6), 1.2, 2.7, 1.6, { color: 0xa29780, name: "bridge-abutment" });
          }
        }
        k.sign(bridge.kind === "drawbridge" ? "MAGERE BRUG" : bridge.name.split(" at ")[0].toUpperCase(), 0, -.5, -l + 9.8, 6.5, .72,
          { ry: Math.PI, name: "bridge-name-plaque" });
        if (bridge.kind === "drawbridge") {
          for (const end of [-1, 1]) for (const side of [-1, 1]) {
            const x = side * 7.8, z = end * 8;
            k.box("paint", x, 4.1, z, .7, 8, .85, { color: 0xe9e2ca, name: "magere-brug-white-tower" });
            k.beam("paint", [x, 7.8, z - end * 5], [x, 7.8, z + end * 6], .65, .75, { color: 0xf3ead6, name: "drawbridge-balance-beam" });
            k.beam("metal", [x, 7.7, z - end * 5], [x, 1.15, end * 1.6], .075, .075, { color: 0x263735, name: "drawbridge-suspension-chain" });
            k.box("paint", x, 7.5, z + end * 5.6, 1.2, 1.05, 1.6, { color: 0xd9d4bf, name: "drawbridge-counterweight" });
            k.solid("drawbridge-post", x, z, .8, .9, 8.1);
          }
          for (const end of [-1, 1]) {
            k.box("paint", 0, 7.4, end * 8, 16.5, .65, .65, { color: 0xeee6d2, name: "drawbridge-overhead-crossbeam" });
            k.beam("paint", [-7.8, 7.7, end * 8], [0, 9.2, end * 8], .3, .4, { color: 0xe9e2ca, name: "drawbridge-gabled-bracing" });
            k.beam("paint", [7.8, 7.7, end * 8], [0, 9.2, end * 8], .3, .4, { color: 0xe9e2ca, name: "drawbridge-gabled-bracing" });
          }
        }
      });
    }
  }

  function buildHouses() {
    const palette = [0x8e5140, 0x614a42, 0x424b49, 0xae8156, 0xa55746, 0xb09b77, 0xc7c2b1, 0x725646];
    const shops = ["DE KOFFIEKAMER", "BOEKHANDEL", "BAKKERIJ", "BLOEMEN & PLANTEN", "CAFE DE GRACHT", "FIETSENMAKER"];
    const palace = AMSTERDAM.landmarks.find(p => p.id === "palace");
    const reserved = [...AMSTERDAM.landmarks, { x: palace.x, z: palace.z - 28, w: 104, d: 24 }];
    const plots = [];
    let serial = 0;
    const clear = (x, z, w, d) => {
      if (reserved.some(p => Math.abs(x - p.x) < (w + p.w) / 2 + 3 && Math.abs(z - p.z) < (d + p.d) / 2 + 3)) return false;
      for (const dx of [-w / 2, 0, w / 2]) for (const dz of [-d / 2, 0, d / 2]) {
        if (!isAmsterdamDry(x + dx, z + dz, 1) || terrain.roadDistance(x + dx, z + dz) < 10.3) return false;
      }
      return true;
    };
    function house(x, z, w, d, heading, i) {
      const c = Math.abs(Math.cos(heading)), s = Math.abs(Math.sin(heading));
      if (!clear(x, z, c * w + s * d, s * w + c * d)) return;
      const axes = [{ x: Math.cos(heading), z: -Math.sin(heading) }, { x: Math.sin(heading), z: Math.cos(heading) }];
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
        x: x + axes[0].x * a * w / 2 + axes[1].x * b * d / 2,
        z: z + axes[0].z * a * w / 2 + axes[1].z * b * d / 2,
      }));
      // Adjacent tangent-aligned houses may have overlapping bounding boxes,
      // but their actual foundations must not overlap across the narrow islands.
      if (plots.some(plot => [...axes, ...plot.axes].every(axis => {
        const a = corners.map(p => p.x * axis.x + p.z * axis.z), b = plot.corners.map(p => p.x * axis.x + p.z * axis.z);
        return Math.max(...a) > Math.min(...b) - .2 && Math.max(...b) > Math.min(...a) - .2;
      }))) return;
      plots.push({ axes, corners });
      counts.houses++;
      site(`canal-house-${i}`, x, z, heading, k => {
        const floors = 3 + (i % 4 === 0 ? 1 : 0), h = floors * 3.45 + 1.3 + i % 3 * .35;
        const brick = palette[i % palette.length], trim = i % 3 === 0 ? 0xd4c8ad : 0xe3dcca;
        const roof = [0x414c4c, 0x62554b, 0x515755][i % 3], f = d / 2;
        k.building("canal-house", 0, 0, w, d, h + w * .42);
        k.box("masonry", 0, h / 2, 0, w, h, d, { color: brick, name: "narrow-brick-house" });
        k.box("stone", 0, .38, 0, w + .12, .75, d + .1, { color: 0x8c8574, name: "stone-basement-plinth" });
        k.box("stone", 0, h - .13, 0, w + .28, .32, d + .25, { color: trim, name: "projecting-cornice" });
        const gh = w * .45;
        k.extrude("roof", [[-w / 2 - .2, 0], [w / 2 + .2, 0], [0, gh * .85]], d + .2, 0, h, 0,
          { color: roof, name: "steep-tiled-roof" });
        const kind = i % 4;
        const outline = kind === 0
          ? [[-.5, 0], [.5, 0], [.5, .18], [.34, .18], [.34, .43], [.21, .43], [.21, .69], [.1, .69], [.1, 1], [-.1, 1], [-.1, .69], [-.21, .69], [-.21, .43], [-.34, .43], [-.34, .18], [-.5, .18]]
          : kind === 1 ? [[-.5, 0], [.5, 0], [.49, .15], [.37, .26], [.29, .47], [.23, .8], [.17, .95], [0, 1.04], [-.17, .95], [-.23, .8], [-.29, .47], [-.37, .26], [-.49, .15]]
          : kind === 2 ? [[-.5, 0], [.5, 0], [.46, .2], [.24, .37], [.18, .5], [.18, .94], [.22, .94], [.22, 1], [-.22, 1], [-.22, .94], [-.18, .94], [-.18, .5], [-.24, .37], [-.46, .2]]
          : [[-.5, 0], [.5, 0], [0, 1]];
        const points = outline.map(([px, py]) => [px * w, py * gh]);
        k.extrude("masonry", points, .4, 0, h, f + .05, { color: brick, name: ["stepped-gable", "bell-gable", "neck-gable", "pointed-gable"][kind] });
        for (let j = 1; j < points.length; j++) {
          const a = points[j], b = points[(j + 1) % points.length];
          k.beam("stone", [a[0], h + a[1], f + .3], [b[0], h + b[1], f + .3], .15, .18, { color: trim, name: "carved-gable-coping" });
        }
        k.box("stone", 0, h + gh * .35, f + .3, 1.2, 1.55, .2, { color: trim, name: "attic-window-surround" });
        k.box("glass", 0, h + gh * .35, f + .43, .93, 1.3, .12, { color: 0x334c50, name: "attic-window" });
        k.beam("wood", [0, h + gh * .78, f - .5], [0, h + gh * .78, f + 1.35], .2, .24,
          { color: 0x303a34, name: "traditional-hoisting-beam" });
        k.beam("metal", [0, h + gh * .78, f + 1.25], [0, h + gh * .78 - .5, f + 1.25], .035, .035,
          { color: 0x363f37, name: "hoist-rope" });
        k.torus("metal", 0, h + gh * .78 - .55, f + 1.25, .13, .035, { color: 0x303a34, name: "hoist-hook" });
        const columns = w > 9.3 ? 3 : 2, shop = i % 7 === 0;
        for (let floor = 0; floor < floors; floor++) for (let col = 0; col < columns; col++) {
          const wx = (col - (columns - 1) / 2) * w / (columns + .45), wy = 2 + floor * 3.45;
          if (floor === 0 && (col === 0 || shop)) continue;
          const ww = Math.min(1.75, w / columns * .57), wh = 2.25;
          k.box("stone", wx, wy, f + .13, ww + .22, wh + .26, .2, { color: trim, name: "sash-window-frame" });
          k.box((i + floor + col) % 13 === 0 ? "light" : "glass", wx, wy, f + .26, ww, wh, .1,
            { color: (i + floor + col) % 13 === 0 ? 0xc4a06c : 0x334e53, name: "recessed-window-glazing" });
          k.box("wood", wx, wy, f + .34, .075, wh, .065, { color: trim, name: "window-mullion" });
          k.box("wood", wx, wy + .18, f + .34, ww, .08, .065, { color: trim, name: "window-transom" });
          k.box("stone", wx, wy - wh / 2 - .08, f + .26, ww + .45, .16, .55, { color: trim, name: "projecting-window-sill" });
          if (!tablet) {
            k.box("wood", wx, wy - .53, f + .34, ww, .055, .06, { color: trim, name: "fine-sash-bar" });
            for (const side of [-1, 1]) k.box("paint", wx + side * (ww / 2 + .3), wy - .45, f + .08, .34, 1.4, .1,
              { color: 0x385147, name: "dutch-shutter" });
          }
          if (floor === 1 && col === 0 && i % 5 === 0) {
            k.box("wood", wx, wy - 1.2, f + .5, ww + .3, .3, .48, { color: 0x38584b, name: "window-flower-box" });
            for (let j = 0; j < 4; j++) flower(k, wx - .6 + j * .4, wy - .96, f + .51, j + i);
          }
        }
        const doorX = -w * .27;
        k.box("stone", doorX, 1.55, f + .12, 1.85, 3, .24, { color: trim, name: "entrance-surround" });
        k.box("paint", doorX, 1.52, f + .28, 1.48, 2.73, .12, { color: i % 2 ? 0x2c4847 : 0x374144, name: "painted-front-door" });
        for (const y of [.85, 1.8]) k.box("wood", doorX, y, f + .36, 1.05, .6, .04,
          { color: 0x445b50, name: "recessed-door-panel" });
        k.box("glass", doorX, 2.68, f + .37, 1.15, .3, .05, { color: 0x8b9b91, name: "door-transom-light" });
        k.sphere("metal", doorX + .49, 1.32, f + .43, .06, .06, .07, { color: 0xbfa46a, name: "brass-door-knob" });
        for (let step = 0; step < 2; step++) k.box("stone", doorX, .08 + step * .12, f + .85 - step * .3, 1.95, .16, .7,
          { color: 0xbdb4a0, name: "front-stoop" });
        k.box("masonry", w * .23, h + gh * .6, -d * .23, 1, 2.1, 1.1, { color: brick, name: "brick-chimney" });
        k.box("stone", w * .23, h + gh * .6 + 1.08, -d * .23, 1.25, .18, 1.35, { color: trim, name: "chimney-cap" });
        if (!tablet) for (let j = 1; j < 7; j++) {
          const xx = (j / 7 - .5) * w;
          k.beam("roof", [xx, h + gh * .85 * (1 - Math.abs(xx) * 2 / w) + .05, -f],
            [xx, h + gh * .85 * (1 - Math.abs(xx) * 2 / w) + .05, f - .25], .055, .055,
            { color: 0x818174, name: "roof-tile-seam" });
        }
        if (shop) {
          k.box("wood", w * .13, 1.5, f + .12, w * .6, 2.8, .2, { color: 0x3b5046, name: "shopfront-joinery" });
          k.box("glass", w * .13, 1.52, f + .25, w * .56, 2.4, .14, { color: 0x54726b, name: "shop-display-window" });
          k.sign(shops[Math.floor(i / 7) % shops.length], 0, 3.75, f + .38, w * .88, .72,
            { name: "hand-lettered-shop-sign", background: i % 2 ? "#384f46" : "#803f35" });
          for (let j = 0; j < 8; j++) k.box("paint", (j - 3.5) * w / 8, 3.07, f + 1.05, w / 8 + .01, .1, 1.6,
            { color: j % 2 ? 0xe1d8bc : i % 2 ? 0x557a69 : 0xa35948, rx: .18, name: "striped-shop-awning" });
          if (counts.cafes < 10) { cafe(k, w * .1, f + 3.1, i); counts.cafes++; }
        } else if (i % 4 === 0) k.sign(String(17 + i), doorX - 1.12, 2.25, f + .27, .5, .36, { name: "house-number" });
        for (const y of [3.65, h - .7]) k.box("stone", 0, y, f + .07, w, .12, .16, { color: trim, name: "facade-string-course" });
        if (i % 3 === 0) {
          k.box("wood", -w / 2 + .17, h / 2, f + .23, .1, h, .12, { color: 0x4c5a4c, name: "rainwater-downpipe" });
          k.cone("wood", w * .31, .27, f + .7, .32, .5, { color: 0x9a6c4e, rx: Math.PI, name: "terracotta-doorstep-pot" });
          k.sphere("foliage", w * .31, .68, f + .7, .45, .58, .43, { color: 0x67815b, name: "doorstep-plant" });
        }
      });
    }
    for (const canal of AMSTERDAM.canals.slice(0, 3)) for (const side of [-1, 1]) {
      const row = offsetPath(canal.points, side * 46), length = amsterdamPathLength(row);
      for (let distance = 45; distance < length - 42;) {
        const i = serial++, w = [8.6, 9.4, 10.4, 8.9, 10.8][i % 5];
        const p = sampleAmsterdamPath(row, distance + w / 2);
        house(p.x, p.z, w, 12, p.heading + (side > 0 ? Math.PI : 0), i);
        distance += w + 1.2;
      }
    }
    for (const street of AMSTERDAM.streets.filter(s => !s.name.includes("Quay"))) for (const side of [-1, 1]) {
      const row = offsetPath(street.points, side * 24), length = amsterdamPathLength(row);
      for (let distance = 12; distance < length - 12; distance += 12) {
        const p = sampleAmsterdamPath(row, distance);
        house(p.x, p.z, 9.8, 13, p.heading + (side > 0 ? Math.PI : 0), serial++);
      }
    }
  }

  function buildStreetLife() {
    const marketCanal = AMSTERDAM.canals[0], marketStart = amsterdamPathLength(marketCanal.points) * .65;
    for (const canal of AMSTERDAM.canals.filter(c => c.points)) for (const side of [-1, 1]) {
      const length = amsterdamPathLength(canal.points);
      for (let distance = 42, index = 0; distance < length - 35; distance += 48, index++) {
        const { x, z, heading } = sampleAmsterdamPath(canal.points, distance, side * (canal.width / 2 + 4));
        if (terrain.roadDistance(x, z) < 8.1 || !isAmsterdamDry(x, z, .7)) continue;
        site(`quayside-${canal.name}-${side}-${index}`, x, z, heading + (side > 0 ? 0 : Math.PI), k => {
          tree(k, 0, 0, index);
          const p = coordinates(7, 0);
          if (terrain.roadDistance(p.x, p.z) > 8 && isAmsterdamDry(p.x, p.z, 1)) {
            lamp(k, 7, 0);
            bicycle(k, 4.5, -.9, index);
            if (index % 3 === 0) bench(k, -5, .5);
          }
        }, true);
      }
      if (canal.name === "Amstel") continue;
      let placed = 0;
      for (let distance = 75 + (side > 0 ? 25 : 0); distance < length - 45 && placed < 4; distance += 64) {
        if (canal === marketCanal && side > 0 && distance > marketStart - 15 && distance < marketStart + 80) continue;
        const { x, z, heading } = sampleAmsterdamPath(canal.points, distance, side * (canal.width / 2 - 3.3));
        if (AMSTERDAM.bridges.some(b => Math.hypot(b.x - x, b.z - z) < b.halfWidth + 18)) continue;
        const i = placed++;
        site(`houseboat-${canal.name}-${side}-${i}`, x, z, heading + (side > 0 ? 0 : Math.PI),
          k => boat(k, false, i + (side > 0 ? 1 : 0)), true);
      }
    }
    for (const [i, canal] of AMSTERDAM.canals.slice(0, 3).entries()) {
      const length = amsterdamPathLength(canal.points);
      for (let distance = length * .43; distance < length - 35; distance += 25) {
        if (canal === marketCanal && distance > marketStart - 20 && distance < marketStart + 85) continue;
        const { x, z, heading } = sampleAmsterdamPath(canal.points, distance);
        if (AMSTERDAM.bridges.some(b => Math.hypot(x - b.x, z - b.z) < Math.hypot(b.halfLength, b.halfWidth) + 12)) continue;
        site(`glass-roof-tour-boat-${i}`, x, z, heading, k => boat(k, true, i), true);
        break;
      }
    }
    // Floating flower stalls sit inside the canal, with a pedestrian deck behind
    // the quayside guardrail. The driving lane remains fully open.
    for (let i = 0; i < 7; i++) {
      const p = sampleAmsterdamPath(marketCanal.points, marketStart + i * 10.2, marketCanal.width / 2 - 3);
      site(`bloemenmarkt-${i}`, p.x, p.z, p.heading, k => {
      counts.marketStalls++;
      k.box("wood", 0, -.22, 0, 9.5, .35, 5.6, { color: 0x766452, name: "floating-flower-market-deck" });
      k.box("wood", 0, 1.1, -1.5, 8.6, 2.6, 2.2, { color: 0x355b4c, name: "flower-stall-timber-cabin" });
      k.extrude("roof", [[-4.7, 0], [4.7, 0], [0, 1.5]], 4.8, 0, 2.5, -.4,
        { color: 0x435f53, name: "flower-market-pitched-roof" });
      k.box("wood", 0, .55, 1.1, 8.2, 1.15, 1.3, { color: 0xb69a68, name: "flower-display-counter" });
      for (let j = 0; j < (tablet ? 8 : 15); j++) {
        const x = -3.6 + j % (tablet ? 4 : 5) * (tablet ? 2.3 : 1.7), z = .7 + Math.floor(j / (tablet ? 4 : 5)) * .45;
        k.cylinder("wood", x, 1.25, z, .23, .35, { color: 0x9b7652, name: "tulip-bucket" });
        for (let n = 0; n < 3; n++) flower(k, x + (n - 1) * .13, 1.45, z, i + j);
      }
      k.sign(i === 3 ? "BLOEMENMARKT" : ["TULPEN", "FLOWER BULBS", "TULIPS & SEEDS"][i % 3], 0, 2.24, 1.62, 7.6, .65,
        { name: "flower-market-sign", background: "#3d6253" });
      }, true);
    }
    const station = AMSTERDAM.landmarks.find(p => p.id === "centraal");
    site("stationsplein", station.x, station.z - 26, 0, k => {
      for (const x of [-42, 105, 135]) {
        k.box("metal", x, .12, 0, 8, .2, 1, { color: 0x465651, name: "station-bicycle-rack-base" });
        for (let i = 0; i < (tablet ? 4 : 7); i++) bicycle(k, x - 3 + i, 0, i + 4);
        lamp(k, x + 5, 1);
      }
      for (const x of [-55, -32, 32, 55]) {
        bench(k, x, 0);
        k.cylinder("metal", x + 3, .55, 0, .34, 1.1, { color: 0x3f5249, name: "street-litter-bin" });
      }
    }, true);
    const palace = AMSTERDAM.landmarks.find(p => p.id === "palace");
    site("dam-square", palace.x, palace.z - 28, 0, k => {
      k.box("stone", 0, .035, 0, 104, .07, 18, { color: 0xc5bdaa, name: "dam-square-paving" });
      for (const x of [-40, -30, 30, 40]) {
        k.box("stone", x, .4, 0, 3.4, .8, 3.4, { color: 0xaaa68f, name: "square-planter" });
        k.sphere("foliage", x, 1.25, 0, 1.6, 1.1, 1.6, { color: 0x657f57, name: "square-topiary" });
        k.solid("square-planter", x, 0, 3.4, 3.4, 1);
      }
    }, true);
    // A blue-and-cream tram at the station terminus, clear of the playable road.
    site("amsterdam-tram", 120, 246, Math.PI / 2, k => {
      for (const dz of [-.8, .8]) k.box("metal", 0, .035, dz, 27, .06, .07, { color: 0x696e66, name: "tram-rail" });
      for (const x of [-6.4, 0, 6.4]) {
        k.box("paint", x, 1.65, 0, 6.1, 2.8, 2.6, { color: 0xe1d9bf, name: "tram-carriage" });
        k.box("paint", x, .77, 0, 6.2, .7, 2.64, { color: 0x326993, name: "blue-tram-livery" });
        for (const side of [-1, 1]) {
          for (const dx of [-1.9, -.6, .8, 2.1]) k.box("glass", x + dx, 2.2, side * 1.33, 1.05, 1.15, .06,
            { color: 0x3e6068, name: "tram-passenger-window" });
          for (const dx of [-1.9, 1.9]) k.torus("metal", x + dx, .44, side * 1.13, .36, .09, { color: 0x3f4641, name: "tram-wheel" });
        }
        k.building("parked-tram", x, 0, 6.2, 2.6, 3.1);
      }
      for (const x of [-3.2, 3.2]) k.box("wood", x, 1.7, 0, .3, 2.55, 2.3, { color: 0x4b5550, name: "tram-articulation" });
      for (const side of [-1, 1]) {
        k.beam("metal", [side * 1.8, 3.1, 0], [0, 4.65, 0], .09, .09, { color: 0x394b44, name: "tram-pantograph" });
      }
      k.sign("2  CENTRAAL STATION", 5.8, 2.93, 1.37, 5.2, .35, { name: "tram-destination-display", background: "#293f3c", ink: "#f3da9b" });
    }, true);
  }

  function flower(k, x, y, z, i) {
    k.beam("foliage", [x, y, z], [x, y + .28, z], .025, .025, { color: 0x587641, name: "tulip-stem" });
    k.sphere("paint", x, y + .32, z, .11, .14, .1, { color: [0xca5a59, 0xe3b455, 0xc98d9e, 0xe5d8bd, 0xa273a0][i % 5], name: "tulip-flower" });
  }

  function cafe(k, x, z, i) {
    for (const dx of [-1.8, 1.8]) {
      k.cylinder("wood", x + dx, .76, z, .58, .08, { color: 0xa78358, name: "cafe-round-table" });
      k.cylinder("metal", x + dx, .37, z, .05, .74, { color: 0x33483d, name: "cafe-table-pedestal" });
      for (const side of [-1, 1]) {
        k.box("wood", x + dx + side * .85, .48, z, .46, .08, .47, { color: 0x9b7d54, name: "cafe-chair-seat" });
        k.box("wood", x + dx + side * 1.03, .83, z, .07, .45, .47, { color: 0x9b7d54, name: "cafe-chair-back" });
        for (const dz of [-.18, .18]) k.beam("metal", [x + dx + side * .85, .48, z + dz], [x + dx + side * .93, .05, z + dz], .045, .045,
          { color: 0x3b4b40, name: "cafe-chair-leg" });
      }
      k.cylinder("stone", x + dx, .9, z, .065, .17, { color: 0xe6dec8, name: "coffee-cup" });
    }
    k.cylinder("wood", x, 1.35, z, .045, 2.7, { color: 0x8c7957, name: "cafe-parasol-pole" });
    k.cone("paint", x, 2.67, z, 2.65, .65, { color: i % 2 ? 0xc9bb94 : 0x9c5b4b, name: "cafe-parasol" });
  }

  function tree(k, x, z, i) {
    const h = 8.8 + i % 4 * .65;
    k.cylinder("wood", x, 2.6, z, .24, 5.2, { color: 0x665d44, name: "canal-elm-trunk" });
    for (let j = 0; j < 4; j++) {
      const a = j * Math.PI / 2 + i, dx = Math.cos(a), dz = Math.sin(a);
      k.beam("wood", [x, 3.4, z], [x + dx * 1.8, h - 2, z + dz * 1.8], .14, .14,
        { color: 0x716750, name: "elm-spreading-branch" });
    }
    const n = tablet ? 5 : 9;
    for (let j = 0; j < n; j++) {
      const a = j * 2.4, radius = j === 0 ? 0 : 1.8;
      k.sphere("foliage", x + Math.cos(a) * radius, h - 1.2 + Math.sin(j * 1.7) * 1.1, z + Math.sin(a) * radius,
        2.3, 2.5, 2.2, { color: [0x617b52, 0x7b905c, 0x6c8657, 0x849866][(i + j) % 4], name: "deciduous-elm-canopy" });
    }
    const obstacle = k.solid("elm-trunk", x, z, .48, .48, 5.5);
    const record = { x: obstacle.x, y: obstacle.y, z: obstacle.z, w: 2.5, h };
    treeInfo.push(record); ownedTrees.add(record); counts.trees++;
    k.box("metal", x, .065, z, 1.25, .08, 1.25, { color: 0x555e4a, name: "square-tree-grate" });
  }

  function lamp(k, x, z) {
    counts.lights++;
    // The pooled downlight sits just outside the opaque post and below the glazing.
    const point = coordinates(x + .28, z);
    group.userData.nightLights.push({ position: [point.x, AMSTERDAM.landY + 4.35, point.z],
      color: 0xffc786, intensity: 75, distance: 22 });
    k.cylinder("metal", x, .22, z, .19, .44, { color: 0x2b4438, name: "lantern-cast-iron-base" });
    k.cylinder("metal", x, 2.45, z, .073, 4.8, { color: 0x2b4438, name: "historic-street-lamp" });
    k.box("light", x, 4.68, z, .38, .54, .38, { color: 0xe5cfa0, name: "warm-lantern-glazing" });
    for (const dx of [-.22, .22]) for (const dz of [-.22, .22]) k.beam("metal", [x + dx, 4.35, z + dz], [x + dx * .8, 4.96, z + dz * .8], .04, .04,
      { color: 0x2a4135, name: "lantern-corner-frame" });
    k.cone("metal", x, 5.09, z, .35, .28, { color: 0x2a4135, name: "lantern-roof" });
    k.sphere("metal", x, 5.3, z, .075, .12, .075, { color: 0x2a4135, name: "lantern-finial" });
  }

  function bench(k, x, z) {
    counts.benches++;
    for (let j = 0; j < 4; j++) k.box("wood", x, .51, z - .27 + j * .18, 2.25, .09, .14,
      { color: 0x95835e, name: "bench-seat-slat" });
    for (let j = 0; j < 3; j++) k.box("wood", x, .77 + j * .16, z + .36, 2.25, .12, .09,
      { color: 0x95835e, name: "bench-back-slat" });
    for (const side of [-1, 1]) {
      k.beam("metal", [x + side * .8, .03, z - .2], [x + side * .8, .52, z + .18], .07, .07,
        { color: 0x354c3e, name: "bench-iron-leg" });
      k.beam("metal", [x + side * .8, .03, z + .34], [x + side * .8, 1.13, z + .38], .07, .07,
        { color: 0x354c3e, name: "bench-back-support" });
    }
  }

  function bicycle(k, x, z, i) {
    counts.bicycles++;
    const frame = [0x3e6860, 0x9a5a42, 0x4f6470, 0x2e3932, 0xc2b383][i % 5];
    for (const dx of [-.61, .61]) {
      k.torus("wood", x + dx, .4, z, .35, .042, { color: 0x293832, name: "bicycle-tire" });
      k.torus("metal", x + dx, .4, z, .305, .017, { color: 0xa6ad9a, name: "bicycle-wheel-rim" });
      for (let j = 0; j < (tablet ? 3 : 6); j++) {
        const a = j * Math.PI / (tablet ? 3 : 6);
        k.beam("metal", [x + dx - Math.cos(a) * .3, .4 - Math.sin(a) * .3, z],
          [x + dx + Math.cos(a) * .3, .4 + Math.sin(a) * .3, z], .012, .012,
          { color: 0xacb4a1, name: "bicycle-spoke" });
      }
    }
    const a = [x - .61, .4, z], b = [x - .13, .43, z], c = [x - .26, .94, z], d = [x + .37, .96, z], e = [x + .61, .4, z];
    for (const [p, q] of [[a, b], [b, c], [c, a], [c, d], [d, b], [d, e]]) k.beam("paint", p, q, .04, .04,
      { color: frame, name: "dutch-bicycle-diamond-frame" });
    k.box("wood", x - .27, 1.02, z, .29, .07, .21, { color: 0x584d37, name: "bicycle-saddle" });
    k.beam("metal", [x + .37, .96, z], [x + .35, 1.18, z], .03, .03, { color: 0xa0ab97, name: "bicycle-handlebar-stem" });
    k.beam("metal", [x + .35, 1.18, z - .22], [x + .35, 1.18, z + .22], .03, .03,
      { color: 0xa0ab97, name: "bicycle-handlebar" });
    k.box("metal", x - .13, .43, z, .18, .05, .37, { color: 0x475e4a, name: "bicycle-pedals" });
    if (i % 3 === 0) {
      k.box("wood", x + .64, .99, z, .37, .26, .38, { color: 0xa89165, name: "bicycle-wicker-basket" });
      k.box("wood", x + .64, 1.13, z, .3, .02, .31, { color: 0x665f44, name: "basket-open-top" });
    }
  }

  function boat(k, touring, i) {
    if (touring) counts.tourBoats++; else counts.houseboats++;
    const y = AMSTERDAM.waterY - AMSTERDAM.landY, length = touring ? 10 : 8.6, width = touring ? 1.65 : 2.05;
    k.extrude("metal", [[-length, -width * .55], [-length + 1, -width], [length - 1.7, -width], [length, 0],
      [length - 1.7, width], [-length + 1, width], [-length, width * .55]], .6, 0, y + .29, 0,
      { color: touring ? 0xd4d7c9 : [0x304c45, 0x6e5140, 0x51666a][i % 3], rx: -Math.PI / 2, name: "boat-shaped-hull" });
    k.box("wood", -.2, y + .63, 0, length * 1.65, .12, width * 1.82, { color: 0xb7a47f, name: "boat-timber-deck" });
    if (touring) {
      k.box("glass", 0, y + 1.35, 0, 14.8, 1.35, 2.85, { color: 0x749e9c, name: "tour-boat-panoramic-glazing" });
      for (let j = 0; j < 8; j++) {
        const a = j / 8 * Math.PI, b = (j + 1) / 8 * Math.PI;
        k.panel("glass", [[-7.4, y + 1.9 + Math.sin(a) * .65, Math.cos(a) * 1.48], [7.4, y + 1.9 + Math.sin(a) * .65, Math.cos(a) * 1.48],
          [7.4, y + 1.9 + Math.sin(b) * .65, Math.cos(b) * 1.48], [-7.4, y + 1.9 + Math.sin(b) * .65, Math.cos(b) * 1.48]],
          { color: 0x86aba4, name: "tour-boat-curved-glass-roof" });
      }
      for (let x = -6.8; x < 7; x += 1.7) for (const side of [-1, 1]) k.beam("paint", [x, y + .7, side * 1.48], [x, y + 2.02, side * 1.48], .065, .065,
        { color: 0xdbdcc7, name: "tour-boat-window-rib" });
      k.sign("AMSTERDAM CANAL CRUISES", 0, y + 1.06, width + .02, 10.5, .43,
        { background: "#34615d", name: "canal-cruise-sign" });
    } else {
      k.box("wood", -.7, y + 1.61, 0, 11.6, 1.85, 3.35, { color: i % 2 ? 0x849483 : 0xc5b9a0, name: "houseboat-cabin" });
      for (const side of [-1, 1]) for (let j = 0; j < 5; j++) {
        const x = -5.1 + j * 2.15;
        k.box("stone", x, y + 1.73, side * 1.7, 1.7, 1.28, .13, { color: 0xded7bf, name: "houseboat-window-surround" });
        k.box("glass", x, y + 1.73, side * 1.79, 1.48, 1.04, .07, { color: 0x425f62, name: "houseboat-window" });
      }
      k.box("roof", -.7, y + 2.6, 0, 12.2, .18, 3.85, { color: 0x555e50, name: "houseboat-flat-roof" });
      k.cylinder("metal", -4, y + 3.08, -.6, .12, .95, { color: 0x4a4c3e, name: "houseboat-stove-chimney" });
      k.box("wood", 6.2, y + .95, 0, 1.6, .55, 1.9, { color: 0x8f8061, name: "houseboat-deck-bench" });
      for (const x of [-5, 3]) {
        k.box("wood", x, y + 2.83, 1, 1.5, .36, .6, { color: 0x6c7355, name: "houseboat-roof-planter" });
        for (let j = 0; j < 4; j++) flower(k, x - .5 + j * .32, y + 3.03, 1, i + j);
      }
      for (const x of [-6.7, 6.7]) {
        k.beam("wood", [x, y + .7, width], [x + .7, .15, 3.6], .04, .04, { color: 0xb6a57b, name: "boat-mooring-rope" });
        k.torus("wood", x, y + .4, width, .24, .07, { color: 0x303e37, name: "boat-tire-fender" });
      }
    }
  }

  function buildHorizon() {
    site("flat-dutch-horizon", 0, 0, 0, k => {
      for (const [x, z, w, d] of [[-670, -361, 660, 1278], [670, -361, 660, 1278], [0, -670, 680, 660], [0, 775, 2000, 650]]) {
        k.box("stone", x, -.15, z, w, .2, d, { color: 0x929e92, name: "flat-urban-surround" });
      }
      for (let i = 0; i < 64; i++) {
        const x = -780 + i * 25, h = 10 + i * 7 % 19;
        for (const z of [-405 - i % 3 * 28, 490 + i % 4 * 30]) {
          k.box("masonry", x, h / 2, z, 19, h, 28, { color: [0x817364, 0x6f7770, 0x958271, 0x737c75][i % 4], name: "distant-warehouse" });
          k.extrude("roof", [[-10, 0], [10, 0], [0, 6]], 29, x, h, z, { color: 0x626c67, name: "distant-gabled-roof" });
        }
      }
    }, true);
  }
}
