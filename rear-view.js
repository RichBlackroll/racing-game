import * as THREE from "three";

/**
 * Call render(now) after the main frame, only in cockpit mode; now is milliseconds.
 * Invalidate after resize, cockpit reentry, or context restoration. Owns no DOM.
 */
export function createRearView({ renderer, scene, car, tablet = false, element }) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: renderer.extensions.has("EXT_color_buffer_float") ? THREE.HalfFloatType : THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
  });
  target.texture.name = "RearViewLinear";
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const material = new THREE.MeshBasicMaterial({
    map: target.texture,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: true,
    fog: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const resolveScene = new THREE.Scene();
  resolveScene.add(quad);
  const resolveCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bufferSize = new THREE.Vector2();
  const previousViewport = new THREE.Vector4();
  const previousScissor = new THREE.Vector4();
  const interval = 1000 / (tablet ? 20 : 30);
  const maxWidth = tablet ? 320 : 512;
  const maxHeight = tablet ? 120 : 192;
  let previousWidth = 0, previousHeight = 0;
  let lastRender = -Infinity;
  let fresh = false;
  let disposed = false;

  function invalidate() {
    fresh = false;
  }

  function render(now = performance.now()) {
    if (disposed) return;
    if (renderer.getContext().isContextLost()) {
      invalidate();
      return;
    }
    const rect = element.getBoundingClientRect();
    const canvas = renderer.domElement.getBoundingClientRect();
    const left = Math.max(rect.left, canvas.left);
    const top = Math.max(rect.top, canvas.top);
    const right = Math.min(rect.right, canvas.right);
    const bottom = Math.min(rect.bottom, canvas.bottom);
    if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0 ||
        right <= left || bottom <= top) {
      invalidate();
      return;
    }
    renderer.getDrawingBufferSize(bufferSize);
    if (bufferSize.x <= 0 || bufferSize.y <= 0) {
      invalidate();
      return;
    }
    const scaleX = bufferSize.x / canvas.width;
    const scaleY = bufferSize.y / canvas.height;
    const width = rect.width * scaleX, height = rect.height * scaleY;
    const aspect = rect.width / rect.height;
    if (width !== previousWidth || height !== previousHeight || aspect !== camera.aspect) {
      invalidate();
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      target.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      previousWidth = width;
      previousHeight = height;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const scissorTest = renderer.getScissorTest();
    const autoClear = renderer.autoClear;
    const autoReset = renderer.info.autoReset;
    const shadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const shadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    renderer.getViewport(previousViewport);
    renderer.getScissor(previousScissor);
    try {
      renderer.autoClear = false;
      renderer.info.autoReset = false;
      // Reuse the main frame's shadows, without consuming a pending shadow update.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      if (!fresh || now < lastRender || now - lastRender >= interval) {
        invalidate();
        car.updateWorldMatrix(true, false);
        camera.position.fromArray(car.userData.cameraProfile?.mirror ?? [0, 1.7, -2.5]).applyMatrix4(car.matrixWorld);
        // Cameras look down local -Z, opposite the car's local +Z forward.
        car.getWorldQuaternion(camera.quaternion);
        renderer.setRenderTarget(target);
        renderer.setScissorTest(false);
        renderer.clear(true, true, false);
        const visible = car.visible;
        try {
          car.visible = false;
          renderer.render(scene, camera);
        } finally {
          car.visible = visible;
        }
        fresh = true;
        lastRender = now;
      }

      renderer.setRenderTarget(null);
      // Bounds are in buffer pixels; setters apply DPR, so divide it out once.
      const ratio = renderer.getPixelRatio();
      renderer.setViewport((rect.left - canvas.left) * scaleX / ratio,
        (canvas.bottom - rect.bottom) * scaleY / ratio, width / ratio, height / ratio);
      renderer.setScissor((left - canvas.left) * scaleX / ratio,
        (canvas.bottom - bottom) * scaleY / ratio,
        (right - left) * scaleX / ratio, (bottom - top) * scaleY / ratio);
      renderer.setScissorTest(true);
      // r170 writes the world target linearly; the basic material tone maps once here.
      // No clear: the depth-independent quad replaces only the scissored aperture.
      renderer.render(resolveScene, resolveCamera);
    } finally {
      // Restore logical defaults before binding, which reinstates target-local bounds.
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(previousTarget, previousFace, previousMip);
      renderer.autoClear = autoClear;
      renderer.info.autoReset = autoReset;
      renderer.shadowMap.autoUpdate = shadowAutoUpdate;
      renderer.shadowMap.needsUpdate = shadowNeedsUpdate;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    target.dispose();
    geometry.dispose();
    material.dispose();
  }

  return { render, invalidate, dispose };
}
