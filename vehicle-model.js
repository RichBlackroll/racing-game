import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createModifierCar } from "./modifier-car.js";
import { getVehicle } from "./vehicle-data.js";
import { createCarFlag } from "./car-flag.js";

function resourcesOf(model) {
  const resources = new Set();
  model.traverse((object) => {
    if (!object.isMesh) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material)) {
        if (!value?.isTexture) continue;
        resources.add(value);
        // Texture.dispose does not close shared ImageBitmaps decoded by GLTFLoader.
        for (const image of Array.isArray(value.image) ? value.image : [value.image]) {
          if (typeof image?.close === "function") resources.add(image);
        }
      }
    }
  });
  return resources;
}

function disposeResources(resources, retained = new Set()) {
  for (const resource of resources) {
    if (retained.has(resource)) continue;
    if (typeof resource.dispose === "function") resource.dispose();
    else resource.close();
  }
  resources.clear();
}

export async function loadVehicleModel(id, { signal } = {}) {
  const vehicle = getVehicle(id);
  const response = await fetch(vehicle.file, { signal });
  if (!response.ok) throw new Error(`Could not load ${vehicle.name} (${response.status}).`);
  const bytes = await response.arrayBuffer();
  signal?.throwIfAborted();
  // Both licensed GLBs are self-contained and need no runtime compression decoder.
  const { scene } = await new GLTFLoader().parseAsync(bytes, "");
  if (signal?.aborted) {
    disposeResources(resourcesOf(scene));
    signal.throwIfAborted();
  }
  return prepareVehicleModel(scene, vehicle.id);
}

