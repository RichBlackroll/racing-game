import * as THREE from "three";
import { createCelestialSky } from "./celestial-sky.js";

/**
 * Create after level scenery; set camera.far >= 1400 and updateProjectionMatrix().
 * Call setDaylight(controllerState) before each render(timeSeconds).
 * resize() follows the caller's setSize/setPixelRatio (including adaptive budgets);
 * render() also checks dimensions. dispose() before replacing the level.
 * setPerformanceMode(true) bypasses HDR bloom until disabled (default false).
 * Owns a full-canvas render, not a composer pass; leaves exposure/environment alone.
 */
export function createAtmosphere({ scene, renderer, camera, level, tablet = false }) {
  const moon = level === "moon";
  const forest = level === "forest";
  const waterfront = level === "wellington";
  const amsterdam = level === "amsterdam";
  const previousFog = scene.fog;
  const horizon = new THREE.Color(waterfront ? 0xb7d4dd : amsterdam ? 0xc5d2ce : 0xbfc5bc);
  // A softer density than the near-field fog keeps 250-650 m ridges in the haze.
  const fog = moon ? null : new THREE.FogExp2(horizon, waterfront ? 0.00016 : amsterdam ? 0.0015 : forest ? 0.0016 : 0.0025);
  scene.fog = fog;

  const motionQuery = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const eye = new THREE.Vector3();
  const bufferSize = new THREE.Vector2();
  const logicalSize = new THREE.Vector2();
  const previousViewport = new THREE.Vector4();
  let animationTime = 0;
  let previousTime;
  let disposed = false;
  let performanceMode = false;
  const celestial = createCelestialSky({ scene, level, tablet });
  const { sky } = celestial;
  let pollen = null;

  if (forest || level === "stunt") {
    const count = tablet ? (forest ? 80 : 40) : (forest ? 200 : 100);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    let seed = 731;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = random() * 64;
      positions[i * 3 + 1] = 0.8 + random() * 12;
      positions[i * 3 + 2] = random() * 64;
      seeds[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    pollen = new THREE.Points(geometry, new THREE.ShaderMaterial({
      name: "AtmospherePollenMaterial",
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uEye: { value: eye },
        uHeight: { value: 1 },
        uPixelRatio: { value: 1 },
        uDaylight: { value: 1 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uEye;
        uniform float uHeight;
        uniform float uPixelRatio;
        uniform float uDaylight;
        attribute float aSeed;
        varying float vOpacity;
        void main() {
          vec3 p = position;
          p.x += uTime * (0.11 + aSeed * 0.07);
          p.z += uTime * 0.045;
          p.y += uEye.y - 3.0 + sin(uTime * 0.32 + aSeed * 30.0) * 0.35;
          vec2 offset = mod(p.xz - uEye.xz + 32.0, 64.0) - 32.0;
          p.xz = uEye.xz + offset;
          vec4 view = viewMatrix * vec4(p, 1.0);
          float distanceToEye = length(p - uEye);
          vOpacity = (1.0 - smoothstep(18.0, 30.0, length(offset)));
          vOpacity *= smoothstep(2.0, 6.0, distanceToEye);
          vOpacity *= 1.0 - smoothstep(12.0, 24.0, abs(p.y - uEye.y));
          vOpacity *= 0.12 + aSeed * 0.12;
          vOpacity *= uDaylight;
          gl_Position = projectionMatrix * view;
          gl_PointSize = clamp(0.027 * uHeight * projectionMatrix[1][1] / max(-view.z, 0.1),
                               1.0, 2.5 * uPixelRatio);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vOpacity;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float alpha = (1.0 - smoothstep(0.1, 1.0, r)) * vOpacity;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(0.86, 0.79, 0.57, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    }));
    pollen.name = "AtmospherePollen";
    pollen.frustumCulled = false;
    scene.add(pollen);
  }

  const gl = renderer.getContext();
  const hdrSupported = renderer.extensions.has("EXT_color_buffer_float");
  let samples = 0;
  if (hdrSupported && !tablet) {
    // MAX_SAMPLES alone does not guarantee RGBA16F + depth support.
    const colorSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
    const depthSamples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES);
    samples = [4, 2].find(n => colorSamples.includes(n) && depthSamples.includes(n)) || 0;
  }
  // Keep native canvas AA if this desktop cannot multisample the HDR format.
  const target = hdrSupported && (tablet || samples > 0) ? new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    samples,
  }) : null;
  if (target) target.texture.name = "AtmosphereHDR";

  const resolveScene = new THREE.Scene();
  const resolveCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const resolve = target ? new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    name: "AtmosphereResolveMaterial",
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    uniforms: {
      // Always a Texture, never the render target or an unbound sampler.
      uSource: { value: target.texture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uRadius: { value: 4 },
      uBloom: { value: moon ? 0.025 : 0.065 },
      uGrade: { value: moon ? 0 : 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform vec2 uTexel;
      uniform float uRadius;
      uniform float uBloom;
      uniform float uGrade;
      varying vec2 vUv;
      vec3 highlight(vec2 offset) {
        vec2 uv = clamp(vUv + offset * uTexel * uRadius, uTexel * 0.5, 1.0 - uTexel * 0.5);
        vec3 c = max(texture2D(uSource, uv).rgb, vec3(0.0));
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float knee = smoothstep(1.1, 2.1, luma);
        return min(c, vec3(10.0)) * knee * max(luma - 1.1, 0.0) / max(luma, 0.0001);
      }
      void main() {
        vec4 source = texture2D(uSource, vUv);
        vec3 bloom = highlight(vec2(1.0, 0.0)) + highlight(vec2(-1.0, 0.0));
        bloom += highlight(vec2(0.0, 1.0)) + highlight(vec2(0.0, -1.0));
        bloom += highlight(vec2(1.414, 1.414)) + highlight(vec2(-1.414, 1.414));
        bloom += highlight(vec2(1.414, -1.414)) + highlight(vec2(-1.414, -1.414));
        vec3 color = max(source.rgb, vec3(0.0)) + bloom * (uBloom / 8.0);
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float light = smoothstep(0.15, 1.8, luma);
        vec3 balance = mix(vec3(0.982, 1.004, 1.012), vec3(1.016, 1.003, 0.980), light);
        color *= mix(vec3(1.0), balance, uGrade);
        color = mix(vec3(luma), color, 1.0 - 0.025 * uGrade);
        vec2 corner = (vUv - 0.5) * 2.0;
        color *= 1.0 - 0.065 * smoothstep(0.35, 1.8, dot(corner, corner));
        gl_FragColor = vec4(color, source.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })) : null;
  if (resolve) {
    resolve.name = "AtmosphereResolve";
    resolve.frustumCulled = false;
    resolveScene.add(resolve);
  }

  function setDaylight(state) {
    if (disposed || !state) return;
    celestial.update({ state });
    if (fog && state.horizon?.isColor) fog.color.copy(state.horizon);
    const night = sky.material.uniforms.uNight.value;
    if (resolve) resolve.material.uniforms.uBloom.value = moon ? 0.025 + night * 0.015 : 0.065 + night * 0.04;
    if (pollen) {
      const light = sky.material.uniforms.uDaylight.value * (1 - night);
      pollen.material.uniforms.uDaylight.value = light;
      pollen.visible = light > 0.001;
    }
  }

  function setPerformanceMode(enabled) {
    if (disposed || typeof enabled !== "boolean" || enabled === performanceMode) return;
    performanceMode = enabled;
    if (enabled && target) {
      // setSize releases GPU storage; keep the target/texture for lazy recovery.
      target.setSize(1, 1);
      resolve.material.uniforms.uTexel.value.set(1, 1);
    }
  }

  function resize() {
    if (disposed) return;
    renderer.getDrawingBufferSize(bufferSize);
    renderer.getSize(logicalSize);
    const width = Math.max(1, bufferSize.x);
    const height = Math.max(1, bufferSize.y);
    if (!performanceMode && target && (target.width !== width || target.height !== height)) {
      target.setSize(width, height);
      resolve.material.uniforms.uTexel.value.set(1 / width, 1 / height);
    }
    if (resolve) resolve.material.uniforms.uRadius.value = Math.max(1.5, height * 0.004);
    if (pollen) {
      pollen.material.uniforms.uHeight.value = height;
      pollen.material.uniforms.uPixelRatio.value = height / Math.max(1, logicalSize.y);
    }
  }

  function render(timeSeconds = 0) {
    if (disposed) return;
    resize();
    if (Number.isFinite(timeSeconds)) {
      if (previousTime !== undefined && !motionQuery?.matches) {
        animationTime += THREE.MathUtils.clamp(timeSeconds - previousTime, 0, 0.1);
      }
      previousTime = timeSeconds;
    }
    camera.getWorldPosition(eye);
    celestial.update({ time: animationTime, eye });
    if (pollen) pollen.material.uniforms.uTime.value = animationTime;
    if (performanceMode || !target) {
      renderer.render(scene, camera);
      return;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const scissorTest = renderer.getScissorTest();
    renderer.getViewport(previousViewport);
    try {
      renderer.info.autoReset = false;
      renderer.info.reset();
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      // Three r170 skips tone mapping for ordinary targets and writes linear HDR.
      renderer.render(scene, camera);
      // Three resolves MSAA at the end of render; unbind before sampling it.
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, logicalSize.x, logicalSize.y);
      renderer.setScissorTest(false);
      renderer.clear(true, true, true);
      renderer.render(resolveScene, resolveCamera);
    } finally {
      renderer.setViewport(previousViewport);
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.setScissorTest(scissorTest);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    celestial.dispose();
    for (const object of [pollen, resolve]) {
      if (!object) continue;
      object.removeFromParent();
      object.geometry.dispose();
      object.material.dispose();
    }
    target?.dispose();
    if (scene.fog === fog) scene.fog = previousFog;
  }

  resize();
  return { setDaylight, setPerformanceMode, render, resize, dispose, sky, pollen };
}
