# Wellington Waterfront Geometry

Choose **Wellington** in the map menu, or open `?level=wellington`, for a
real-geography-based waterfront drive. The layout, course, rendered terrain,
shoreline safety and minimap share the geographic records documented below.
Run `node --test wellington-course.test.js wellington-world.test.js` for geometry
checks, or `npm test` for the full game suite. Run `npm run build` after changes.

`wellington-world.js` builds the clipped land, harbour, skyline and minimap.
Landmarks use simplified architectural forms; the secondary city blocks and
distant East Harbour ridge are illustrative, not individually mapped buildings
or surveyed terrain. All data and generated geometry work without a runtime map API.

## Exports

`wellington-layout.js` exports exactly:

- `WELLINGTON`: deeply frozen `{ halfSize, landY, waterY, origin, coast, wharves, waterHoles, streets, landmarks, hills }`.
- `projectWellington(lat, lon)`: WGS84 decimal degrees to `{ x, z }` in metres.
- `isWellingtonLand(x, z, margin = 0)`: land/wharf union minus water cutouts, clipped to the gameplay square, with circular clearance.
- `wellingtonHeightAt(x, z)`: shared terrain surface height, not a mesh offset.

`wellington-course.js` exports exactly `createWellingtonCourse()`, returning:

```js
{
  route,          // Vector3[], implicitly closed, no duplicate endpoint
  heightAt,      // wellingtonHeightAt
  roadDistance,  // distance to timed route OR any mapped street centreline
  nearest,       // function (x, z) -> { distance, index, t, height, bank, along }
  halfSize,      // 1500 metres
  length,        // measured closed 3D polyline length in metres
  elevation,     // { min, max, gain }, measured from that polyline
  isSafePosition // land clearance AND clearance from rotated landmark buildings
}
```

`nearest.index` identifies the segment from `route[index]` to
`route[(index + 1) % route.length]`; `t` is its clamped X/Z projection fraction.
`height` is interpolated unbanked centre height. `bank` is dh/dl along the unit
cross-road vector `(-dz, dx)`. `along` is 3D lap distance in `[0, length)`.
Queries to `nearest` and `roadDistance` require finite numeric coordinates.
Treat each returned route as read-only: its segment measurements are cached.

## Coordinates And Shapes

- Origin: latitude **-41.286**, longitude **174.783**, in the inner harbour.
- **x increases east; z increases north**. The existing minimap already draws
  `-z`, so do not invert north a second time.
- One horizontal unit is one metre. The projection uses the WGS84 ellipsoid's
  meridional and prime-vertical radii at the origin, held constant over this
  small area. It is not NZTM2000 and has no gameplay scale multiplier.
- `halfSize = 1500` defines a 3 km square. `landY = 3`, `waterY = 0`, and the
  submerged terrain bed is -4. These are game elevations, not a tidal datum.
- `coast` is an implicitly closed main-land polygon with `{ x, z }` vertices.
  Its northern, western and southern square-clipping edges are not seawalls.
- `wharves` and `waterHoles` contain `{ name, points: [{ x, z }] }` records.
  Render `(coast UNION wharves) MINUS waterHoles`, not separate land slabs
  covering the holes. Whairepo's cutout includes its open harbour channel.
- `streets` contain `{ name, width, points: [{ x, z }] }` polylines. Widths are
  approximate game paved corridors, not lane counts or surveyed road reserves.
- Every landmark has exactly `{ id, name, x, z, w, d, h, rotation, type }`.
  Dimensions are metres; `rotation` is radians using **Three.js rotation.y**.
  `w` is local x width, `d` local z depth; `h` is height above the foundation.
- `hills` contain `{ name, x, z, h, rx, rz }` with approximate summit elevation
  and elliptical support radii. The western hills are intentionally clipped.

At zero margin main-land/wharf boundaries count as land, but lagoon boundaries
count as water. Positive margins must clear exposed boundaries strictly; hidden
wharf attachment seams do not reduce clearance. Nonfinite inputs and negative
margins return false. `isWellingtonLand` does not test buildings.
`isSafePosition` additionally excludes all positive-height landmark footprints;
park and lagoon markers (`h = 0`) are not solid buildings. No renderer or generic
building generator should place additional buildings inside the route's 8.5 m
clearance corridor, or inside these landmark footprints.

## Circuit And Fidelity

The approximately **4.06 km** circuit uses the shared street controls in order:
Waterloo Quay, Customhouse Quay, Jervois Quay, Cable Street, the western Oriental
Parade return, the Kent Terrace junction, Wakefield Street, Victoria Street,
Hunter Street, Featherston Street, and Bunny Street.

The short Oriental section returns south at the western end of the parade;
it does **not** drive all the way around the beach. The full Oriental Parade
polyline, beach contour, Clyde Quay boat harbour, Freyberg Pool and St Gerard's
are included in the surrounding layout. This avoids pretending that hillside
steps are through roads, racing along wharf promenades, or having two ambiguous
lap distances on an identical out-and-back centreline. Parliament and the railway
sit north of the starting area, rather than being moved next to Te Papa.

