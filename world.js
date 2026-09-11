import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { inClearing } from "./landmarks.js";

const noiseGLSL = /* glsl */ `
  float landscapeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float landscapeNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(landscapeHash(i), landscapeHash(i + vec2(1., 0.)), f.x),
      mix(landscapeHash(i + vec2(0., 1.)), landscapeHash(i + 1.), f.x), f.y);
  }
`;

// The course owns the playable hills; distant relief blends out from its edge.
export function terrainHeight(x, z, level = "forest", terrain) {
  const boundary = (terrain?.halfSize ?? (level === "forest" ? 620 : level === "city" ? 320 : 290)) + 20;
  const edge = THREE.MathUtils.smoothstep(Math.max(Math.abs(x), Math.abs(z)), boundary, boundary + 180);
  const base = terrain?.heightAt(x, z) ?? 0;
  if (edge === 0) return base;
  const ridge = Math.pow(Math.abs(Math.sin(x * 0.006 + Math.cos(z * 0.004) * 1.7)), 1.7);
  const detail = Math.sin(x * 0.019 + z * 0.012) * 24 + Math.sin(z * 0.034 - x * 0.027) * 13
    + Math.abs(Math.sin(x * 0.022 + z * 0.017) * Math.sin(z * 0.023 - x * 0.011)) * 38;
  const coast = level === "moon" ? 0 : THREE.MathUtils.smoothstep(x, boundary + 60, boundary + 230)
    * (1 - THREE.MathUtils.smoothstep(Math.abs(z + 120), 180, 470));
  const distant = (26 + ridge * (level === "moon" ? 105 : 170) + detail) * (1 - coast) - coast * 10;
  return THREE.MathUtils.lerp(base, distant, edge);
}

