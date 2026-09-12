import * as THREE from "three";

/** Procedural, linear-HDR sky. time is the caller's reduced-motion-aware animation clock. */
export function createCelestialSky({ scene, level, tablet = false }) {
  const vacuum = level === "moon";
  const waterfront = level === "wellington";
  const sun = new THREE.Vector3(-0.55, 0.48, waterfront ? 0.38 : -0.38).normalize();
  // Cinematic angular diameters, not scale models. Saturn's rings span 1.34 degrees.
  const planets = [
    { name: "Venus", offset: -28, diameter: 0.56 },
    { name: "Mars", offset: 72, diameter: 0.60 },
    { name: "Jupiter", offset: 140, diameter: 0.96 },
    { name: "Saturn", offset: -115, diameter: 0.64 },
    { name: "Mercury", offset: 18, diameter: 0.50 },
  ];
  const uniforms = {
    uTime: { value: 0 },
    uVacuum: { value: vacuum ? 1 : 0 },
    uDaylight: { value: 1 },
    uNight: { value: 0 },
    uTwilight: { value: 0 },
    uWarmGlow: { value: 0 },
    uStars: { value: vacuum ? 1 : 0 },
    uHorizon: { value: new THREE.Color(vacuum ? 0 : waterfront ? 0xb7d4dd : level === "amsterdam" ? 0xc5d2ce : 0xbfc5bc) },
    uZenith: { value: new THREE.Color(vacuum ? 0 : 0x397caf) },
    uSunColor: { value: new THREE.Color(0xffe1ae) },
    uSunDirection: { value: sun },
    uMoonDirection: { value: sun.clone().negate() },
    uPlanets: { value: planets.map(p => new THREE.Vector4(0, 0, 0, THREE.MathUtils.degToRad(p.diameter / 2))) },
  };
  const blends = [["daylight", "uDaylight"], ["night", "uNight"], ["twilight", "uTwilight"],
    ["warmGlow", "uWarmGlow"], ["stars", "uStars"]];
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, tablet ? 32 : 48, tablet ? 16 : 24),
    new THREE.ShaderMaterial({
      name: "CelestialSkyMaterial",
      defines: { SKY_DETAIL: tablet ? 0 : 1 },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          // World directions stay aligned with controller lights, even under a transformed scene.
          vDirection = mat3(modelMatrix) * position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uVacuum;
        uniform float uDaylight;
        uniform float uNight;
        uniform float uTwilight;
        uniform float uWarmGlow;
        uniform float uStars;
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform vec3 uSunColor;
        uniform vec3 uSunDirection;
        uniform vec3 uMoonDirection;
        uniform vec4 uPlanets[5];
        varying vec3 vDirection;

        // Fixed seed, no time in the spatial hash and no sine-hash precision loss on mobile.
        vec3 hash3(vec3 p) {
          p = fract(p * vec3(0.1031, 0.1030, 0.0973) + 0.731);
          p += dot(p, p.yxz + 33.33);
          return fract((p.xxy + p.yxx) * p.zyx);
        }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash3(i).x, hash3(i + vec3(1,0,0)).x, f.x),
                         mix(hash3(i + vec3(0,1,0)).x, hash3(i + vec3(1,1,0)).x, f.x), f.y),
                     mix(mix(hash3(i + vec3(0,0,1)).x, hash3(i + vec3(1,0,1)).x, f.x),
                         mix(hash3(i + vec3(0,1,1)).x, hash3(i + vec3(1,1,1)).x, f.x), f.y), f.z);
        }
        float dust(vec3 p) {
          float value = noise(p) * 0.64 + noise(p * 2.07 + 17.0) * 0.26;
          #if SKY_DETAIL == 1
            value += noise(p * 4.13 + 43.0) * 0.10;
          #endif
          return value;
        }
        float disc(float distanceToCenter, float radius, float aa) {
          return 1.0 - smoothstep(radius - aa, radius + aa, distanceToCenter);
        }
        vec2 bodyUV(vec3 d, vec3 center, float radius) {
          vec3 pole = abs(center.y) > 0.98 ? vec3(0,0,1) : vec3(0,1,0);
          vec3 right = normalize(cross(pole, center));
          vec3 up = cross(center, right);
          return vec2(dot(d, right), dot(d, up)) / radius;
        }
        vec3 starLayer(vec2 uv, float face, float scale, float density, float seed) {
          vec2 p = uv * scale;
          vec3 h = hash3(vec3(floor(p), face + seed));
          vec2 delta = fract(p) - (0.3 + h.xy * 0.4);
          // Broaden subpixel stars with derivatives, preserving their integrated light.
          float pixel = max(length(fwidth(p)), 0.001);
          float radius = mix(0.014, 0.042, h.z * h.z);
          float width = sqrt(radius * radius + pixel * pixel * 0.20);
          float light = exp(-dot(delta, delta) / (2.0 * width * width));
          light *= radius * radius / (width * width);
          light *= step(1.0 - density, h.z) * mix(1.0, 5.5, pow(h.x, 6.0));
          light *= 1.0 - smoothstep(0.55, 1.3, pixel);
          float twinkle = 1.0 + (1.0 - uVacuum) * 0.09 * sin(uTime * (0.7 + h.y) + h.x * 90.0);
          return mix(vec3(0.65, 0.80, 1.0), vec3(1.0, 0.84, 0.63), h.y) * light * twinkle;
        }
        float crater(vec2 uv, vec2 center, float radius, float pixel) {
          vec2 p = (uv - center) / radius;
          float r = length(p);
          float aa = max(pixel / radius, 0.035);
          float bowl = disc(r, 0.78, aa);
          float rimDistance = (r - 0.88) / max(0.10, aa);
          float rim = exp(-rimDistance * rimDistance);
          return -0.16 * bowl + rim * (0.12 + 0.10 * dot(p, normalize(vec2(-1,1))));
        }
        void main() {
          vec3 d = normalize(vDirection);
          float elevation = max(d.y, 0.0);
          float aboveHorizon = smoothstep(-0.015, 0.065, d.y);
          float sunDistance = length(d - uSunDirection);
          float sunAA = max(fwidth(sunDistance), 0.00008);
          float sunDisc = disc(sunDistance, 0.00465, sunAA);
          float sunward = pow(max(dot(d, uSunDirection), 0.0), 5.0);
          vec3 color = vec3(0.0);
          float clouds = 0.0;
          if (uVacuum < 0.5) {
            float gradient = 1.0 - exp(-elevation * 3.0);
            color = mix(uHorizon, uZenith, gradient);
            color = mix(uHorizon * 0.85, color, smoothstep(-0.18, 0.025, d.y));
            vec3 amber = uSunColor * vec3(0.48, 0.22, 0.10);
            vec3 rose = vec3(0.22, 0.047, 0.082);
            float horizonHaze = exp(-abs(d.y - 0.045) * 7.0);
            color += mix(rose, amber, sunward) * horizonHaze * uWarmGlow * (0.18 + 0.82 * sunward);
            color += uSunColor * sunward * exp(-elevation * 2.8) * (0.035 * uDaylight);
            color += uSunColor * exp(-sunDistance * 18.0) * (0.12 * uDaylight + 0.22 * uWarmGlow);

            // Long, sheared cirrus strands. The night sky never inherits white daytime clouds.
            vec2 p = d.xz / max(d.y + 0.25, 0.15);
            p = mat2(0.87, -0.49, 0.49, 0.87) * p + vec2(uTime * 0.0018, uTime * 0.0005);
            float bend = noise(vec3(p * vec2(0.65, 1.7), 2.0));
            vec3 fibers = vec3(p.x * 0.85, p.y * 15.0 + bend * 3.0, 7.0);
            float strand = noise(fibers) * 0.7 + noise(fibers * 1.9) * 0.3;
            clouds = smoothstep(0.49, 0.77, strand) * smoothstep(0.40, 0.77, noise(vec3(p * vec2(0.4, 1.3), 19.0)));
            clouds *= smoothstep(0.04, 0.24, d.y) * (1.0 - smoothstep(0.80, 1.0, d.y));
          }

          // Cubical coordinates avoid the pinched star density of a latitude/longitude grid.
          float celestialVisibility = mix(aboveHorizon * (1.0 - clouds * 0.75), 1.0, uVacuum);
          if (uStars > 0.0) {
            vec3 ad = abs(d);
            vec2 starUV;
            float face;
            if (ad.x >= ad.y && ad.x >= ad.z) { starUV = d.yz / ad.x; face = d.x > 0.0 ? 0.0 : 1.0; }
            else if (ad.y >= ad.z) { starUV = d.xz / ad.y; face = d.y > 0.0 ? 2.0 : 3.0; }
            else { starUV = d.xy / ad.z; face = d.z > 0.0 ? 4.0 : 5.0; }
            starUV = starUV * 0.5 + 0.5;
            vec3 starlight = starLayer(starUV, face, 120.0, 0.080, 731.0);
            #if SKY_DETAIL == 1
              starlight += starLayer(starUV, face, 220.0, 0.025, 193.0) * 0.55;
            #endif
            // A tilted great circle with dark dust lanes, rather than a luminous painted stripe.
            float latitude = dot(d, normalize(vec3(-0.46, 0.58, 0.67)));
            float band = exp(-latitude * latitude * 52.0);
            float nebula = dust(d * 12.0 + 5.0);
            float lane = smoothstep(0.40, 0.68, noise(d * 28.0 + 31.0));
            vec3 galaxy = mix(vec3(0.016, 0.023, 0.042), vec3(0.043, 0.031, 0.026), nebula);
            galaxy *= band * (0.35 + nebula) * (1.0 - lane * 0.78);
            color += (starlight + galaxy) * uStars * celestialVisibility * mix(1.0, 0.22 + uNight * 0.38, uVacuum);
          }

          if (uVacuum < 0.5 && uStars > 0.0) {
            // Curtains between 10 and 40 degrees: visible from a driving camera, not just overhead.
            float azimuth = abs(d.x) + abs(d.z) < 0.00001 ? 0.0 : atan(d.z, d.x);
            float altitude = asin(clamp(d.y, -1.0, 1.0));
            vec3 auroraColor = vec3(0.0);
            for (int i = 0; i < 3; i++) {
              float layer = float(i);
              float phase = azimuth * 3.0 + layer * 2.1 + uTime * 0.018;
              float base = 0.23 + layer * 0.085 + 0.045 * sin(phase) + 0.025 * sin(phase * 2.0 - uTime * 0.012);
              float height = altitude - base;
              float curtain = exp(-max(height, 0.0) * 15.0) * smoothstep(-0.022, 0.022, height);
              float folds = 0.58 + 0.26 * sin(azimuth * 24.0 + sin(phase) * 4.0 + uTime * 0.055 + layer);
              folds += 0.16 * sin(azimuth * 57.0 - uTime * 0.035 + layer * 7.0);
              float arc = 0.3 + 0.7 * pow(0.5 + 0.5 * cos(azimuth * 2.0 + layer), 2.0);
              curtain *= folds * arc;
              vec3 tint = mix(vec3(0.035, 0.29, 0.16), vec3(0.025, 0.18, 0.23), layer * 0.35);
              tint = mix(tint, vec3(0.13, 0.045, 0.24), smoothstep(0.055, 0.19, height));
              auroraColor += tint * curtain;
            }
            float window = smoothstep(0.1745, 0.22, altitude) * (1.0 - smoothstep(0.60, 0.6981, altitude));
            color += auroraColor * window * uStars * (0.65 + 0.35 * uNight) * (1.0 - clouds * 0.5);
          }

          // The full moon uses local disc coordinates; craters never swim with time or the camera.
          vec2 moonUV = bodyUV(d, uMoonDirection, 0.0065);
          float moonR = length(moonUV);
          float moonAA = max(length(fwidth(moonUV)), 0.001);
          float moonDisc = disc(moonR, 1.0, moonAA) * step(0.0, dot(d, uMoonDirection));
          float moonDistance = length(d - uMoonDirection);
          float moonVisibility = (1.0 - uVacuum) * celestialVisibility * (1.0 - 0.78 * uDaylight);
          color += vec3(0.09, 0.13, 0.20) * exp(-moonDistance * 48.0) * moonVisibility * uNight;
          if (moonDisc > 0.0 && uVacuum < 0.5) {
            // Derivatives are evaluated above the disc branch so mobile edge quads remain defined.
            float moonTexture = dust(vec3(moonUV * 3.5, 41.0));
            float maria = smoothstep(0.36, 0.64, moonTexture);
            float relief = crater(moonUV, vec2(-0.40, 0.33), 0.23, moonAA);
            relief += crater(moonUV, vec2(0.27, -0.37), 0.16, moonAA);
            relief += crater(moonUV, vec2(0.51, 0.31), 0.12, moonAA);
            relief += crater(moonUV, vec2(-0.20, -0.60), 0.09, moonAA);
            float limb = sqrt(max(0.0, 1.0 - min(moonR * moonR, 1.0)));
            vec3 moonColor = mix(vec3(0.38, 0.43, 0.49), vec3(0.91, 0.88, 0.79), maria);
            moonColor *= (0.74 + 0.26 * limb) * (1.0 + relief) * 1.8;
            color = mix(color, moonColor, moonDisc * moonVisibility);
          }

          // Fixed solar elongations on a shared ecliptic; small, recognizable accents, not giant props.
          if (uStars > 0.0 || uTwilight > 0.0 || uVacuum > 0.5) {
            for (int i = 0; i < 5; i++) {
              vec4 planet = uPlanets[i];
              vec2 uv = bodyUV(d, planet.xyz, planet.w);
              float r = length(uv);
              float aa = max(length(fwidth(uv)), 0.002);
              float mask = disc(r, 1.0, aa) * step(0.0, dot(d, planet.xyz));
              float z = sqrt(max(0.0, 1.0 - min(r * r, 1.0)));
              float shading = 0.24 + 0.76 * max(0.0, dot(vec3(uv, z), normalize(vec3(-0.35, 0.25, 1.0))));
              vec3 tint = vec3(0.88, 0.79, 0.56);
              if (i == 1) tint = vec3(0.71, 0.25, 0.12) * (0.8 + 0.2 * noise(vec3(uv * 5.0, 3.0)));
              if (i == 2) {
                float phase = uv.y * 19.0 + sin(uv.x * 4.0) * 0.6;
                float footprint = fwidth(phase);
                float belts = sin(phase) * exp(-0.5 * footprint * footprint);
                tint = mix(vec3(0.48, 0.28, 0.16), vec3(0.91, 0.79, 0.61), 0.5 + 0.5 * belts);
                float spot = disc(length((uv - vec2(-0.28, -0.3)) / vec2(0.28, 0.16)), 1.0, aa * 5.0);
                tint = mix(tint, vec3(0.62, 0.24, 0.13), spot * 0.7);
              }
              if (i == 4) tint = vec3(0.48, 0.45, 0.41);
              float visibility = celestialVisibility * mix(uStars, 1.0, uVacuum);
              if (i == 0 || i == 4) visibility = celestialVisibility * mix(max(uStars, uTwilight * 0.8), 1.0, uVacuum);
              if (i == 3) {
                vec2 ringUV = mat2(0.91, -0.415, 0.415, 0.91) * uv;
                float ringR = length(ringUV / vec2(1.0, 0.38));
                float ringAA = max(fwidth(ringR), 0.002);
                float rings = disc(ringR, 2.1, ringAA) * (1.0 - disc(ringR, 1.28, ringAA));
                float gap = disc(abs(ringR - 1.75), 0.055, ringAA);
                rings *= (1.0 - gap * 0.8) * step(0.0, dot(d, planet.xyz));
                // The far half disappears behind the globe; the near half crosses in front.
                float front = step(ringUV.y, 0.0);
                color = mix(color, vec3(0.63, 0.55, 0.39), rings * (1.0 - front) * visibility * 0.8);
                color = mix(color, tint * shading, mask * visibility);
                color = mix(color, vec3(0.73, 0.65, 0.47), rings * front * visibility * 0.85);
              } else {
                color = mix(color, tint * shading * (i == 0 ? 2.2 : 1.25), mask * visibility);
              }
            }
          }

          if (uVacuum < 0.5) {
            vec3 cloudColor = mix(uHorizon * 0.65, vec3(0.91, 0.93, 0.94), uDaylight);
            cloudColor = mix(cloudColor, uSunColor * vec3(0.95, 0.48, 0.34), uWarmGlow * sunward * 0.7);
            color = mix(color, cloudColor, clouds * (0.12 + 0.14 * uDaylight));
          }
          // Vacuum still has the moving sun, but no atmospheric aureole or extra moon disc.
          color += uSunColor * 12.0 * sunDisc * mix(aboveHorizon * (1.0 - clouds * 0.65), 1.0, uVacuum);
          gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  sky.name = "AtmosphereSky";
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  sky.castShadow = false;
  sky.receiveShadow = false;
  sky.userData.planets = planets;
  scene.add(sky);
  const pole = new THREE.Vector3(0, 0.917, -0.399).normalize();
  const tangent = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let disposed = false;

  function update({ state, time, eye } = {}) {
    if (disposed) return;
    if (state) {
      for (const [key, name] of blends) {
        if (Number.isFinite(state[key])) uniforms[name].value = THREE.MathUtils.clamp(state[key], 0, 1);
      }
      if (state.sunDirection?.isVector3) sun.copy(state.sunDirection);
      if (state.moonDirection?.isVector3) uniforms.uMoonDirection.value.copy(state.moonDirection);
      if (state.sunColor?.isColor) uniforms.uSunColor.value.copy(state.sunColor);
      if (vacuum) {
        uniforms.uStars.value = 1;
      } else {
        if (state.horizon?.isColor) uniforms.uHorizon.value.copy(state.horizon);
        if (state.zenith?.isColor) uniforms.uZenith.value.copy(state.zenith);
      }
    }
    if (Number.isFinite(time)) uniforms.uTime.value = time;
    if (eye) {
      sky.position.copy(eye);
      scene.worldToLocal(sky.position);
    }
    if (state) {
      tangent.crossVectors(pole, sun);
      if (tangent.lengthSq() < 0.0001) tangent.set(1, 0, 0).cross(sun);
      tangent.normalize();
      for (let i = 0; i < planets.length; i++) {
        const angle = THREE.MathUtils.degToRad(planets[i].offset);
        direction.copy(sun).multiplyScalar(Math.cos(angle)).addScaledVector(tangent, Math.sin(angle));
        uniforms.uPlanets.value[i].set(direction.x, direction.y, direction.z, uniforms.uPlanets.value[i].w);
      }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    sky.removeFromParent();
    sky.geometry.dispose();
    sky.material.dispose();
  }

  update({ state: {} });
  return { sky, update, dispose };
}
