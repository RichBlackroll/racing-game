// Simplified OSM/LINZ-derived geography, not survey geometry. See WELLINGTON.md.
const origin = Object.freeze({ lat: -41.286, lon: 174.783 });
const radians = Math.PI / 180;
const latitude = origin.lat * radians;
const eccentricitySquared = 6.69437999014e-3;
const denominator = 1 - eccentricitySquared * Math.sin(latitude) ** 2;
const northMetres = radians * 6378137 * (1 - eccentricitySquared) / denominator ** 1.5;
const eastMetres = radians * 6378137 * Math.cos(latitude) / Math.sqrt(denominator);

/** WGS84 degrees to local metres: +x east, +z north; no horizontal exaggeration. */
export function projectWellington(lat, lon) {
  return { x: (lon - origin.lon) * eastMetres, z: (lat - origin.lat) * northMetres };
}

const points = coordinates => coordinates.map(([lat, lon]) => projectWellington(lat, lon));
const polygon = (name, coordinates) => ({ name, points: points(coordinates) });
const street = (name, width, coordinates) => ({ ...polygon(name, coordinates), width });
const landmark = (id, name, lat, lon, w, d, h, rotation, type) =>
  ({ id, name, ...projectWellington(lat, lon), w, d, h, rotation, type });

// North port, Lambton waterfront, Te Aro reclamation, Clyde Quay, Oriental Bay.
// Western/southern edges are world clipping edges, NOT additional coastline.
const shore = points([
  [-41.2810463, 174.7900803], [-41.2814940, 174.7869218],
  [-41.2820032, 174.7848663], [-41.2817633, 174.7843723],
  [-41.2809380, 174.7843044], [-41.2789809, 174.7832620],
  [-41.2797235, 174.7825130], [-41.2801526, 174.7816899],
  [-41.2804881, 174.7811113], [-41.2812269, 174.7806369],
  [-41.2818143, 174.7797286], [-41.2821487, 174.7793537],
  [-41.2830055, 174.7794201], [-41.2836401, 174.7792012],
  [-41.2839585, 174.7791581], [-41.2845164, 174.7793321],
  [-41.2849437, 174.7793989], [-41.2859694, 174.7795057],
  [-41.2861562, 174.7791770], [-41.2864159, 174.7792323],
  [-41.2877995, 174.7795785], [-41.2879750, 174.7796086],
  [-41.2881878, 174.7796721], [-41.2882823, 174.7801889],
  [-41.2895975, 174.7805598], [-41.2893432, 174.7831530],
  [-41.2894480, 174.7834208], [-41.2898993, 174.7835325],
  [-41.2905219, 174.7840982], [-41.2904663, 174.7846796],
  [-41.2905225, 174.7854548], [-41.2904572, 174.7857702],
  [-41.2906239, 174.7862529], [-41.2906505, 174.7864359],
  [-41.2913141, 174.7862140], [-41.2914511, 174.7863666],
  [-41.2913174, 174.7880817], [-41.2912032, 174.7889419],
  [-41.2909728, 174.7894833], [-41.2903932, 174.7891429],
  [-41.2900618, 174.7898237], [-41.2898615, 174.7897717],
  [-41.2897836, 174.7899155], [-41.2899305, 174.7900841],
  [-41.2901639, 174.7900488], [-41.2904709, 174.7908240],
  [-41.2904188, 174.7913942], [-41.2905716, 174.7917398],
  [-41.2907867, 174.7924150], [-41.2910049, 174.7935682],
  [-41.2910526, 174.7941213], [-41.2910424, 174.7943763],
  [-41.2908681, 174.7949950], [-41.2907961, 174.7958015],
  [-41.2907620, 174.7961376], [-41.2905541, 174.7964416],
  [-41.2901457, 174.7967338], [-41.2898616, 174.7969053],
  [-41.2895900, 174.7970378], [-41.2891453, 174.7971747],
  [-41.2887733, 174.7980681], [-41.2880712, 174.7996050],
  [-41.2874636, 174.8003881],
]);

