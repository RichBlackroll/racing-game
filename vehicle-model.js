import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createModifierCar } from "./modifier-car.js";
import { getVehicle } from "./vehicle-data.js";

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
  const paint = new THREE.MeshStandardMaterial({
    name: "vehicle-paint", color: 0xc60920, metalness: 0.12, roughness: 0.26, side: THREE.DoubleSide,
  });
  const sourceResources = resourcesOf(model), resources = new Set([paint]), temporary = new Set();
  let visuals;
  function mesh(geometry, material, parent = car, x = 0, y = 0, z = 0) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.receiveShadow = true;
    parent.add(object);
    for (const resource of resourcesOf(object)) resources.add(resource);
    return object;
  }
  function dispose() {
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
    let painted = false;
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
          material.emissiveIntensity = 1.3;
          material.transparent = false;
          material.opacity = 1;
        }
        if (tesla && ["Glass", "LED_PHARE", "Material.004"].includes(name)) {
          // In this model Glass means headlight covers, not the cabin windows.
          material.color.set(0xd7e8f4);
          material.metalness = 0.25;
          material.roughness = 0.16;
          if (name === "LED_PHARE") {
            material.emissive.set(0xe2f5ff);
            material.emissiveIntensity = 1.1;
          }
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
      const key = material.uuid + (isWheel ? `:${Math.sign(center.x)}:${Math.sign(center.z)}` : ":body");
      if (!parts.has(key)) parts.set(key, { material, geometries: [], isWheel });
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
      parts.get(key).geometries.push(geometry);
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

    const metal = new THREE.MeshStandardMaterial({ color: 0xaeb4b6, metalness: 0.9, roughness: 0.25 });
    const rocket = new THREE.Group();
    rocket.position.set(0, 0.65, -2.85);
    car.add(rocket);
    const housing = mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.65, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x727b82, metalness: 0.8, roughness: 0.32, side: THREE.DoubleSide }), rocket);
    housing.rotation.x = Math.PI / 2;
    const throat = mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.85 }), rocket, 0, 0, 0.18);
    throat.rotation.x = Math.PI / 2;
    mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 24), metal, rocket, 0, 0, -0.325);
    const flame = new THREE.Group();
    rocket.add(flame);
    flame.visible = false;
    const outer = mesh(new THREE.ConeGeometry(0.27, 2.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xff4910, emissive: 0xff3000, emissiveIntensity: 7, roughness: 1 }), flame, 0, 0, -1.5);
    outer.rotation.x = -Math.PI / 2;
    const inner = mesh(new THREE.ConeGeometry(0.17, 1.5, 16),
      new THREE.MeshStandardMaterial({ color: 0xffedaf, emissive: 0xffcc56, emissiveIntensity: 15, roughness: 0.85 }), flame, 0, 0, -1.08);
    inner.rotation.x = -Math.PI / 2;
    visuals = createModifierCar({ car, wheels, paint, rocket });
    disposeResources(sourceResources, resources);
    return { vehicle, car, wheels, paint, rocket, housing, flame, visuals, dispose };
  } catch (error) {
    for (const resource of sourceResources) resources.add(resource);
    dispose();
    throw error;
  } finally {
    for (const geometry of temporary) geometry.dispose();
  }
}
