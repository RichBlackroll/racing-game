import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createRampCourse, createLevelScenery } from "./levels.js";
import { createCourse } from "./course.js";
import { createCourseDetails, createCourseHUD } from "./course-details.js";
import { sampleDrivingSurface } from "./driving-terrain.js";
import { createArchitecture } from "./architecture.js";
import { createLandscape } from "./world.js";
import { createWellingtonWorld } from "./wellington-world.js";
import { createAmsterdamGroundGeometry, createAmsterdamWorld } from "./amsterdam-world.js";
import { createLandmarks } from "./landmarks.js";
import { createAtmosphere } from "./atmosphere.js";
import { createFinishLine } from "./finish-line.js";
import { createJumpPhysics } from "./jumps.js";
import { createConeField } from "./cones.js";
import { createPlaythings } from "./playthings.js";
import { createPeopleField } from "./people.js";
import { createFriendAdventure } from "./friends.js";
import { createFriendRacers } from "./friend-racers.js";
import { createModifier } from "./modifier-ui.js";
import { createGaragePreview } from "./modifier-preview.js";
import { loadVehicleModel } from "./vehicle-model.js";
import { getVehicle } from "./vehicle-data.js";
import { createSession } from "./session.js";
import { createEngineAudio } from "./engine-audio.js";
import { moveWithBounces } from "./collision.js";
import { createCameraClearance } from "./camera.js";
import { createCockpit } from "./cockpit.js";
import {
  tabletProfile,
  pixelBudget,
  adaptiveScale,
  createFrameLimiter,
  bindDrivingInput,
} from "./tablet.js";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
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
  const session = createSession();
  const saved = session.value;
  const level = loading.level;
  const audio = createEngineAudio();
  audio.setEnabled(saved.sound);
  const isCity = level === "city", isMoon = level === "moon", isStunt = level === "stunt";
  const isWellington = level === "wellington";
  const isAmsterdam = level === "amsterdam";
  document.body.classList.toggle("wellington", isWellington);
  const hasRamps = isMoon || isStunt;
  const course = createCourse(level);
  const { route, heightAt, roadDistance: roadDist } = course;
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: !device.tablet,
    preserveDrawingBuffer: false,
  });
  document.body.prepend(renderer.domElement);
  renderer.domElement.classList.add("game-canvas");
  renderer.setSize(renderer.domElement.clientWidth, renderer.domElement.clientHeight, false);
  const renderSize = new THREE.Vector2();
  const allowMobileFrame = createFrameLimiter();
  let resolutionScale = 1;
  const applyPixelRatio = (width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight) => {
    const ratio = device.tablet
      ? pixelBudget(width, height, devicePixelRatio) * resolutionScale
      : Math.min(devicePixelRatio, 1.25);
    if (renderer.getPixelRatio() === ratio) return false;
    renderer.setPixelRatio(ratio);
    return true;
  };
  applyPixelRatio();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  let contextLost = false, gameReady = false, graphicsNeedRefresh = false;
  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    contextLost = true;
    graphicsNeedRefresh = true;
    audio.silence();
    if (gameReady) {
      interruptGame();
      show("Graphics paused. Waiting for the browser to restore them...");
    }
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    if (!gameReady) return;
    refreshGraphics();
    returnToGame();
  });
  function refreshGraphics() {
    if (!gameReady || contextLost || !graphicsNeedRefresh) return;
    // Three restores GPU resources, but generated lighting and our pause need refreshing.
    if (isMoon) {
      updateMoonEnvironment();
      garagePreview.setEnvironment(scene.environment);
    }
    renderer.shadowMap.needsUpdate = true;
    sceneDirty = true;
    graphicsNeedRefresh = false;
  }
  const camera = new THREE.PerspectiveCamera(
    55,
    innerWidth / innerHeight,
    0.1,
    800,
  );
  const load = new THREE.TextureLoader();
  const [env, groundTex, groundNorm, groundRough] = await Promise.all([
    isMoon ? null : new RGBELoader().loadAsync("forest.hdr"),
    hasRamps || isAmsterdam ? canvasTex(512, (c,n) => {
      c.fillStyle = isAmsterdam ? "#bcb5a6" : isMoon ? "#a8a9b1" : "#7c9677"; c.fillRect(0,0,n,n);
      let state = 91;
      const noise = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
      for (let i=0;i<16000;i++) { c.fillStyle = "rgba(35,40,48," + noise()*0.2 + ")"; c.fillRect(noise()*n,noise()*n,1+noise()*2,1+noise()*2); }
      if (isAmsterdam) {
        c.strokeStyle = "#7f82774d"; c.lineWidth = 1;
        for (let y = 0; y < n; y += 32) for (let x = -32; x < n; x += 64) c.strokeRect(x + (y / 32 % 2) * 32, y, 64, 32);
      }
    }) : load.loadAsync("forest-Diffuse.jpg"),
    null,
    null,
  ]);
  await loading.phase(1, isAmsterdam ? "Building gables, bridges and little canal boats..." : isWellington ? "Tracing Wellington's waterfront and skyline..." : isMoon ? "Moving a few craters into place..." : isCity ? "Waking up the neighborhood..." : isStunt ? "Giving the ramps a little extra bounce..." : "Planting a few happy little trees...");
  if (env) env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = env;
  scene.background = new THREE.Color(0xabbdb5);
  scene.backgroundBlurriness = 0;
  scene.environmentIntensity = 0.7;
  scene.backgroundIntensity = 0.8;
  scene.fog = new THREE.Fog(0xabbdb5, 95, 240);
  camera.far = isWellington ? 12000 : 1600;
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
  const sun = new THREE.DirectionalLight(isMoon ? 0xffffff : 0xffe1ae, isMoon ? 3.2 : 3.1);
  sun.position.set(-course.halfSize * 1.25, course.halfSize * 1.1, -course.halfSize * .86);
  if (isWellington) sun.position.z *= -1;
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(device.tablet ? 2048 : 4096);
  Object.assign(sun.shadow.camera, {
    left: -course.halfSize - 40,
    right: course.halfSize + 40,
    top: course.halfSize + 40,
    bottom: -course.halfSize - 40,
    far: course.halfSize * 4,
  });
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.12;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xc4dce5, isMoon ? 0x545967 : 0x555b43, isMoon ? 1 : 0.85));
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
  const groundmat = mat(isAmsterdam ? 0xb1a890 : hasRamps ? 0xffffff : 0x4b5834, {
    map: groundTex,
    normalMap: groundNorm,
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughnessMap: groundRough,
  });
  const groundSize = (course.halfSize + 20) * 2;
  let ground = null;
  // Wellington owns a clipped coastline mesh, not a square drivable harbour bed.
  if (!isWellington) {
    const groundSegments = Math.ceil(groundSize / (device.tablet ? 5 : 4));
    const groundGeometry = isAmsterdam ? createAmsterdamGroundGeometry()
      : new THREE.PlaneGeometry(groundSize, groundSize, groundSegments, groundSegments).rotateX(-Math.PI / 2);
    const groundPositions = groundGeometry.attributes.position;
    for (let i = 0; i < groundPositions.count; i++) {
      if (isAmsterdam) break;
      const x = groundPositions.getX(i), z = groundPositions.getZ(i);
      // A shallow road bed prevents the coarse terrain triangles poking through asphalt.
      const bed = isCity ? 0 : .22 * (1 - THREE.MathUtils.smoothstep(roadDist(x, z), 7, 15));
      groundPositions.setY(i, heightAt(x, z) - bed);
    }
    groundGeometry.computeVertexNormals();
    ground = mesh(groundGeometry, groundmat);
    ground.castShadow = false;
  }
  groundTex.repeat.setScalar(groundSize / 7);
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
    c.fillStyle = "#363d40";
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 50000; i++) {
      let v = 37 + rnd() * 35;
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
  dirtTex.repeat.set(1, course.length / 10);
  const roadmat = mat(0xffffff, {
    map: dirtTex,
    bumpMap: dirtTex,
    bumpScale: 0.045,
    roughness: 0.76,
    side: THREE.DoubleSide,
  });
  // Shared mitered vertices keep both edges continuous, including city corners.
  const edge = (i, offset) => {
    const p = route[i], prev = route[(i + route.length - 1) % route.length], next = route[(i + 1) % route.length];
    const ax = p.x - prev.x, az = p.z - prev.z, al = Math.hypot(ax, az);
    const bx = next.x - p.x, bz = next.z - p.z, bl = Math.hypot(bx, bz);
    let nx = -az / al - bz / bl, nz = ax / al + bx / bl;
    const length = Math.hypot(nx, nz); nx /= length; nz /= length;
    const miter = offset / Math.max(0.5, nx * -bz / bl + nz * bx / bl);
    return [p.x + nx * miter, p.z + nz * miter];
  };
  const ribbon = (left, right, height, parity = null) => {
    const positions = [], uvs = [];
    for (let i = 0; i < route.length; i++) {
      if (parity !== null && i % 2 !== parity) continue;
      const j = (i + 1) % route.length;
      const points = [edge(i, left), edge(i, right), edge(j, left), edge(j, left), edge(i, right), edge(j, right)];
      for (const p of points) positions.push(p[0], heightAt(p[0], p[1]) + height, p[1]);
      uvs.push(0, i / route.length, 1, i / route.length, 0, (i + 1) / route.length, 0, (i + 1) / route.length, 1, i / route.length, 1, (i + 1) / route.length);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    const continuous = mergeVertices(geometry);
    geometry.dispose();
    continuous.computeVertexNormals();
    return continuous;
  };
  const rg = ribbon(-5.8, 5.8, 0.075);
  const routeMesh = mesh(rg, roadmat);
  for (let parity = 0; parity < 2; parity++) {
    if (isCity || isWellington || isAmsterdam) break;
    const strips = [ribbon(-6.5, -5.65, 0.10, parity), ribbon(5.65, 6.5, 0.10, parity)];
    mesh(mergeGeometries(strips), mat(parity ? 0xe7e2d4 : hasRamps ? 0xbb634e : 0x7b8274, { side: THREE.DoubleSide }));
    strips.forEach((g) => g.dispose());
  }
  const obstacles = [], treeInfo = [], buildingInfo = [];
  if (isCity) {
    const asphalt = dirtTex.clone();
    asphalt.repeat.set(100, 100);
    groundmat.map = asphalt;
    groundmat.normalMap = null;
    groundmat.roughnessMap = null;
    groundmat.color.set(0xffffff);
  }
  const waterfront = isWellington ? createWellingtonWorld({ scene, course, obstacles, buildingInfo, tablet: device.tablet })
    : isAmsterdam ? createAmsterdamWorld({ scene, terrain: course, obstacles, buildingInfo, treeInfo, tablet: device.tablet }) : null;
  const architecture = waterfront ?? createArchitecture({ scene, level, obstacles, buildingInfo, tablet: device.tablet, terrain: course });
  const landmarks = waterfront ?? createLandmarks({ scene, level, obstacles, buildingInfo, tablet: device.tablet, terrain: course });
  const landscape = waterfront ? { group: waterfront.landscapeGroup, animate: waterfront.animate }
    : createLandscape({ scene, ground, level, roadDist, route, obstacles, treeInfo, buildingInfo, tablet: device.tablet, terrain: course, clearings: landmarks.clearings });
  createCourseDetails({ scene, course, obstacles });
  const ramps = hasRamps ? createRampCourse(scene, route, isMoon) : [];
  if (isMoon) createLevelScenery(scene, true, roadDist, obstacles, course, landmarks.clearings);
  let moonEnvironment;
  function updateMoonEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
    moonEnvironment?.dispose();
    moonEnvironment = pmrem.fromScene(room, 0.04);
    scene.environment = moonEnvironment.texture;
    scene.environmentIntensity = 0.65;
    room.dispose(); pmrem.dispose();
  }
  if (isMoon) updateMoonEnvironment();
  // Keep distant terrain and animated vegetation out of the structural camera checks.
  const cameraScenery = waterfront ? buildingInfo.map((b) => {
    // Small proxies avoid five per-frame raycasts through city-wide facade batches.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d));
    proxy.position.set(b.x, b.y + b.h / 2, b.z);
    proxy.rotation.y = b.rotation ?? 0;
    return proxy;
  }) : scene.children.filter((object) => object !== landscape.group && object !== ground && object !== routeMesh);
  const atmosphere = createAtmosphere({ scene, renderer, camera, level, tablet: device.tablet });
  const jumpPhysics = hasRamps ? createJumpPhysics(ramps, isMoon ? 3.2 : 9.82, course) : null;
  // Local licensed car models and their adaptations are credited in CREDITS.md.
  const car = new THREE.Group();
  scene.add(car);
  // Only the visual group visits the garage; driving position and heading stay here.
  const carVisual = new THREE.Group();
  car.add(carVisual);
  await loading.phase(2, "Polishing your getaway car...");
  let vehicleModel, vehicleLoadMessage = "";
  try {
    vehicleModel = await loadVehicleModel(saved.vehicle);
  } catch (error) {
    if (saved.vehicle === "porsche") throw error;
    vehicleModel = await loadVehicleModel("porsche");
    session.update({ vehicle: "porsche", config: { ...saved.config, engine: getVehicle("porsche").engine } });
    vehicleLoadMessage = `${getVehicle(saved.vehicle).name} could not load. Using the Porsche; try again in My garage.`;
  }
  carVisual.add(vehicleModel.car);
  let { wheels, flame } = vehicleModel;
  const metal = mat(0xaeb4b6, { metalness: 0.9, roughness: 0.25 });
  const gates = [];
  const gateMat = mat(0xe5c96c, { metalness: 0.3, roughness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const index = Math.floor(i * route.length / 8);
    let p = route[index],
      n = route[(index + 1) % route.length],
      g = new THREE.Group();
    g.position.copy(p);
    g.rotation.y = Math.atan2(n.x - p.x, n.z - p.z);
    scene.add(g);
    if (i === 0) cameraScenery.push(createFinishLine({ scene, position: p, heading: g.rotation.y, obstacles, heightAt }));
    else for (let x of [-5, 5]) {
      box(0.1, 1.9, 0.1, metal, g, x, 0.95, 0);
      box(0.43, 0.22, 0.1, gateMat, g, x, 1.75, 0);
    }
    gates.push(g);
    cameraScenery.push(g);
  }
  const clearCamera = createCameraClearance(cameraScenery);
  const cameraAnchor = new THREE.Vector3();

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
    const seconds = 5 * modifier.tuning.boostTime;
    boostEnds = performance.now() + seconds * 1000;
    flame.visible = true;
    boostButton.disabled = true;
    show(`ROCKET BOOST · ${seconds} SECONDS`);
  }
  boostButton.onclick = activateBoost;

  const fill = new THREE.RectAreaLight(0xffe6d2, 3, 12, 12);
  fill.position.set(-12, 10, 108);
  fill.lookAt(car.position);
  scene.add(fill);

  await loading.phase(3, isMoon ? "Hanging the Earth in the sky..." : "Letting a little sunshine in...");
  // Ground occlusion is baked once; scenery keeps its physical materials.
  let bakedShadow, carShadow;
  const atlasSize = device.tablet ? 1024 : 2048,
    worldSize = groundSize;
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
  const world = new THREE.Vector3();
  for (const o of [ground, routeMesh].filter(Boolean)) {
    const geo = o.geometry, pos = geo.attributes.position;
    const uv1 = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      uv1[i * 2] = world.x / worldSize + 0.5;
      uv1[i * 2 + 1] = 0.5 - world.z / worldSize;
    }
    geo.setAttribute("uv1", new THREE.BufferAttribute(uv1, 2));
    o.material.aoMap = bakedShadow;
    o.material.aoMapIntensity = 1;
    const prepareSurface = o.material.onBeforeCompile;
    const surfaceKey = o.material.customProgramCacheKey();
    o.material.onBeforeCompile = (shader, gl) => {
      prepareSurface.call(o.material, shader, gl);
      shader.fragmentShader = shader.fragmentShader.replace("#include <aomap_fragment>", `
        #include <aomap_fragment>
        reflectedLight.directDiffuse *= mix(vec3(1.0), texture2D(aoMap, vAoMapUv).rgb, 0.35);
      `);
    };
    o.material.customProgramCacheKey = () => surfaceKey + "/ground-occlusion";
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
  const shadowCoordinates = carShadow.geometry.attributes.position.array.slice();
  carShadow.castShadow = false;
  let frameCount = 0;
  const status = document.getElementById("render-status");
  const levelControl = document.getElementById("level");
  levelControl.value = level;
  levelControl.onchange = () => {
    clearKeys();
    saveDrive();
    audio.silence();
    const url = new URL(location.href);
    url.searchParams.set("level", levelControl.value);
    loading.navigate(url, level).catch(loading.fail);
  };
  document.querySelector(".badge").innerHTML =
    '<span class="dot"></span> ' +
    ({ city: "DOWNTOWN / DISCOVERY DRIVE", forest: "PINE VALLEY / WOODLAND ADVENTURE",
      stunt: "STUNT PARK / CIRCUS CIRCUIT", moon: "MOON RUN / LUNAR EXPLORER",
      amsterdam: "AMSTERDAM / CANAL EXPLORER", wellington: "WELLINGTON, NZ / WATERFRONT" }[level]);
  document.querySelector(".mission small").textContent = isWellington
    ? "FOLLOW THE QUAYS OR EXPLORE ORIENTAL BAY" : isAmsterdam ? "CANALS, BRIDGES & LITTLE DETOURS" : "FOLLOW THE ROAD OR EXPLORE A GOLDEN STAR";
  document.getElementById("map-attribution").hidden = !isWellington;
  if (isWellington) document.getElementById("map").setAttribute("aria-label", "North-up Wellington waterfront map: coastline, streets, landmarks, your car and next checkpoint");
  if (isAmsterdam) document.getElementById("map").setAttribute("aria-label", "Amsterdam canals, bridges, landmarks, your car and next checkpoint");
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
    const clearance = Math.max(0, car.position.y - heightAt(car.position.x, car.position.z));
    const shadowScale = 1 + clearance * .07;
    const shadowPosition = carShadow.geometry.attributes.position;
    for (let i = 0; i < shadowPosition.count; i++) {
      // Plane +Y maps to world -Z so its front face points up at the camera.
      const right = shadowCoordinates[i * 3] * shadowScale, along = -shadowCoordinates[i * 3 + 1] * shadowScale;
      const x = car.position.x + Math.cos(heading) * right + Math.sin(heading) * along;
      const z = car.position.z - Math.sin(heading) * right + Math.cos(heading) * along;
      shadowPosition.setXYZ(i, x, heightAt(x, z) + .115, z);
    }
    shadowPosition.needsUpdate = true;
    carShadow.geometry.computeBoundingSphere();
    carShadow.material.opacity = Math.max(.18, 1 - clearance * .065);
    landscape.animate(performance.now() / 1000);
    const inside = camMode === 2;
    cockpit.setActive(inside);
    cockpit.update({ speed, steer, travel, handbrake: !!keys[" "], boosting, recovering,
      boostRemaining: (boostEnds - (paused ? pauseStarted : tick)) / 1000,
      boostDuration: 5 * modifier.tuning.boostTime, hasRocket: modifier.config.rocket !== "none" });
    // The exterior model has opaque windows; the view-only cabin replaces it here.
    const carVisible = car.visible;
    try {
      car.visible = carVisible && !inside;
      atmosphere.render(tick / 1000);
    } finally {
      car.visible = carVisible;
    }
    cockpit.renderMirror(tick);
    status.textContent = "CINEMATIC WORLD · " + fps + " FPS";
  }
  const keys = {};
  let slipX = 0,
    slipZ = 0,
    collisionCount = 0;
  let speed = 0,
    heading = Math.PI / 2,
    steer = 0,
    camMode = saved.camera,
    checkpoint = 1,
    lap = 1,
    travel = 0,
    toastUntil = 5;
  let surfacePose = sampleDrivingSurface(heightAt, route[0].x, route[0].z, heading);
  let lapSeconds = 0, bestLap = 0;
  const start = route[0];
  const coneField = createConeField({ scene, route, obstacles, ramps, terrain: course, gravity: isMoon ? 3.2 : 9.82, onChange: () => { sceneDirty = true; } });
  const playField = createPlaythings({
    scene, route, obstacles, terrain: course,
    ramps: hasRamps ? ramps : [],
    roadDist,
    gravity: isMoon ? 3.2 : 9.82,
    kinds: {
      forest: { ball: { count: 9, sizeRange: [0.7, 1.05] }, block: { count: 14, sizeRange: [0.7, 1.15] } },
      city: { tire: { count: 12, sizeRange: [0.9, 1.1] }, block: { count: 10, sizeRange: [0.85, 1.2] } },
      amsterdam: { ball: { count: 8, sizeRange: [0.65, 0.9] }, block: { count: 10, sizeRange: [0.7, 1] } },
      wellington: { tire: { count: 8, sizeRange: [0.9, 1.1] }, ball: { count: 6, sizeRange: [0.7, 1] } },
      stunt: { ball: { count: 15, sizeRange: [0.8, 1.2] }, block: { count: 10, sizeRange: [1.0, 1.4] } },
      moon: { ball: { count: 14, sizeRange: [0.8, 1.1] }, block: { count: 12, sizeRange: [0.85, 1.2] } },
    }[level],
    onChange: () => { sceneDirty = true; },
  });
  const peopleField = createPeopleField({
    scene, route, obstacles, terrain: course, ramps: hasRamps ? ramps : [],
    roadDist,
    gravity: isMoon ? 3.2 : 9.82,
    count: device.tablet ? 8 : 14,
    speech: () =>
      document.getElementById("friend-voice")?.getAttribute("aria-pressed") === "true",
    onChange: () => { sceneDirty = true; },
  });
  car.position.copy(start);
  const ui = {
    speed: document.getElementById("speed"),
    gear: document.getElementById("gear"),
    meter: document.getElementById("meter"),
    toast: document.getElementById("toast"),
    progress: document.getElementById("progress"),
  };
  const updateCourseHUD = createCourseHUD(course);
  const cockpit = createCockpit({ renderer, scene, car, tablet: device.tablet });
  const friendRacers = createFriendRacers({
    scene, course, obstacles, ramps, gravity: isMoon ? 3.2 : 9.82,
    contactTexture: contact, onRace: show,
  });
  const garagePreview = createGaragePreview({
    renderer, car: carVisual, environment: scene.environment, contactTexture: contact,
  });
  // The same editable model and renderer serve both the road and the garage.
  const modifier = createModifier({
    visuals: vehicleModel.visuals, show, preview: garagePreview, session, audio,
    async onVehicleChange(id, config, signal) {
      const next = await loadVehicleModel(id, { signal });
      try {
        signal.throwIfAborted();
        if (!modifier.active) throw new DOMException("Garage closed", "AbortError");
        next.visuals.apply(config);
      } catch (error) {
        next.dispose();
        throw error;
      }
      // Keep the driving root and garage holder intact; commit only a ready model.
      const previous = vehicleModel;
      carVisual.add(next.car);
      vehicleModel = next;
      ({ wheels, flame } = next);
      previous.dispose();
      sceneDirty = true;
      return next.visuals;
    },
    canOpen: () => !loading.active && !document.hidden && !contextLost && !adventure.busy(),
    onOpenChange(open) {
      clearKeys();
      audio.silence();
      saveDrive();
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
        if (!loading.active && !contextLost && !document.hidden) renderFrame();
      }
    },
  });
  function reset(restore = false) {
    let drive = restore === true ? saved.drives[level] : null;
    sceneDirty = true;
    boosting = false;
    recovering = false;
    boostEnds = 0;
    flame.visible = false;
    boostButton.disabled = false;
    boostText.textContent = boostLabel;
    car.position.copy(start);
    if (drive) {
      // Resolve against today's terrain and static scenery, never restore live velocity.
      const ground = heightAt(drive.x, drive.z);
      const position = moveWithBounces(drive, { x: 0, z: 0 }, 0,
        obstacles.filter((o) => ground + 1.6 > (o.y ?? -Infinity) && ground < (o.y ?? 0) + (o.height ?? Infinity)), course.halfSize);
      if (!course.isSafePosition || course.isSafePosition(position.x, position.z, 2.5))
        car.position.set(position.x, heightAt(position.x, position.z), position.z);
      else drive = null;
    }
    speed = 0;
    slipX = 0;
    slipZ = 0;
    collisionCount = 0;
    steer = 0;
    heading = drive?.heading ?? Math.atan2(route[1].x - start.x, route[1].z - start.z);
    surfacePose = sampleDrivingSurface(heightAt, car.position.x, car.position.z, heading);
    car.rotation.set(-surfacePose.pitch, heading, surfacePose.roll, "YXZ");
    coneField.reset(car.position, heading);
    playField.reset(car.position, heading);
    peopleField.reset(car.position, heading);
    friendRacers.reset(car.position);
    jumpPhysics?.reset(car.position);
    checkpoint = drive?.checkpoint ?? 1;
    lap = drive?.lap ?? 1;
    travel = 0;
    lapSeconds = drive?.lapSeconds ?? 0;
    if (drive) bestLap = drive.bestLap;
    // Old checkpoints and lap records belong to the shorter circuit, not this one.
    if (drive && Number.isFinite(course.length) && drive.courseLength !== Math.round(course.length)) {
      checkpoint = lap = 1;
      lapSeconds = bestLap = 0;
    }
    camera.position.set(
      car.position.x - Math.sin(heading) * 9,
      car.position.y + 3.6,
      car.position.z - Math.cos(heading) * 9,
    );
    cameraAnchor.copy(car.position).y += 1.7;
    clearCamera(cameraAnchor, camera.position);
    saveDrive();
    show("Back on the trail");
    if (gameReady && !contextLost && !document.hidden && !loading.active) {
      updateCamera(1);
      renderFrame();
    }
  }
  function saveDrive() {
    const flight = jumpPhysics?.state();
    if (flight?.airborne || flight?.clearance > 0.2) return;
    if (course.isSafePosition && !course.isSafePosition(car.position.x, car.position.z, 2.5)) return;
    session.update({ drives: { ...session.value.drives, [level]: {
      x: car.position.x, z: car.position.z, heading, checkpoint, lap, lapSeconds, bestLap,
      courseLength: Math.round(course.length),
    } } });
  }
  function show(s) {
    ui.toast.textContent = s;
    ui.toast.style.opacity = 1;
    toastUntil = performance.now() / 1000 + 3;
  }
  function toggle() {
    camMode = (camMode + 1) % 3;
    session.update({ camera: camMode });
    show(["Chase camera", "Overhead camera", "Inside camera"][camMode]);
    if (!contextLost && !document.hidden && !loading.active) {
      updateCamera(1);
      renderFrame();
    }
  }
  document.getElementById("camera").onclick = toggle;
  document.getElementById("reset").onclick = () => reset();
  addEventListener("keydown", (e) => {
    if (e.target?.closest?.("select,input,textarea")) return;
    if (modifier.active || adventure.busy()) return;
    let k = e.key.toLowerCase();
    if (!e.repeat && k === "shift") activateBoost();
    if (!e.repeat && k === "r") reset();
    if (!e.repeat && k === "c") toggle();
  });
  const clearKeys = bindDrivingInput(
    keys,
    document.querySelectorAll("[data-key]"),
    window,
    document,
    () => !modifier.active && !paused && !adventure.busy() && !loading.active && !document.hidden && !contextLost,
  );
  let last = performance.now(),
    lastMap = 0;
  const map = document.getElementById("map").getContext("2d");
  const mapExtent = isWellington || isAmsterdam ? course.halfSize : Math.max(...route.map(p => Math.max(Math.abs(p.x), Math.abs(p.z)))) + 30;
  const mapScale = (isWellington ? 138 : 126) / mapExtent;
  function drawMap() {
    map.clearRect(0, 0, 276, 276);
    map.save();
    map.translate(138, 138);
    waterfront?.drawMap(map, mapScale);
    if (isCity) {
      map.strokeStyle = "#c1cbaa33";
      map.lineWidth = 3;
      for (let v = -150; v <= 150; v += 50) {
        map.beginPath();
        map.moveTo(v * mapScale, -150 * mapScale);
        map.lineTo(v * mapScale, 150 * mapScale);
        map.moveTo(-150 * mapScale, v * mapScale);
        map.lineTo(150 * mapScale, v * mapScale);
        map.stroke();
      }
    }
    map.strokeStyle = isWellington ? "#fff0af" : "#c1cbaa66";
    map.lineWidth = isWellington ? 2.3 : 7;
    map.beginPath();
    route.forEach((p, i) =>
      i
        ? map.lineTo(p.x * mapScale, -p.z * mapScale)
        : map.moveTo(p.x * mapScale, -p.z * mapScale),
    );
    map.closePath();
    map.stroke();
    for (const site of landmarks.sites) {
      if (site.interior) continue;
      if (site.access?.start) {
        map.strokeStyle = "#e9b95780"; map.lineWidth = 2;
        map.beginPath();
        map.moveTo(site.access.start.x * mapScale, -site.access.start.z * mapScale);
        map.lineTo(site.x * mapScale, -site.z * mapScale);
        map.stroke();
      }
      map.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5 - Math.PI / 2, radius = (i % 2 ? 2.6 : 6) * (isWellington ? .5 : 1);
        const x = site.x * mapScale + Math.cos(angle) * radius, y = -site.z * mapScale + Math.sin(angle) * radius;
        if (i) map.lineTo(x, y); else map.moveTo(x, y);
      }
      map.closePath(); map.fillStyle = "#f4c958"; map.fill();
    }
    adventure.drawMap(map, mapScale);
    friendRacers.drawMap(map, mapScale);
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
    updateCourseHUD(car.position, surfacePose.grade, lapSeconds, bestLap);
  }
  reset(true);
  show("Follow the golden trail markers");
  let paused = false,
    resumeOnReturn = false,
    pauseStarted = 0,
    qualityStart = performance.now(),
    qualityFrames = 0;
  const pauseButton = document.getElementById("pause");
  const pauseText = pauseButton.querySelector("[data-label]");
  function pauseGame(value) {
    if (value) {
      audio.silence();
      if (!loading.active) saveDrive();
    }
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
  function interruptGame() {
    // Repeated blur/hidden/pagehide events must not overwrite the original pause intent.
    resumeOnReturn ||= !paused;
    clearKeys();
    pauseGame(true);
  }
  function returnToGame() {
    if (document.hidden || contextLost) return;
    if (resumeOnReturn) {
      resumeOnReturn = false;
      pauseGame(false);
    }
    last = qualityStart = fpsStart = performance.now();
    qualityFrames = fpsFrames = 0;
    resize();
    if (!loading.active) {
      if (modifier.active) garagePreview.render(0, true);
      else renderFrame();
    }
  }
  pauseButton.onclick = () => {
    if (document.hidden || contextLost) return;
    resumeOnReturn = false;
    pauseGame(!paused);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) interruptGame();
    else returnToGame();
  });
  addEventListener("blur", interruptGame);
  addEventListener("focus", returnToGame);
  addEventListener("pagehide", interruptGame);
  addEventListener("pageshow", returnToGame);
  const adventure = createFriendAdventure({
    scene, route, session,
    onChange: () => { sceneDirty = true; },
    onStop: () => {
      audio.silence();
      saveDrive();
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
  const soundButton = document.getElementById("sound");
  function soundLabel() {
    const { enabled, unlocked } = audio.state();
    soundButton.setAttribute("aria-pressed", String(enabled));
    soundButton.querySelector("[data-label]").textContent = !enabled ? "Muted" : unlocked ? "Sound" : "Enable sound";
    soundButton.title = enabled && unlocked ? "Mute engine sounds" : "Enable engine sounds";
  }
  function unlockAudio() {
    if (!audio.state().enabled) return;
    void audio.unlock().then((ready) => {
      soundLabel();
      if (!ready) show("Sound couldn't start. Tap Enable sound to retry; check your device volume.");
    });
  }
  soundButton.onclick = () => {
    const { enabled, unlocked } = audio.state();
    const sound = !(enabled && unlocked);
    audio.setEnabled(sound);
    session.update({ sound });
    soundLabel();
    if (sound) unlockAudio();
  };
  soundLabel();
  // A fresh driving gesture also resumes audio after a browser/app interruption.
  const resumeSound = (event) => {
    if (event.target?.closest?.("#sound") || loading.active || modifier.active || document.hidden || contextLost) return;
    if (!audio.state().unlocked) unlockAudio();
  };
  addEventListener("pointerdown", resumeSound);
  addEventListener("keydown", resumeSound);
  document.getElementById("home").onclick = () => {
    resumeOnReturn = false;
    pauseGame(true);
    loading.home();
  };
  show(vehicleLoadMessage || (hasRamps ? (isMoon ? "Moon Run · Ready for a moon jump?" : "Stunt Park · Follow the ramp arrows!") : "Vincent is waiting for a picnic delivery!"));
  let lastSave = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (loading.active || (paused && !modifier.active) || document.hidden || contextLost || (adventure.busy() && !modifier.active)) {
      audio.silence();
      last = now;
      return;
    }
    // Rendering deadlines are separate from the actual elapsed physics time.
    if (device.tablet && !allowMobileFrame(now)) return;
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
    surfacePose = sampleDrivingSurface(heightAt, car.position.x, car.position.z, heading);
    if (!keys[" "] && (Math.abs(speed) > .1 || throttle) && !jumpPhysics?.state().airborne)
      speed -= Math.sin(surfacePose.pitch) * (isMoon ? 3.2 : 9.82) * .55 * dt;
    const cruiseMax = (off) => (off ? 17 * tune.offroadTop : 32 * tune.top);
    // Rockets amplify the fitted engine and tyres instead of capping upgraded cars.
    const boostMax = (off) => cruiseMax(off) * 1.5 * tune.boostTop;
    if (boosting && (now >= boostEnds || throttle < 0 || keys[" "])) {
      boosting = false;
      recovering = true;
      flame.visible = false;
      sceneDirty = true;
      show("Boost complete · slowing to cruise");
    }
    if (boosting) {
      const boostTarget = boostMax(offroad);
      const boostThrust = (24 + 10 * tune.accel) * tune.boostTop;
      speed += THREE.MathUtils.clamp(boostTarget - speed, -14 * dt, boostThrust * dt);
      flame.scale.set(
        1 + Math.sin(now * 0.04) * 0.12,
        1 + Math.cos(now * 0.032) * 0.12,
        1 + Math.sin(now * 0.025) * 0.2,
      );
      boostText.textContent =
        "Boosting " + Math.max(0, (boostEnds - now) / 1000).toFixed(1) + "s";
    } else if (recovering) {
      if (keys[" "]) speed *= Math.exp(-3.4 * dt);
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
    document.body.classList.toggle("boosting", boosting);
    steer = THREE.MathUtils.lerp(steer, turn, 1 - Math.exp(-8 * dt));
    heading +=
      steer *
      Math.min(32 * Math.max(tune.top, 1), Math.max(-9, speed)) *
      0.032 *
      (1 + .8 * (1 - THREE.MathUtils.smoothstep(Math.abs(speed), 12, 32))) *
      tune.steer *
      dt *
      (keys[" "] ? 1.6 : 1) *
      (jumpPhysics?.state().airborne ? 0.3 : 1);
    const forwardX = Math.sin(heading),
      forwardZ = Math.cos(heading);
    slipX *= Math.exp(-5 * dt);
    slipZ *= Math.exp(-5 * dt);
    const vx = forwardX * speed + slipX,
      vz = forwardZ * speed + slipZ;
    const motion = friendRacers.update(dt, car.position, heading, speed, { x: vx, z: vz });
    car.position.x = motion.x;
    car.position.z = motion.z;
    const flight = jumpPhysics?.update(dt, car.position);
    surfacePose = sampleDrivingSurface(heightAt, car.position.x, car.position.z, heading);
    car.position.y = flight ? flight.height : surfacePose.height;
    if (!flight || (!flight.airborne && flight.clearance < 0.6)) adventure.update(car.position);
    if (flight?.landed && flight.longest > 0.25) show("Lovely landing!");
    if (motion.hits) {
      collisionCount += motion.hits;
      speed = motion.vx * forwardX + motion.vz * forwardZ;
      slipX = motion.vx - speed * forwardX;
      slipZ = motion.vz - speed * forwardZ;
      if (boosting && motion.staticHits) {
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
    travel += Math.abs(speed) * dt;
    if (lapSeconds > 0 || Math.abs(speed) > .5) lapSeconds += dt;
    car.rotation.set(-(flight ? flight.pitch : surfacePose.pitch), heading,
      surfacePose.roll - steer * speed * 0.0018, "YXZ");
    if (!flight) car.position.y += Math.sin(travel * 2) * Math.min(Math.abs(speed) * .0008, .025 * tune.bounce);
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
        bestLap = bestLap ? Math.min(bestLap, lapSeconds) : lapSeconds;
        show(`Lap complete: ${lapSeconds.toFixed(1)} s. Best: ${bestLap.toFixed(1)} s`);
        lapSeconds = 0;
      } else show("Checkpoint reached");
    }
    ui.progress.textContent =
      "Checkpoint " +
      (checkpoint === 0 ? 8 : checkpoint) +
      " / 8  ·  Lap " +
      lap + " / " + lapSeconds.toFixed(1) + " s";
    updateCamera(dt);
    ui.speed.textContent = Math.round(Math.abs(speed) * 3.6);
    ui.gear.textContent = speed < -0.5 ? "R" : speed > 0.5 ? "D" : "N";
    ui.meter.style.width = Math.min(100, (Math.abs(speed) /
      (modifier.config.rocket === "none" ? cruiseMax(false) : boostMax(false))) * 100) + "%";
    ui.toast.style.opacity = now / 1000 < toastUntil ? 1 : 0;
    if (now - lastMap > 100) {
      drawMap();
      lastMap = now;
    }
    if (now - lastSave > 3000) {
      saveDrive();
      lastSave = now;
    }
    if (!adventure.busy()) audio.updateDriving({ engineId: modifier.config.engine, speed, throttle, boosting });
    renderFrame();
  }
  function updateCamera(dt) {
    let f = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)),
      target = car.position.clone(),
      desired = target.clone();
    if (camMode === 0) {
      desired.addScaledVector(f, hasRamps ? -12 : -9);
      desired.y += 3.6;
      target.addScaledVector(f, 6);
      target.y = heightAt(target.x, target.z) + 1.3 + Math.max(0, car.position.y - surfacePose.height);
    } else if (camMode === 1) {
      desired.addScaledVector(f, -6);
      desired.y += 25;
      target.addScaledVector(f, 4);
    } else {
      // Driver's eye position, following the car's pitch on hills and ramps.
      desired.set(.35, 1.45, .1).applyQuaternion(car.quaternion).add(car.position);
      target.set(.35, 1.45, 20).applyQuaternion(car.quaternion).add(car.position);
    }
    desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + (camMode === 2 ? 1.25 : 2.2));
    camera.position.lerp(desired, camMode === 2 ? 1 : 1 - Math.exp(-5 * dt));
    if (camera.position.distanceToSquared(desired) < 0.00001)
      camera.position.copy(desired);
    // Resolve after smoothing so entering a roof or turning beside a wall snaps clear immediately.
    cameraAnchor.copy(car.position).y += 1.7;
    // Terrain is sampled instead of raycasting every triangle in the large heightfield.
    for (const t of [.25, .5, .75, 1]) {
      const x = THREE.MathUtils.lerp(cameraAnchor.x, camera.position.x, t);
      const z = THREE.MathUtils.lerp(cameraAnchor.z, camera.position.z, t);
      const y = THREE.MathUtils.lerp(cameraAnchor.y, camera.position.y, t);
      camera.position.y += Math.max(0, heightAt(x, z) + .45 - y) / t;
    }
    clearCamera(cameraAnchor, camera.position);
    camera.fov = THREE.MathUtils.lerp(
      camera.fov,
      boosting ? 68 : 55,
      1 - Math.exp(-3 * dt),
    );
    if (Math.abs(camera.fov - (boosting ? 68 : 55)) < 0.01)
      camera.fov = boosting ? 68 : 55;
    camera.updateProjectionMatrix();
    camera.lookAt(target);
  }
  await loading.phase(4, "Calling your friends. You're almost there...");
  // Only static scenery enters the cached sun shadow; the car uses contact AO.
  car.traverse((object) => { if (object.isMesh) object.castShadow = false; });
  renderer.shadowMap.needsUpdate = true;
  updateCamera(1);
  gameReady = true;
  refreshGraphics();
  resize();
  drawMap();
  renderFrame();
  if (contextLost) interruptGame();
  loading.complete((action) => {
    clearKeys();
    last = qualityStart = fpsStart = performance.now();
    qualityFrames = fpsFrames = 0;
    unlockAudio();
    resumeOnReturn = false;
    if (contextLost) resumeOnReturn = true;
    else pauseGame(false);
    if (action === "garage") modifier.open();
  });
  requestAnimationFrame(frame);
  function resize() {
    cockpit.resize();
    const width = renderer.domElement.clientWidth, height = renderer.domElement.clientHeight;
    if (!width || !height || contextLost) return false;
    const ratioChanged = applyPixelRatio(width, height);
    if (modifier.active) {
      garagePreview.resize();
      return ratioChanged;
    }
    const aspectChanged = camera.aspect !== width / height;
    if (aspectChanged) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    renderer.getSize(renderSize);
    const sizeChanged = renderSize.x !== width || renderSize.y !== height;
    if (sizeChanged) renderer.setSize(width, height, false);
    return sizeChanged || ratioChanged || aspectChanged;
  }
  let resizePending = false;
  function scheduleResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      const changed = resize();
      if (loading.active || document.hidden || contextLost) return;
      // Resizing clears the canvas, even when simulation is paused in a dialog.
      if (modifier.active) garagePreview.render(0);
      else if (changed) renderFrame();
    });
  }
  addEventListener("resize", scheduleResize);
  window.visualViewport?.addEventListener("resize", scheduleResize);
  window.gameState = () => ({
    speed,
    heading,
    checkpoint,
    lap,
    lapSeconds,
    bestLap,
    position: car.position.toArray(),
    webgl: renderer.info.render.calls,
    carModel: vehicleModel.vehicle.name,
    vehicle: vehicleModel.vehicle.id,
    level,
    course: { length: course.length, elevation: course.elevation, samples: route.length,
      groundHeight: heightAt(car.position.x, car.position.z), pitch: surfacePose.pitch,
      bank: surfacePose.roll, grade: surfacePose.grade, progress: course.nearest(car.position.x, car.position.z).along / course.length },
    flight: jumpPhysics?.state() ?? null,
    ramps: ramps.length,
    collisionCount,
    lateralSpeed: Math.hypot(slipX, slipZ),
    mode: "cinematic",
    architecture: architecture.counts,
    amsterdam: isAmsterdam ? waterfront.counts : null,
    landmarks: landmarks.sites,
    landmarkGeometry: landmarks.counts,
    fps,
    tablet: device.tablet,
    touch: device.touch,
    pixelRatio: renderer.getPixelRatio(),
    paused,
    cameraMode: camMode,
    audio: audio.state(),
    locallySaved: session.persistent,
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
    racers: friendRacers.state(),
    cones: coneField.state(),
    toys: playField.state(),
    people: peopleField.state(),
    nozzleDoubleSided: vehicleModel.housing.material.side === THREE.DoubleSide,
    mods: { ...modifier.config },
    tuning: modifier.tuning,
    configuring: modifier.active,
    modifierVisuals: modifier.visuals,
    garagePreview: garagePreview.state(),
  });
}
