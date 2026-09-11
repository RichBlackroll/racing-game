import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createModifierCar } from "./modifier-car.js";

// A lightweight road car uses the real garage parts, without five more GLTFs.
export function createFriendRacerCar(friend, config) {
  const car = new THREE.Group();
  car.name = `racer-${friend.name}`;
  const paint = new THREE.MeshStandardMaterial({ roughness: .28, metalness: .3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x18212b, roughness: .65 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x314b60, roughness: .16, metalness: .6 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xd9e1e6, roughness: .3, metalness: .7 });
  const light = new THREE.MeshStandardMaterial({ color: 0xffedbd, emissive: 0xffedbd, emissiveIntensity: 0 });
  const red = new THREE.MeshStandardMaterial({ color: 0xff352d, emissive: 0xff180e, emissiveIntensity: 0 });
  light.userData.nightIntensity = 1.8;
  red.userData.nightIntensity = 1.3;
  const cube = new RoundedBoxGeometry(1, 1, 1, 1, .12);
  function box(parent, material, size, position) {
    const mesh = new THREE.Mesh(cube, material);
    mesh.scale.fromArray(size); mesh.position.fromArray(position);
    parent.add(mesh); return mesh;
  }
  box(car, dark, [1.85, .2, 4.25], [0, .31, 0]);
  box(car, paint, [1.95, .55, 4.5], [0, .62, 0]);
  const cabin = box(car, glass, [1.5, .65, 1.9], [0, 1.12, .1]);
  cabin.rotation.x = -.08;
  const roofY = 1.49;
  box(car, paint, [1.53, .1, 1.35], [0, roofY - .05, .05]);
  for (const x of [-.73, .73]) {
    box(car, light, [.42, .18, .12], [x, .74, 2.25]);
    box(car, red, [.48, .13, .1], [x, .71, -2.25]);
    box(car, paint, [.08, .63, .1], [x, 1.12, -.35]);
  }
  box(car, dark, [1.8, .1, .35], [0, 1.03, -1.95]);
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(.36, .36, .3, 16).rotateZ(Math.PI / 2);
  for (const x of [-.96, .96]) for (const z of [-1.4, 1.4]) {
    const pivot = new THREE.Group(); pivot.position.set(x, .36, z); car.add(pivot);
    const tire = new THREE.Mesh(tireGeo, dark); pivot.add(tire);
    const hub = box(pivot, silver, [.32, .4, .1], [0, 0, 0]);
    box(pivot, silver, [.32, .1, .4], [0, 0, 0]);
    wheels.push({ pivot, tire, hub, front: z > 0 });
  }
  const rocket = new THREE.Group(); rocket.position.set(0, .66, -2.58); car.add(rocket);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(.24, .29, .6, 12), silver);
  nozzle.rotation.x = Math.PI / 2; rocket.add(nozzle);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(.24, 12), dark);
  bore.position.z = -.305; bore.rotation.y = Math.PI; rocket.add(bore);
  const modifier = createModifierCar({ car, wheels, paint, rocket });
  modifier.apply(config);
  const visuals = modifier.state();

  const sign = new THREE.Group(); sign.name = "taxi-name-sign";
  sign.position.set(0, roofY + visuals.height.bodyLift, .08);
  car.add(sign);
  // Taller brackets keep the name above big wings when Elio follows behind.
  const mountHeight = Math.max(.13, (visuals.spoiler.topY ?? 0) + .08 - sign.position.y);
  const signCenter = mountHeight + .29;
  for (const x of [-.56, .56]) box(sign, dark, [.12, mountHeight, .28], [x, mountHeight / 2, 0]);
  box(sign, new THREE.MeshBasicMaterial({ color: 0xffedbd }), [1.85, .58, .42], [0, signCenter, 0]);
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 160;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff2bd"; ctx.fillRect(0, 0, 512, 160);
  ctx.fillStyle = "#18212b"; ctx.font = "bold 78px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(friend.name, 256, 73, 470);
  ctx.fillStyle = friend.color; ctx.fillRect(0, 136, 512, 24);
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 ? "#18212b" : "#fff2bd"; ctx.fillRect(i * 16, 136, 16, 12);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  // Separate outward faces keep the name readable, never mirrored from behind.
  for (const side of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.79, .54), labelMaterial);
    face.name = `name-${side === 1 ? "front" : "rear"}`;
    face.position.set(0, signCenter, side * .216); face.rotation.y = side === 1 ? 0 : Math.PI; sign.add(face);
  }

  // Freeze configured parts into material batches; only the four wheels animate.
  function batch(root, excluded = new Set()) {
    car.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert(), groups = new Map(), remove = [];
    root.traverseVisible((node) => {
      if (!node.isMesh) return;
      for (let p = node; p !== root; p = p.parent) if (excluded.has(p)) return;
      const geometry = (node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone())
        .applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
      if (!groups.has(node.material)) groups.set(node.material, []);
      groups.get(node.material).push(geometry); remove.push(node);
    });
    for (const node of remove) node.removeFromParent();
    for (const [material, geometries] of groups) {
      const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
      mesh.receiveShadow = true; root.add(mesh);
      geometries.forEach(g => g.dispose());
    }
  }
  const wheelRoots = new Set(wheels.map(w => w.pivot)); wheelRoots.add(sign);
  batch(car, wheelRoots);
  for (const wheel of wheels) { batch(wheel.tire); batch(wheel.hub); }
  // Add after batching so the flame can switch on without rebuilding the car.
  const flame = new THREE.Group(); flame.name = "racer-boost-flame"; flame.visible = false;
  rocket.add(flame);
  for (const [radius, length, color] of [[.27, 2.6, 0xff5318], [.16, 1.7, 0xffecad]]) {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(radius, length, 12),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    plume.rotation.x = -Math.PI / 2; plume.position.z = -.3 - length / 2;
    flame.add(plume);
  }
  return { car, wheels, visuals, sign, flame };
}
