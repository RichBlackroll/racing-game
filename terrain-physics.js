import * as CANNON from "cannon-es";

const grids = new WeakMap();

export function addSceneryBodies(world, obstacles, terrain, collisionFilterMask) {
  const rails = new Map(), cellSize = 32;
  for (const o of obstacles) {
    const isRail = o.kind === "quay-railing" || o.kind === "bridge-rail";
    const cx = Math.floor(o.x / cellSize), cz = Math.floor(o.z / cellSize);
    const key = isRail ? `${cx}/${cz}` : null;
    const position = new CANNON.Vec3(o.x, (o.y ?? terrain?.heightAt(o.x, o.z) ?? 0) + 1.5, o.z);
    let body = rails.get(key);
    if (!body) {
      body = new CANNON.Body({ mass: 0, collisionFilterGroup: 8, collisionFilterMask });
      if (isRail) {
        // Local cell centres keep SAP bounds tight; each rail retains its own shape.
        body.position.set((cx + 0.5) * cellSize, 0, (cz + 0.5) * cellSize);
        rails.set(key, body);
      } else body.position.copy(position);
    }
    body.addShape(o.hx !== undefined
      ? new CANNON.Box(new CANNON.Vec3(o.hx, 1.5, o.hz))
      : new CANNON.Cylinder(o.r, o.r, 3, 8), position.vsub(body.position));
    if (!isRail) world.addBody(body);
  }
  for (const body of rails.values()) world.addBody(body);
}

// Share only samples: Cannon shapes own mutable pillar caches and body pointers.
export function createTerrainBody(terrain = null, options = {}) {
  const body = new CANNON.Body({ ...options, mass: 0 });
  body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  if (!terrain) {
    body.addShape(new CANNON.Plane());
    body.position.y = 0.075;
    return body;
  }

  const { heightAt, halfSize } = terrain;
  let sizes = grids.get(heightAt);
  if (!sizes) grids.set(heightAt, sizes = new Map());
  let grid = sizes.get(halfSize);
  if (!grid) {
    const cells = Math.ceil(halfSize * 2 / 4);
    const elementSize = halfSize * 2 / cells;
    let minValue = Infinity, maxValue = -Infinity;
    const data = Array.from({ length: cells + 1 }, (_, i) =>
      Array.from({ length: cells + 1 }, (_, j) => {
        // Rotating Cannon's XY grid -90 degrees maps local +Y to world -Z.
        const height = terrain.heightAt(-halfSize + i * elementSize, halfSize - j * elementSize);
        minValue = Math.min(minValue, height);
        maxValue = Math.max(maxValue, height);
        return height;
      }));
    grid = { data, elementSize, minValue, maxValue };
    sizes.set(halfSize, grid);
  }
  body.addShape(new CANNON.Heightfield(grid.data, {
    elementSize: grid.elementSize, minValue: grid.minValue, maxValue: grid.maxValue,
  }));
  body.position.set(-halfSize, 0.075, halfSize);
  return body;
}
