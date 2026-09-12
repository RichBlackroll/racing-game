import * as THREE from "three";

// Width:height ratios are 3:2, 2:1, 13:15, 3:2, 2:1, and 11:8 respectively.
const sizes = new Map([
  ["pt", [240, 160]], ["ca", [256, 128]], ["be", [156, 180]],
  ["fr", [240, 160]], ["nz", [256, 128]], ["no", [220, 160]],
]);
const WHITE = 0xffffff;

/** Creates an independently owned, opaque texture. Country must be pt/ca/be/fr/nz/no. */
export function createCountryFlagTexture(country) {
  if (!sizes.has(country)) throw new RangeError("Unsupported flag country; expected pt, ca, be, fr, nz, or no");
  const [width, height] = sizes.get(country);
  const data = new Uint8Array(width * height * 4);
  // Artwork uses top-left coordinates; DataTexture's unflipped rows start at UV v=0.
  function pixel(x, y, color) {
    const i = ((height - 1 - y) * width + x) * 4;
    data[i] = color >> 16; data[i + 1] = color >> 8; data[i + 2] = color;
    data[i + 3] = 255;
  }
  function rect(x, y, w, h, color) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) pixel(col, row, color);
    }
  }
  // Even-odd scanline fill also supports the bridged inner contours of sphere rings.
  function polygon(points, color) {
    const first = Math.max(0, Math.ceil(Math.min(...points.map(p => p[1])) - .5));
    const last = Math.min(height - 1, Math.floor(Math.max(...points.map(p => p[1])) - .5));
    for (let y = first; y <= last; y++) {
      const intersections = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [ax, ay] = points[j], [bx, by] = points[i];
        if ((ay > y + .5) !== (by > y + .5)) {
          intersections.push(ax + (y + .5 - ay) * (bx - ax) / (by - ay));
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const start = Math.max(0, Math.ceil(intersections[i] - .5));
        const end = Math.min(width, Math.ceil(intersections[i + 1] - .5));
        for (let x = start; x < end; x++) pixel(x, y, color);
      }
    }
  }

  if (country === "be" || country === "fr") {
    const colors = country === "be" ? [0x000000, 0xfdda24, 0xef3340] : [0x000091, WHITE, 0xe1000f];
    colors.forEach((color, i) => rect(i * width / 3, 0, width / 3, height, color));
  } else if (country === "no") {
    rect(0, 0, width, height, 0xba0c2f);
    // Nordic cross: 6:1:2:1:12 horizontally and 6:1:2:1:6 vertically.
    rect(60, 0, 40, height, WHITE);
    rect(0, 60, width, 40, WHITE);
    rect(70, 0, 20, height, 0x00205b);
    rect(0, 70, width, 20, 0x00205b);
  } else if (country === "ca") {
    const red = 0xff0000;
    rect(0, 0, width, height, red);
    rect(width / 4, 0, width / 2, height, WHITE);
    // Original symmetric eleven-point silhouette, drawn inside the square white panel.
    const half = [[50, 10], [55, 25], [61, 21], [58, 44], [70, 33], [73, 41],
      [87, 38], [83, 51], [91, 54], [68, 73], [72, 82], [52, 79], [52, 94]];
    const leaf = [...half, ...half.slice(1).reverse().map(([x, y]) => [100 - x, y])];
    polygon(leaf.map(([x, y]) => [width / 4 + x * height / 100, y * height / 100]), red);
  } else if (country === "pt") {
    const red = 0xff0000, gold = 0xffcc00, blue = 0x003399;
    rect(0, 0, width, height, red);
    rect(0, 0, width * .4, height, 0x006600);
    const cx = width * .4, cy = height / 2;
    function ring(rx, ry, angle = 0) {
      const points = [];
      for (const inner of [false, true]) {
        for (let i = 0; i <= 64; i++) {
          const a = (inner ? 64 - i : i) * Math.PI / 32;
          const x = (rx - (inner ? 2 : 0)) * Math.cos(a);
          const y = (ry - (inner ? 2 : 0)) * Math.sin(a);
          points.push([cx + x * Math.cos(angle) - y * Math.sin(angle),
            cy + x * Math.sin(angle) + y * Math.cos(angle)]);
        }
      }
      polygon(points, gold);
    }
    ring(40, 40); ring(18, 40); ring(40, 13); ring(40, 12, -.45);
    function shield(x, y, w, h, color) {
      polygon([[x, y], [x + w, y], [x + w, y + h * .65], [x + w * .8, y + h * .88],
        [x + w / 2, y + h], [x + w * .2, y + h * .88], [x, y + h * .65]], color);
    }
    shield(cx - 24, cy - 30, 48, 60, red);
    shield(cx - 18, cy - 24, 36, 46, WHITE);
    for (const [dx, dy] of [[0, -17], [-10, -5], [0, -5], [10, -5], [0, 7]]) {
      shield(cx + dx - 4, cy + dy, 8, 10, blue);
      for (const [x, y] of [[-2, 2], [1, 2], [0, 4], [-2, 6], [1, 6]]) {
        pixel(cx + dx + x, cy + dy + y, WHITE);
      }
    }
    // Seven small gold castle marks in the red shield border.
    for (const [dx, dy] of [[-19, -28], [-2, -28], [15, -28], [-22, -7], [18, -7], [-15, 16], [11, 16]]) {
      rect(cx + dx, cy + dy, 4, 4, gold);
    }
  } else {
    const blue = 0x012169, red = 0xc8102e;
    rect(0, 0, width, height, blue);
    const cw = width / 2, ch = height / 2;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const px = x + .5, py = y + .5;
      const d1 = py - px * ch / cw, d2 = py - (ch - px * ch / cw);
      let color = Math.min(Math.abs(d1), Math.abs(d2)) < ch / 10 ? WHITE : blue;
      // Counterchanged St Patrick saltires, not centered red diagonal stripes.
      const side = px < cw / 2 ? 1 : -1;
      if ([d1, d2].some(d => d * side > 0 && d * side < ch / 15)) color = red;
      if (Math.abs(px - cw / 2) < cw / 12 || Math.abs(py - ch / 2) < ch / 6) color = WHITE;
      if (Math.abs(px - cw / 2) < cw / 20 || Math.abs(py - ch / 2) < ch / 10) color = red;
      pixel(x, y, color);
    }
    function star(x, y, radius, color, inner = .382) {
      polygon(Array.from({ length: 10 }, (_, i) => {
        const a = i * Math.PI / 5 - Math.PI / 2, r = radius * (i % 2 ? inner : 1);
        return [x + Math.cos(a) * r, y + Math.sin(a) * r];
      }), color);
    }
    // Southern Cross only: no fifth star or Commonwealth star below the canton.
    for (const [x, y, r] of [[.75, .2, 8], [.625, .44, 7], [.875, .38, 6], [.75, .8, 9]]) {
      star(x * width, y * height, r, WHITE, .48);
      star(x * width, y * height, r - 2.5, red);
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `country-flag-${country}`;
  texture.userData.country = country;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
