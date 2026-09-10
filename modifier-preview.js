import * as THREE from "three";

const VIEWS = {
  color: [0.72, 0.34],
  wheels: [1.3, 0.24],
  suspension: [1.43, 0.18],
  engine: [2.45, 0.78],
  spoiler: [2.4, 0.46],
  rocket: [2.8, 0.25],
};
const TRANSITION_SECONDS = 0.25;
const TAU = Math.PI * 2;

// The caller owns driving state and RAF; render(dt) takes seconds. Coordinates: +Y up, +Z front.
export function createGaragePreview({ renderer, car, environment, contactTexture }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe7ecdf);
  scene.environment = environment ?? null;
  scene.environmentIntensity = 0.9;
  const camera = new THREE.PerspectiveCamera(36, 1, 0.03, 120);
  const presentation = new THREE.Group();
  scene.add(presentation, new THREE.HemisphereLight(0xffffff, 0xb5bdab, 1.8));
  const key = new THREE.DirectionalLight(0xfff5e5, 2.4);
  key.position.set(-4, 7, 5);
  const fill = new THREE.DirectionalLight(0xe6efff, 0.9);
  fill.position.set(5, 4, -5);
  scene.add(key, fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ color: 0xe7ecdf, toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.01, 0.08, 64),
    new THREE.MeshStandardMaterial({ color: 0xf2f1e7, roughness: 0.92 }),
  );
  pedestal.position.y = -0.04;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(0.976, 0.987, 64),
    new THREE.MeshBasicMaterial({ color: 0xd2d9ca, toneMapped: false }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.001;
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: contactTexture ?? null,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  scene.add(floor, pedestal, rim, shadow);

  const bounds = new THREE.Box3();
  const meshBounds = new THREE.Box3();
  const size = new THREE.Vector3();
  const target = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const relative = new THREE.Vector3();
  const projected = new THREE.Box2();
  const projectedPoint = new THREE.Vector2();
  const points = [];
  const viewPoints = [];
  let active = false, host = null, win = null, doc = null;
  let original = null, observer = null, reducedMotion = null;
  let part = "color", [angle, elevation] = VIEWS.color;
  let distance = 0, motion = null;
  let width = 0, height = 0, top = 0, bottom = 0, side = 0;
  let pointerId = null, pointerX = 0, pointerY = 0;

  function measureCar() {
    presentation.position.set(0, 0, 0);
    presentation.updateMatrixWorld(true);
    bounds.makeEmpty();
    points.length = 0;
    viewPoints.length = 0;
    // Box3.setFromObject also includes hidden flames and unselected variants.
    car.traverseVisible((mesh) => {
      if (!mesh.isMesh || !camera.layers.test(mesh.layers)) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some((m) => m.visible && (!m.transparent || m.opacity > 0))) return;
      if (mesh.geometry.drawRange.count === 0) return;
      const positions = mesh.geometry.attributes.position;
      meshBounds.makeEmpty();
      if (positions && !mesh.isInstancedMesh) {
        // Only on focus, not per frame. Exact bounds keep already-spun tires on the floor.
        for (let i = 0; i < positions.count; i++) {
          mesh.getVertexPosition(i, relative).applyMatrix4(mesh.matrixWorld);
          meshBounds.expandByPoint(relative);
        }
      } else if (mesh.isInstancedMesh) {
        mesh.computeBoundingBox();
        meshBounds.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
      }
      if (meshBounds.isEmpty()) return;
      for (let i = 0; i < 8; i++) {
        const point = new THREE.Vector3(
          i & 1 ? meshBounds.max.x : meshBounds.min.x,
          i & 2 ? meshBounds.max.y : meshBounds.min.y,
          i & 4 ? meshBounds.max.z : meshBounds.min.z,
        );
        points.push(point);
        bounds.expandByPoint(point);
      }
    });
    shadow.visible = !!contactTexture && !bounds.isEmpty();
    if (bounds.isEmpty()) {
      size.set(0, 0, 0);
      target.set(0, 0.75, 0);
      pedestal.scale.set(3.2, 1, 3.2);
      rim.scale.setScalar(3.2);
      return;
    }
    bounds.getCenter(target);
    presentation.position.set(-target.x, -bounds.min.y, -target.z);
    bounds.translate(presentation.position);
    bounds.getCenter(target);
    bounds.getSize(size);
    for (const point of points) point.add(presentation.position);
    viewPoints.length = points.length * 3;
    const radius = Math.hypot(size.x, size.z) * 0.5 + 0.3;
    pedestal.scale.set(radius, 1, radius);
    rim.scale.setScalar(radius);
    shadow.scale.set(size.x * 1.35, size.z * 1.2, 1);
    presentation.updateMatrixWorld(true);
  }

  function projectAt(atDistance) {
    projected.makeEmpty();
    for (let i = 0; i < viewPoints.length; i += 3) {
      const depth = atDistance - viewPoints[i + 2];
      projectedPoint.set(viewPoints[i] / depth, viewPoints[i + 1] / depth);
      projected.expandByPoint(projectedPoint);
    }
  }

  function fitDistance(yaw, pitch) {
    if (!width || !height || !points.length) return 7;
    direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(direction, right);
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const horizontal = tangent * camera.aspect * (1 - 2 * side / width);
    const vertical = tangent * (1 - (top + bottom) / height);
    let required = 1, nearest = 0;
    // Fit each visible mesh's corners in perspective, including its near-side depth.
    for (let i = 0; i < points.length; i++) {
      relative.subVectors(points[i], target);
      const depth = relative.dot(direction);
      const x = relative.dot(right), y = relative.dot(up);
      viewPoints[i * 3] = x;
      viewPoints[i * 3 + 1] = y;
      viewPoints[i * 3 + 2] = depth;
      nearest = Math.max(nearest, depth);
      required = Math.max(required,
        depth + Math.abs(x) / horizontal,
        depth + Math.abs(y) / vertical);
    }
    // Center the projected silhouette rather than wasting space around the 3D box center.
    let low = nearest + 0.05, high = Math.max(low, required);
    for (let i = 0; i < 12; i++) {
      const mid = (low + high) / 2;
      projectAt(mid);
      if (projected.max.x - projected.min.x <= horizontal * 2 &&
          projected.max.y - projected.min.y <= vertical * 2) high = mid;
      else low = mid;
    }
    return high * 1.025;
  }

  function updateCamera() {
    if (!width || !height) return;
    // Intermediate orbit angles and newly enlarged parts must also fit, not just the endpoint.
    const required = fitDistance(angle, elevation);
    distance = THREE.MathUtils.clamp(distance, required, required * 1.12);
    camera.position.set(
      Math.sin(angle) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(angle) * Math.cos(elevation),
    ).multiplyScalar(distance).add(target);
    camera.near = Math.max(0.01, distance / 200);
    camera.far = Math.max(120, distance + size.length() * 3);
    camera.lookAt(target);
    let offsetX = 0, offsetY = (bottom - top) / 2;
    if (points.length) {
      projectAt(distance);
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      offsetX = (projected.min.x + projected.max.x) * width / (4 * tangent * camera.aspect);
      offsetY -= (projected.min.y + projected.max.y) * height / (4 * tangent);
    }
    camera.setViewOffset(width, height, offsetX, offsetY, width, height);
    camera.updateMatrixWorld();
  }

  function moveTo(yaw, pitch, immediate = false) {
    const required = fitDistance(yaw, pitch);
    // Retain a little zoom slack so small part changes do not make the camera breathe.
    const nextDistance = Math.max(required, Math.min(distance || required, required * 1.1));
    if (immediate || reducedMotion?.matches || !width || !height) {
      angle = yaw;
      elevation = pitch;
      distance = nextDistance;
      motion = null;
    } else {
      motion = {
        angle, elevation, distance, yaw, pitch, nextDistance, elapsed: 0,
      };
    }
    updateCamera();
  }

  function focus(partId, immediate = false) {
    if (!active) return;
    stopDrag();
    part = Object.hasOwn(VIEWS, partId) ? partId : "color";
    measureCar();
    const [yaw, pitch] = VIEWS[part];
    moveTo(angle + Math.atan2(Math.sin(yaw - angle), Math.cos(yaw - angle)), pitch, immediate);
  }

  function turn() {
    if (!active) return;
    stopDrag();
    moveTo(angle + Math.PI / 2, elevation);
  }

  function stopDrag(event) {
    if (pointerId === null || (event?.pointerId !== undefined && event.pointerId !== pointerId)) return;
    const id = pointerId;
    pointerId = null;
    try {
      if (host.hasPointerCapture(id)) host.releasePointerCapture(id);
    } catch {
      // A browser cancellation may already have invalidated the capture.
    }
  }

  function pointerDown(event) {
    if (pointerId !== null || event.isPrimary === false || event.button !== 0) return;
    if (event.target.closest?.("button, a, input, select, textarea, [role='button']")) return;
    event.preventDefault();
    pointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    motion = null;
    try {
      host.setPointerCapture(pointerId);
    } catch {
      stopDrag();
    }
  }

  function pointerMove(event) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      stopDrag();
      return;
    }
    event.preventDefault();
    const yaw = angle - (event.clientX - pointerX) * TAU / Math.max(width, 320);
    const pitch = THREE.MathUtils.clamp(
      elevation + (event.clientY - pointerY) * Math.PI / Math.max(height, 240), 0.1, 1.05,
    );
    pointerX = event.clientX;
    pointerY = event.clientY;
    moveTo(yaw, pitch, true);
  }

  function visibilityChange() {
    if (doc.hidden) stopDrag();
  }

  function inputListeners(method) {
    for (const [type, handler] of [
      ["pointerdown", pointerDown], ["pointermove", pointerMove],
      ["pointerup", stopDrag], ["pointercancel", stopDrag], ["lostpointercapture", stopDrag],
    ]) host[method](type, handler);
    win?.[method]("pointerup", stopDrag);
    win?.[method]("pointercancel", stopDrag);
    win?.[method]("blur", stopDrag);
    doc[method]("visibilitychange", visibilityChange);
  }

  function resize() {
    if (!active) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (w <= 0 || h <= 0) {
      width = Math.max(0, w);
      height = Math.max(0, h);
      return;
    }
    renderer.setSize(w, h, false);
    if (w === width && h === height) return;
    width = w;
    height = h;
    top = Math.min(36, height * 0.16);
    bottom = Math.min(50, height * 0.22);
    side = Math.min(18, width * 0.045);
    camera.aspect = width / height;
    moveTo(motion?.yaw ?? angle, motion?.pitch ?? elevation, !motion);
  }

  function open(nextHost, partId = "color") {
    if (!nextHost?.appendChild) throw new TypeError("Garage preview requires a host element.");
    partId = Object.hasOwn(VIEWS, partId) ? partId : "color";
    if (active && host === nextHost) {
      resize();
      if (partId !== part) focus(partId);
      return;
    }
    if (active) close();
    const canvas = renderer.domElement;
    original = {
      carParent: car.parent,
      carIndex: car.parent?.children.indexOf(car) ?? -1,
      canvasParent: canvas.parentNode,
      canvasNext: canvas.nextSibling,
      size: renderer.getSize(new THREE.Vector2()),
    };
    host = nextHost;
    doc = host.ownerDocument;
    win = doc.defaultView;
    reducedMotion = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
    active = true;
    width = height = distance = 0;
    motion = null;
    // add(), not attach(): keep local transforms and discard the driving parent's heading.
    presentation.add(car);
    host.appendChild(canvas);
    focus(partId, true);
    resize();
    inputListeners("addEventListener");
    if (win?.ResizeObserver) {
      observer = new win.ResizeObserver(resize);
      observer.observe(host);
    }
  }

  function close() {
    if (!active) return;
    stopDrag();
    inputListeners("removeEventListener");
    observer?.disconnect();
    observer = null;
    motion = null;
    active = false;
    if (original.carParent) {
      original.carParent.add(car);
      const siblings = original.carParent.children;
      siblings.splice(siblings.indexOf(car), 1);
      siblings.splice(Math.min(original.carIndex, siblings.length), 0, car);
    } else car.removeFromParent();
    const canvas = renderer.domElement;
    if (original.canvasParent) {
      const next = original.canvasNext?.parentNode === original.canvasParent ? original.canvasNext : null;
      original.canvasParent.insertBefore(canvas, next);
    } else canvas.remove();
    renderer.setSize(original.size.x, original.size.y, false);
    host = win = doc = original = reducedMotion = null;
    width = height = 0;
  }

  function render(dt = 0) {
    if (!active || !width || !height) return;
    if (motion) {
      motion.elapsed += Number.isFinite(dt) ? Math.max(0, dt) : 0;
      const t = reducedMotion?.matches ? 1 : Math.min(1, motion.elapsed / TRANSITION_SECONDS);
      const eased = t * t * (3 - 2 * t);
      angle = THREE.MathUtils.lerp(motion.angle, motion.yaw, eased);
      elevation = THREE.MathUtils.lerp(motion.elevation, motion.pitch, eased);
      distance = THREE.MathUtils.lerp(motion.distance, motion.nextDistance, eased);
      if (t === 1) motion = null;
      updateCamera();
    }
    renderer.render(scene, camera);
  }

  function state() {
    const round = (n) => Math.round(n * 1000) / 1000;
    const vector = (v) => v.toArray().map(round);
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    return {
      active, part, angle: round(THREE.MathUtils.euclideanModulo(angle, TAU)),
      elevation: round(elevation), dragging: pointerId !== null, transitioning: !!motion,
      camera: {
        position: vector(camera.position), target: vector(target), distance: round(distance),
        fov: camera.fov, aspect: round(camera.aspect),
        size: [round(viewHeight * camera.aspect), round(viewHeight)],
      },
      bounds: bounds.isEmpty() ? null : { min: vector(bounds.min), max: vector(bounds.max), size: vector(size) },
      view: { width, height, top, bottom, side },
    };
  }

  return { open, close, resize, focus, turn, render, state };
}
