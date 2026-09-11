import * as THREE from "three";
import { DEFAULTS, PARTS } from "./modifier-data.js";

// car is the visual group, never the driving/physics root. Initialize once.
// wheels is consolidated in-place; tire and hub remain independent spin groups.
export function createModifierCar({ car, wheels = [], paint, rocket }) {
  const options = new Map(
    PARTS.map((part) => [part.id, new Map(part.options.map((o) => [o.id, o]))]),
  );
  const config = { ...DEFAULTS };
  car.updateWorldMatrix(true, true);
  const inverseCar = new THREE.Matrix4().copy(car.matrixWorld).invert();
  const matrix = new THREE.Matrix4();
  const box = new THREE.Box3();
  function localBounds(object) {
    const bounds = new THREE.Box3();
    object.traverse((node) => {
      if (!node.isMesh) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      matrix.multiplyMatrices(inverseCar, node.matrixWorld);
      bounds.union(box.copy(node.geometry.boundingBox).applyMatrix4(matrix));
    });
    return bounds;
  }

  const corners = new Map();
  const wheelRoots = new Set();
  for (const wheel of wheels) {
    const bounds = localBounds(wheel.pivot);
    const center = bounds.getCenter(new THREE.Vector3());
    const side = center.x < 0 ? -1 : 1;
    const key = `${wheel.front ? "front" : "rear"}-${side < 0 ? "left" : "right"}`;
    if (!corners.has(key)) {
      corners.set(key, { key, side, front: wheel.front, bounds: new THREE.Box3(), roots: new Set() });
    }
    const corner = corners.get(key);
    corner.bounds.union(bounds);
    corner.roots.add(wheel.pivot);
    wheelRoots.add(wheel.pivot);
    if (wheel.hub?.parent === car) {
      corner.bounds.union(localBounds(wheel.hub));
      corner.roots.add(wheel.hub);
      wheelRoots.add(wheel.hub);
    }
  }

  const originals = car.children.filter((child) => !wheelRoots.has(child));
  const bodyBounds = new THREE.Box3();
  for (const child of originals) {
    if (child !== rocket) bodyBounds.union(localBounds(child));
  }
  const body = new THREE.Group();
  body.name = "modifier-body";
  car.add(body);
  for (const child of originals) body.add(child);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
  const dark = new THREE.MeshStandardMaterial({ color: 0x172332, metalness: 0.4, roughness: 0.4 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc9d9e4, metalness: 0.65, roughness: 0.3 });
  const cyan = new THREE.MeshStandardMaterial({ color: 0x36efff, emissive: 0x08bbdd, emissiveIntensity: 0.8, metalness: 0.3, roughness: 0.3 });
  const springPaint = new THREE.MeshStandardMaterial({ color: 0xbaff35, emissive: 0x547600, emissiveIntensity: 0.25, metalness: 0.25, roughness: 0.4 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff862b, metalness: 0.2, roughness: 0.35 });
  const capPaint = {
    four: new THREE.MeshStandardMaterial({ color: 0x358dff, metalness: 0.25, roughness: 0.3 }),
    six: new THREE.MeshStandardMaterial({ color: 0xab68ff, metalness: 0.25, roughness: 0.3 }),
    eight: orange,
  };
  function mesh(parent, name, geometry, material, scale, position) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.scale.fromArray(scale);
    object.position.fromArray(position);
    parent.add(object);
    return object;
  }

  const wheelInfo = [];
  for (const corner of corners.values()) {
    const center = corner.bounds.getCenter(new THREE.Vector3());
    const size = corner.bounds.getSize(new THREE.Vector3());
    // Width must not contribute to rolling radius, unlike a bounding sphere.
    const radius = Math.max(size.y, size.z) / 2;
    const pivot = new THREE.Group();
    pivot.name = `modifier-wheel-${corner.key}`;
    pivot.position.copy(center);
    const tire = new THREE.Group();
    tire.name = `modifier-tire-spin-${corner.key}`;
    const hub = new THREE.Group();
    hub.name = `modifier-hub-spin-${corner.key}`;
    pivot.add(tire, hub);
    car.add(pivot);
    // Reparent intact imported parts about one common center, not each rim's
    // slightly different center. Their geometry and materials stay untouched.
    for (const root of corner.roots) tire.attach(root);

    const motor = new THREE.Group();
    motor.name = "modifier-hub-motor";
    hub.add(motor);
    const faceX = corner.side * (size.x / 2 + 0.055);
    const disc = mesh(motor, "modifier-motor-hub", cylinder, cyan,
      [radius * 0.67, 0.09, radius * 0.67], [faceX, 0, 0]);
    disc.rotation.z = Math.PI / 2;
    const boss = mesh(motor, "modifier-motor-center", cylinder, silver,
      [radius * 0.21, 0.025, radius * 0.21], [faceX + corner.side * 0.055, 0, 0]);
    boss.rotation.z = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      const spoke = mesh(motor, "modifier-motor-spoke", cube, dark,
        [0.025, radius * 0.27, 0.035],
        [faceX + corner.side * 0.05, Math.cos(angle) * radius * 0.42, Math.sin(angle) * radius * 0.42]);
      spoke.rotation.x = angle;
    }
    const record = { pivot, tire, hub, front: corner.front, radius };
    wheelInfo.push({ record, center, radius, halfHeight: size.y / 2, width: size.x, side: corner.side, motor });
  }
  wheels.splice(0, wheels.length, ...wheelInfo.map((w) => w.record));

  const groundY = Math.min(...wheelInfo.map((w) => w.center.y - w.halfHeight), bodyBounds.min.y);
  const maxHalfHeight = Math.max(0, ...wheelInfo.map((w) => w.halfHeight));
  const sportDrop = Math.min(0.18, Math.max(0, bodyBounds.min.y - groundY - 0.025));
  const rearZ = bodyBounds.min.z;
  const length = bodyBounds.max.z - rearZ;
  const engineZ = rearZ + length * 0.24;

  // Sample the actual rear deck (including its slope), not a guessed box below
  // the hood. Rays work on the baked, material-merged Porsche geometry too.
  car.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0).transformDirection(car.matrixWorld);
  const point = new THREE.Vector3();
  let deckY = -Infinity;
  const engineFeet = [];
  const deckObjects = originals.filter((object) => object !== rocket);
  for (const x of [-0.48, 0, 0.48]) {
    for (const z of [engineZ - 0.48, engineZ, engineZ + 0.48]) {
      point.set(x, bodyBounds.max.y + 1, z).applyMatrix4(car.matrixWorld);
      ray.set(point, down);
      const hit = ray.intersectObjects(deckObjects, true)[0];
      if (hit) {
        const y = point.copy(hit.point).applyMatrix4(inverseCar).y;
        deckY = Math.max(deckY, y);
        if (x !== 0 && z !== engineZ) engineFeet.push({ x, y, z: z - engineZ });
      }
    }
  }
  if (!Number.isFinite(deckY)) deckY = bodyBounds.max.y;

  const engine = new THREE.Group();
  engine.name = "modifier-engine";
  engine.position.set(0, deckY + 0.06, engineZ);
  body.add(engine);
  mesh(engine, "modifier-engine-base", cube, dark, [1.4, 0.12, 1.4], [0, 0, 0]);
  for (const foot of engineFeet) {
    const height = engine.position.y - foot.y + 0.08;
    mesh(engine, "modifier-engine-foot", cube, silver, [0.12, height, 0.12], [foot.x, -height / 2, foot.z]);
  }
  const combustion = new THREE.Group();
  combustion.name = "modifier-combustion-engine";
  engine.add(combustion);
  mesh(combustion, "modifier-engine-block", cube, silver, [1.08, 0.2, 1.12], [0, 0.14, 0]);
  const cylinders = [];
  for (let i = 0; i < 8; i++) {
    const group = new THREE.Group();
    group.name = "modifier-cylinder";
    combustion.add(group);
    mesh(group, "modifier-cylinder-barrel", cylinder, silver, [0.125, 0.32, 0.125], [0, 0.16, 0]);
    const cap = mesh(group, "modifier-cylinder-cap", cylinder, capPaint.four,
      [0.155, 0.085, 0.155], [0, 0.355, 0]);
    cylinders.push({ group, cap });
  }
  const electric = new THREE.Group();
  electric.name = "modifier-electric-pack";
  engine.add(electric);
  mesh(electric, "modifier-battery", cube, cyan, [1.08, 0.4, 0.77], [0, 0.27, -0.13]);
  for (const x of [-0.3, 0, 0.3]) {
    mesh(electric, "modifier-battery-strap", cube, dark, [0.045, 0.42, 0.79], [x, 0.27, -0.13]);
  }
  for (const x of [-0.43, 0.43]) {
    mesh(electric, "modifier-battery-terminal", cylinder, orange, [0.065, 0.08, 0.065], [x, 0.51, 0.12]);
  }
  mesh(electric, "modifier-battery-plus", cube, dark, [0.16, 0.02, 0.035], [0.16, 0.48, -0.18]);
  mesh(electric, "modifier-battery-plus", cube, dark, [0.035, 0.02, 0.16], [0.16, 0.48, -0.18]);
  mesh(electric, "modifier-battery-minus", cube, dark, [0.16, 0.02, 0.035], [-0.16, 0.48, -0.18]);
  const electricMotor = mesh(electric, "modifier-electric-motor", cylinder, silver,
    [0.18, 0.92, 0.18], [0, 0.24, 0.43]);
  electricMotor.rotation.z = Math.PI / 2;
  for (const x of [-0.47, 0.47]) {
    const end = mesh(electric, "modifier-electric-motor-end", cylinder, cyan,
      [0.185, 0.06, 0.185], [x, 0.24, 0.43]);
    end.rotation.z = Math.PI / 2;
  }

  const suspension = new THREE.Group();
  suspension.name = "modifier-suspension";
  car.add(suspension);
  const helix = new THREE.CatmullRomCurve3(Array.from({ length: 81 }, (_, i) => {
    const t = i / 80;
    return new THREE.Vector3(Math.cos(t * Math.PI * 10) * 0.095, t, Math.sin(t * Math.PI * 10) * 0.095);
  }));
  const coilGeometry = new THREE.TubeGeometry(helix, 80, 0.025, 6, false);
  const springs = wheelInfo.map((wheel) => {
    const group = new THREE.Group();
    suspension.add(group);
    const coil = mesh(group, "modifier-coil-spring", coilGeometry, springPaint, [1, 1, 1], [0, 0, 0]);
    const shaft = mesh(group, "modifier-shock-shaft", cylinder, silver, [0.03, 1, 0.03], [0, 0.5, 0]);
    mesh(group, "modifier-spring-seat", cylinder, dark, [0.14, 0.05, 0.14], [0, 0, 0]);
    const top = mesh(group, "modifier-spring-seat", cylinder, dark, [0.14, 0.05, 0.14], [0, 1, 0]);
    return { wheel, group, coil, shaft, top };
  });
  const axles = [];
  for (const front of [false, true]) {
    const pair = wheelInfo.filter((w) => w.record.front === front);
    if (pair.length !== 2) continue;
    const axle = mesh(suspension, "modifier-axle", cylinder, orange, [0.07, 1, 0.07], [0, 0, 0]);
    axle.rotation.z = Math.PI / 2;
    axles.push({ pair, axle });
  }
  const sportSills = new THREE.Group();
  sportSills.name = "modifier-sport-sills";
  body.add(sportSills);
  for (const x of [bodyBounds.min.x - 0.025, bodyBounds.max.x + 0.025]) {
    mesh(sportSills, "modifier-sport-sill", cube, orange, [0.065, 0.095, length * 0.38], [x, bodyBounds.min.y + 0.09, 0]);
  }

  const spoiler = new THREE.Group();
  spoiler.name = "modifier-spoiler";
  spoiler.position.set(0, deckY, rearZ + 0.3);
  body.add(spoiler);
  const wing = mesh(spoiler, "modifier-wing", cube, dark, [1, 0.1, 1], [0, 0, 0]);
  const secondWing = mesh(spoiler, "modifier-second-wing", cube, dark, [1, 0.08, 1], [0, 0, 0]);
  const mounts = [-0.61, 0.61].map((x) =>
    mesh(spoiler, "modifier-wing-mount", cube, silver, [0.1, 1, 0.16], [x, 0, 0]));
  const plates = [-1, 1].map(() =>
    mesh(spoiler, "modifier-wing-endplate", cube, paint || orange, [0.08, 1, 1], [0, 0, 0]));
  const rocketPosition = rocket?.position.clone();
  const rocketScale = rocket?.scale.clone();
  const rocketBounds = rocket ? localBounds(rocket) : null;

  function apply(next = DEFAULTS) {
    for (const part of PARTS) {
      config[part.id] = options.get(part.id).has(next[part.id]) ? next[part.id] : DEFAULTS[part.id];
    }
    if (paint?.color) paint.color.set(options.get("color").get(config.color).hex);

    const monster = config.wheels === "monster";
    const wide = config.wheels === "wide";
    const radialScale = monster ? 2.15 : 1;
    const widthScale = monster ? 2.3 : wide ? 2.1 : 1;
    const wheelLift = monster ? maxHalfHeight * (radialScale - 1) + 0.45 : 0;
    body.position.y = wheelLift + (config.suspension === "lift" ? 0.68 : config.suspension === "sport" ? -sportDrop : 0);
    for (const info of wheelInfo) {
      const { record, center, side, halfHeight, width, radius, motor } = info;
      const pivot = record.pivot;
      pivot.scale.set(widthScale, radialScale, radialScale);
      pivot.position.copy(center);
      pivot.position.y += halfHeight * (radialScale - 1);
      if (wide) pivot.position.x += side * (width * (widthScale - 1) / 2 + 0.12);
      if (monster) {
        const bodyEdge = side < 0 ? -bodyBounds.min.x : bodyBounds.max.x;
        // Clear the whole body even at the game's maximum steering angle.
        const reach = width * widthScale / 2 + radius * radialScale * Math.sin(0.4);
        pivot.position.x = side * Math.max(Math.abs(center.x), bodyEdge + reach + 0.12);
      }
      record.radius = radius * radialScale;
      motor.visible = config.wheels === "hub";
    }

    suspension.visible = monster || config.suspension === "lift";
    sportSills.visible = config.suspension === "sport";
    for (const { wheel, group, coil, shaft, top } of springs) {
      const pivot = wheel.record.pivot;
      const bodyEdge = wheel.side < 0 ? -bodyBounds.min.x : bodyBounds.max.x;
      const innerEdge = Math.abs(pivot.position.x) - wheel.width * widthScale / 2;
      const springX = wheel.side * Math.min(bodyEdge - 0.1, innerEdge - 0.16);
      const bottomY = pivot.position.y;
      const height = Math.max(0.12, bodyBounds.min.y + body.position.y + 0.12 - bottomY);
      group.position.set(springX, bottomY, pivot.position.z);
      coil.scale.y = height;
      shaft.scale.y = height;
      shaft.position.y = height / 2;
      top.position.y = height;
    }
    for (const { pair, axle } of axles) {
      const a = pair[0].record.pivot.position;
      const b = pair[1].record.pivot.position;
      axle.position.copy(a).add(b).multiplyScalar(0.5);
      axle.scale.y = Math.abs(a.x - b.x);
    }

    electric.visible = config.engine === "electric";
    combustion.visible = !electric.visible;
    const count = { four: 4, six: 6, eight: 8, electric: 0 }[config.engine];
    for (let i = 0; i < cylinders.length; i++) {
      const { group, cap } = cylinders[i];
      group.visible = i < count;
      const bank = i % 2 === 0 ? -1 : 1;
      group.position.set(
        count === 4 ? (i - 1.5) * 0.33 : bank * 0.28,
        0.23,
        count === 4 ? 0 : (Math.floor(i / 2) - (count / 2 - 1) / 2) * 0.36,
      );
      group.rotation.z = count === 4 ? 0 : -bank * 0.35;
      cap.material = capPaint[config.engine] || capPaint.four;
    }

    spoiler.visible = config.spoiler !== "stock";
    const mega = config.spoiler === "mega";
    const wingWidth = mega ? 3.45 : 2.55;
    const wingDepth = mega ? 0.72 : 0.52;
    const wingHeight = bodyBounds.max.y + (mega ? 1.1 : 0.55) - deckY;
    // Sweep the blades back so the rear-above engine view can see every cap.
    const wingOffset = mega ? -0.72 : -0.26;
    wing.scale.set(wingWidth, 0.1, wingDepth);
    wing.position.set(0, wingHeight, wingOffset);
    secondWing.visible = mega;
    secondWing.scale.set(wingWidth * 0.94, 0.08, wingDepth * 0.8);
    secondWing.position.set(0, wingHeight - 0.29, wingOffset + 0.08);
    for (const mount of mounts) {
      mount.position.y = wingHeight / 2;
      mount.position.z = wingOffset / 2;
      mount.rotation.x = Math.atan2(wingOffset, wingHeight);
      mount.scale.y = Math.hypot(wingHeight, wingOffset);
    }
    for (let i = 0; i < plates.length; i++) {
      plates[i].scale.set(0.08, mega ? 0.57 : 0.32, wingDepth + 0.08);
      plates[i].position.set((i === 0 ? -1 : 1) * wingWidth / 2, wingHeight - 0.09, wingOffset);
    }
    if (rocket) {
      const scale = config.rocket === "big" ? 1.8 : 1;
      rocket.visible = config.rocket !== "none";
      rocket.scale.copy(rocketScale).multiplyScalar(scale);
      rocket.position.copy(rocketPosition);
      // Enlarge away from the deck attachment and keep the nozzle off the floor.
      rocket.position.y += (scale - 1) * (rocketPosition.y - rocketBounds.min.y);
      rocket.position.z -= (scale - 1) * (rocketBounds.max.z - rocketPosition.z);
    }
  }

  function state() {
    const count = combustion.visible ? cylinders.filter(({ group }) => group.visible).length : 0;
    return {
      paint: paint?.color ? `#${paint.color.getHexString()}` : null,
      engine: { id: config.engine, cylinders: count, banks: count === 0 ? 0 : count === 4 ? 1 : 2, electric: electric.visible, deckY: engine.position.y + body.position.y, z: engine.position.z },
      height: { bodyLift: body.position.y, clearance: bodyBounds.min.y + body.position.y - groundY, springs: suspension.visible ? springs.length : 0, axles: suspension.visible ? axles.length : 0 },
      wheels: {
        id: config.wheels,
        count: wheelInfo.length,
        motorHubs: wheelInfo.filter((w) => w.motor.visible).length,
        corners: wheelInfo.map(({ record, side, halfHeight, width }) => ({
          side, front: record.front, radius: record.radius,
          width: width * record.pivot.scale.x,
          center: record.pivot.position.toArray(),
          bottomY: record.pivot.position.y - halfHeight * record.pivot.scale.y,
        })),
      },
      spoiler: { added: spoiler.visible, width: spoiler.visible ? wing.scale.x : 0, topY: spoiler.visible ? spoiler.position.y + plates[0].position.y + plates[0].scale.y / 2 + body.position.y : null },
      rocket: { visible: rocket?.visible ?? false, scale: rocket?.scale.toArray() ?? null },
    };
  }

  apply(DEFAULTS);
  // The loader disposes imported resources separately when replacing a vehicle.
  const resources = new Set([cube, cylinder, coilGeometry, dark, silver, cyan, springPaint, orange, ...Object.values(capPaint)]);
  return { apply, state, dispose() {
    for (const resource of resources) resource.dispose();
    resources.clear();
  } };
}
