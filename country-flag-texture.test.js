import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createCountryFlagTexture } from "./country-flag-texture.js";

// Top-left artwork coordinates, matching standard Three.js UV orientation.
function colorAt(texture, x, y) {
  const { data, width, height } = texture.image;
  const i = ((height - 1 - y) * width + x) * 4;
  return data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
}

function components(texture, color, minX = 0) {
  const { width, height } = texture.image, seen = new Set(), groups = [];
  for (let y = 0; y < height; y++) for (let x = minX; x < width; x++) {
    const id = y * width + x;
    if (seen.has(id) || colorAt(texture, x, y) !== color) continue;
    const group = [[x, y]];
    seen.add(id);
    for (let i = 0; i < group.length; i++) {
      const [gx, gy] = group[i];
      for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
        const nx = gx + dx, ny = gy + dy;
        const next = ny * width + nx;
        if (nx < minX || nx >= width || ny < 0 || ny >= height || seen.has(next)) continue;
        if (colorAt(texture, nx, ny) !== color) continue;
        seen.add(next); group.push([nx, ny]);
      }
    }
    groups.push(group);
  }
  return groups;
}

test("flags are synchronous, opaque, independently owned Node DataTextures", t => {
  for (const name of ["document", "OffscreenCanvas", "fetch", "Image"]) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() { throw new Error(`Unexpected use of ${name}`); },
    });
  }
  for (const [country, width, height] of [["pt", 240, 160], ["ca", 256, 128],
    ["be", 156, 180], ["fr", 240, 160], ["nz", 256, 128]]) {
    const a = createCountryFlagTexture(country), b = createCountryFlagTexture(country);
    t.after(() => { a.dispose(); b.dispose(); });
    assert.ok(a instanceof THREE.DataTexture);
    assert.deepEqual([a.image.width, a.image.height], [width, height]);
    assert.ok(a.image.data instanceof Uint8Array);
    assert.equal(a.image.data.length, width * height * 4);
    assert.equal(a.colorSpace, THREE.SRGBColorSpace);
    assert.equal(a.format, THREE.RGBAFormat);
    assert.equal(a.type, THREE.UnsignedByteType);
    assert.equal(a.generateMipmaps, true);
    assert.equal(a.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(a.magFilter, THREE.LinearFilter);
    assert.equal(a.flipY, false);
    assert.ok(a.version > 0);
    assert.equal(a.userData.country, country);
    assert.equal(a.name, `country-flag-${country}`);
    assert.notEqual(a, b);
    assert.notEqual(a.image.data, b.image.data);
    assert.deepEqual(a.image.data, b.image.data);
    for (let i = 3; i < a.image.data.length; i += 4) assert.equal(a.image.data[i], 255);
    const original = b.image.data[0];
    a.image.data[0] ^= 255;
    assert.equal(b.image.data[0], original);
    let disposed = false;
    a.addEventListener("dispose", () => { disposed = true; });
    a.dispose();
    assert.equal(disposed, true);
    assert.equal(b.image.data[0], original);
  }
});

test("unknown codes are rejected, never assigned a guessed nationality", () => {
  for (const country of [undefined, null, "", "au", "Portugal", "PT", "toString", {}]) {
    assert.throws(() => createCountryFlagTexture(country), RangeError);
  }
});

test("Belgium and France have equal full-height vertical thirds in hoist order", t => {
  for (const [country, colors] of [["be", [0x000000, 0xfdda24, 0xef3340]], ["fr", [0x000091, 0xffffff, 0xe1000f]]]) {
    const texture = createCountryFlagTexture(country);
    t.after(() => texture.dispose());
    const { width, height } = texture.image;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      assert.equal(colorAt(texture, x, y), colors[Math.floor(x * 3 / width)]);
    }
  }
});

test("Canada has 1:2:1 panels and a symmetric eleven-point maple leaf with a stem", t => {
  const texture = createCountryFlagTexture("ca");
  t.after(() => texture.dispose());
  for (let x = 0; x < 256; x++) assert.equal(colorAt(texture, x, 0), x < 64 || x >= 192 ? 0xff0000 : 0xffffff);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    assert.equal(colorAt(texture, x, y), colorAt(texture, 255 - x, y));
    if (x < 64) assert.equal(colorAt(texture, x, y), 0xff0000);
  }
  const leaf = (x, y) => colorAt(texture, Math.floor(64 + x * 1.28), Math.floor(y * 1.28));
  for (const [x, y] of [[50, 13], [60, 24], [70, 36], [85, 40], [88, 54], [69, 80]]) {
    assert.equal(leaf(x, y), 0xff0000, `leaf point at ${x},${y}`);
    assert.equal(leaf(100 - x, y), 0xff0000);
  }
  for (const [x, y] of [[56, 23], [64, 35], [74, 38], [86, 49], [76, 73], [46, 87]]) {
    assert.equal(leaf(x, y), 0xffffff, `leaf notch at ${x},${y}`);
  }
  assert.equal(leaf(50, 88), 0xff0000);
  assert.equal(leaf(50, 97), 0xffffff);
  assert.equal(components(texture, 0xff0000).length, 3, "two bars and one connected leaf");
});

test("Portugal has a 2:3 field split, gold armillary sphere and five blue shields", t => {
  const texture = createCountryFlagTexture("pt");
  t.after(() => texture.dispose());
  for (let x = 0; x < 240; x++) assert.equal(colorAt(texture, x, 0), x < 96 ? 0x006600 : 0xff0000);
  for (const [x, y] of [[96, 40], [56, 80], [135, 80], [96, 119], [62, 73]]) {
    assert.equal(colorAt(texture, x, y), 0xffcc00, `sphere at ${x},${y}`);
  }
  assert.equal(colorAt(texture, 73, 60), 0xff0000, "red shield border on green field");
  assert.equal(colorAt(texture, 80, 60), 0xffffff, "white shield interior");
  const shields = components(texture, 0x003399);
  assert.equal(shields.length, 5);
  assert.ok(shields.every(group => group.length >= 50));
  for (const [x, y] of [[96, 64], [86, 76], [96, 76], [106, 76], [96, 88]]) {
    assert.equal(colorAt(texture, x, y), 0x003399);
    assert.equal(colorAt(texture, x, y + 3), 0xffffff, "white bezant inside blue shield");
  }
});

test("NZ has an upright Union Jack canton and exactly FOUR white-bordered red stars", t => {
  const texture = createCountryFlagTexture("nz"), blue = 0x012169, red = 0xc8102e;
  t.after(() => texture.dispose());
  for (const [x, y, color] of [[0, 20, blue], [64, 10, red], [10, 32, red],
    [55, 10, 0xffffff], [10, 23, 0xffffff], [20, 7, 0xffffff], [20, 12, red], [64, 95, blue]]) {
    assert.equal(colorAt(texture, x, y), color);
  }
  const stars = components(texture, red, 128);
  assert.equal(stars.length, 4);
  assert.equal(components(texture, 0xffffff, 128).length, 4);
  for (const [x, y] of [[192, 25], [160, 56], [224, 48], [192, 102]]) {
    assert.equal(colorAt(texture, x, y), red);
  }
  for (const star of stars) for (const [x, y] of star) {
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      assert.notEqual(colorAt(texture, nx, ny), blue, "each red star is fully white-bordered");
    }
  }
  for (let y = 64; y < 128; y++) for (let x = 0; x < 128; x++) {
    assert.equal(colorAt(texture, x, y), blue, "no Australian Commonwealth star below canton");
  }
});