/** Authoritative read-only geometry shared by rendering, terrain and safety. */
export const WELLINGTON = {
  halfSize: 1500, landY: 3, waterY: 0, origin,
  coast: [{ x: -1500, z: 1500 }, { x: 460, z: 1500 }, ...shore,
    { x: 1500, z: -130 }, { x: 1500, z: -1500 }, { x: -1500, z: -1500 }],
  wharves: [
    polygon("Queens Wharf", [
      [-41.2845164, 174.7793321], [-41.2844790, 174.7796892],
      [-41.2837188, 174.7796189], [-41.2837238, 174.7800622],
      [-41.2845909, 174.7802032], [-41.2856903, 174.7803435],
      [-41.2856752, 174.7800083], [-41.2848897, 174.7798730],
      [-41.2849437, 174.7793989],
    ]),
    polygon("Glasgow Wharf", [
      [-41.2801526, 174.7816899], [-41.2819181, 174.7823899],
      [-41.2818948, 174.7828422], [-41.2797235, 174.7825130],
    ]),
    polygon("Interisland Wharf", [
      [-41.2812269, 174.7806369], [-41.2823784, 174.7812293],
      [-41.2823856, 174.7815443], [-41.2804881, 174.7811113],
    ]),
    polygon("Waterloo Wharf", [
      [-41.2818143, 174.7797286], [-41.2817248, 174.7801930],
      [-41.2826698, 174.7804282], [-41.2826714, 174.7806956],
      [-41.2817069, 174.7804835], [-41.2812269, 174.7806369],
    ]),
    polygon("Clyde Quay Wharf", [
      [-41.2904572, 174.7857702], [-41.2883414, 174.7855350],
      [-41.2883627, 174.7858730], [-41.2906239, 174.7862529],
    ]),
  ],
  waterHoles: [
    polygon("Whairepo Lagoon and harbour channel", [
      [-41.2879750, 174.7796086], [-41.2879884, 174.7793014],
      [-41.2880745, 174.7785997], [-41.2883884, 174.7786879],
      [-41.2888422, 174.7788277], [-41.2891112, 174.7789086],
      [-41.2891893, 174.7791422], [-41.2886472, 174.7794558],
      [-41.2881878, 174.7796721], [-41.2881000, 174.7799000],
      [-41.2879000, 174.7798200],
    ]),
    polygon("Te Papa Lagoon", [
      [-41.2895713, 174.7829375], [-41.2895557, 174.7825281],
      [-41.2895839, 174.7823469], [-41.2900924, 174.7820268],
      [-41.2896776, 174.7826746],
    ]),
  ],
  streets: [
    street("Waterloo Quay", 28, [[-41.2802413, 174.7804762], [-41.2811831, 174.7796407], [-41.2818381, 174.7790445]]),
    street("Customhouse Quay", 28, [[-41.2818381, 174.7790445], [-41.2821829, 174.7787875],
      [-41.2832458, 174.7782139], [-41.2838429, 174.7778906], [-41.2841892, 174.7777812]]),
    street("Jervois Quay", 28, [[-41.2841892, 174.7777812], [-41.2844802, 174.7777485],
      [-41.2849704, 174.7778150], [-41.2865832, 174.7781723], [-41.2879646, 174.7784195],
      [-41.2888556, 174.7786015], [-41.2894641, 174.7787261], [-41.2897767, 174.7789472]]),
    street("Cable Street", 24, [[-41.2897767, 174.7789472], [-41.2904307, 174.7800754],
      [-41.2906264, 174.7804127], [-41.2910882, 174.7812682], [-41.2918816, 174.7837364],
      [-41.2922887, 174.7849519], [-41.2923878, 174.7857386]]),
    // This short southbound section is the lap's Oriental Parade return.
    street("Oriental Parade return", 24, [[-41.2923878, 174.7857386], [-41.2927098, 174.7852443], [-41.2930922, 174.7847874]]),
    street("Kent Terrace junction", 24, [[-41.2930922, 174.7847874], [-41.2932814, 174.7845340], [-41.2929739, 174.7841204]]),
    street("Wakefield Street", 22, [[-41.2929739, 174.7841204], [-41.2926293, 174.7833369],
      [-41.2921767, 174.7819125], [-41.2915592, 174.7803262], [-41.2911466, 174.7796322],
      [-41.2904398, 174.7783250], [-41.2899729, 174.7775895], [-41.2892553, 174.7765846], [-41.2887874, 174.7761341]]),
    street("Victoria Street", 22, [[-41.2887874, 174.7761341], [-41.2885518, 174.7761270],
      [-41.2882600, 174.7762239], [-41.2872530, 174.7768081], [-41.2865907, 174.7771636],
      [-41.2859986, 174.7774933], [-41.2857947, 174.7773395]]),
    street("Hunter Street", 22, [[-41.2857947, 174.7773395], [-41.2855926, 174.7767179], [-41.2853618, 174.7759906]]),
    street("Featherston Street", 22, [[-41.2853618, 174.7759906], [-41.2851110, 174.7759679],
      [-41.2846935, 174.7762129], [-41.2823371, 174.7775586], [-41.2810373, 174.7783244],
      [-41.2804006, 174.7787079], [-41.2795784, 174.7791653]]),
    street("Bunny Street", 22, [[-41.2795784, 174.7791653], [-41.2802413, 174.7804762]]),
    street("Waterloo Quay north", 28, [[-41.2802413, 174.7804762], [-41.2788621, 174.7818273],
      [-41.2773632, 174.7832828], [-41.2758854, 174.7847529]]),
    street("Oriental Parade", 22, [[-41.2923878, 174.7857386], [-41.2918130, 174.7864865],
      [-41.2917268, 174.7870510], [-41.2916833, 174.7878392], [-41.2916103, 174.7887112],
      [-41.2914562, 174.7892678], [-41.2910446, 174.7902513], [-41.2907653, 174.7909159],
      [-41.2908655, 174.7916343], [-41.2911786, 174.7923140], [-41.2913722, 174.7931474],
      [-41.2913304, 174.7940910], [-41.2911546, 174.7951576], [-41.2909423, 174.7961865],
      [-41.2905816, 174.7967166], [-41.2899296, 174.7971548], [-41.2891558, 174.7976344], [-41.2886570, 174.7989086]]),
    street("Herd Street", 12, [[-41.2906829, 174.7859278], [-41.2910998, 174.7858511], [-41.2914682, 174.7861300], [-41.2917817, 174.7865455]]),
    street("Bowen Street", 20, [[-41.2786776, 174.7750146], [-41.2788178, 174.7758703], [-41.2788692, 174.7764294]]),
    street("Lambton Quay", 20, [[-41.2788244, 174.7784039], [-41.2795926, 174.7770824],
      [-41.2800167, 174.7762541], [-41.2813000, 174.7756000], [-41.2830535, 174.7754972],
      [-41.2841709, 174.7754463], [-41.2851396, 174.7756415], [-41.2853618, 174.7759906]]),
  ],
  landmarks: [
    landmark("beehive", "The Beehive", -41.27840, 174.77665, 52, 52, 72, 0, "beehive"),
    landmark("parliament", "Parliament House", -41.27778, 174.77635, 68, 58, 25, 0, "parliament"),
    landmark("railway", "Wellington Railway Station", -41.27888, 174.78039, 132, 76, 25, -0.65, "railway"),
    landmark("bowen", "Bowen House / Te Iho", -41.27938, 174.77656, 32, 36, 90, -0.38, "glass-tower"),
    landmark("majestic", "Majestic Centre", -41.28845, 174.77455, 44, 50, 116, -0.5, "majestic"),
    landmark("stateinsurance", "Aon Centre (formerly State Insurance / BNZ Centre)", -41.286741, 174.776393, 42, 42, 103, -0.42, "black-tower"),
    landmark("intercontinental", "InterContinental Wellington", -41.28453, 174.77680, 43, 53, 45, 0.38, "hotel"),
    landmark("tsbarena", "TSB Arena", -41.28553, 174.77877, 49, 93, 18, -0.12, "arena"),
    landmark("queensshed1", "Queens Wharf Shed 1", -41.28420, 174.77989, 24, 88, 12, -0.12, "wharf-shed"),
    landmark("queensshed5", "Queens Wharf Shed 5", -41.28438, 174.77907, 18, 61, 12, -0.12, "wharf-shed"),
    landmark("queensshed6", "Queens Wharf Shed 6", -41.28542, 174.77925, 21, 93, 15, -0.12, "wharf-shed"),
    landmark("frankkitts", "Frank Kitts Park", -41.28710, 174.77880, 52, 165, 0, -0.12, "park"),
    landmark("whairepo", "Whairepo Lagoon", -41.288652, 174.779037, 45, 108, 0, -0.15, "lagoon"),
    landmark("boatsheds", "Star Boating Club / The Boatshed", -41.28854, 174.77966, 20, 27, 11, -0.12, "boat-shed"),
    landmark("rowingclub", "Wellington Rowing Club", -41.28880, 174.77970, 19, 23, 11, -0.12, "boat-shed"),
    landmark("wharewaka", "Te Wharewaka o Poneke", -41.28939, 174.77919, 30, 20, 12, -0.65, "wharewaka"),
    landmark("tepapa", "Museum of New Zealand Te Papa Tongarewa", -41.29036, 174.78196, 130, 75, 30, 0.40, "museum"),
    // Interior feature of Te Papa, not a separate waterfront meeting house.
    landmark("wharenui", "Te Hono ki Hawaiki (inside Te Papa, Level 4)", -41.29020, 174.78218, 22, 16, 8, 0.40, "wharenui"),
    landmark("michaelfowler", "Michael Fowler Centre", -41.28953, 174.77802, 49, 56, 27, 0.35, "concert-hall"),
    landmark("citygallery", "City Gallery Wellington / Te Whare Toi", -41.28843, 174.77735, 42, 35, 18, 0.40, "gallery"),
    landmark("takina", "Takina - Wellington Convention and Exhibition Centre", -41.29146, 174.78118, 61, 52, 25, 0.40, "convention-centre"),
    landmark("waitangi", "Waitangi Park", -41.29135, 174.78455, 102, 90, 0, 0.40, "park"),
    landmark("chaffers", "Chaffers Dock Building", -41.29069, 174.78452, 83, 30, 22, -0.08, "art-deco"),
    landmark("clydequay", "Clyde Quay Wharf apartments", -41.28942, 174.78583, 23, 193, 18, -0.08, "pier-apartments"),
    landmark("orientalboatsheds", "Clyde Quay boat sheds", -41.29142, 174.78773, 110, 12, 5, -0.08, "boat-sheds"),
    landmark("freyberg", "Freyberg Pool", -41.29082, 174.78960, 29, 50, 12, -0.49, "pool"),
    landmark("stgerard", "St Gerard's Church and Monastery", -41.29176, 174.79087, 49, 37, 24, -0.55, "monastery"),
  ],
  hills: [
    { name: "Mount Victoria / Matairangi", ...projectWellington(-41.29611, 174.79417), h: 196, rx: 640, rz: 780 },
    { name: "Kelburn hillside (clipped)", ...projectWellington(-41.2875, 174.7645), h: 145, rx: 790, rz: 900 },
    { name: "Thorndon / Tinakori foothills (clipped)", ...projectWellington(-41.2750, 174.7675), h: 125, rx: 650, rz: 800 },
  ],
};
function freeze(value) {
  Object.values(value).forEach(child => { if (child && typeof child === "object") freeze(child); });
  return Object.freeze(value);
}
freeze(WELLINGTON);

