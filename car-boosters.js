import * as THREE from "three";

export function createCarBoosters({ body, surfaces, bounds, wheelTop, sportDrop }) {
  const rocket = new THREE.Group();
  rocket.name = "car-boosters";
  const flame = new THREE.Group();
  flame.name = "boost-flames";
  flame.visible = false;
  rocket.add(flame);
  body.updateWorldMatrix(true, true);
  const inverse = body.matrixWorld.clone().invert();
  const ray = new THREE.Raycaster();
  const resources = new Set();
  const silver = new THREE.MeshStandardMaterial({ color: 0xaeb4b6, metalness: .9, roughness: .25 });
  const shell = new THREE.MeshStandardMaterial({ color: 0x727b82, metalness: .8, roughness: .32, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: .85 });
  const band = new THREE.MeshStandardMaterial({ color: 0xff862b, metalness: .45, roughness: .3 });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const barrel = new THREE.CylinderGeometry(.23, .23, .58, 20).rotateX(Math.PI / 2);
  const bell = new THREE.CylinderGeometry(.23, .29, .27, 20, 1, true).rotateX(Math.PI / 2);
  const ring = new THREE.TorusGeometry(.235, .035, 8, 20);
  const rim = new THREE.TorusGeometry(.29, .035, 8, 20);
  const bore = new THREE.CircleGeometry(.23, 20).rotateY(Math.PI);
  const plumes = [[.25, 2.4, 0xff4910, 0xff3000, 7], [.16, 1.5, 0xffedaf, 0xffcc56, 15]].map(
    ([radius, length, color, emissive, emissiveIntensity]) => ({
      // Put the cone's base at the outlet so flicker never opens a gap.
      geometry: new THREE.ConeGeometry(radius, length, 16).rotateX(-Math.PI / 2).translate(0, 0, -length / 2),
      material: new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness: 1 }),
    }),
  );
  function mesh(parent, name, geometry, material, position, scale = [1, 1, 1]) {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.position.fromArray(position);
    object.scale.fromArray(scale);
    object.receiveShadow = true;
    parent.add(object);
    resources.add(geometry); resources.add(material);
    return object;
  }
  function surface(origin, direction) {
    ray.set(origin.clone().applyMatrix4(body.matrixWorld), direction.clone().transformDirection(body.matrixWorld));
    const hit = ray.intersectObjects(surfaces, true)[0];
    return hit ? hit.point.applyMatrix4(inverse) : origin.clone().clamp(bounds.min, bounds.max);
  }
  const boosters = [];
  function booster(name, position, size) {
    const group = new THREE.Group();
    group.name = name;
    group.position.copy(position); group.scale.setScalar(size);
    rocket.add(group);
    mesh(group, "booster-barrel", barrel, shell, [0, 0, -.29]);
    const housing = mesh(group, "booster-nozzle", bell, shell, [0, 0, -.715]);
    mesh(group, "booster-throat", bore, dark, [0, 0, -.585]);
    mesh(group, "booster-rim", rim, silver, [0, 0, -.85]);
    for (const z of [-.16, -.5]) mesh(group, "booster-band", ring, band, [0, 0, z]);
    const plume = new THREE.Group();
    plume.name = `${name}-flame`;
    plume.position.copy(position); plume.position.z -= .85 * size;
    plume.scale.setScalar(size);
    flame.add(plume);
    for (const { geometry, material } of plumes) mesh(plume, "booster-plume", geometry, material, [0, 0, 0]);
    const record = { group, plume, size, housing };
    boosters.push(record);
    return record;
  }

  const mountY = THREE.MathUtils.clamp(bounds.min.y + (bounds.max.y - bounds.min.y) * .38, .5, .8);
  const sideZ = bounds.min.z + 1;
  for (const side of [-1, 1]) {
    // Land the brackets on the fenders, not inside the open wheel wells.
    const edge = side < 0 ? bounds.min.x : bounds.max.x;
    const feet = [-.16, -.5].map(z => surface(
      new THREE.Vector3(edge * .7, bounds.max.y + 1, sideZ + z),
      new THREE.Vector3(0, -1, 0),
    ));
    const sideY = Math.max(...feet.map(foot => foot.y + .25), wheelTop + sportDrop + .36);
    const x = edge + side * .16;
    const { group } = booster(`booster-side-${side < 0 ? "left" : "right"}`, new THREE.Vector3(x, sideY, sideZ), 1);
    for (const foot of feet) {
      foot.y -= .025;
      const start = foot.clone().sub(group.position);
      const end = new THREE.Vector3(-side * .1, 0, start.z);
      const delta = end.clone().sub(start);
      const mount = mesh(group, "booster-mount", cube, silver, start.clone().add(end).multiplyScalar(.5).toArray(), [.14, .16, delta.length()]);
      mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), delta.normalize());
      mesh(group, "booster-mount-foot", cube, dark, start.toArray(), [.22, .08, .22]);
    }
  }

  const rearY = Math.max(mountY, bounds.min.y + sportDrop + .55);
  const rear = surface(new THREE.Vector3(0, rearY, bounds.min.z - 1), new THREE.Vector3(0, 0, 1));
  rear.z += .06;
  const big = booster("booster-rear", rear, 1.8);
  mesh(big.group, "booster-mount", cube, dark, [0, 0, 0], [.7, .56, .14]);
  body.add(rocket);

  return {
    rocket, flame, housing: big.housing,
    apply(option) {
      rocket.visible = option !== "none";
      for (const { group, plume, size } of boosters) group.visible = plume.visible = option === (size === 1 ? "small" : "big");
    },
    animateFlame(x, y, z) {
      for (const { plume, size } of boosters) plume.scale.set(x * size, y * size, z * size);
    },
    state() {
      const active = boosters.filter(({ group }) => rocket.visible && group.visible);
      return { visible: rocket.visible, count: active.length, scale: (active[0]?.group.scale ?? rocket.scale).toArray() };
    },
    dispose() {
      for (const resource of resources) resource.dispose();
      resources.clear();
    },
  };
}