export function createLandscape({ scene, ground, level, roadDist, route, obstacles, treeInfo, buildingInfo, tablet = false, terrain, clearings = [] }) {
  let seed = 57021;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const forest = level === "forest", moon = level === "moon";
  const halfSize = terrain?.halfSize ?? (forest ? 620 : level === "city" ? 320 : 290);
  const heightAt = (x, z) => terrain?.heightAt(x, z) ?? 0;
  const group = new THREE.Group();
  group.name = "landscape/" + level;
  scene.add(group);
  const time = { value: 0 };
  const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

  function surface(material, strength = 0.18) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = "varying vec3 vLandscapePosition;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\nvLandscapePosition = (modelMatrix * vec4(position, 1.0)).xyz;");
      shader.fragmentShader = "varying vec3 vLandscapePosition;\n" + noiseGLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", /* glsl */ `
        #include <map_fragment>
        float broad = landscapeNoise(vLandscapePosition.xz * 0.055);
        float fine = landscapeNoise(vLandscapePosition.xz * 1.7);
        diffuseColor.rgb *= 1.0 + (broad - 0.5) * ${strength.toFixed(2)} + (fine - 0.5) * 0.09;
      `);
    };
    material.customProgramCacheKey = () => "landscape-surface-" + strength;
  }
  if (forest || level === "stunt") {
    ground.material.color.set(forest ? 0x829a76 : 0x9ca28f);
    surface(ground.material, 0.65);
  }

  // Four joined strips leave a real hole, so no backdrop triangle can cut
  // through the main ground or a road, even on the enlarged forest course.
  const boundary = halfSize + 20, outer = Math.max(1100, boundary + 460);
  const segments = tablet ? 80 : 128, rings = tablet ? 28 : 46;
  const vertices = [], indices = [];
  for (let side = 0; side < 4; side++) {
    const start = vertices.length / 3;
    for (let ring = 0; ring <= rings; ring++) for (let j = 0; j <= segments; j++) {
      const radius = boundary + (outer - boundary) * ring / rings, along = (j / segments * 2 - 1) * radius;
      const x = side === 0 ? along : side === 1 ? radius : side === 2 ? -along : -radius;
      const z = side === 0 ? -radius : side === 1 ? along : side === 2 ? radius : -along;
      vertices.push(x, terrainHeight(x, z, level, terrain), z);
      if (ring < rings && j < segments) {
        const a = start + ring * (segments + 1) + j, b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const relief = new THREE.BufferGeometry();
  relief.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  relief.setIndex(indices);
  const position = relief.attributes.position;
  relief.computeVertexNormals();
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color(), moss = new THREE.Color(moon ? 0x727986 : 0x68796b);
  const stone = new THREE.Color(moon ? 0xa8acb7 : 0x93958c), snow = new THREE.Color(0xd8dfd9);
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), slope = 1 - relief.attributes.normal.getY(i);
    color.copy(moss).lerp(stone, THREE.MathUtils.clamp(slope * 3 + y / 260, 0, 1));
    if (!moon) color.lerp(snow, THREE.MathUtils.smoothstep(y + Math.sin(position.getX(i) * 0.037) * 12, 152, 208));
    color.multiplyScalar(0.86 + random() * 0.14).toArray(colors, i * 3);
  }
  relief.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const terrainMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.96 });
  surface(terrainMaterial, 0.3);
  const mountains = new THREE.Mesh(relief, terrainMaterial);
  mountains.name = "landscape/continuous-mountain-relief";
  group.add(mountains);

  if (!moon) {
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x365f60, roughness: 0.18, metalness: 0.58 });
    waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uLandscapeTime = time;
      shader.vertexShader = "varying vec3 vWater;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvWater = (modelMatrix * vec4(position, 1.)).xyz;");
      shader.fragmentShader = "varying vec3 vWater;\nuniform float uLandscapeTime;\n" + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", /* glsl */ `
        #include <normal_fragment_maps>
        vec2 wave = vec2(sin(vWater.x * 1.4 + vWater.z * .9 + uLandscapeTime * .7),
          cos(vWater.z * 1.8 - vWater.x * .6 + uLandscapeTime * .5));
        normal = normalize(normal + vec3(wave.x, wave.y, 0.) * .09);
      `);
    };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1900), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(boundary + 810, -0.15, -120);
    water.name = "landscape/distant-tidal-water";
    group.add(water);
  }

  // Spatial instancing keeps detailed silhouettes inexpensive and cullable.
  const batches = new Map(), transform = new THREE.Object3D();
  const cellSize = tablet ? 160 : 128;
  function instance(name, geometry, material, x, y, z, sx, sy, sz, ry = 0, rx = 0, shade = 1) {
    const key = name + "/" + Math.floor(x / cellSize) + "/" + Math.floor(z / cellSize);
    if (!batches.has(key)) batches.set(key, { geometry, material, matrices: [], shades: [] });
    transform.position.set(x, y, z); transform.scale.set(sx, sy, sz);
    transform.rotation.set(rx, ry, 0, "YXZ"); transform.updateMatrix();
    batches.get(key).matrices.push(transform.matrix.clone());
    batches.get(key).shades.push(shade);
  }
  function wind(material, amount, foliage = false) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLandscapeTime = time;
      shader.vertexShader = "uniform float uLandscapeTime;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", /* glsl */ `
        #include <begin_vertex>
        vec3 anchor = (instanceMatrix * vec4(position, 1.)).xyz;
        float gust = sin(anchor.x * .09 + anchor.z * .07 + uLandscapeTime * .85);
        transformed.x += gust * ${amount.toFixed(3)} * ${foliage ? "(uv.y + .15)" : "pow(max(position.y, 0.), 1.7)"};
        transformed.z += cos(uLandscapeTime * .63 + anchor.x * .065) * ${ (amount * 0.4).toFixed(3)} * max(position.y, 0.);
      `);
    };
    material.customProgramCacheKey = () => "landscape-wind-" + amount + "-" + foliage;
  }

  const occupied = (x, z, margin = 0) => inClearing(clearings, x, z, margin) ||
    buildingInfo.some(b => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin);
  if (forest) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const c = canvas.getContext("2d");
    function branch(x, y, length, angle, depth) {
      const ex = x + Math.cos(angle) * length, ey = y + Math.sin(angle) * length;
      c.strokeStyle = depth > 1 ? "#6d7050" : "#768260";
      c.lineWidth = depth > 1 ? 2 : 1.15;
      c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.stroke();
      for (let n = 0; n < 12; n++) {
        const f = n / 12, px = x + (ex - x) * f, py = y + (ey - y) * f;
        for (const side of [-1, 1]) {
          const a = angle + side * .72;
          if (depth > 0 && n % 2 === 0) branch(px, py, length * (1 - f) * .43, a, depth - 1);
          else {
            const needle = 5 + random() * 10;
            c.strokeStyle = ["#829366", "#a4ab7a", "#5b7857", "#bbc393"][Math.floor(random() * 4)];
            c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a) * needle, py + Math.sin(a) * needle); c.stroke();
          }
        }
      }
    }
    branch(128, 244, 222, -Math.PI / 2, 2);
    const needles = new THREE.CanvasTexture(canvas);
    needles.colorSpace = THREE.SRGBColorSpace;
    const leaf = new THREE.MeshStandardMaterial({ color: 0x82a68e, map: needles, alphaTest: .32, side: THREE.DoubleSide, roughness: .92 });
    wind(leaf, .065, true);
    const bark = new THREE.MeshStandardMaterial({ color: 0x5f5949, roughness: 1 });
    const trunk = new THREE.CylinderGeometry(.07, .24, 1, 9);
    const frond = new THREE.PlaneGeometry(1, 1, 1, 2).translate(0, .5, 0);
    let count = 0;
    const target = tablet ? 650 : 900;
    for (let i = 0; i < target * 8 && count < target; i++) {
      const index = Math.floor((i % target) / target * route.length);
      const p = route[index], next = route[(index + 1) % route.length];
      const dx = next.x - p.x, dz = next.z - p.z, length = Math.hypot(dx, dz) || 1;
      const offset = (random() < .5 ? -1 : 1) * (10 + random() * (i % 5 === 4 ? 130 : 30));
      const along = (random() - .5) * 8;
      const x = p.x + (-dz * offset + dx * along) / length, z = p.z + (dx * offset + dz * along) / length;
      if (Math.max(Math.abs(x), Math.abs(z)) > halfSize - 6) continue;
      const dist = roadDist(x, z);
      if (dist < 10 || occupied(x, z, 6)) continue;
      // Open meadow windows between irregular groves, not a uniform plantation.
      if (Math.sin(x * .043) + Math.cos(z * .038) > .85 && dist > 20) continue;
      const base = heightAt(x, z), h = 12 + random() * 16, w = 2.8 + random() * 2.3;
      treeInfo.push({ x, y: base, z, h, w });
      obstacles.push({ x, y: base, z, r: .32, height: h * .9 });
      instance("trunks", trunk, bark, x, base + h * .45, z, 1, h * .9, 1, random() * 6.28, 0, .8 + random() * .35);
      const tiers = tablet ? 9 : 12;
      for (let tier = 0; tier < tiers; tier++) {
        const f = tier / tiers, y = base + h * (.19 + f * .75), radius = w * (1 - f * .91);
        for (let j = 0; j < 6; j++) {
          const a = j * Math.PI / 3 + tier * 2.4 + random() * .4;
          instance("needles", frond, leaf, x, y + random() * .5, z,
            radius * 1.2, radius * 1.8, 1, a, 1.06 + random() * .25, .58 + f * .27 + random() * .18);
          if (!tablet && tier < 8) instance("needles", frond, leaf, x, y + .45, z,
            radius * 1.1, radius * 1.6, 1, a + .45, .64, .65 + random() * .25);
        }
      }
      count++;
    }
    group.userData.trees = count;
  }

  if (forest || level === "stunt") {
    const bladePositions = [], bladeColors = [];
    const baseColor = new THREE.Color(0x46533a), tipColor = new THREE.Color(0xa5aa70);
    for (let blade = 0; blade < 7; blade++) {
      const a = random() * Math.PI * 2, x = (random() - .5) * .65, z = (random() - .5) * .65;
      const h = .45 + random() * .65, width = .025 + random() * .018;
      const points = [];
      for (let j = 0; j <= 3; j++) {
        const t = j / 3, bend = t * t * .32, w = width * (1 - t);
        for (const side of [-1, 1]) points.push([x + Math.cos(a) * w * side + Math.sin(a) * bend, t * h, z + Math.sin(a) * w * side + Math.cos(a) * bend]);
      }
      for (let j = 0; j < 3; j++) for (const index of [j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 2, j * 2 + 1, j * 2 + 3]) {
        bladePositions.push(...points[index]);
        color.copy(baseColor).lerp(tipColor, points[index][1] / h).toArray(bladeColors, bladeColors.length);
      }
    }
    const blades = new THREE.BufferGeometry();
    blades.setAttribute("position", new THREE.Float32BufferAttribute(bladePositions, 3));
    blades.setAttribute("color", new THREE.Float32BufferAttribute(bladeColors, 3));
    blades.computeVertexNormals();
    const grass = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    wind(grass, .2);
    const count = tablet ? 8500 : 17000;
    for (let i = 0; i < count; i++) {
      const p = route[Math.floor(random() * route.length)];
      const spread = i < count * .8 ? 36 : 180;
      const x = p.x + (random() - .5) * spread, z = p.z + (random() - .5) * spread;
      if (Math.max(Math.abs(x), Math.abs(z)) > halfSize - 1) continue;
      const dist = roadDist(x, z);
      if (dist < 6.9 || occupied(x, z, 1.2)) continue;
      const size = .55 + random() * .7;
      instance("meadow", blades, grass, x, heightAt(x, z) + .01, z, size, size * .75, size, random() * 6.28, 0, .8 + random() * .3);
    }
  }

  if (forest) {
    const rawRock = new THREE.IcosahedronGeometry(1, 3);
    rawRock.deleteAttribute("normal");
    rawRock.deleteAttribute("uv");
    const rock = mergeVertices(rawRock);
    rawRock.dispose();
    const rp = rock.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
      const r = 1 + Math.sin(x * 7 + y * 4) * .08 + Math.cos(z * 9 - x * 5) * .06;
      rp.setXYZ(i, x * r, y * r, z * r);
    }
    rock.computeVertexNormals();
    let top = 0;
    for (let i = 0; i < rp.count; i++) top = Math.max(top, .32 + rp.getY(i) * .65 * Math.cos(.15) - rp.getZ(i) * .85 * Math.sin(.15));
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x92968a, roughness: .94 });
    for (let i = 0; i < 100; i++) {
      const p = route[Math.floor(i / 100 * route.length)];
      const x = p.x + (random() - .5) * 160, z = p.z + (random() - .5) * 160;
      const size = .8 + random() * 3.2;
      if (Math.max(Math.abs(x), Math.abs(z)) > halfSize - size * 1.12
        || roadDist(x, z) < 8 + size * 1.12 || occupied(x, z, size + 1)) continue;
      const base = heightAt(x, z);
      instance("weathered-stone", rock, rockMaterial, x, base + size * .32, z, size, size * .65, size * .85, random() * 6.28, .15, .7 + random() * .35);
      obstacles.push({ x, y: base, z, r: size * 1.12, height: size * top });
    }
  }

  for (const [name, batch] of batches) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    mesh.name = "landscape/" + name;
    batch.matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setScalar(batch.shades[i]));
    });
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 1;
    mesh.receiveShadow = true;
    mesh.castShadow = !name.startsWith("meadow");
    group.add(mesh);
  }
  return {
    group,
    animate(t) { time.value = reducedMotion?.matches ? 0 : t; },
  };
}