const clamp = t => Math.max(0, Math.min(1, t));
function distanceSquared(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
  return (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
}
function contains(polygon, x, z) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (distanceSquared(x, z, a, b) < 1e-16) return true;
    if ((a.z > z) !== (b.z > z) && x < a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z)) inside = !inside;
  }
  return inside;
}
const land = [WELLINGTON.coast, ...WELLINGTON.wharves.map(p => p.points)];
const holes = WELLINGTON.waterHoles.map(p => p.points);
const dry = (x, z) => land.some(p => contains(p, x, z)) && !holes.some(p => contains(p, x, z));
const edges = [...land, ...holes].flatMap(p => p.map((a, i) => ({ a, b: p[(i + 1) % p.length] })));
const streets = WELLINGTON.streets.flatMap(street => street.points.slice(1).map((b, i) => ({ a: street.points[i], b, halfWidth: street.width / 2 })));

// Split only the sparse polygon edges once. Keep exposed union boundaries, not
// wharf/land attachment seams; a clearance disc may straddle either polygon.
const boundary = [];
for (const { a, b } of edges) {
  const dx = b.x - a.x, dz = b.z - a.z, squared = dx * dx + dz * dz, cuts = [0, 1];
  for (const { a: c, b: d } of edges) {
    const ex = d.x - c.x, ez = d.z - c.z, cross = dx * ez - dz * ex;
    if (Math.abs(cross) > 1e-8) {
      const t = ((c.x - a.x) * ez - (c.z - a.z) * ex) / cross;
      const u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / cross;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    } else if (Math.abs((c.x - a.x) * dz - (c.z - a.z) * dx) < 1e-7) {
      for (const p of [c, d]) cuts.push(clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / squared));
    }
  }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] - cuts[i - 1] < 1e-10) continue;
    const t = (cuts[i] + cuts[i - 1]) / 2, x = a.x + dx * t, z = a.z + dz * t;
    const nx = -dz / Math.sqrt(squared) * 1e-5, nz = dx / Math.sqrt(squared) * 1e-5;
    if (dry(x + nx, z + nz) !== dry(x - nx, z - nz)) boundary.push({
      a: { x: a.x + dx * cuts[i - 1], z: a.z + dz * cuts[i - 1] },
      b: { x: a.x + dx * cuts[i], z: a.z + dz * cuts[i] },
    });
  }
}

