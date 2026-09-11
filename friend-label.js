import * as THREE from "three";

export function createFriendLabel(texture, width = 120) {
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, sizeAttenuation: false, fog: false, toneMapped: false,
    depthTest: true, depthWrite: false,
  }));
  label.name = "friend-name-badge";
  label.center.set(.5, 0);
  // Screen-sized sprites extend beyond their world-space culling bounds.
  label.frustumCulled = false;
  const viewport = new THREE.Vector2();
  label.onBeforeRender = (renderer, scene, camera) => {
    renderer.getSize(viewport);
    const pixels = Math.min(width, viewport.x * .3);
    const scale = 2 * pixels / (Math.max(1, viewport.y) * camera.projectionMatrix.elements[5]);
    // Use CSS pixels so distance, boost FOV and adaptive resolution do not shrink names.
    label.scale.set(scale, scale * texture.image.height / texture.image.width, 1);
    label.updateMatrixWorld();
  };
  return label;
}
