import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { stadiumRoute, createRampCourse, createLevelScenery, decorateForest, decorateCity, decorateStuntPark } from "./levels.js";
import { createJumpPhysics } from "./jumps.js";
import { createConeField } from "./cones.js";
import { createPlaythings } from "./playthings.js";
import { createPeopleField } from "./people.js";
import { createFriendAdventure } from "./friends.js";
import { createModifier } from "./modifier-ui.js";
import { createGaragePreview } from "./modifier-preview.js";
import { moveWithBounces } from "./collision.js";
import {
  tabletProfile,
  pixelBudget,
  adaptiveScale,
  bindDrivingInput,
} from "./tablet.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";

export async function main(loading) {
  await loading.phase(0, "Packing a little atmosphere...");
  const device = tabletProfile({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    coarse: matchMedia("(any-pointer: coarse)").matches,
  });
  document.body.classList.toggle("touch-device", device.touch);
  const boostLabel = "Boost";
  const requestedLevel = new URLSearchParams(location.search).get("level");
  const level = ["forest", "city", "stunt", "moon"].includes(requestedLevel) ? requestedLevel : "forest";
  const isCity = level === "city", isMoon = level === "moon", isStunt = level === "stunt";
  const hasRamps = isMoon || isStunt;
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: !device.tablet,
    preserveDrawingBuffer: false,
  });
  renderer.setSize(innerWidth, innerHeight);
  let resolutionScale = 1;
  const applyPixelRatio = () =>
    renderer.setPixelRatio(
      device.tablet
        ? pixelBudget(innerWidth, innerHeight, devicePixelRatio) *
            resolutionScale
        : Math.min(devicePixelRatio, 1.25),
    );
  applyPixelRatio();
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.body.prepend(renderer.domElement);
  renderer.domElement.classList.add("game-canvas");
  let contextLost = false;
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    loading.fail(new Error("Graphics paused. Reload to resume your drive."));
  });
  const camera = new THREE.PerspectiveCamera(
    55,
    innerWidth / innerHeight,
    0.1,
    800,
  );
  const load = new THREE.TextureLoader();
  const [env, groundTex, groundNorm, groundRough] = await Promise.all([
    isMoon ? null : new RGBELoader().loadAsync("forest.hdr"),
    hasRamps ? canvasTex(512, (c,n) => {
      c.fillStyle = isMoon ? "#a8a9b1" : "#7c9677"; c.fillRect(0,0,n,n);
      let state = 91;
      const noise = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
      for (let i=0;i<16000;i++) { c.fillStyle = "rgba(35,40,48," + noise()*0.2 + ")"; c.fillRect(noise()*n,noise()*n,1+noise()*2,1+noise()*2); }
    }) : load.loadAsync("forest-Diffuse.jpg"),
    null,
    null,
  ]);
  await loading.phase(1, isMoon ? "Moving a few craters into place..." : isCity ? "Waking up the neighborhood..." : isStunt ? "Giving the ramps a little extra bounce..." : "Planting a few happy little trees...");
  if (env) env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = env;
  scene.background = new THREE.Color(0xabbdb5);
  scene.backgroundBlurriness = 0;
  scene.environmentIntensity = 0.85;
  scene.backgroundIntensity = 0.8;
  scene.fog = new THREE.Fog(0xabbdb5, 95, 240);
  camera.far = isMoon ? 650 : 270;
  camera.updateProjectionMatrix();
  for (let t of [groundTex, groundNorm, groundRough].filter(Boolean)) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(85, 85);
    t.anisotropy = Math.min(
      device.tablet ? 2 : 8,
      renderer.capabilities.getMaxAnisotropy(),
    );
  }
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const sun = new THREE.DirectionalLight(isMoon ? 0xffffff : 0xffedce, isMoon ? 3.2 : 2.5);
  sun.position.set(-60, 75, -45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -65,
    right: 65,
    top: 65,
    bottom: -65,
    far: 240,
  });
  sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xdce8ff, isMoon ? 0x545967 : 0x414328, isMoon ? 1 : 0.5));
  const mat = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  function mesh(geo, material, parent = scene, x = 0, y = 0, z = 0) {
    let m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function box(w, h, d, m, p, x, y, z) {
    return mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.16),
      m,
      p,
      x,
      y,
      z,
    );
  }
  let seed = 12;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const route = [];
  for (let i = 0; i < 240; i++) {
    let t = (i / 240) * Math.PI * 2;
    route.push(
      new THREE.Vector3(
        Math.sin(t) * (80 + 12 * Math.sin(t * 3)),
        0.025,
        Math.cos(t) * 100,
      ),
    );
  }
  if (hasRamps) stadiumRoute(route);
  function roadDist(x, z) {
    if (isCity) {
      let best = Infinity;
      for (let v = -150; v <= 150; v += 50)
        best = Math.min(best, Math.abs(x - v), Math.abs(z - v));
      return best;
    }
    let best = 1e9;
    for (let p of route) best = Math.min(best, (x - p.x) ** 2 + (z - p.z) ** 2);
    return Math.sqrt(best);
  }
  if (isCity) {
    for (let i = 0; i < 240; i++) {
      let edge = Math.floor(i / 60),
        t = (i % 60) / 60;
      let coords = [
        [-100 + 200 * t, 100],
        [100, 100 - 200 * t],
        [100 - 200 * t, -100],
        [-100, -100 + 200 * t],
      ][edge];
      route[i].set(coords[0], 0.025, coords[1]);
    }
  }
  const groundmat = mat(hasRamps ? 0xffffff : 0x4b5834, {
    map: groundTex,
    normalMap: groundNorm,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughnessMap: groundRough,
  });
  let ground = mesh(new THREE.PlaneGeometry(700, 700), groundmat);
  ground.rotation.x = -Math.PI / 2;
  // Fine sand and small stones, generated once as a repeating surface texture.
  function canvasTex(size, paint) {
    let c = document.createElement("canvas");
    c.width = c.height = size;
    paint(c.getContext("2d"), size);
    let t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const dirtTex = canvasTex(512, (c, s) => {
    c.fillStyle = "#575b60";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 50000; i++) {
      let v = 65 + rnd() * 45;
      c.fillStyle = `rgba(${v},${v + 2},${v + 4},${0.2 + rnd() * 0.5})`;
      let r = 0.3 + rnd() * 1.7;
      c.fillRect(rnd() * s, rnd() * s, r, r);
    }
    for (let x of [155, 355]) {
      let g = c.createLinearGradient(x - 34, 0, x + 34, 0);
      g.addColorStop(0, "#0000");
      g.addColorStop(0.5, "#20242a20");
      g.addColorStop(1, "#0000");
      c.fillStyle = g;
      c.fillRect(x - 34, 0, 68, s);
    }
  });
  dirtTex.repeat.set(1, 60);
  const roadmat = mat(0xffffff, {
    map: dirtTex,
    bumpMap: dirtTex,
    bumpScale: 0.045,
    roughness: 0.94,
    side: THREE.DoubleSide,
  });
  // Shared mitered vertices keep both edges continuous, including city corners.
  const edge = (i, offset) => {
    const p = route[i], prev = route[(i + 239) % 240], next = route[(i + 1) % 240];
    const ax = p.x - prev.x, az = p.z - prev.z, al = Math.hypot(ax, az);
    const bx = next.x - p.x, bz = next.z - p.z, bl = Math.hypot(bx, bz);
    let nx = -az / al - bz / bl, nz = ax / al + bx / bl;
    const length = Math.hypot(nx, nz); nx /= length; nz /= length;
    const miter = offset / Math.max(0.5, nx * -bz / bl + nz * bx / bl);
    return [p.x + nx * miter, p.z + nz * miter];
  };
  const ribbon = (left, right, height, parity = null) => {
    const positions = [], uvs = [];
    for (let i = 0; i < 240; i++) {
      if (parity !== null && i % 2 !== parity) continue;
      const j = (i + 1) % 240;
      const points = [edge(i, left), edge(i, right), edge(j, left), edge(j, left), edge(i, right), edge(j, right)];
      for (const p of points) positions.push(p[0], height, p[1]);
      uvs.push(0, i / 240, 1, i / 240, 0, (i + 1) / 240, 0, (i + 1) / 240, 1, i / 240, 1, (i + 1) / 240);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  };
  const rg = ribbon(-5.8, 5.8, 0.075);
  const routeMesh = mesh(rg, roadmat);
  for (let parity = 0; parity < 2; parity++) {
    const strips = [ribbon(-6.5, -5.65, 0.10, parity), ribbon(5.65, 6.5, 0.10, parity)];
    mesh(mergeGeometries(strips), mat(parity ? 0xf8f6ed : 0xe33443, { side: THREE.DoubleSide }));
    strips.forEach((g) => g.dispose());
  }
  const barkTex = canvasTex(256, (c, s) => {
    c.fillStyle = "#55483c";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) {
      let v = 25 + rnd() * 65;
      c.fillStyle = `rgb(${v + 12},${v + 5},${v})`;
      c.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 3, 5 + rnd() * 55);
    }
  });
  barkTex.repeat.set(2, 3);
  const bark = mat(0x9a9183, {
    map: barkTex,
    bumpMap: barkTex,
    bumpScale: 0.15,
  });
  const needle = canvasTex(256, (c, s) => {
    c.clearRect(0, 0, s, s);
    c.strokeStyle = "#6d6544";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(128, 256);
    c.lineTo(128, 8);
    c.stroke();
    for (let i = 0; i < 1000; i++) {
      let y = rnd() * 245,
        width = 85 * (0.25 + (0.75 * y) / 256),
        x = 128 + (rnd() - 0.5) * width * 2;
      let v = 35 + rnd() * 55;
      c.strokeStyle = `rgb(${v * 0.75},${v + 18},${v * 0.65})`;
      c.lineWidth = 0.7 + rnd();
      c.beginPath();
      c.moveTo(128, y + 20);
      c.lineTo(x, y - 5 - rnd() * 18);
      c.stroke();
    }
  });
  const leaves = mat(0xb2ba8b, {
    map: needle,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.94,
  });
  const obstacles = [],
    treeInfo = [],
    trunks = [],
    fronds = [],
    stones = [];
  const dummy = new THREE.Object3D();
  function bake(geo, list, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    list.push(geo.clone().applyMatrix4(dummy.matrix));
  }
  const tg = new THREE.CylinderGeometry(0.15, 0.32, 1, 7),
    fg = new THREE.PlaneGeometry(1, 1),
    rockgeo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < (isCity || hasRamps ? 0 : 420); i++) {
    let x = (rnd() - 0.5) * 390,
      z = (rnd() - 0.5) * 390;
    if (roadDist(x, z) < 8) continue;
    let h = 10 + rnd() * 13,
      w = 2 + rnd() * 2;
    obstacles.push({ x, z, r: 0.55 });
    treeInfo.push({ x, z, h, w });
    bake(tg, trunks, x, h / 2, z, 1, h, 1);
    for (let level = 0; level < 9; level++) {
      let y = 3 + (level * (h - 4)) / 9,
        rad = w * (1 - level / 11);
      for (let j = 0; j < 5; j++) {
        let a = (j * Math.PI * 2) / 5 + level * 1.7 + rnd() * 0.6;
        let r = rad * 0.48;
        bake(
          fg,
          fronds,
          x + Math.sin(a) * r,
          y,
          z + Math.cos(a) * r,
          rad * 1.8,
          2.5,
          1,
          -0.4,
          a,
          0,
        );
      }
    }
  }
  for (let i = 0; i < (isCity || hasRamps ? 0 : 110); i++) {
    let x = (rnd() - 0.5) * 300,
      z = (rnd() - 0.5) * 300;
    if (roadDist(x, z) < 7) continue;
    let r = 0.35 + rnd() * 1.1;
    bake(rockgeo, stones, x, r * 0.5, z, r, r * 0.65, r, 0, rnd() * 6, 0);
    obstacles.push({ x, z, r });
  }
  function merged(list, material) {
    if (!list.length) return;
    // Spatial batches let the camera discard forest outside the visible area.
    const chunks = new Map();
    for (let geo of list) {
      geo.computeBoundingBox();
      let c = geo.boundingBox.getCenter(new THREE.Vector3()),
        key =
          Math.floor(c.x / (isCity ? 110 : 40)) +
          "," +
          Math.floor(c.z / (isCity ? 110 : 40));
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(geo);
    }
    for (let batch of chunks.values()) {
      let g = mergeGeometries(batch);
      g.computeBoundingSphere();
      mesh(g, material);
      batch.forEach((g) => g.dispose());
    }
  }
  merged(trunks, bark);
  merged(fronds, leaves);
  merged(stones, mat(0x777c66, { roughness: 1 }));
  // Clumps of undergrowth and grass catch indirect light along the road verge.
  const grassGeo = [];
  for (let i = 0; i < (isCity || hasRamps ? 0 : 2100); i++) {
    let p = route[Math.floor(rnd() * 240)],
      x = p.x + (rnd() - 0.5) * 40,
      z = p.z + (rnd() - 0.5) * 40;
    if (roadDist(x, z) < 6.5) continue;
    let h = 0.15 + rnd() * 0.6;
    for (let j = 0; j < 3; j++) {
      let geo = new THREE.BufferGeometry();
      let a = rnd() * 6.28,
        w = 0.05 + rnd() * 0.05;
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            x - w,
            0,
            z,
            x + w,
            0,
            z,
            x + Math.sin(a) * 0.2,
            h,
            z + Math.cos(a) * 0.2,
          ],
          3,
        ),
      );
      geo.computeVertexNormals();
      grassGeo.push(geo);
    }
  }
  merged(grassGeo, mat(0x59643b, { side: THREE.DoubleSide }));

  const buildingInfo = [];
  if (isCity) {
    scene.background.set(0xb9cad5);
    if (scene.fog) scene.fog.color.set(0xb9cad5);
    const asphalt = canvasTex(256, (c, n) => {
      c.fillStyle = "#474c51";
      c.fillRect(0, 0, n, n);
      for (let i = 0; i < 18000; i++) {
        let v = 48 + rnd() * 48;
        c.fillStyle = `rgb(${v},${v + 3},${v + 5})`;
        c.fillRect(rnd() * n, rnd() * n, 1, 1);
      }
    });
    asphalt.repeat.set(90, 90);
    groundmat.map = asphalt;
    groundmat.normalMap = null;
    groundmat.roughnessMap = null;
    groundmat.color.set(0xffffff);
    routeMesh.visible = true;
    const concrete = mat(0xa7aaa6),
      curb = mat(0xc3c1b5),
      white = mat(0xe4dfc9),
      yellow = mat(0xd9a83c),
      steel = mat(0x374753);
    const facadeMaps = [];
    for (let k = 0; k < 4; k++)
      facadeMaps.push(
        canvasTex(256, (c, n) => {
          c.fillStyle = ["#a8a6a0", "#6d7f8c", "#b69d89", "#747d80"][k];
          c.fillRect(0, 0, n, n);
          for (let y = 8; y < 256; y += 32)
            for (let x = 8; x < 256; x += 32) {
              c.fillStyle = rnd() < 0.2 ? "#d3c8a1" : "#354e60";
              c.fillRect(x, y, 18, 23);
              c.fillStyle = "#93a8ad";
              c.fillRect(x + 2, y + 2, 3, 18);
              c.fillStyle = "#242e34";
              c.fillRect(x, y + 23, 20, 2);
            }
        }),
      );
    const awnings = [mat(0x844d3b), mat(0x496d6a), mat(0xb59450)];
    const planter = mat(0x6b4a34);
    const signColors = [mat(0x2a8f7a), mat(0xb34a6b), mat(0x3d6bb5), mat(0xd98f2e), mat(0xe05d48)];
    const bloomColors = [mat(0xf26fd2), mat(0xffc64d), mat(0x67c8f1), mat(0xa4e86a)];
    const buildingMaterials = facadeMaps.map((t) =>
      mat(0xffffff, { map: t, roughness: 0.8 }),
    );
    const cityBatches = new Map();
    function cityBox(w, h, d, m, x, y, z) {
      let geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(x, y, z);
      if (!cityBatches.has(m)) cityBatches.set(m, []);
      cityBatches.get(m).push(geo);
    }
    for (let x = -125; x <= 125; x += 50)
      for (let z = -125; z <= 125; z += 50) {
        cityBox(36, 0.22, 36, concrete, x, 0.11, z);
        cityBox(37, 0.12, 37, curb, x, 0.06, z);
        let w = 22 + rnd() * 8,
          d = 22 + rnd() * 8,
          h = 12 + rnd() * 48;
        let material = buildingMaterials[Math.floor(rnd() * 4)];
        cityBox(w, h, d, material, x, h / 2 + 0.22, z);
        cityBox(w + 1, 0.6, d + 1, steel, x, h + 0.52, z);
        cityBox(w * 0.3, 1.4, d * 0.22, concrete, x, h + 1.4, z);
        obstacles.push({ x, z, hx: w / 2, hz: d / 2, r: Math.hypot(w, d) / 2 });
        buildingInfo.push({ x, z, w, d, h });
        // Street-level storefronts and awnings on the road-facing facade.
        cityBox(w * 0.7, 2.8, 0.15, steel, x, 1.8, z + d / 2 + 0.1);
        cityBox(
          w * 0.8,
          0.16,
          1.4,
          awnings[Math.floor(rnd() * 3)],
          x,
          3.3,
          z + d / 2 + 0.6,
        );
        // Flower boxes and a bright shop sign make every facade playful.
        cityBox(w * 0.9, 0.14, 0.9, planter, x, 4.1, z + d / 2 + 0.75);
        cityBox(0.5, 0.42, 0.62, bloomColors[Math.floor(rnd() * 4)], x, 4.34, z + d / 2 + 0.75);
        cityBox(0.9, 0.52, 0.12, signColors[Math.floor(rnd() * 5)], x, 5.5, z + d / 2 + 0.06);
      }
    for (let road = -150; road <= 150; road += 50) {
      for (let v = -165; v <= 165; v += 9) {
        if (Math.abs(((v + 175) % 50) - 25) < 9) continue;
        cityBox(3, 0.02, 0.14, yellow, v, 0.052, road);
        cityBox(0.14, 0.02, 3, yellow, road, 0.054, v);
      }
      for (let cross = -150; cross <= 150; cross += 50) {
        for (let n = -4; n <= 4; n += 2) {
          cityBox(1.1, 0.02, 5, white, cross + n, 0.06, road + 10);
          cityBox(5, 0.02, 1.1, white, cross + 10, 0.06, road + n);
        }
      }
    }
    for (let x = -150; x <= 150; x += 50)
      for (let z = -125; z <= 125; z += 50) {
        cityBox(0.18, 6, 0.18, steel, x + 8, 3, z);
        cityBox(2.5, 0.18, 0.35, steel, x + 7, 6, z);
        cityBox(0.7, 0.12, 0.4, white, x + 6, 5.88, z);
        obstacles.push({ x: x + 8, z, r: 0.22 });
        cityBox(1.2, 0.65, 2.1, curb, x + 10, 0.4, z + 7);
        obstacles.push({ x: x + 10, z: z + 7, hx: 0.6, hz: 1.05, r: 1.2 });
      }
    for (const [m, list] of cityBatches) merged(list, m);
  }
  const staticObjects = scene.children.filter((o) => o.isMesh);
  const ramps = hasRamps ? createRampCourse(scene, route, isMoon) : [];
  if (hasRamps) createLevelScenery(scene, isMoon, roadDist, obstacles);
  let forestAnim = null;
  if (!isCity && !hasRamps) forestAnim = decorateForest(scene, roadDist);
  if (isCity) decorateCity(scene, rnd);
  if (isStunt) decorateStuntPark(scene, rnd);
  if (isMoon) {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.65;
    room.dispose(); pmrem.dispose();
  }
  const jumpPhysics = hasRamps ? createJumpPhysics(ramps, isMoon ? 3.2 : 9.82) : null;
  // Porsche GT3 RS by Ddiaz Design, CC BY-NC-SA 4.0. See CREDITS.md.
  const car = new THREE.Group();
  scene.add(car);
  // Only the visual group visits the garage; driving position and heading stay here.
  const carVisual = new THREE.Group();
  car.add(carVisual);
  const paint = new THREE.MeshStandardMaterial({
      color: 0xc60920,
      metalness: 0.12,
      roughness: 0.26,
      side: THREE.DoubleSide,
    }),
    dark = mat(0x111318),
    metal = mat(0xaeb4b6, { metalness: 0.9, roughness: 0.25 });
  await loading.phase(2, "Polishing your getaway car...");
  const gltf = await new GLTFLoader().loadAsync("porsche-gt3-rs.glb");
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(model),
    size = bounds.getSize(new THREE.Vector3());
  const factor = 4.6 / Math.max(size.x, size.z);
  model.scale.multiplyScalar(factor);
  model.updateMatrixWorld(true);
  bounds.setFromObject(model);
  let center = bounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= bounds.min.y;
  model.updateMatrixWorld(true);
  // Bake transforms and merge matching materials to avoid thousands of draw calls.
  const parts = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    let m = o.material;
    const name = m.name || "";
    if (name.includes("Paint_Material")) m = paint;
    else {
      m = m.clone();
      if (name.includes("Window")) {
        m.color.set(0x25313b);
        m.metalness = 0.35;
        m.roughness = 0.1;
        m.transparent = false;
        m.opacity = 1;
        if ("transmission" in m) m.transmission = 0;
      }
      if (name.includes("RED_GLASS")) {
        m.color.set(0x9e0010);
        m.emissive.set(0xff0310);
        m.emissiveIntensity = 1.3;
        m.transparent = false;
        m.opacity = 1;
      }
      m.side = THREE.DoubleSide;
    }
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geo.computeBoundingBox();
    let gc = geo.boundingBox.getCenter(new THREE.Vector3());
    let isWheel = name.includes("_Wheel1A_");
    let key =
      m === paint
        ? "paint"
        : name + (isWheel ? ":" + Math.sign(gc.x) + ":" + Math.sign(gc.z) : "");
    if (!parts.has(key)) parts.set(key, { m, geos: [], isWheel });
    if (geo.index) geo = geo.toNonIndexed();
    for (let a of Object.keys(geo.attributes))
      if (!["position", "normal", "uv"].includes(a)) geo.deleteAttribute(a);
    if (!geo.attributes.uv)
      geo.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          new Float32Array(geo.attributes.position.count * 2),
          2,
        ),
      );
    parts.get(key).geos.push(geo);
  });
  const wheels = [];
  for (let { m, geos, isWheel } of parts.values()) {
    let geo = mergeGeometries(geos);
    geo = mergeVertices(geo, 1e-5);
    if (isWheel) {
      geo.computeBoundingBox();
      let c = geo.boundingBox.getCenter(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
      let pivot = new THREE.Group();
      pivot.position.copy(c);
      carVisual.add(pivot);
      let spin = mesh(geo, m, pivot);
      wheels.push({
        pivot,
        tire: spin,
        hub: new THREE.Group(),
        front: c.z > 0,
      });
    } else mesh(geo, m, carVisual);
    geos.forEach((g) => g.dispose());
  }
  const gates = [];
  const gateMat = mat(0xe5c96c, { metalness: 0.3, roughness: 0.5 });
  for (let i = 0; i < 8; i++) {
    let p = route[i * 30],
      n = route[(i * 30 + 1) % 240],
      g = new THREE.Group();
    g.position.copy(p);
    g.rotation.y = Math.atan2(n.x - p.x, n.z - p.z);
    scene.add(g);
    for (let x of [-5, 5]) {
      box(0.1, 1.9, 0.1, metal, g, x, 0.95, 0);
      box(0.43, 0.22, 0.1, gateMat, g, x, 1.75, 0);
    }
    gates.push(g);
  }

  // A fixed rear rocket housing and an emissive plume, included in the traced scene.
  const rocket = new THREE.Group();
  rocket.position.set(0, 0.65, -2.85);
  carVisual.add(rocket);
  let housing = mesh(
    new THREE.CylinderGeometry(0.28, 0.34, 0.65, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x727b82, metalness: 0.8, roughness: 0.32, side: THREE.DoubleSide }),
    rocket,
  );
  housing.rotation.x = Math.PI / 2;
  let throat = mesh(
    new THREE.CylinderGeometry(0.30, 0.30, 0.12, 24),
    dark,
    rocket,
    0,
    0,
    0.18,
  );
  throat.rotation.x = Math.PI / 2;
  // A rim and recessed throat keep the open bore readable from the rear.
  mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 24), metal, rocket, 0, 0, -0.325);
  const flame = new THREE.Group();
  rocket.add(flame);
  flame.visible = false;
  const fireOuter = mat(0xff4910, {
    emissive: 0xff3000,
    emissiveIntensity: 7,
    roughness: 1,
  });
  const fireInner = mat(0xffedaf, {
    emissive: 0xffcc56,
    emissiveIntensity: 15,
  });
  let outer = mesh(
    new THREE.ConeGeometry(0.27, 2.4, 16),
    fireOuter,
    flame,
    0,
    0,
    -1.5,
  );
  outer.rotation.x = -Math.PI / 2;
  let inner = mesh(
    new THREE.ConeGeometry(0.17, 1.5, 16),
    fireInner,
    flame,
    0,
    0,
    -1.08,
  );
  inner.rotation.x = -Math.PI / 2;
  const boostButton = document.getElementById("boost");
  const boostText = boostButton.querySelector("[data-label]");
  let sceneDirty = true,
    boostEnds = 0,
    recovering = false,
    boosting = false;
  function activateBoost() {
    if (modifier.active) return;
    if (modifier.config.rocket === "none") {
      show("Add a rocket in the 🛠 CAR panel to boost!");
      return;
    }
    if (paused || boosting || recovering) return;
    boosting = true;
    sceneDirty = true;
    boostEnds = performance.now() + 5000 * Math.max(0.2, modifier.tuning.boostTime || 1);
    flame.visible = true;
    boostButton.disabled = true;
    show("ROCKET BOOST · 5 SECONDS");
  }
  boostButton.onclick = activateBoost;

  const fill = new THREE.RectAreaLight(0xffe6d2, 3, 12, 12);
  fill.position.set(-12, 10, 108);
  fill.lookAt(car.position);
  scene.add(fill);

  await loading.phase(3, isMoon ? "Hanging the Earth in the sky..." : "Letting a little sunshine in...");
  // One-time procedural lighting bake; no ray tracing or live shadow maps.
  let bakedShadow, carShadow;
  const atlasSize = device.tablet ? 1024 : 2048,
    worldSize = 700;
  const atlas = document.createElement("canvas");
  atlas.width = atlas.height = atlasSize;
  const ctx = atlas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, atlasSize, atlasSize);
  const px = (x) => (x / worldSize + 0.5) * atlasSize;
  // Ground UVs have north at the top of the atlas.
  function oval(x, z, rx, rz, angle, opacity) {
    ctx.save();
    ctx.translate(px(x), px(z));
    ctx.rotate(angle);
    ctx.scale((rx / worldSize) * atlasSize, (rz / worldSize) * atlasSize);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, `rgba(21,32,23,${opacity})`);
    g.addColorStop(0.5, `rgba(21,32,23,${opacity * 0.7})`);
    g.addColorStop(1, "rgba(21,32,23,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  for (const t of treeInfo) {
    oval(t.x, t.z, t.w * 1.4, t.w * 1.4, 0, 0.4);
    for (let n = 1; n <= 5; n++) {
      let f = n / 5;
      oval(
        t.x + t.h * 0.8 * f,
        t.z + t.h * 0.6 * f,
        t.w * (1.1 - f * 0.65),
        t.w * (1.1 - f * 0.65),
        0,
        0.22,
      );
    }
  }
  for (const b of buildingInfo) {
    ctx.save();
    ctx.fillStyle = "rgba(21,32,40,.3)";
    ctx.beginPath();
    const dx = b.h * 0.8,
      dz = b.h * 0.6;
    ctx.moveTo(px(b.x - b.w / 2), px(b.z - b.d / 2));
    ctx.lineTo(px(b.x + b.w / 2), px(b.z - b.d / 2));
    ctx.lineTo(px(b.x + b.w / 2 + dx), px(b.z + b.d / 2 + dz));
    ctx.lineTo(px(b.x - b.w / 2 + dx), px(b.z + b.d / 2 + dz));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (const o of obstacles)
    if (o.hx === undefined) oval(o.x, o.z, o.r * 2, o.r * 2, 0, 0.3);
  bakedShadow = new THREE.CanvasTexture(atlas);
  bakedShadow.colorSpace = THREE.SRGBColorSpace;
  bakedShadow.channel = 1;
  bakedShadow.anisotropy = 4;
  scene.updateMatrixWorld(true);
  const sunDir = new THREE.Vector3(-0.55, 0.75, -0.35).normalize(),
    normal = new THREE.Vector3(),
    world = new THREE.Vector3();
  for (const o of staticObjects) {
    const original = o.material,
      geo = o.geometry,
      norm = geo.attributes.normal,
      pos = geo.attributes.position,
      colors = new Float32Array(pos.count * 3);
    let groundSurface = o === ground || geo === rg;
    for (let i = 0; i < pos.count; i++) {
      normal.fromBufferAttribute(norm, i).transformDirection(o.matrixWorld);
      world.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      let diffuse = Math.max(0, normal.dot(sunDir));
      let light = groundSurface
        ? 1
        : original === leaves
          ? 0.72 + Math.min(world.y / 24, 0.3)
          : 0.5 + diffuse * 0.65;
      let ao = groundSurface ? 1 : Math.min(1, 0.64 + world.y * 0.16);
      colors[i * 3] = light * ao;
      colors[i * 3 + 1] = light * ao * 0.98;
      colors[i * 3 + 2] = light * ao * 0.87;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = new THREE.MeshBasicMaterial({
      color: original.color,
      map: original.map,
      alphaTest: original.alphaTest,
      side: original.side,
      vertexColors: true,
      fog: true,
    });
    if (groundSurface) {
      m.color.set(o === ground ? (isMoon ? 0xffffff : isStunt ? 0xd2dfd0 : isCity ? 0xd5d9dc : 0xc1cba4) : 0xffffff);
      const uv1 = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        world.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        uv1[i * 2] = world.x / worldSize + 0.5;
        uv1[i * 2 + 1] = 0.5 - world.z / worldSize;
      }
      geo.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
      m.lightMap = bakedShadow;
      m.lightMapIntensity = 1.45;
    }
    o.material = m;
    o.castShadow = false;
    o.receiveShadow = false;
  }
  // A soft, inexpensive contact shadow follows the moving car.
  const contact = canvasTex(128, (c, z) => {
    const g = c.createRadialGradient(z / 2, z / 2, 10, z / 2, z / 2, z / 2);
    g.addColorStop(0, "rgba(0,0,0,.65)");
    g.addColorStop(0.6, "rgba(0,0,0,.4)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, z, z);
  });
  carShadow = mesh(
    new THREE.PlaneGeometry(3.5, 6.1),
    new THREE.MeshBasicMaterial({
      map: contact,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    scene,
  );
  carShadow.rotation.x = -Math.PI / 2;
  let frameCount = 0;
  const status = document.getElementById("render-status");
  const levelControl = document.getElementById("level");
  levelControl.value = level;
  levelControl.onchange = () => {
    clearKeys();
    const url = new URL(location.href);
    url.searchParams.set("level", levelControl.value);
    loading.navigate(url, level).catch(loading.fail);
  };
  document.querySelector(".badge").innerHTML =
    '<span class="dot"></span> ' +
    (isCity ? "DOWNTOWN / URBAN RUN" : "PINE VALLEY / FREE DRIVE");
  document.querySelector(".mission small").textContent = isCity
    ? "EXPLORE THE CITY LOOP"
    : "EXPLORE THE FOREST LOOP";
  let fps = 0,
    frameMs = 0,
    fpsFrames = 0,
    fpsStart = performance.now();
  function renderFrame() {
    frameCount++;
    fpsFrames++;
    const tick = performance.now();
    if (tick - fpsStart >= 500) {
      frameMs = (tick - fpsStart) / fpsFrames;
      fps = Math.round(1000 / frameMs);
      fpsFrames = 0;
      fpsStart = tick;
    }
    camera.updateMatrixWorld();
    carShadow.position.set(car.position.x, 0.115, car.position.z);
    carShadow.rotation.z = -heading;
    const shadowScale = 1 + car.position.y * 0.07;
    carShadow.scale.setScalar(shadowScale);
    carShadow.material.opacity = Math.max(0.18, 1 - car.position.y * 0.065);
    renderer.render(scene, camera);
    status.textContent = "BAKED LIGHTING · " + fps + " FPS";
  }
  const keys = {};
  let slipX = 0,
    slipZ = 0,
    collisionCount = 0;
  let speed = 0,
    heading = Math.PI / 2,
    steer = 0,
    camMode = 0,
    checkpoint = 1,
    lap = 1,
    travel = 0,
    toastUntil = 5;
  const start = route[0];
  const coneField = createConeField({ scene, route, obstacles, ramps, gravity: isMoon ? 3.2 : 9.82, onChange: () => { sceneDirty = true; } });
  const playField = createPlaythings({
    scene, route, obstacles,
    ramps: hasRamps ? ramps : [],
    roadDist,
    gravity: isMoon ? 3.2 : 9.82,
    kinds: {
      forest: { ball: { count: 9, sizeRange: [0.7, 1.05] }, block: { count: 14, sizeRange: [0.7, 1.15] } },
      city: { tire: { count: 12, sizeRange: [0.9, 1.1] }, block: { count: 10, sizeRange: [0.85, 1.2] } },
      stunt: { ball: { count: 15, sizeRange: [0.8, 1.2] }, block: { count: 10, sizeRange: [1.0, 1.4] } },
      moon: { ball: { count: 14, sizeRange: [0.8, 1.1] }, block: { count: 12, sizeRange: [0.85, 1.2] } },
    }[level],
    onChange: () => { sceneDirty = true; },
  });
  const peopleField = createPeopleField({
    scene, route, obstacles, ramps: hasRamps ? ramps : [],
    roadDist,
    gravity: isMoon ? 3.2 : 9.82,
    count: device.tablet ? 8 : 14,
    speech: () =>
      document.getElementById("friend-voice")?.getAttribute("aria-pressed") === "true",
    onChange: () => { sceneDirty = true; },
  });
  car.position.set(start.x, 0, start.z);
  const ui = {
    speed: document.getElementById("speed"),
    gear: document.getElementById("gear"),
    meter: document.getElementById("meter"),
    toast: document.getElementById("toast"),
    progress: document.getElementById("progress"),
  };
  const garagePreview = createGaragePreview({
    renderer, car: carVisual, environment: scene.environment, contactTexture: contact,
  });
  // The same editable model and renderer serve both the road and the garage.
  const modifier = createModifier({
    car: carVisual, wheels, paint, rocket, show, preview: garagePreview,
    onOpenChange(open) {
      clearKeys();
      for (const id of ["camera", "reset"]) document.getElementById(id).disabled = open;
      if (open) {
        speed = slipX = slipZ = steer = 0;
        boosting = recovering = false;
        boostEnds = 0;
        flame.visible = false;
        boostButton.disabled = false;
        boostText.textContent = boostLabel;
        document.body.classList.remove("boosting");
        for (const wheel of wheels) wheel.pivot.rotation.y = 0;
        ui.speed.textContent = "0";
        ui.gear.textContent = "N";
        ui.meter.style.width = "0%";
      } else {
        last = qualityStart = fpsStart = performance.now();
        qualityFrames = fpsFrames = 0;
        resize();
        renderFrame();
      }
    },
  });
  function reset() {
    sceneDirty = true;
    boosting = false;
    recovering = false;
    boostEnds = 0;
    flame.visible = false;
    boostButton.disabled = false;
    boostText.textContent = boostLabel;
    car.position.set(start.x, 0, start.z);
    speed = 0;
    slipX = 0;
    slipZ = 0;
    collisionCount = 0;
    steer = 0;
    heading = Math.atan2(route[1].x - start.x, route[1].z - start.z);
    coneField.reset(car.position, heading);
    playField.reset(car.position, heading);
    peopleField.reset(car.position, heading);
    jumpPhysics?.reset(car.position);
    checkpoint = 1;
    lap = 1;
    travel = 0;
    camera.position.set(
      car.position.x - Math.sin(heading) * 9,
      3.6,
      car.position.z - Math.cos(heading) * 9,
    );
    show("Back on the trail");
  }
  function show(s) {
    ui.toast.textContent = s;
    toastUntil = performance.now() / 1000 + 3;
  }
  function toggle() {
    camMode = (camMode + 1) % 3;
    show(["Chase camera", "Overhead camera", "Hood camera"][camMode]);
  }
  document.getElementById("camera").onclick = toggle;
  document.getElementById("reset").onclick = reset;
  addEventListener("keydown", (e) => {
    if (e.target?.closest?.("select,input,textarea")) return;
    if (modifier.active) return; // config panel open — let it handle Escape
    let k = e.key.toLowerCase();
    if (!e.repeat && k === "shift") activateBoost();
    if (!e.repeat && k === "r") reset();
    if (!e.repeat && k === "c") toggle();
  });
  const clearKeys = bindDrivingInput(
    keys,
    document.querySelectorAll("[data-key]"),
  );
  let last = performance.now(),
    lastMap = 0;
  const map = document.getElementById("map").getContext("2d");
  const mapScale = hasRamps ? 0.6 : 0.94;
  function drawMap() {
    map.clearRect(0, 0, 276, 276);
    map.save();
    map.translate(138, 138);
    if (isCity) {
      map.strokeStyle = "#c1cbaa33";
      map.lineWidth = 3;
      for (let v = -100; v <= 100; v += 50) {
        map.beginPath();
        map.moveTo(v * mapScale, -115);
        map.lineTo(v * mapScale, 115);
        map.moveTo(-115, v * mapScale);
        map.lineTo(115, v * mapScale);
        map.stroke();
      }
    }
    map.strokeStyle = "#c1cbaa66";
    map.lineWidth = 7;
    map.beginPath();
    route.forEach((p, i) =>
      i
        ? map.lineTo(p.x * mapScale, -p.z * mapScale)
        : map.moveTo(p.x * mapScale, -p.z * mapScale),
    );
    map.closePath();
    map.stroke();
    adventure.drawMap(map, mapScale);
    let g = gates[checkpoint];
    map.fillStyle = "#eef1a5";
    map.beginPath();
    map.arc(g.position.x * mapScale, -g.position.z * mapScale, 6, 0, 7);
    map.fill();
    map.translate(car.position.x * mapScale, -car.position.z * mapScale);
    map.rotate(heading);
    map.fillStyle = "white";
    map.beginPath();
    map.moveTo(0, -8);
    map.lineTo(5, 6);
    map.lineTo(-5, 6);
    map.closePath();
    map.fill();
    map.restore();
  }
  reset();
  show("Follow the golden trail markers");
  let paused = false,
    pauseStarted = 0,
    qualityStart = performance.now(),
    qualityFrames = 0;
  const pauseButton = document.getElementById("pause");
  const pauseText = pauseButton.querySelector("[data-label]");
  function pauseGame(value) {
    if (paused === value) return;
    paused = value;
    clearKeys();
    if (paused) {
      pauseStarted = performance.now();
      show("Paused · Tap Resume to drive");
    } else {
      if (boosting) boostEnds += performance.now() - pauseStarted;
      last = performance.now();
      qualityStart = last;
      qualityFrames = 0;
      fpsStart = last;
      fpsFrames = 0;
      show("Back on the road");
    }
    pauseText.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-label", paused ? "Resume driving" : "Pause driving");
    pauseButton.title = paused ? "Resume driving" : "Pause driving";
    pauseButton.setAttribute("aria-pressed", String(paused));
  }
  pauseButton.onclick = () => pauseGame(!paused);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pauseGame(true);
  });
  addEventListener("blur", () => pauseGame(true));
  addEventListener("resize", clearKeys);
  const adventure = createFriendAdventure({
    scene, route,
    onChange: () => { sceneDirty = true; },
    onStop: () => {
      speed = slipX = slipZ = 0;
      boosting = recovering = false;
      flame.visible = false;
      boostButton.disabled = false;
      boostText.textContent = boostLabel;
      document.body.classList.remove("boosting");
      sceneDirty = true;
      clearKeys();
    },
  });
  show(hasRamps ? (isMoon ? "Moon Run · Ready for a moon jump?" : "Stunt Park · Follow the ramp arrows!") : "Vincent is waiting for a picnic delivery!");
  function frame(now) {
    requestAnimationFrame(frame);
    if (loading.active || (paused && !modifier.active) || document.hidden || contextLost || (adventure.busy() && !modifier.active)) {
      last = now;
      return;
    }
    // Avoid running the full scene at 120 Hz on ProMotion displays.
    if (device.tablet && now - last < 1000 / 60 - 1) return;
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (modifier.active) {
      garagePreview.render(dt);
      return;
    }
    if (device.tablet) {
      qualityFrames++;
      if (now - qualityStart >= 3000) {
        const next = adaptiveScale(
          resolutionScale,
          (qualityFrames * 1000) / (now - qualityStart),
        );
        if (next !== resolutionScale) {
          resolutionScale = next;
          applyPixelRatio();
        }
        qualityStart = now;
        qualityFrames = 0;
      }
    }
    let throttle =
        (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0),
      turn =
        ((keys.a || keys.arrowleft ? 1 : 0) -
        (keys.d || keys.arrowright ? 1 : 0)) ||
        (Number.isFinite(keys.steering) ? THREE.MathUtils.clamp(keys.steering, -1, 1) : 0),
      offroad = roadDist(car.position.x, car.position.z) > 6;
    const tune = modifier.tuning;
    const cruiseMax = (off) => (off ? 17 * tune.offroadTop : 32 * tune.top);
    const boostMax = (off) => (off ? 20 * tune.boostTop : 38 * tune.boostTop);
    if (boosting && (now >= boostEnds || throttle < 0 || keys[" "])) {
      boosting = false;
      recovering = true;
      flame.visible = false;
      sceneDirty = true;
      show("Boost complete · slowing to cruise");
    }
    if (boosting) {
      const boostTarget = boostMax(offroad);
      speed += THREE.MathUtils.clamp(boostTarget - speed, -14 * dt, 8 * dt);
      flame.scale.set(
        1 + Math.sin(now * 0.04) * 0.12,
        1 + Math.cos(now * 0.032) * 0.12,
        1 + Math.sin(now * 0.025) * 0.2,
      );
      boostText.textContent =
        "Boosting " + Math.max(0, (boostEnds - now) / 1000).toFixed(1) + "s";
    } else if (recovering) {
      if (speed > cruiseMax(offroad))
        speed = Math.max(cruiseMax(offroad), speed - (throttle < 0 ? 28 : 14) * dt);
      boostText.textContent = "Cooling down";
      if (speed <= cruiseMax(offroad)) {
        recovering = false;
        boostButton.disabled = false;
        boostText.textContent = boostLabel;
      }
    } else {
      speed += throttle * (speed * throttle < 0 ? 22 : 10) * tune.accel * dt;
      speed *= Math.exp(-(keys[" "] ? 3.4 : throttle ? 0.13 : 0.6) * dt);
      speed = THREE.MathUtils.clamp(speed, -9, cruiseMax(offroad));
      if (!throttle && Math.abs(speed) < 0.03) speed = 0;
    }
    if (boosting && keys[" "]) speed *= Math.exp(-3.4 * dt);
    document.body.classList.toggle("boosting", boosting);
    steer = THREE.MathUtils.lerp(steer, turn, 1 - Math.exp(-8 * dt));
    heading +=
      steer *
      Math.min(32 * Math.max(tune.top, 1), Math.max(-9, speed)) *
      0.032 *
      tune.steer *
      dt *
      (keys[" "] ? 1.6 : 1) *
      (jumpPhysics?.state().airborne ? 0.3 : 1);
    const forwardX = Math.sin(heading),
      forwardZ = Math.cos(heading);
    slipX *= Math.exp(-5 * dt);
    slipZ *= Math.exp(-5 * dt);
    const vx = forwardX * speed + slipX,
      vz = forwardZ * speed + slipZ,
      searchRadius = Math.hypot(vx, vz) * dt + 3;
    const nearby = obstacles.filter(
      (o) =>
        car.position.y < (o.height ?? Infinity) &&
        Math.abs(o.x - car.position.x) < searchRadius + (o.hx || o.r) &&
        Math.abs(o.z - car.position.z) < searchRadius + (o.hz || o.r),
    );
    const motion = moveWithBounces(car.position, { x: vx, z: vz }, dt, nearby);
    car.position.x = motion.x;
    car.position.z = motion.z;
    const flight = jumpPhysics?.update(dt, car.position);
    if (flight) car.position.y = flight.height;
    if (!flight || (!flight.airborne && flight.height < 0.6)) adventure.update(car.position);
    if (flight?.landed && flight.longest > 0.25) show("Lovely landing!");
    if (motion.hits) {
      collisionCount += motion.hits;
      speed = motion.vx * forwardX + motion.vz * forwardZ;
      slipX = motion.vx - speed * forwardX;
      slipZ = motion.vz - speed * forwardZ;
      if (boosting) {
        boosting = recovering = false;
        flame.visible = false;
        boostButton.disabled = false;
        boostText.textContent = boostLabel;
      }
      sceneDirty = true;
    }

    coneField.update(dt, car.position, heading);
    playField.update(dt, car.position, heading);
    peopleField.update(dt, { position: car.position, heading }, Math.abs(speed), now / 1000);
    forestAnim?.animate(now / 1000);
    travel += Math.abs(speed) * dt;
    car.rotation.set(0, heading, -steer * speed * 0.0018);
    if (flight) car.rotateX(-flight.pitch);
    else
      car.position.y =
        Math.sin(travel * 2) *
        Math.min(Math.abs(speed) * 0.0015, 0.045 * tune.bounce);
    for (let w of wheels) {
      w.pivot.rotation.y = w.front ? steer * 0.36 : 0;
      w.tire.rotation.x += (speed * dt) / w.radius;
      w.hub.rotation.x += (speed * dt) / w.radius;
    }
    let g = gates[checkpoint];
    if (car.position.distanceTo(g.position) < 6) {
      checkpoint++;
      if (checkpoint === 8) checkpoint = 0;
      if (checkpoint === 1) {
        lap++;
        show("Loop complete. Keep exploring.");
      } else show("Checkpoint reached");
    }
    ui.progress.textContent =
      "Checkpoint " +
      (checkpoint === 0 ? 8 : checkpoint) +
      " / 8  ·  Lap " +
      lap;
    let f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
      target = car.position.clone(),
      desired = target.clone();
    if (camMode === 0) {
      desired.addScaledVector(f, hasRamps ? -12 : -9);
      desired.y += 3.6;
      target.addScaledVector(f, 6);
      target.y += 1.3;
    } else if (camMode === 1) {
      desired.addScaledVector(f, -6);
      desired.y += 25;
      target.addScaledVector(f, 4);
    } else {
      desired.addScaledVector(f, 1);
      desired.y += 1.95;
      target.addScaledVector(f, 15);
      target.y += 1.5;
    }
    camera.position.lerp(desired, camMode === 2 ? 1 : 1 - Math.exp(-5 * dt));
    if (camera.position.distanceToSquared(desired) < 0.00001)
      camera.position.copy(desired);
    camera.fov = THREE.MathUtils.lerp(
      camera.fov,
      boosting ? 59 : 55,
      1 - Math.exp(-3 * dt),
    );
    if (Math.abs(camera.fov - (boosting ? 59 : 55)) < 0.01)
      camera.fov = boosting ? 59 : 55;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    ui.speed.textContent = Math.round(Math.abs(speed) * 3.6);
    ui.gear.textContent = speed < -0.5 ? "R" : speed > 0.5 ? "D" : "N";
    ui.meter.style.width = Math.min(100, (Math.abs(speed) / 38) * 100) + "%";
    ui.toast.style.opacity = now / 1000 < toastUntil ? 1 : 0;
    if (now - lastMap > 100) {
      drawMap();
      lastMap = now;
    }
    renderFrame();
  }
  await loading.phase(4, "Calling your friends. You're almost there...");
  camera.lookAt(car.position.x, 1, car.position.z);
  drawMap();
  renderFrame();
  loading.complete();
  requestAnimationFrame(frame);
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    applyPixelRatio();
    if (modifier.active) garagePreview.resize();
    else renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  window.gameState = () => ({
    speed,
    heading,
    checkpoint,
    lap,
    position: car.position.toArray(),
    webgl: renderer.info.render.calls,
    carModel: "Porsche 911 GT3 RS",
    level,
    flight: jumpPhysics?.state() ?? null,
    ramps: ramps.length,
    collisionCount,
    lateralSpeed: Math.hypot(slipX, slipZ),
    mode: "fast",
    fps,
    tablet: device.tablet,
    touch: device.touch,
    pixelRatio: renderer.getPixelRatio(),
    paused,
    frameMs,
    bakedLighting: true,
    shadowMaps: renderer.shadowMap.enabled,
    pathTracerLoaded: false,
    compiling: false,
    frames: frameCount,
    boosting,
    recovering,
    boostRemaining: Math.max(0, (boostEnds - performance.now()) / 1000),
    flameVisible: flame.visible,
    wheelCount: wheels.length,
    adventure: adventure.state(),
    cones: coneField.state(),
    toys: playField.state(),
    people: peopleField.state(),
    nozzleDoubleSided: housing.material.side === THREE.DoubleSide,
    mods: { ...modifier.config },
    tuning: modifier.tuning,
    configuring: modifier.active,
    modifierVisuals: modifier.visuals,
    garagePreview: garagePreview.state(),
  });
}
