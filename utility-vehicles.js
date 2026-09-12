import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createModifierCar } from "./modifier-car.js";
import { createCarFlag } from "./car-flag.js";
import { DEFAULTS } from "./modifier-data.js";

// Takes ownership of a Kenney Car Kit scene. Articulated parts never enter the
// ordinary loader's material batching or the modifier's mounting-surface bounds.
export function prepareUtilityVehicleModel(source, vehicle) {
  const backhoe = vehicle.id === "backhoe";
  const car = new THREE.Group();
  car.name = vehicle.id;
  car.userData.nightVehicle = true;
  const resources = new Set(), moving = [], wheels = [];
  let visuals, flag, disposed = false;
  source.traverse(object => {
    if (!object.isMesh) return;
    resources.add(object.geometry);
    for (const material of [].concat(object.material)) {
      resources.add(material);
      for (const texture of Object.values(material)) {
        if (!texture?.isTexture) continue;
        resources.add(texture);
        for (const image of [].concat(texture.image)) if (typeof image?.close === "function") resources.add(image);
      }
    }
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    flag?.dispose();
    visuals?.dispose();
    for (const resource of resources) {
      if (typeof resource.dispose === "function") resource.dispose();
      else resource.close();
    }
    resources.clear();
    car.removeFromParent();
    car.clear();
    source.clear();
  }
  function material(name, color, roughness = .55, metalness = .1) {
    const result = new THREE.MeshStandardMaterial({ name, color, roughness, metalness, side: THREE.DoubleSide });
    resources.add(result);
    return result;
  }
  const paint = material("vehicle-paint", 0xe6c310, .35);
  const dark = material("utility-steel", 0x253039, .65, .45);
  const silver = material("utility-hydraulics", 0xbfc8cb, .26, .8);
  const glassMaterial = material("utility-glass", 0x294453, .20, .3);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const pin = new THREE.CylinderGeometry(1, 1, 1, 12);
  resources.add(cube); resources.add(pin);
  function mesh(parent, name, geometry, mat, position = [0, 0, 0], scale = [1, 1, 1]) {
    const object = new THREE.Mesh(geometry, mat);
    object.name = name;
    object.position.fromArray(position); object.scale.fromArray(scale);
    object.receiveShadow = true;
    parent.add(object);
    resources.add(geometry);
    return object;
  }
  function group(parent, name, position) {
    const object = new THREE.Group(); object.name = name;
    object.position.fromArray(position); parent.add(object);
    return object;
  }
  function beam(parent, name, a, b, width, depth, mat = paint) {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
    const object = mesh(parent, name, cube, mat, from.clone().add(to).multiplyScalar(.5).toArray(), [width, from.distanceTo(to), depth]);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
    return object;
  }
  try {
    if (!["backhoe", "dhl-van"].includes(vehicle.id)) throw new Error("Unknown utility vehicle.");
    source.updateMatrixWorld(true);
    const body = source.getObjectByName("body"), loader = source.getObjectByName("shovel");
    if (!body?.isMesh || (backhoe && !loader?.isMesh)) throw new Error(`${vehicle.id} is missing its source body or shovel.`);
    car.attach(body);
    if (loader) { car.attach(loader); moving.push(loader); }
    for (const name of ["wheel-front-left", "wheel-front-right", "wheel-back-left", "wheel-back-right"]) {
      const wheel = source.getObjectByName(name);
      if (!wheel?.isMesh) throw new Error(`${vehicle.id} is missing ${name}.`);
      car.attach(wheel);
      wheels.push({ pivot: wheel, tire: wheel, hub: new THREE.Group(), front: name.includes("front") });
    }

    // The atlas encodes paint, glass, rubber and lamps in the SAME material.
    // Isolate body paint and opaque tinted glass; retain the other source texels.
    for (const object of [body, loader].filter(Boolean)) {
      const geometry = object.geometry.clone(), uv = geometry.attributes.uv;
      resources.add(geometry);
      const position = geometry.attributes.position, index = geometry.index;
      const painted = [], retained = [], glazed = [], point = new THREE.Vector3(), normal = new THREE.Vector3();
      for (let i = 0; i < index.count; i += 3) {
        const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        const u = ids.reduce((sum, k) => sum + uv.getX(k), 0) / 3;
        const v = ids.reduce((sum, k) => sum + uv.getY(k), 0) / 3;
        point.set(0, 0, 0); normal.set(0, 0, 0);
        for (const k of ids) {
          point.add(new THREE.Vector3().fromBufferAttribute(position, k));
          normal.add(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, k));
        }
        point.multiplyScalar(1 / 3).applyMatrix4(object.matrixWorld);
        normal.normalize();
        const glass = u < .125 && v > .75;
        const rearPanel = !backhoe && point.z < -1.2 && point.y > .5 && normal.z < -.5;
        // Remove the fixed rear skin, rather than opening doors over a solid wall.
        if (rearPanel) continue;
        const cargoPanel = !backhoe && glass && point.z < .15 && Math.abs(normal.x) > .5;
        const swatch = backhoe ? Math.abs(u - .46875) < .01 && v < .5
          : u > .95 && v > .25 && v < .5;
        const scoop = object === loader && Math.abs(u - .71875) < .01;
        (swatch || cargoPanel || scoop ? painted : glass ? glazed : retained).push(...ids);
      }
      if (!painted.length) throw new Error(`${vehicle.id} has no source paint binding.`);
      geometry.setIndex([...retained, ...painted, ...glazed]);
      geometry.clearGroups();
      if (retained.length) geometry.addGroup(0, retained.length, 0);
      geometry.addGroup(retained.length, painted.length, 1);
      if (glazed.length) geometry.addGroup(retained.length + painted.length, glazed.length, 2);
      geometry.computeBoundingBox();
      object.geometry = geometry;
      object.material = [object.material, paint, glassMaterial];
      object.receiveShadow = true;
      object.userData.sourcePaintTriangles = painted.length / 3;
    }

    let pose;
    let anchor;
    if (backhoe) {
      const swing = group(car, "backhoe-rear-swing", [0, .58, -1.20]);
      moving.push(swing);
      mesh(swing, "backhoe-swing-mount", cube, dark, [0, 0, .05], [.48, .38, .23]);
      const boom = group(swing, "backhoe-boom", [0, 0, 0]);
      const dipper = group(boom, "backhoe-dipper", [0, 1.10, 0]);
      const bucket = group(dipper, "backhoe-bucket", [0, .93, 0]);
      for (const [parent, length, width] of [[boom, 1.10, .22], [dipper, .93, .16]]) {
        for (const side of [-1, 1]) {
          beam(parent, "backhoe-arm-cheek", [side * width / 2, 0, 0], [side * width / 2, length, 0], .075, .17);
        }
        beam(parent, "backhoe-arm-web", [0, .1, 0], [0, length - .1, 0], width, .10);
        for (const y of [0, length]) {
          const joint = mesh(parent, "backhoe-joint-pin", pin, silver, [0, y, 0], [.105, width + .16, .105]);
          joint.rotation.z = Math.PI / 2;
        }
      }
      // A hollow, curved scoop with side cheeks and four forward-facing teeth.
      const profile = [[.10, .025], [-.13, -.025], [-.27, -.17], [-.25, -.31], [-.02, -.36], [.26, -.30]];
      for (let i = 1; i < profile.length; i++) {
        const [z0, y0] = profile[i - 1], [z1, y1] = profile[i];
        beam(bucket, "backhoe-bucket-shell", [0, y0, z0], [0, y1, z1], .50, .035);
      }
      const cheek = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
      const cheekGeometry = new THREE.ShapeGeometry(cheek);
      // Shape X becomes model Z; its Y remains up.
      cheekGeometry.rotateY(-Math.PI / 2);
      for (const x of [-.25, .25]) mesh(bucket, "backhoe-bucket-cheek", cheekGeometry, paint, [x, 0, 0]);
      for (const x of [-.19, -.063, .063, .19]) {
        beam(bucket, "backhoe-bucket-tooth", [x, -.30, .18], [x, -.32, .36], .075, .055, silver);
      }
      anchor = group(bucket, "utility-effect-anchor", [0, -.32, .36]);
      const rams = [];
      for (const [name, fromParent, fromPosition, toParent, toPosition] of [
        ["boom", swing, [0, .03, .15], boom, [0, .79, .13]],
        ["dipper", boom, [0, .47, -.16], dipper, [0, .46, -.13]],
        ["bucket", dipper, [0, .43, -.10], bucket, [0, -.08, -.20]],
      ]) {
        const from = group(fromParent, `${name}-ram-base`, fromPosition);
        const to = group(toParent, `${name}-ram-tip`, toPosition);
        const cylinder = mesh(swing, `${name}-hydraulic-barrel`, pin, dark);
        const rod = mesh(swing, `${name}-hydraulic-rod`, pin, silver);
        rams.push({ from, to, cylinder, rod });
      }
      const keys = [
        [0, -.72, -1.66, 2.53], [.32, -1.12, -1.10, 2.15],
        [.58, -.50, -1.70, 1.70], [.78, -.65, -1.80, 3.10], [1, -.72, -1.66, 2.53],
      ];
      pose = p => {
        const right = keys.findIndex(key => key[0] >= p);
        const a = keys[Math.max(0, right - 1)], b = keys[Math.max(0, right)];
        const t = THREE.MathUtils.smoothstep(p, a[0], b[0] || 1);
        loader.rotation.x = -.28 - .12 * Math.sin(Math.PI * p) ** 2;
        boom.rotation.x = THREE.MathUtils.lerp(a[1], b[1], t);
        dipper.rotation.x = THREE.MathUtils.lerp(a[2], b[2], t);
        bucket.rotation.x = THREE.MathUtils.lerp(a[3], b[3], t);
        car.updateWorldMatrix(true, true);
        for (const { from, to, cylinder, rod } of rams) {
          const start = swing.worldToLocal(from.getWorldPosition(new THREE.Vector3()));
          const end = swing.worldToLocal(to.getWorldPosition(new THREE.Vector3()));
          const delta = end.clone().sub(start), length = delta.length();
          for (const [object, fraction, offset, radius] of [[cylinder, .58, .29, .058], [rod, .52, .74, .032]]) {
            object.position.copy(start).addScaledVector(delta, offset);
            object.scale.set(radius, length * fraction, radius);
            object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
          }
        }
      };
    } else {
      const red = material("DHL-red-marking", 0xd40511, .6, 0);
      // Original geometric lettering: no downloaded logo, font, canvas or DOM.
      const shapes = [];
      const polygon = points => new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x + .22 * y, y)));
      const d = polygon([[0, 0], [0, 1], [.52, 1], [.76, .80], [.76, .24], [.52, 0]]);
      d.holes.push(new THREE.Path([[.23, .23], [.47, .23], [.53, .32], [.53, .70], [.45, .77], [.23, .77]]
        .map(([x, y]) => new THREE.Vector2(x + .22 * y, y))));
      shapes.push(d, polygon([[.87, 0], [.87, 1], [1.1, 1], [1.1, .63], [1.45, .63], [1.45, 1], [1.68, 1], [1.68, 0], [1.45, 0], [1.45, .39], [1.1, .39], [1.1, 0]]),
        polygon([[1.81, 0], [1.81, 1], [2.05, 1], [2.05, .24], [2.63, .24], [2.63, 0]]));
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const x = side < 0 ? -.92 : 2.83, y = .08 + i * .23;
        shapes.push(polygon([[x, y], [x + .70, y], [x + .70, y + .12], [x, y + .12]]));
      }
      const pieces = shapes.map(shape => new THREE.ShapeGeometry(shape));
      const logo = mergeGeometries(pieces);
      for (const piece of pieces) piece.dispose();
      logo.translate(-1.31, -.5, 0);
      resources.add(logo);
      for (const side of [-1, 1]) {
        const mark = mesh(body, `DHL-side-${side}`, logo, red, [side * .557, .76, -.69], [.29, .27, 1]);
        mark.rotation.y = side * Math.PI / 2;
      }
      const doors = [];
      for (const side of [-1, 1]) {
        const door = group(car, `van-rear-door-${side}`, [side * .535, .855, -1.357]);
        moving.push(door); doors.push(door);
        mesh(door, "van-door-panel", cube, paint, [-side * .265, 0, 0], [.525, .70, .035]);
        mesh(door, "van-door-handle", cube, dark, [-side * .46, -.13, -.025], [.045, .15, .025]);
        const mark = mesh(door, "DHL-rear", logo, red, [-side * .265, .09, -.022], [.112, .15, 1]);
        mark.rotation.y = Math.PI;
        for (const y of [-.25, .25]) mesh(door, "van-door-hinge", cube, silver, [0, y, 0], [.055, .095, .055]);
      }
      mesh(car, "van-cargo-floor", cube, dark, [0, .505, -.91], [1.04, .035, .85]);
      mesh(car, "van-cargo-bulkhead", cube, dark, [0, .85, -.48], [1.04, .69, .035]);
      mesh(car, "van-rear-header", cube, paint, [0, 1.255, -1.29], [1.05, .10, .13]);
      anchor = group(body, "utility-effect-anchor", [0, .34, -1.76]);
      pose = p => {
        const opening = THREE.MathUtils.smoothstep(p, 0, .25) * (1 - THREE.MathUtils.smoothstep(p, .72, 1));
        doors.forEach((door, i) => { door.rotation.y = (i === 0 ? 1 : -1) * opening * Math.PI * .53; });
      };
    }
    // Absolute cycle sampling, not a delta: both endpoints are the travel pose.
    // The anchor follows suspension and articulation; read it in world space.
    const special = {
      anchor,
      pose(progress) {
        if (disposed) return;
        pose(Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0);
        car.updateWorldMatrix(true, true);
      },
      reset() { special.pose(0); },
    };
    special.reset();
    const bounds = new THREE.Box3().setFromObject(car, true);
    const target = vehicle.length ?? (backhoe ? 8.8 : 5.8);
    const scale = target / (bounds.max.z - bounds.min.z);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error(`${vehicle.id} has no utility geometry.`);
    // Center on the real axles, not the long rear boom. Preserve wheel radius,
    // body width and height by scaling the complete closed/travel model uniformly.
    const wheelBounds = wheels.map(wheel => new THREE.Box3().setFromObject(wheel.pivot, true));
    const centers = wheelBounds.map(box => box.getCenter(new THREE.Vector3()));
    const center = centers.reduce((sum, value) => sum.add(value), new THREE.Vector3()).multiplyScalar(.25);
    const ground = Math.min(...wheelBounds.map(box => box.min.y));
    for (const child of car.children) {
      child.position.sub(new THREE.Vector3(center.x, ground, center.z)).multiplyScalar(scale);
      child.scale.multiplyScalar(scale);
    }
    car.updateMatrixWorld(true);
    bounds.setFromObject(car, true);
    const dimensions = bounds.getSize(new THREE.Vector3());
    car.userData.dimensions = { length: dimensions.z, width: dimensions.x, height: dimensions.y };
    car.userData.utilityBounds = { min: bounds.min.toArray(), max: bounds.max.toArray() };
    car.userData.headlights = [-1, 1].map(side => [side * .40 * scale, .70 * scale, (backhoe ? .76 : 1.27) * scale - center.z * scale]);

    for (const part of moving) part.removeFromParent();
    const chassis = new THREE.Box3().setFromObject(body, true);
    const wheelTop = Math.max(...wheels.map(wheel => new THREE.Box3().setFromObject(wheel.pivot, true).max.y));
    visuals = createModifierCar({ car, wheels, paint });
    const suspended = car.getObjectByName("modifier-body");
    for (const part of moving) suspended.add(part);
    const { rocket, housing, flame } = visuals.boosters;
    // The big rear booster must not occupy the digging boom or cargo doorway.
    // Reuse its real housing/flame and move it onto an outboard rear bracket.
    const big = rocket.getObjectByName("booster-rear");
    const plume = flame.getObjectByName("booster-rear-flame");
    big.position.x = chassis.max.x + .25;
    big.position.y = wheelTop + .75;
    plume.position.copy(big.position); plume.position.z -= .85 * big.scale.z;
    car.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(chassis.max.x * .5, big.position.y, chassis.min.z - 1), new THREE.Vector3(0, 0, 1));
    const contact = ray.intersectObject(body, true)[0]?.point ?? new THREE.Vector3(chassis.max.x * .5, big.position.y, chassis.min.z);
    const start = big.worldToLocal(contact.clone()), end = new THREE.Vector3();
    const mount = big.getObjectByName("booster-mount");
    mount.position.copy(start).multiplyScalar(.5);
    mount.scale.set(.16, .16, start.length() + .14);
    mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), end.sub(start).normalize());

    ray.set(new THREE.Vector3(-chassis.max.x * .75, chassis.max.y + 1, chassis.min.z + .9), new THREE.Vector3(0, -1, 0));
    const flagMount = ray.intersectObject(body, true)[0]?.point ?? new THREE.Vector3(-chassis.max.x * .75, chassis.max.y, chassis.min.z + .9);
    flag = createCarFlag("nz", { mountLength: .18 });
    flag.group.position.copy(flagMount).add(new THREE.Vector3(0, .025, -.18));
    suspended.add(flag.group);
    visuals.apply({ ...DEFAULTS, color: "yellow", engine: vehicle.engine });
    special.reset();
    return { vehicle, car, wheels, paint, rocket, housing, flame, visuals, flag, special, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