// Each load owns its resources. +Y is up and +Z is forward in both local assets.
export function prepareVehicleModel(model, id) {
  const vehicle = getVehicle(id), tesla = vehicle.id === "tesla";
  const car = new THREE.Group();
  car.name = vehicle.id;
  car.userData.nightVehicle = true;
  const paint = new THREE.MeshStandardMaterial({
    name: "vehicle-paint", color: 0xc60920, metalness: 0.12, roughness: 0.26, side: THREE.DoubleSide,
  });
  const sourceResources = resourcesOf(model), resources = new Set([paint]), temporary = new Set();
  let visuals, flag;
  function mesh(geometry, material, parent = car, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.receiveShadow = true;
    parent.add(object);
    for (const resource of resourcesOf(object)) resources.add(resource);
    return object;
  }
  function dispose() {
    flag?.dispose();
    visuals?.dispose();
    disposeResources(resources);
    car.removeFromParent();
    car.clear();
  }
  try {
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
    const length = Math.max(size.x, size.z);
    if (!Number.isFinite(length) || length <= 0) throw new Error(`${vehicle.name} has no car geometry.`);
    model.scale.multiplyScalar(4.6 / length);
    model.updateMatrixWorld(true);
    bounds.setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= bounds.min.y;
    model.updateMatrixWorld(true);

    // Bake transforms and batch materials, keeping each wheel corner independent.
    const parts = new Map();
    const headlightBounds = [new THREE.Box3(), new THREE.Box3()], point = new THREE.Vector3();
    let painted = false, porscheHeadlight;
    model.traverse((object) => {
      if (!object.isMesh) return;
      let material = object.material;
      const name = material.name || "";
      if (tesla ? name === "CAR_PAINT" : name.includes("Paint_Material")) {
        material = paint;
        painted = true;
      } else {
        if (tesla ? name === "Material.017" : name.includes("Window")) {
          material.color.set(0x25313b);
          material.metalness = 0.35;
          material.roughness = 0.1;
          material.transparent = false;
          material.opacity = 1;
          if ("transmission" in material) material.transmission = 0;
        }
        if (tesla ? ["Material.002", "Material.007"].includes(name) : name.includes("RED_GLASS")) {
          material.color.set(0x9e0010);
          material.emissive.set(0xff0310);
          material.emissiveIntensity = 0;
          Object.assign(material.userData, { nightIntensity: 1.3, brakeIntensity: 3, nightRole: "taillight" });
          material.transparent = false;
          material.opacity = 1;
        }
        if (tesla && ["Glass", "LED_PHARE", "Material.004"].includes(name)) {
          // In this model Glass means headlight covers, not the cabin windows.
          material.color.set(0xd7e8f4);
          material.metalness = 0.25;
          material.roughness = 0.16;
          material.emissive.set(0xe2f5ff);
          material.emissiveIntensity = 0;
          Object.assign(material.userData, { nightIntensity: name === "LED_PHARE" ? 1.8 : 0.6, nightRole: "headlight" });
        }
        if (tesla && ["Material.003", "Material.011", "Material.012"].includes(name)) {
          material.metalness = 0.8;
          material.roughness = 0.28;
        }
        material.side = THREE.DoubleSide;
      }
      let geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
      temporary.add(geometry);
      geometry.computeBoundingBox();
      const center = geometry.boundingBox.getCenter(new THREE.Vector3());
      const isWheel = tesla ? object.name.startsWith("wheel") : name.includes("_Wheel1A_");
      if (geometry.index) {
        const indexed = geometry;
        geometry = indexed.toNonIndexed();
        temporary.add(geometry);
        indexed.dispose();
        temporary.delete(indexed);
      }
      for (const attribute of Object.keys(geometry.attributes)) {
        if (!["position", "normal", "uv"].includes(attribute)) geometry.deleteAttribute(attribute);
      }
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      if (!geometry.attributes.uv) geometry.setAttribute("uv",
        new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
      const pieces = [];
      if (!tesla && name.includes("LightA_Material")) {
        // This atlas also covers rear/reversing lamps. Split front triangles once,
        // rather than turning the entire shared light atlas into white emission.
        if (!porscheHeadlight) {
          porscheHeadlight = material.clone();
          porscheHeadlight.name = `${name}/headlights`;
          porscheHeadlight.emissive.set(0xe2f5ff); porscheHeadlight.emissiveIntensity = 0;
          Object.assign(porscheHeadlight.userData, { nightIntensity: 1.5, nightRole: "headlight" });
          resources.add(porscheHeadlight);
        }
        const front = [], other = [], positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i += 3) {
          const indices = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3 > 1.2 ? front : other;
          indices.push(i, i + 1, i + 2);
        }
        for (const [indices, mat] of [[front, porscheHeadlight], [other, material]]) {
          if (!indices.length) continue;
          geometry.setIndex(indices);
          const piece = geometry.toNonIndexed(); temporary.add(piece);
          pieces.push({ geometry: piece, material: mat });
        }
        geometry.dispose(); temporary.delete(geometry);
      } else pieces.push({ geometry, material });
      for (const piece of pieces) {
        const key = piece.material.uuid + (isWheel ? `:${Math.sign(center.x)}:${Math.sign(center.z)}` : ":body");
        if (!parts.has(key)) parts.set(key, { material: piece.material, geometries: [], isWheel });
        parts.get(key).geometries.push(piece.geometry);
        if (piece.material.userData.nightRole === "headlight") {
          const positions = piece.geometry.attributes.position;
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i);
            headlightBounds[point.x < 0 ? 0 : 1].expandByPoint(point);
          }
        }
      }
    });
    const wheels = [];
    for (const { material, geometries, isWheel } of parts.values()) {
      const merged = mergeGeometries(geometries);
      if (!merged) throw new Error(`${vehicle.name} has incompatible mesh attributes.`);
      temporary.add(merged);
      const geometry = mergeVertices(merged, 1e-5);
      if (isWheel) {
        geometry.computeBoundingBox();
        const center = geometry.boundingBox.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -center.y, -center.z);
        const pivot = new THREE.Group();
        pivot.position.copy(center);
        car.add(pivot);
        wheels.push({ pivot, tire: mesh(geometry, material, pivot), hub: new THREE.Group(), front: center.z > 0 });
      } else mesh(geometry, material);
      for (const part of [...geometries, merged]) {
        part.dispose();
        temporary.delete(part);
      }
    }
    const corners = new Set(wheels.map(({ pivot, front }) => `${Math.sign(pivot.position.x)}:${front}`));
    if (!painted || corners.size !== 4) throw new Error(`${vehicle.name} is missing paint or wheel bindings.`);

    visuals = createModifierCar({ car, wheels, paint });
    const { rocket, housing, flame } = visuals.boosters;
    // Reach the real rear bumper while keeping the mast behind the largest wing.
    const body = car.getObjectByName("modifier-body");
    car.updateMatrixWorld(true);
    const rearRay = new THREE.Raycaster(new THREE.Vector3(.78, .72 + body.position.y, -5), new THREE.Vector3(0, 0, 1));
    const rear = rearRay.intersectObjects(body.children.filter(object => object.isMesh), false)[0];
    const mount = rear ? body.worldToLocal(rear.point) : new THREE.Vector3(.78, .72, -2.3);
    flag = createCarFlag("nz", { mountLength: mount.z + 3.4 });
    flag.group.position.set(mount.x, mount.y, -3.4);
    body.add(flag.group);
    car.userData.headlights = headlightBounds.map((bounds, i) => bounds.isEmpty()
      ? [i === 0 ? -0.73 : 0.73, 0.74, 2.3]
      : [bounds.getCenter(point).x, point.y, bounds.max.z + 0.06]);
    disposeResources(sourceResources, resources);
    return { vehicle, car, wheels, paint, rocket, housing, flame, visuals, flag, dispose };
  } catch (error) {
    for (const resource of sourceResources) resources.add(resource);
    dispose();
    throw error;
  } finally {
    for (const geometry of temporary) geometry.dispose();
  }
}
