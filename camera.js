import * as THREE from "three";

// Snapshot static scenery only: the car, effects, and moving props are not blockers.
export function createCameraClearance(roots) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const blockers = [];
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverseVisible((object) => {
      if (!object.isMesh) return;
      const proxy = object.clone(false);
      proxy.material = material;
      proxy.matrixWorld.copy(object.matrixWorld);
      blockers.push({ proxy, bounds: new THREE.Box3().setFromObject(object) });
    });
  }
  const raycaster = new THREE.Raycaster();
  const direction = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const origin = new THREE.Vector3(), end = new THREE.Vector3();
  const sweep = new THREE.Box3(), hits = [];
  const probes = [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];
  return function clearCamera(anchor, position) {
    direction.subVectors(position, anchor);
    const distance = direction.length();
    if (distance < 0.00001) return position;
    direction.divideScalar(distance);
    right.set(direction.z, 0, -direction.x);
    if (right.lengthSq() < 0.00001) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(direction, right).normalize();
    sweep.makeEmpty().expandByPoint(anchor).expandByPoint(position).expandByScalar(0.4);
    const nearby = blockers.filter(({ bounds }) => bounds.intersectsBox(sweep));
    let clearDistance = distance;
    // Corner probes protect the near plane, not just the center of the view.
    for (const [x, y] of probes) {
      origin.copy(anchor).addScaledVector(right, x * 0.25).addScaledVector(up, y * 0.25);
      raycaster.set(origin, direction);
      raycaster.far = distance + 0.35;
      for (const { proxy, bounds } of nearby) {
        if (!bounds.containsPoint(origin) &&
          (!raycaster.ray.intersectBox(bounds, end) || origin.distanceTo(end) > raycaster.far)) continue;
        hits.length = 0;
        proxy.raycast(raycaster, hits);
        for (const hit of hits) clearDistance = Math.min(clearDistance, Math.max(0, hit.distance - 0.35));
      }
    }
    return position.copy(anchor).addScaledVector(direction, clearDistance);
  };
}
