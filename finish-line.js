import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function createFinishLine({ scene, position, heading, obstacles, heightAt }) {
  const group = new THREE.Group();
  group.name = "finish-line";
  const baseHeight = heightAt ? heightAt(position.x, position.z) : 0;
  group.position.set(position.x, baseHeight, position.z);
  group.rotation.y = heading;
  scene.add(group);

  const dark = new THREE.MeshStandardMaterial({ color: 0x15191f, roughness: 0.55, metalness: 0.35 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xb6bec8, roughness: 0.35, metalness: 0.8 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd91d29, roughness: 0.4 });
  const batches = new Map();
  function box(material, w, h, d, x, y, z, angle = 0) {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.rotateZ(angle);
    geometry.translate(x, y, z);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(geometry);
  }

  // Keep the entire 11.6 m road and its kerbs clear of the support feet.
  for (const x of [-7.25, 7.25]) {
    box(dark, 1.25, 0.35, 1.8, x, 0.175, 0);
    for (const dx of [-0.35, 0.35]) for (const z of [-0.45, 0.45]) {
      box(silver, 0.12, 6.9, 0.12, x + dx, 3.45, z);
    }
    for (let y = 0.65; y < 6.2; y += 0.9) {
      for (const z of [-0.45, 0.45]) {
        box(silver, 0.08, Math.hypot(0.7, 0.9), 0.08, x, y + 0.45, z,
          (Math.floor(y / 0.9) % 2 ? 1 : -1) * Math.atan2(0.7, 0.9));
      }
    }
    box(red, 0.85, 1.6, 1.05, x, 1.2, 0);
    obstacles.push({
      x: position.x + Math.cos(heading) * x,
      z: position.z - Math.sin(heading) * x,
      y: baseHeight,
      r: 0.9, height: 6.9,
    });
  }
  box(dark, 15.5, 1.65, 1.15, 0, 6.15, 0);
  box(red, 15.6, 0.12, 1.2, 0, 7.02, 0);
  box(silver, 15.5, 0.12, 1.2, 0, 5.28, 0);
  box(dark, 4.2, 0.65, 0.8, 0, 4.83, 0);

  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 256;
  const c = canvas.getContext("2d");
  c.fillStyle = "#15191f";
  c.fillRect(0, 0, canvas.width, canvas.height);
  for (const start of [0, 1792]) {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      c.fillStyle = (row + col) % 2 ? "#15191f" : "#ffffff";
      c.fillRect(start + col * 64, row * 64, 64, 64);
    }
  }
  c.fillStyle = "#ffffff";
  c.font = "italic 900 132px Arial, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("Daddy is a legend", 1024, 133, 1408);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const bannerMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const bannerGeometry = new THREE.PlaneGeometry(15.3, 1.6);
  const lampGeometry = new THREE.CircleGeometry(0.2, 16);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xff2436, toneMapped: false });
  // Separate outward-facing panels keep lettering readable, not mirrored, on either approach.
  for (const side of [-1, 1]) {
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.name = side < 0 ? "finish-banner-front" : "finish-banner-back";
    banner.position.set(0, 6.15, side * 0.585);
    banner.rotation.y = side < 0 ? Math.PI : 0;
    group.add(banner);
    for (let i = 0; i < 5; i++) {
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set((i - 2) * 0.78, 4.83, side * 0.41);
      lamp.rotation.y = banner.rotation.y;
      group.add(lamp);
    }
  }

  const whitePaint = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  const blackPaint = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.9 });
  for (let row = 0; row < 3; row++) for (let col = 0; col < 16; col++) {
    box((row + col) % 2 ? blackPaint : whitePaint,
      0.725, 0.012, 0.725, -5.8 + (col + 0.5) * 0.725, 0.115, (row - 1) * 0.725);
  }
  for (const z of [-1.18, 1.18]) box(whitePaint, 11.6, 0.012, 0.12, 0, 0.115, z);

  for (const [material, geometries] of batches) {
    if (heightAt && (material === whitePaint || material === blackPaint)) {
      for (const geometry of geometries) {
        const p = geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = position.x + Math.cos(heading) * p.getX(i) + Math.sin(heading) * p.getZ(i);
          const z = position.z - Math.sin(heading) * p.getX(i) + Math.cos(heading) * p.getZ(i);
          p.setY(i, p.getY(i) + heightAt(x, z) - baseHeight);
        }
        geometry.computeVertexNormals();
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.name = material === whitePaint || material === blackPaint ? "finish-road-paint" : "finish-structure";
    mesh.castShadow = mesh.name === "finish-structure";
    mesh.receiveShadow = true;
    group.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  return group;
}
