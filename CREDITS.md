# WILDRUN asset credits

## Porsche 911 GT3 RS

“2023 Porsche 911 GT3 RS 2.7 Carrera Tribute 992” by **Ddiaz Design**.

Original model: https://sketchfab.com/3d-models/2023-porsche-911-gt3-rs-27-carrera-tribute-992-f17a982d5d8a4d97baef4b00b51a4e9a
Creator: https://sketchfab.com/ddiaz-design
License: **Creative Commons Attribution–NonCommercial–ShareAlike 4.0**: https://creativecommons.org/licenses/by-nc-sa/4.0/

Downloaded from the public Supercar-Vault-3D asset mirror: https://github.com/Nissmo89/Supercar-Vault-3D
The original author, source, and license are embedded in the GLB asset metadata.

Modifications in this game: rescaled model, merged geometry, red body paint, adjusted glass/light materials, and a separate rear rocket attachment. These model adaptations are provided under the same CC BY-NC-SA 4.0 license. The model and its adaptations are for noncommercial use.

## Tesla Model 3

"Tesla Model 3" by **David_Holiday**.

Original model: https://sketchfab.com/3d-models/tesla-model-3-123c10f376ec4f18b93c73afc382808b
Creator: https://sketchfab.com/David_Holiday
License: **Creative Commons Attribution 4.0**: https://creativecommons.org/licenses/by/4.0/

Downloaded from the credited Wawa Sensei slideshow repository:
https://github.com/wass08/r3f-3d-slideshow
Source file: https://raw.githubusercontent.com/wass08/r3f-3d-slideshow/main/public/models/model3_scene.glb
Local asset: `tesla-model-3.glb` (696,588 bytes).

Adaptations: extracted the Tesla without the surrounding showcase props; decoded
Draco compression offline; removed unused data; baked transforms and centered the
car; straightened the front wheels and normalized wheel axes for animation. The
game rescales and material-batches the model, changes paint and glass/light
materials, and adds its educational parts and rocket. The model and its
adaptations retain CC BY 4.0 attribution. Author, license, source, and preparation
details are also embedded in the GLB. No external model service or decoder is
required at runtime.

## Volkswagen Golf GTI Mk1

"1976 Volkswagen Golf GTI Mk1" by **Ddiaz Design**.

Original model: https://sketchfab.com/3d-models/1976-volkswagen-golf-gti-mk1-1fc46cb37bd748e3bb9355fcedaf3817
Creator: https://sketchfab.com/ddiaz-design
Uploader-declared license: **Creative Commons Attribution-NonCommercial-ShareAlike 4.0**:
https://creativecommons.org/licenses/by-nc-sa/4.0/

Downloaded from the public race-flow asset mirror:
https://github.com/richardfariax/race-flow
Source file: https://raw.githubusercontent.com/richardfariax/race-flow/main/web/public/models/golf_gti.glb
Original source download: 3,838,096 bytes; source mesh: 48,825 triangles.
Local asset: `golf-gti-mk1.glb` (3,040,540 bytes; 48,825 triangles).

Local preparation: self-contained GLB with no runtime decoder dependency; baked
transforms; tire and disk geometry separated into four wheel corners with stable
wheel names; dedicated headlight material; retained textures and attribution;
normalized orientation with +Y up and +Z front. The game adds its configurable
educational parts and rocket. Retain attribution and the declared noncommercial
and share-alike restrictions for the model and adaptations, to the extent the
uploader has the rights to license them.

**Provenance caveat: underlying rights are not verified.** The original listing
explicitly states "Based on a Need For Speed Heat 3d model" and credits **GM25**:
https://www.facebook.com/p/GM25-100042237200164/
The uploader's CC declaration does not establish permission from the underlying
game's rights holders. Included at the user's request for **local internal
evaluation only**, not cleared for public or commercial distribution. Do not
publish or deploy this asset without resolving those rights. Internal use is not
a license exemption and can still fall outside the noncommercial terms.

## BYD Atto 1 and Volvo EX40

Original code-authored exterior approximations, added at the user's request.
No third-party vehicle mesh, texture, font, scan or manufacturer CAD is bundled.
Reference photos were inspected for modeling, not copied into the game.