This is a **fictional closed game circuit, not navigation, a legal driving
itinerary, or an authorised road race**. One-way restrictions, bus-only roads,
traffic islands, junction turning restrictions, temporary works and the
City-to-Sea pedestrian bridge over Jervois Quay are not simulated. The
Kent/Wakefield junction is simplified across its paved intersection. Bends use
small circular fillets instead of a spline that could overshoot into the water.
Tests check the full **6.5 m half-width plus 2 m reserve**, including between
samples, against the shared land mask and every rotated landmark footprint.

The route and mapped coastal streets are deliberately flat at the reclaimed-waterfront game datum. A 40 m terrain apron outside paved street widths keeps
the low-detail hillside mesh from protruding through the finer road surfaces. Hill
relief is a compact analytic approximation away from the lap, fading near shore
and clipping edges, **not a DEM or surveyed contours**. Mount Victoria's summit
control retains 196 m; western hillside controls are illustrative. No false
climbs are added to the quay circuit.

Coastline and road coordinates were manually selected, rounded and simplified
from raw OpenStreetMap nodes fetched on **10 September 2026**. This is a
**hand-traced/simplified derivative**, not a complete raw-data import and **not
survey accuracy**. Expect metres to tens of metres of plan error at simplified
bends, reclamations, junctions and footprints. The outer port is particularly
generalised; small pontoons, piles, breakwaters, steps and beach tidal variation
are omitted. Coordinate decimal precision does not imply measured accuracy.

Landmarks use approximate mapped centres and recognisable massing types rather
than cadastral footprints. Rectangles are simplified principal masses, not all
annexes or roof outlines. They are never relocated arbitrarily to clear the lap.
The 116 m **Majestic Centre** and 103 m **Aon Centre**, formerly **State Insurance
Building / BNZ Centre**, are distinct. The latter has id `stateinsurance` and
type `black-tower`; there is no duplicate `aon` building.

## Landmark Heights

| Landmark / IDs | Height (m) | Basis / recognisable form |
| --- | ---: | --- |
| Beehive | 72 | Published overall height; stepped circular executive wing |
| Parliament House | 25 | Approximate four-storey stone parliamentary mass |
| Railway station | 25 | Approximate monumental station and portico mass |
| Bowen House / Te Iho | 90 | Published height; narrow glass office tower |
| Majestic Centre | 116 | Published height; distinct stepped/crowned tower |
| State Insurance / Aon Centre | 103 | Published height; square black granite tower |
| InterContinental | 45 | Approximate hotel mass, not certified roof height |
| TSB Arena | 18 | Approximate large gabled arena |
| Queens Wharf sheds 1, 5, 6 | 12, 12, 15 | Approximate historic gabled shed masses |
| Te Papa | 30 | Approximate six-level, articulated museum mass |
| Te Hono ki Hawaiki | 8 | Illustrative internal wharenui feature, not an exterior building |
| Michael Fowler Centre | 27 | Approximate sculpted concert-hall roof mass |
| City Gallery | 18 | Approximate low civic/gallery mass |
| Takina | 25 | Approximate convention-centre mass; curved bronze facade type |
| Star Boating / Wellington Rowing Club | 11, 11 | Approximate timber boat-club roof heights |
| Te Wharewaka o Poneke | 12 | Approximate folded waka-house roof |
| Chaffers Dock | 22 | Approximate art-deco apartment conversion |
| Clyde Quay apartments | 18 | Approximate elongated pier apartment mass |
| Clyde Quay boat sheds / Freyberg Pool | 5, 12 | Approximate low shed row and modernist pool |
| St Gerard's | 24 | Approximate brick church/monastery mass above hillside foundation |

Other than the four explicitly published tower heights and the Mount Victoria
summit, heights and dimensions are visual estimates informed by mapped footprints,
storeys and public descriptions. They have not been independently measured.
The OSM Beehive way's `height=7` tag was not used: it conflicts with its ten
storeys and published 72 m overall height.

`wharenui` denotes **Te Hono ki Hawaiki inside Te Papa on Level 4**, as described
by Te Papa itself. It is not Te Wharewaka o Poneke, which has its own record by
Whairepo Lagoon. A renderer should treat `wharenui` as an interior museum feature
or label, not create a separate ground-level building or an invented roof-top
shrine. Detailed cultural carving/design is not reproduced here. Display names
use ASCII spellings in code (for example Takina and Poneke).

## Sources And Attribution

Public-facing attribution for maps or scenes derived from these data:

**Map data (c) OpenStreetMap contributors, ODbL 1.0. Contains data sourced from
Land Information New Zealand (LINZ), licensed for reuse under CC BY 4.0. Geometry
has been simplified and adapted for a fictional game circuit.**

- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
  and [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve the OSM
  attribution in the visible map/scene UI when integrating, not only this file;
  follow the ODbL requirements when distributing the derivative geographic data.
- [Raw OSM JSON map extract used](https://api.openstreetmap.org/api/0.6/map.json?bbox=174.772,-41.294,174.798,-41.276).
  The API returns full ways crossing the box; only the relevant waterfront portion
  was selected. Overpass requests failed; the direct OSM API succeeded. There is
  no runtime network dependency.
- [LINZ attribution in OSM](https://wiki.openstreetmap.org/wiki/LINZ) and
  [LINZ copyright and licensing](https://www.linz.govt.nz/copyright).
  Retrieved coastline ways explicitly identify LINZ, including 2012-06-06 source
  versions, with later OSM edits. This is not a fresh LINZ survey download.
- Coastline OSM ways: [1022527524](https://www.openstreetmap.org/way/1022527524),
  [1024177755](https://www.openstreetmap.org/way/1024177755),
  [188171692](https://www.openstreetmap.org/way/188171692),
  [1022527531](https://www.openstreetmap.org/way/1022527531),
  [1117296496](https://www.openstreetmap.org/way/1117296496),
  [1022527530](https://www.openstreetmap.org/way/1022527530),
  [1022527525](https://www.openstreetmap.org/way/1022527525),
  [690129740](https://www.openstreetmap.org/way/690129740), and
  [1022527527](https://www.openstreetmap.org/way/1022527527).
- [Queens Wharf, way 773900255](https://www.openstreetmap.org/way/773900255),
  [Waterloo Wharf, way 773900257](https://www.openstreetmap.org/way/773900257),
  [Interisland Wharf, way 773900258](https://www.openstreetmap.org/way/773900258),
  [Glasgow Wharf, way 773900259](https://www.openstreetmap.org/way/773900259),
  [Te Papa Lagoon, way 256667074](https://www.openstreetmap.org/way/256667074),
  [Oriental Parade, way 121066309](https://www.openstreetmap.org/way/121066309),
  [Cable Street, way 330592620](https://www.openstreetmap.org/way/330592620),
  [Featherston Street, way 450172282](https://www.openstreetmap.org/way/450172282),
  [Te Papa, way 190557095](https://www.openstreetmap.org/way/190557095), and
  [Takina, way 1028184544](https://www.openstreetmap.org/way/1028184544) are examples
  of the source features retained. Street ways are split at intersections.
- [Wellington City Council: Life's a beach in Oriental Bay](https://wellington.govt.nz/about-wellington/history/throwbackthursday/oriental-parade),
  fetched successfully: waterfront history, St Gerard's, baths/Freyberg Pool,
  reclamation and imported sand. Descriptive corroboration, not surveyed geometry.
- [Te Papa: Rongomaraeroa](https://www.tepapa.govt.nz/visit/exhibitions/te-marae),
  fetched successfully: Level 4 location and the name Te Hono ki Hawaiki.
- [Aon Centre](https://en.wikipedia.org/wiki/Aon_Centre_(Wellington)),
  [Majestic Centre](https://en.wikipedia.org/wiki/Majestic_Centre),
  [Beehive](https://en.wikipedia.org/wiki/Beehive_(New_Zealand)),
  [Wellington building heights](https://en.wikipedia.org/wiki/List_of_tallest_buildings_in_Wellington),
  [Mount Victoria](https://en.wikipedia.org/wiki/Mount_Victoria_(Wellington_hill)),
  [Whairepo Lagoon](https://en.wikipedia.org/wiki/Whairepo_Lagoon), and
  [Oriental Bay](https://en.wikipedia.org/wiki/Oriental_Bay), fetched successfully:
  secondary cross-checks for names, heights, coordinates and descriptions.
  Wikipedia text is CC BY-SA 4.0; this file summarises facts rather than copying
  its article prose. The heights list itself carries an original-research warning.
- [Parliament's Beehive page](https://www.parliament.nz/en/visit-and-learn/history-and-buildings/buildings-and-grounds/parliament-buildings/the-beehive-executive-wing/)
  and [LINZ lagoon naming notice](https://www.linz.govt.nz/news/2015-12/wellington-lagoon-gets-new-name)
  were attempted but blocked by CAPTCHA/403. They are further references, not
  claimed successful downloads.

## Query Cost

Course construction does not build a 3 km spatial grid. It rounds sparse street
controls, subdivides their straight spans to at most 3 m, and caches the mapping
from each sparse span to its resampled route indices. `nearest` projects against
only those sparse spans and returns the matching resampled segment. Initialization
is proportional to route samples, rather than world cells times route samples.
`roadDistance` also checks the sparse street segments. Land geometry computes
exposed boundary fragments once from its small polygon set, so positive margins
are exact against the simplified polygon union, including wharf joins and holes.

Tests cover projection, immutable contracts, simple polygons, independent land
classification, margin semantics, known geographic order, tower identity,
heights, closed length/elevation, exhaustive nearest comparison, route/shoulder
self-intersections, road alignment, and continuous full-corridor land/building
clearance. They do not claim visual renderer verification or legal-road validity.
