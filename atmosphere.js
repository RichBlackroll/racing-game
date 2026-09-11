import * as THREE from "three";

/**
 * Create after level scenery; set camera.far >= 1400 and updateProjectionMatrix().
 * Replace renderer.render(scene, camera) with atmosphere.render(timeSeconds).
 * resize() follows the caller's setSize/setPixelRatio (including adaptive budgets);
 * render() also checks dimensions. dispose() before replacing the level.
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
  if (fog) scene.fog = fog;

  const motionQuery = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const eye = new THREE.Vector3();
  const bufferSize = new THREE.Vector2();
  const logicalSize = new THREE.Vector2();
  const previousViewport = new THREE.Vector4();
  let animationTime = 0;
  let previousTime;
  let disposed = false;
  let sky = null;
  let pollen = null;

  if (!moon) {
    sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({
        name: "AtmosphereSkyMaterial",
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uHorizon: { value: horizon },
          uZenith: { value: new THREE.Color(waterfront ? 0x5289b1 : 0x567b84) },
          uSun: { value: new THREE.Vector3(-0.55, 0.48, waterfront ? 0.38 : -0.38).normalize() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDirection;
          void main() {
            vDirection = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position.z = gl_Position.w;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uHorizon;
          uniform vec3 uZenith;
          uniform vec3 uSun;
          varying vec3 vDirection;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
          }
          void main() {
            vec3 d = normalize(vDirection);
            float elevation = max(d.y, 0.0);
            float mu = clamp(dot(d, uSun), -1.0, 1.0);
            // Optical path length grows at grazing angles; blue scatters first.
            float airMass = 1.0 / sqrt(elevation * elevation + 0.025);
            vec3 transmission = exp(-vec3(0.20, 0.29, 0.40) * (airMass - 0.988));
            transmission *= smoothstep(0.0, 0.18, elevation);
            vec3 color = mix(uHorizon, uZenith, transmission);
            color = mix(uHorizon * 0.91, color, smoothstep(-0.18, 0.04, d.y));
            float rayleigh = 0.75 * (1.0 + mu * mu);
            color += vec3(0.025, 0.045, 0.055) * rayleigh * elevation;
            float sunward = pow(max(mu, 0.0), 3.0);
            color += vec3(0.19, 0.105, 0.035) * sunward * exp(-elevation * 2.3);
            // A restrained forward-scattering lobe plus a broad aureole.
            float mie = 0.065 / pow(max(1.0 + 0.76 * 0.76 - 1.52 * mu, 0.05), 1.5);
            color += vec3(1.0, 0.73, 0.43) * (mie * 0.17 + 0.10 * pow(max(mu, 0.0), 8.0));

            // Stretched, gently sheared cirrus filaments, not an isotropic fBm field.
            vec2 p = d.xz / max(d.y + 0.22, 0.12);
            p = mat2(0.87, -0.49, 0.49, 0.87) * p;
            p += vec2(uTime * 0.0018, uTime * 0.0005);
            float bend = noise(p * vec2(0.65, 1.7));
            vec2 stretched = vec2(p.x * 0.85, p.y * 15.0 + bend * 3.0);
            float fibers = noise(stretched) * 0.7 + noise(stretched * vec2(1.8, 2.1)) * 0.3;
            float coverage = smoothstep(0.40, 0.77, noise(p * vec2(0.4, 1.3) + 19.0));
            float clouds = smoothstep(0.49, 0.77, fibers) * coverage;
            clouds *= smoothstep(0.04, 0.24, d.y) * (1.0 - smoothstep(0.80, 1.0, d.y));
            color = mix(color, vec3(0.95, 0.90, 0.77) + sunward * vec3(0.22, 0.12, 0.03), clouds * 0.18);

            float sunAngle = acos(mu);
            float edge = max(fwidth(sunAngle), 0.0003);
            float disk = 1.0 - smoothstep(0.00465 - edge, 0.00465 + edge, sunAngle);
            color += vec3(12.0, 9.6, 6.4) * disk * (1.0 - clouds * 0.35);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      }),
    );
    sky.name = "AtmosphereSky";
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    scene.add(sky);
  }

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
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uEye;
        uniform float uHeight;
        uniform float uPixelRatio;
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

  function resize() {
    if (disposed) return;
    renderer.getDrawingBufferSize(bufferSize);
    renderer.getSize(logicalSize);
    const width = Math.max(1, bufferSize.x);
    const height = Math.max(1, bufferSize.y);
    if (target && (target.width !== width || target.height !== height)) {
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
    if (sky) {
      sky.position.copy(eye);
      scene.worldToLocal(sky.position);
      sky.material.uniforms.uTime.value = animationTime;
    }
    if (pollen) pollen.material.uniforms.uTime.value = animationTime;
    if (!target) {
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
    for (const object of [sky, pollen, resolve]) {
      if (!object) continue;
      object.removeFromParent();
      object.geometry.dispose();
      object.material.dispose();
    }
    target?.dispose();
    if (fog && scene.fog === fog) scene.fog = previousFog;
  }

  resize();
  return { render, resize, dispose, sky, pollen };
}
