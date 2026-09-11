import * as THREE from "three";
import { enableGeometryShadows } from "./daylight.js";

// Continuous glazing keeps its existing batches and daytime finish. Only a
// deterministic subset of inset rooms emits, never the entire glass envelope.
export function occupiedWindowEmission(material) {
  material.emissive.set(0xffcf91);
  material.emissiveIntensity = 0;
  material.userData.nightIntensity = 0.85;
  material.userData.nightColor = 0xffcf91;
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    shader.vertexShader = "varying vec3 vRoomPosition; varying vec3 vRoomNormal;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `
      #include <worldpos_vertex>
      vec4 roomPosition = vec4(transformed, 1.0);
      vec3 roomNormal = normal;
      #ifdef USE_INSTANCING
        roomPosition = instanceMatrix * roomPosition;
        roomNormal = mat3(instanceMatrix) * roomNormal;
      #endif
      vRoomPosition = (modelMatrix * roomPosition).xyz;
      vRoomNormal = normalize(mat3(modelMatrix) * roomNormal);
    `);
    shader.fragmentShader = "varying vec3 vRoomPosition; varying vec3 vRoomNormal;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", `
      #include <emissivemap_fragment>
      float across = abs(vRoomNormal.z) > abs(vRoomNormal.x) ? vRoomPosition.x : vRoomPosition.z;
      vec2 room = vec2(across / 2.5, vRoomPosition.y / 3.3);
      vec2 cell = floor(room);
      float occupied = step(0.64, fract(sin(dot(cell, vec2(12.9898, 78.233))
        + floor(dot(vRoomPosition.xz, abs(vRoomNormal.xz)) * 0.25)) * 43758.5453));
      vec2 edge = min(fract(room), 1.0 - fract(room));
      vec2 inset = smoothstep(vec2(0.12, 0.18), vec2(0.12, 0.18) + max(fwidth(room), vec2(0.015)), edge);
      totalEmissiveRadiance *= occupied * inset.x * inset.y * (1.0 - step(0.35, abs(vRoomNormal.y)));
    `);
  };
  material.customProgramCacheKey = () => `${cacheKey}/occupied-rooms-v1`;
  return material;
}

/** Create after scenery and racers. Update before hiding the car for cockpit.
 * Static descriptor positions are GROUP-LOCAL and frozen in world space here.
 * The caller owns materials and renderer.shadowMap.needsUpdate; we own lights.
 * dt is seconds, defaulting to 1/60 and capped at 0.1 for 0.25-second fades.
 */
export function createNightLighting({ scene, tablet = false }) {
  const bindings = new Map(), playerBindings = new Map(), anchors = [];
  const headlights = [], streets = [];
  const eye = new THREE.Vector3(), beam = new THREE.Vector3(0, -1.4, 38), inverseScene = new THREE.Matrix4();
  let disposed = false, currentModel, currentCar, body, nightValue = 0, modelScans = 0;
  let lensPositions = [];

  function bind(material, target) {
    if (!material?.emissive || !Number.isFinite(material.userData.nightIntensity)) return;
    if (!target.has(material)) target.set(material, {
      intensity: material.emissiveIntensity, color: material.emissive.clone(),
      nightIntensity: Math.max(0, material.userData.nightIntensity),
      brakeIntensity: Math.max(0, material.userData.brakeIntensity ?? 0),
    });
    if (material.userData.nightColor !== undefined) material.emissive.set(material.userData.nightColor);
  }
  function restore(target) {
    for (const [material, initial] of target) {
      material.emissiveIntensity = initial.intensity;
      material.emissive.copy(initial.color);
    }
    target.clear();
  }
  scene.updateWorldMatrix(true, true);
  function collect(object) {
    // Player materials are rebound separately on identity changes, so a disposed
    // GLTF is never retained in the static material collection after a swap.
    if (object.userData.nightVehicle) return;
    for (const descriptor of object.userData.nightLights ?? []) {
      if (!Array.isArray(descriptor.position) || descriptor.position.length !== 3
        || !descriptor.position.every(Number.isFinite) || !(descriptor.distance > 0)
        || !Number.isFinite(descriptor.distance) || !(descriptor.intensity > 0)
        || !Number.isFinite(descriptor.intensity)) continue;
      const position = new THREE.Vector3().fromArray(descriptor.position).applyMatrix4(object.matrixWorld);
      const target = position.clone().add(new THREE.Vector3(0, -1, 0).transformDirection(object.matrixWorld));
      anchors.push({ position, target, color: new THREE.Color(descriptor.color ?? 0xffcf91),
        intensity: descriptor.intensity, distance: descriptor.distance, score: 0 });
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) bind(material, bindings);
    for (const child of object.children) collect(child);
  }
  collect(scene);

  function spot(name, mapSize, distance, angle) {
    const light = new THREE.SpotLight(0xffffff, 0, distance, angle, 0.6, 2);
    light.name = name;
    light.target.name = `${name}/target`;
    light.castShadow = true;
    light.shadow.mapSize.setScalar(mapSize);
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = false;
    light.shadow.camera.near = 0.1;
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.035;
    scene.add(light, light.target);
    return light;
  }
  for (let i = 0; i < 2; i++) headlights.push(spot(`night/player-headlight-${i}`, tablet ? 512 : 1024, 85, Math.PI / 7));
  // Small pooled shadow maps keep street illumination from leaking through
  // buildings without allocating an actual light or shadow map per fixture.
  for (let i = 0; i < (tablet ? 2 : 4); i++) streets.push({
    light: spot(`night/street-${i}`, 512, 24, Math.PI * 0.42), anchor: null, gain: 0,
  });
  const candidates = [], desired = new Set(), assigned = new Set();

  function update({ night, car, vehicleModel, braking = false, dt = 1 / 60, snap = false }) {
    if (disposed) return;
    const fadeStep = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) / 0.25 : 0;
    nightValue = Number.isFinite(night) ? THREE.MathUtils.clamp(night, 0, 1) : 0;
    if (currentModel !== vehicleModel || currentCar !== car) {
      restore(playerBindings);
      currentModel = vehicleModel; currentCar = car; body = null; lensPositions = [];
      const root = vehicleModel?.car;
      if (root) {
        enableGeometryShadows(root);
        modelScans++;
        root.traverse(object => {
          if (object.name === "modifier-body") body = object;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            bind(material, playerBindings);
          }
        });
        body ??= root;
        lensPositions = (root.userData.headlights ?? [])
          .map(position => new THREE.Vector3().fromArray(position));
      }
    }
    for (const [material, binding] of bindings) material.emissiveIntensity = binding.nightIntensity * nightValue;
    for (const [material, binding] of playerBindings) {
      material.emissiveIntensity = Math.max(binding.nightIntensity * nightValue, braking ? binding.brakeIntensity : 0);
    }
    scene.updateWorldMatrix(true, false);
    inverseScene.copy(scene.matrixWorld).invert();
    if (car) { car.updateWorldMatrix(true, false); eye.setFromMatrixPosition(car.matrixWorld); }
    if (body) body.updateWorldMatrix(true, false);
    for (let i = 0; i < headlights.length; i++) {
      const light = headlights[i], position = lensPositions[i];
      light.intensity = body && car && position ? 900 * nightValue : 0;
      if (body && position) {
        light.position.copy(position).applyMatrix4(body.matrixWorld).applyMatrix4(inverseScene);
        light.target.position.copy(position).add(beam)
          .applyMatrix4(body.matrixWorld).applyMatrix4(inverseScene);
        light.updateMatrixWorld(); light.target.updateMatrixWorld();
      }
      light.shadow.needsUpdate = light.intensity > 0;
    }

    candidates.length = 0; desired.clear(); assigned.clear();
    for (const slot of streets) if (slot.anchor) assigned.add(slot.anchor);
    if (car && nightValue > 0) for (const anchor of anchors) {
      const distance = eye.distanceTo(anchor.position);
      // Local finite illumination plus an earlier camera-distance fade. A little
      // assignment hysteresis prevents two equidistant lamps trading every frame.
      anchor.score = distance * (assigned.has(anchor) ? 0.85 : 1);
      if (distance < anchor.distance * 3) candidates.push(anchor);
    }
    candidates.sort((a, b) => a.score - b.score);
    for (let i = 0; i < Math.min(streets.length, candidates.length); i++) desired.add(candidates[i]);
    for (const slot of streets) {
      const retained = desired.has(slot.anchor), empty = !slot.anchor;
      slot.gain = snap ? Number(retained) : THREE.MathUtils.clamp(slot.gain + (retained ? fadeStep : -fadeStep), 0, 1);
      // Roundoff must not delay a completed fade by another render frame.
      if (fadeStep > 0 && Math.abs(slot.gain - Number(retained)) < 1e-12) slot.gain = Number(retained);
      if (!nightValue || !car) slot.gain = 0;
      if (slot.gain === 0 && !retained) {
        assigned.delete(slot.anchor);
        slot.anchor = candidates.find(anchor => desired.has(anchor) && !assigned.has(anchor)) ?? null;
        if (slot.anchor) {
          assigned.add(slot.anchor);
          if (empty) slot.gain = fadeStep;
          slot.light.position.copy(slot.anchor.position).applyMatrix4(inverseScene);
          slot.light.target.position.copy(slot.anchor.target).applyMatrix4(inverseScene);
          slot.light.color.copy(slot.anchor.color); slot.light.distance = slot.anchor.distance;
          slot.light.updateMatrixWorld(); slot.light.target.updateMatrixWorld();
        }
      }
      const anchor = slot.anchor;
      if (snap) slot.gain = anchor && nightValue > 0 && car ? 1 : 0;
      const fade = anchor && car ? 1 - THREE.MathUtils.smoothstep(eye.distanceTo(anchor.position), anchor.distance * 1.5, anchor.distance * 3) : 0;
      slot.light.intensity = anchor ? anchor.intensity * nightValue * THREE.MathUtils.smoothstep(slot.gain, 0, 1) * fade : 0;
      slot.light.shadow.needsUpdate = slot.light.intensity > 0;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true; nightValue = 0;
    restore(bindings); restore(playerBindings);
    for (const light of [...headlights, ...streets.map(slot => slot.light)]) {
      light.intensity = 0; light.shadow.needsUpdate = false;
      light.removeFromParent(); light.target.removeFromParent(); light.dispose();
    }
    headlights.length = 0; streets.length = 0; anchors.length = 0; candidates.length = 0;
    desired.clear(); assigned.clear(); lensPositions = []; body = currentModel = currentCar = null;
  }
  return { update, dispose, state: () => ({ disposed, night: nightValue,
    materials: bindings.size + playerBindings.size, playerMaterials: playerBindings.size,
    anchors: anchors.length, headlights: headlights.length, streetlights: streets.length,
    shadowedLights: headlights.length + streets.length, activeStreetlights: streets.filter(slot => slot.light.intensity > 0).length, modelScans,
  }) };
}
