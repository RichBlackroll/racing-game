# WILDRUN — Porsche forest drive

Serve this folder with `python3 -m http.server 8765`, then open http://localhost:8765.

- WASD or arrow keys: accelerate, brake/reverse, steer.
- Space: handbrake.
- Shift or the BOOST button: five-second rocket boost, followed by a gradual return to normal speed.
- C: chase, overhead, or hood camera.
- R: reset the car and boost.
- Graphics menu: Performance (baked) or Ultra (dynamic path tracing). Switching reloads the scene and resets the drive.

Performance is the default: `?mode=fast`. It uses a procedural ground-shadow atlas, baked static vertex lighting, spatially culled forest batches, indexed car geometry, HDR car reflections, and a soft contact shadow. It never creates a path tracer and does not render live shadow maps.

Ultra is available at `?mode=dynamic`. It loads the path-tracing code on demand, traces four light bounces, and updates the moving car geometry. It is intended for high-end GPUs; frame rate depends heavily on hardware.

Path tracing accumulates samples when the camera stops. Movement resets accumulation and uses a lower rendering resolution. Initial shader compilation can take several seconds. Ultra requires WebGL2 and floating-point render targets. The speed boost is arcade behavior, not a simulation of Porsche specifications.

Porsche model: Ddiaz Design, CC BY-NC-SA 4.0, noncommercial use. See CREDITS.md for attribution and details. All asset files are local; no runtime CDN is required.

## Rebuild

Run `npm install` and `npm run build` in this folder. The editable application is `game-source.js`; the separately loaded high-end renderer is `pathtracing.js`.

## Levels and collisions

Use the Level menu to choose Pine Valley (forest) or Downtown (city). Direct links: `?mode=fast&level=forest` and `?mode=fast&level=city`. The graphics mode is preserved when switching levels; the drive resets. Both levels support Ultra rendering.

Collisions use a swept circular car collider against tree/rock circles and building/street-furniture rectangles. Impacts reflect velocity with 82% restitution, preserve tangential motion, and carry lateral momentum that gradually settles. World edges also bounce the car. `collision.js` contains the reusable physics code.
