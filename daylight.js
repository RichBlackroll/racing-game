import * as THREE from "three";

const { smoothstep, lerp } = THREE.MathUtils;
const palette = {
  nightHorizon: new THREE.Color(0x101c34), nightZenith: new THREE.Color(0x030815),
  dayHorizon: new THREE.Color(0xbfcbd0), dayZenith: new THREE.Color(0x427faa),
  duskHorizon: new THREE.Color(0xe7a078), duskZenith: new THREE.Color(0x414569),
  blueHorizon: new THREE.Color(0x355b9a), blueZenith: new THREE.Color(0x152c64),
  warmSun: new THREE.Color(0xff8b4e), noonSun: new THREE.Color(0xfff1db),
  nightAmbient: new THREE.Color(0x7298d5), dayAmbient: new THREE.Color(0xc4dce5),
  warmAmbient: new THREE.Color(0xeac0a4), blueAmbient: new THREE.Color(0x6c92e6),
  nightGround: new THREE.Color(0x222e4a), dayGround: new THREE.Color(0x555b43),
};

/** A deliberately cinematic 24-hour solar arc, not a latitude/date ephemeris. */
export function sampleDaylight(hour, level = "forest", result = {}) {
  hour = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : 16.5;
  const angle = (hour - 6) / 24 * Math.PI * 2;
  result.hour = hour;
  result.sunDirection ??= new THREE.Vector3();
  result.moonDirection ??= new THREE.Vector3();
  result.sunDirection.set(Math.cos(angle), Math.sin(angle) * 0.88,
    Math.sin(angle) * Math.sqrt(1 - 0.88 ** 2) * (level === "wellington" ? 1 : -1));
  result.moonDirection.copy(result.sunDirection).negate();
  const elevation = result.sunDirection.y;
  result.daylight = smoothstep(elevation, -0.15, 0.2);
  result.night = 1 - smoothstep(elevation, -0.12, 0.18);
  result.stars = level === "moon" ? 1 : 1 - smoothstep(elevation, -0.20, -0.045);
  result.twilight = 1 - smoothstep(Math.abs(elevation), 0.025, 0.35);
  // Elevation windows run in reverse at dawn: blue hour, warm glow, then daylight.
  result.warmGlow = smoothstep(elevation, -0.12, 0.015) * (1 - smoothstep(elevation, 0.12, 0.4));
  result.blueHour = smoothstep(elevation, -0.32, -0.16) * (1 - smoothstep(elevation, -0.10, 0.015));
  result.sunIntensity = 3.1 * smoothstep(elevation, -0.015, 0.10) * lerp(0.64, 1, Math.max(0, elevation));
  result.moonIntensity = 0.72 * result.night * smoothstep(-elevation, 0.015, 0.3);
  result.period = elevation < -0.26 ? "night" : elevation < -0.055 ? "blue-hour"
    : elevation < 0.10 ? (hour < 12 ? "sunrise" : "sunset")
    : elevation < 0.4 ? "golden-hour" : "daylight";
  for (const name of ["horizon", "zenith", "sunColor"]) result[name] ??= new THREE.Color();
  result.horizon.copy(palette.nightHorizon).lerp(palette.dayHorizon, result.daylight)
    .lerp(palette.blueHorizon, result.blueHour * 0.9).lerp(palette.duskHorizon, result.warmGlow * 0.8);
  result.zenith.copy(palette.nightZenith).lerp(palette.dayZenith, result.daylight)
    .lerp(palette.blueZenith, result.blueHour * 0.9).lerp(palette.duskZenith, result.warmGlow * 0.6);
  result.sunColor.copy(palette.warmSun).lerp(palette.noonSun, smoothstep(elevation, 0.02, 0.65));
  if (level === "moon") {
    result.horizon.set(0); result.zenith.set(0); result.sunColor.set(0xffffff);
  }
  return result;
}

// Decals, water, sky and bloom sprites must not turn into opaque shadow cards.
export function enableGeometryShadows(root) {
  root.traverse(object => {
    if (!object.isMesh || object.userData.celestial) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!materials.some(material => material?.isMeshStandardMaterial)) return;
    if (materials.some(material => !material.depthWrite || (material.transparent && !material.alphaTest))) return;
    object.castShadow = object.userData.castShadow !== false;
    object.receiveShadow = true;
  });
}

/** Owns the game clock and lighting. Advance only with active elapsed time, not the physics step.
 * setPerformanceMode(true) lowers shadow resolution, not refresh cadence (default false).
 */
