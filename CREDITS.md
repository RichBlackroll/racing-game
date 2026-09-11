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
