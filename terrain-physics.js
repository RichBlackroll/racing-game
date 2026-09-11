import * as CANNON from "cannon-es";

const grids = new WeakMap();

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