- **BYD Atto 1**: 2025 Australia/New Zealand Premium export-body reference,
  3.990 m length, 1.720 m body width, 1.590 m height, 2.500 m wheelbase;
  185/55 R16 wheels. Not the shorter Chinese-market Seagull, Dolphin, or Atto 3.
  References: https://bydautomotive.com.au/atto-1 and
  https://bydautomotive.com.au/brochures/BYD-ATTO-1-2025.pdf
- **Volvo EX40**: facelift electric SUV, using Volvo MY26 exterior photographs,
  4.440 m length, 1.873 m body width, 1.647 m height, 2.702 m wheelbase;
  19-inch five-spoke wheels and black roof. Not the EC40 coupe, EX30, or the
  pre-facelift XC40 Recharge.
  References: https://www.volvocars.com/uk/cars/ex40-electric/ and
  https://www.volvocars.com/uk/cars/ex40-electric/specifications/

Geometry is defined in `byd-atto-1.js`, `volvo-ex40.js`, and
`authored-car-geometry.js`. Dimensions and reference notes accompany each model.
These are reference-led game models, not exact replicas: lamp optics, alloy
machining, badges, underbodies and glazing are simplified; no modeled interiors
or opening panels. The shared cockpit overlay is not specific to either car.
Real exterior scale is preserved for these two models; existing imported cars
keep their established arcade scale. Paint and the game's teaching parts,
rockets and flags remain customizable. Handling is arcade, not factory data.
Vehicle names and marks identify the depicted vehicles; no manufacturer
affiliation or endorsement is claimed.

## Backhoe loader and DHL delivery van

Source geometry and colormap texture: **Car Kit 3.1** by **Kenney**.
Source: https://kenney.nl/assets/car-kit
Creator: https://kenney.nl/
License: **Creative Commons Zero 1.0 (CC0)**:
https://creativecommons.org/publicdomain/zero/1.0/
Pack license notice: `licenses/kenney-car-kit.txt`.

Downloaded on 2026-09-12 from the official pack archive:
https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip
Original files: `Models/GLB format/tractor-shovel.glb`,
`Models/GLB format/van.glb`, and `Models/GLB format/Textures/colormap.png`.
Local assets: `backhoe-loader.glb` (238,896 bytes) and
`dhl-delivery-van.glb` (192,016 bytes). The original PNG is embedded as a data
URI; mesh geometry, source node names and pivots are retained. Neither asset
requires an external texture, compression decoder, or model service.

Runtime adaptations in `utility-vehicles.js`: isolated paint triangles from the
shared atlas so windows, tires and trim are not yellow-tinted; rescaled the
models; retained four real independently spinning wheels and the original
articulated front-loader shovel; added an original rear swing mount, boom,
dipper, hollow toothed bucket and moving hydraulic rams to make a two-ended
backhoe loader. The original Kenney tractor is not itself a backhoe. The van
adds original geometric red DHL-style lettering/speed stripes on both sides
and both rear doors, cargo panels, a cargo opening, interior floor/bulkhead,
and two hinged animated rear doors. The source van is unbranded. The full
backhoe and DHL appearance are assembled at runtime, not baked into the GLBs.
Both vehicles support the game's flags, configurable paint and educational
upgrades. These are stylized game adaptations, not manufacturer CAD replicas.

**Trademark notice:** DHL and the DHL logo are marks of their respective
owners. Kenney's CC0 license does **not** license the DHL name, logo or other
trademark rights. The geometric lettering is an original depiction, not an
official downloaded logo asset. No affiliation with, sponsorship by, or
endorsement from DHL, DHL Group or Kenney is claimed. Obtain any necessary
trademark permissions before public or commercial use of the branded depiction.

## Forest assets

Forest Slope HDRI and Forest Floor material maps from Poly Haven, CC0.
https://polyhaven.com/a/forest_slope
https://polyhaven.com/a/forest_floor

## Wellington map data

Map data (c) [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Contains data sourced
from [Land Information New Zealand (LINZ)](https://www.linz.govt.nz/copyright),
licensed for reuse under CC BY 4.0. Coastline and street geometry have been
simplified and adapted for a fictional driving circuit.

The derivative geographic database in `wellington-layout.js` is made available
under ODbL 1.0. See [WELLINGTON.md](WELLINGTON.md) for source features, estimated
building heights and fidelity limits. Buildings are simplified generated models,
not downloaded building models or photogrammetry.

## Rendering libraries

Three.js: https://github.com/mrdoob/three (MIT)

- Cannon ES 0.20.0: MIT license. Used for traffic-cone physics; see licenses/cannon-es.txt.