/** Land union minus lagoon cutouts, with nonnegative circular clearance metres. */
export function isWellingtonLand(x, z, margin = 0) {
  if (![x, z, margin].every(Number.isFinite) || margin < 0
      || Math.abs(x) + margin > WELLINGTON.halfSize || Math.abs(z) + margin > WELLINGTON.halfSize || !dry(x, z)) return false;
  return margin === 0 || boundary.every(({ a, b }) => distanceSquared(x, z, a, b) > margin * margin);
}

/** Game datum: flat reclaimed waterfront, compact hill relief, submerged bed -4. */
export function wellingtonHeightAt(x, z) {
  if (!isWellingtonLand(x, z)) return -4;
  let relief = 0;
  for (const hill of WELLINGTON.hills) {
    const r2 = ((x - hill.x) / hill.rx) ** 2 + ((z - hill.z) / hill.rz) ** 2;
    if (r2 < 1) relief += (hill.h - WELLINGTON.landY) * (1 - r2) ** 2;
  }
  if (relief === 0) return WELLINGTON.landY;
  // Keep a full terrain-triangle apron flat beside the reclaimed coastal roads.
  // Otherwise coarse hillside triangles can cut through the finer asphalt mesh.
  let streetDistance = Infinity;
  for (const { a, b, halfWidth } of streets) streetDistance = Math.min(streetDistance, Math.sqrt(distanceSquared(x, z, a, b)) - halfWidth);
  const roadBlend = clamp((streetDistance - 40) / 60);
  relief *= roadBlend * roadBlend * (3 - 2 * roadBlend);
  let shoreDistance = Infinity;
  for (const { a, b } of boundary) shoreDistance = Math.min(shoreDistance, distanceSquared(x, z, a, b));
  const t = clamp(Math.sqrt(shoreDistance) / 90);
  return WELLINGTON.landY + relief * t * t * (3 - 2 * t);
}