export function createDaylight({ scene, renderer, level, tablet = false,
  reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false }) {
  const value = sampleDaylight(16.5, level);
  value.running = !reducedMotion;
  value.cycleMinutes = 12;
  const original = { environment: scene.environmentIntensity, exposure: renderer.toneMappingExposure };
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  const moon = new THREE.DirectionalLight(0x9dbbff, 0);
  const ambient = new THREE.HemisphereLight(0xc4dce5, 0x555b43, 0.85);
  sun.name = "DaylightSun"; moon.name = "DaylightMoon"; ambient.name = "DaylightAmbient";
  const radius = tablet ? 95 : 140;
  for (const [light, size] of [[sun, tablet ? 2048 : 4096], [moon, tablet ? 1024 : 2048]]) {
    light.castShadow = true;
    light.shadow.mapSize.setScalar(size);
    light.shadow.autoUpdate = false;
    Object.assign(light.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 1, far: 1400 });
    light.shadow.camera.updateProjectionMatrix();
    light.shadow.bias = -0.00008;
    light.shadow.normalBias = 0.065;
    scene.add(light, light.target);
  }
  scene.add(ambient);
  const center = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let disposed = false;
  let performanceMode = false;

  function update(position = center) {
    if (disposed) return value;
    center.copy(position);
    sun.color.copy(value.sunColor); sun.intensity = value.sunIntensity;
    moon.intensity = value.moonIntensity;
    ambient.color.copy(palette.nightAmbient).lerp(palette.dayAmbient, value.daylight);
    if (level !== "moon") ambient.color.lerp(palette.blueAmbient, value.blueHour * 0.8)
      .lerp(palette.warmAmbient, value.warmGlow * 0.22);
    ambient.groundColor.copy(palette.nightGround).lerp(palette.dayGround, value.daylight);
    ambient.intensity = lerp(0.24, level === "moon" ? 0.65 : 0.85, value.daylight) * (1 - value.twilight * 0.22);
    scene.environmentIntensity = lerp(0.075, level === "moon" ? 0.65 : 0.7, value.daylight) * (1 - value.twilight * 0.28);
    renderer.toneMappingExposure = lerp(1.12, 1.02, value.daylight);
    for (const [light, direction] of [[sun, value.sunDirection], [moon, value.moonDirection]]) {
      // Snap in light space, not world X/Z: a following shadow frustum otherwise crawls over surfaces.
      right.crossVectors(worldUp, direction).normalize();
      up.crossVectors(direction, right).normalize();
      const texel = radius * 2 / light.shadow.mapSize.x;
      light.target.position.copy(center);
      for (const axis of [right, up]) {
        const distance = center.dot(axis);
        light.target.position.addScaledVector(axis, Math.round(distance / texel) * texel - distance);
      }
      light.position.copy(light.target.position).addScaledVector(direction, 650);
      light.shadow.needsUpdate = light.intensity > 0;
    }
    // Per-light flags keep dark celestial sources out of the shadow render passes.
    renderer.shadowMap.needsUpdate = true;
    return value;
  }

  return {
    state: () => value,
    setHour(hour) { if (!disposed && Number.isFinite(hour)) sampleDaylight(hour, level, value); },
    setRunning(running) { if (!disposed && typeof running === "boolean") value.running = running; },
    setCycleMinutes(minutes) { if (!disposed && [3, 12, 30].includes(minutes)) value.cycleMinutes = minutes; },
    setPerformanceMode(enabled) {
      if (disposed || typeof enabled !== "boolean" || enabled === performanceMode) return;
      performanceMode = enabled;
      for (const [light, size] of [[sun, enabled ? 1024 : tablet ? 2048 : 4096],
        [moon, enabled ? 512 : tablet ? 1024 : 2048]]) {
        const shadow = light.shadow;
        if (shadow.mapSize.x === size && shadow.mapSize.y === size) continue;
        // Three only reallocates a shadow target when map is null, not on mapSize changes.
        shadow.dispose();
        shadow.map = shadow.mapPass = null;
        shadow.mapSize.setScalar(size);
      }
      update(); // Re-snap the following rig and invalidate the active source at the new texel size.
    },
    advance(dt) {
      // Slow frames keep the chosen day length; long stalls cannot skip an entire night.
      if (!disposed && value.running && Number.isFinite(dt) && dt > 0)
        sampleDaylight(value.hour + Math.min(dt, 1) * 24 / (value.cycleMinutes * 60), level, value);
    },
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const light of [sun, moon, ambient]) {
        light.removeFromParent(); light.target?.removeFromParent(); light.dispose();
      }
      scene.environmentIntensity = original.environment;
      renderer.toneMappingExposure = original.exposure;
    },
  };
}
