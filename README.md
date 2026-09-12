# WILDRUN — Porsche forest drive

Elios racing game.

## Launch and local session

The homepage shows all six maps and My garage while the initial world prepares.
Clicking a map immediately opens its full-screen level loader and enters the drive
when the world is ready, without a second Drive/Continue click. Clicking the loaded
map reuses that world; a different map carries a one-shot launch intent through
navigation. Ordinary visits and reloads still open the homepage. My garage remains
available once the current car and world are ready.
After automatic entry, the first driving gesture enables engine audio when the
browser requires user activation; audio never adds another launch confirmation.
Maps in the toolbar returns to this menu without discarding the current drive.

The selected car, car parts, garage tab, last map, camera, engine sound and people-voice
settings save on this browser and origin. Each map also saves a grounded driving
position, checkpoint, lap and lap timing every three seconds and on interruptions.
Reloading resumes stationary on the current terrain, never in mid-jump or boost.
Reset starts that map's drive over without removing the car build.
Corrupt saves fall back safely; blocked
or full storage keeps the game playable but cannot retain choices across reloads.

`session.js` owns `wildrun-session-v1` in localStorage. It does not sync devices.
An explicit valid `?level=` link overrides the last map saved on this device.

## Utility vehicles and special actions

My garage now includes a Giant Backhoe Digger and a DHL Delivery Van, alongside
the five cars. Both use local CC0 Kenney Car Kit models, adapted for this game;
see `CREDITS.md` for sources, modifications and the DHL trademark notice.
The backhoe is 8.8 metres long in its travel pose, versus roughly 4-4.6 metres
for the cars. It has slower acceleration, steering and top speed, larger contact
dimensions, and a higher, wider chase camera with extra portrait-screen clearance.
The van sits between the backhoe and ordinary cars in speed and camera distance.
Selecting either utility vehicle starts with yellow paint; garage upgrades still work.

Click/tap the vehicle action button, or press **E**:

| Vehicle | Special action |
| --- | --- |
| Porsche | Sprint: a short speed increase with golden trails |
| Tesla | Light pulse: a decorative electric wave |
| Golf | Hop: a playful visual suspension bounce |
| BYD Atto 1 | Bubbles: a floating bubble trail |
| Volvo EX40 | Beacon: a sweeping amber light effect |
| Giant Backhoe | Dig: lower the scoop, lift soil and tip out a heap |
| DHL Delivery Van | Deliver: open the rear doors and drop a parcel |

Park before digging or delivering. Digging also needs clear off-road soil, away
from water and buildings. The vehicle stays parked during its working cycle;
each action has a visible cooldown. Dig marks, soil and parcels are bounded visual
props, not terrain deformation or collision obstacles. At most 12 deposits remain
for 30 gameplay seconds. Actions freeze on pause and reset on vehicle changes,
garage entry and Reset. Reduced motion reduces particle density and the Golf hop.
Collected items still use **F**, and rockets still use **Shift**.

`vehicle-data.js` owns handling, camera and action profiles; `utility-vehicles.js`
preserves model articulation. `vehicle-actions.js` owns pause-safe cycles and pooled
effects, and `vehicle-action-ui.js` handles keyboard, touch and accessibility.
`gameState().specialAction` exposes readiness, cooldown and live deposit counts.

## Time of day

The toolbar clock shows live 24-hour game time, not your device's local time.
Tap it to open a compact Time of day panel. On compact screens, open Menu first:
the clock and its controls stay inside the scrollable, paused drive menu rather
than covering the road or pedals. Desktop keeps the toolbar clock.

- Drag Game time, or use its arrow keys, Home and End, to choose any minute.
- Dawn (05:00), Day (12:00), Golden hour (19:30), and Night (23:00) jump immediately.
- Auto cycle toggles Running/Frozen. Freezing holds the time without pausing the car;
  choosing a time or preset does not automatically freeze the cycle.
- Minutes / day selects 3, 12, or 30 real minutes per full game day.
- Night lighting shows the current night-lighting blend, not a separate lights switch.
- Escape or Close returns focus to the clock. Clicking outside or tabbing out closes
  the panel. Keys used inside the controls do not steer, reset, or boost the car.
  The updating clock is not a live screen-reader announcement.

The daylight controller defaults to 16:30 and a 12-minute day, running unless
prefers-reduced-motion is enabled. A valid saved choice overrides these defaults.
Time controls save only your chosen time, auto-cycle setting, and day length in
`wildrun-time-controls-v1`, separate from the driving session. Slider selections
save when committed, not on every animation frame. Changing speed or freezing later
does not replace your saved time with the automatically advanced clock. Invalid
settings fall back to controller defaults; unavailable storage leaves controls usable.

Day/night skies, planets, and aurora are stylized scenery, not an astronomical
simulation: game time does not predict real planetary positions, seasons, or aurora.

`time-controls.js` exports `createTimeControls({ daylight, onChange })`, returning
`{ update(), dispose() }`. The caller supplies the daylight controller, marks the scene
dirty in `onChange`, calls `update()` each render, and calls `dispose()` at teardown.
The controls never advance time or own a render loop. They consume `state()` with
`{ hour, daylight, night, period, running, cycleMinutes }` and the setters
`setHour(number)`, `setRunning(boolean)`, and `setCycleMinutes(number)`.
Run `node --test time-controls.test.js` for settings validation, persistence,
keyboard isolation, focus, dismissal, and lifecycle checks using a lightweight DOM mock.

## Living worlds

Each map has its own shuffled lineup of animated surprises, beginning within a few
seconds of driving. Balloonists wave from striped baskets, propeller planes and
helicopters cross the skyline, birds flap past, kites trail ribbons, and airships
cruise overhead. Forest, Downtown and Stunt Park have strolling elephants;
Downtown and Stunt Park also have rocket launches with fire and drifting smoke.
Stunt Park occasionally gets a flying-saucer visitor.

Amsterdam and Wellington feature balloonists, birds, planes, helicopters, kites
and airships. Moon Run has rocket launches, flying saucers, tumbling satellites,
comets, hopping astronauts and a space-suited elephant. Shooting stars also appear
on the five Earth maps after dark, alongside the existing planets and aurora.

Events stay anchored in the world, fade in and out, and never change driving
physics or move the camera. Ground visitors use clear, dry, off-road paths.
Scheduling excludes pause, menus, garage, background and graphics-loss time;
Reset clears the visitors and starts a fresh lineup. Desktop allows up to three
simultaneous events; performance mode allows two. Reduced motion allows one
slower visitor at a time, without bobbing, rapid articulation or smoke effects.
`gameState().ambientEvents` reports the lineup, active visitors and bounded counts.

Run `node --test ambient-events.test.js ambient-models.test.js` for map coverage,
placement, animation, pause/reset, motion preferences and resource budgets.

## Mobile browsers and touch screens

Both portrait and landscape layouts have separate steering, accelerator/brake,
handbrake, and boost controls. Hold steering and a pedal together; lifted or
cancelled touches release independently. Safe-area padding keeps controls away
from the home indicator. Pause/Resume is available in the top toolbar; switching
apps temporarily pauses the drive and clears held controls. Returning resumes the
drive automatically unless you paused it yourself. Temporary graphics-context loss
also recovers without locking the controls behind the loading screen.
Browser-toolbar height changes keep held pedals engaged; rotation or changes to
the control layout release them safely. Resizing a paused drive redraws the view
without advancing the car. Compact phone layouts keep the HUD clear of controls,
and narrow garage tab strips scroll horizontally instead of shrinking touch targets.

On touch devices (including landscape tablets), or at widths up to 900px or heights
up to 600px, driving shows Menu, Pause/Resume, a small speed
readout, and the driving controls. Menu contains
Maps, Garage, Camera, Reset, Sound, Voices, Time of day, route map, and
asset credits. Route map and time controls start collapsed each
time Menu opens. It pauses the car and clears held pedals; closing resumes only if
the drive was not already manually paused. Inside view keeps the rear-view mirror
and compact speed readout without the full-width dashboard or ornamental instruments.

iPad (including Safari's desktop identity) and coarse-pointer phones use the same cinematic world
renderer with reduced scenery detail. Rendering caps the drawing buffer at
1.2 million pixels on tablets/phones and 2.07 million on desktop, and targets at
most 60 updates per second on all devices. Every three seconds of active driving,
measured frame rate adjusts resolution, including on non-touch laptops.
Below 45 FPS, automatic performance mode also bypasses HDR bloom/post grading,
uses 1024/512 sun/moon and 256 headlight shadow maps, and removes streetlight
shadows while retaining their illumination. Touch profiles start in this mode.
Desktop effects return only after resolution recovers and five healthy windows
above 57 FPS, preventing rapid quality switching. Loading, pause, background and
garage time are excluded from frame-rate measurements. The render-status label
and `gameState().mode` report performance mode; `gameState().resolutionScale`
reports the adaptive scale. Normal and roughness ground downloads are skipped.
The iPad profile uses smaller occlusion and dynamic shadow maps, fewer vegetation
instances and facade details, and disables multisample AA.
The frame limiter preserves its timing remainder on 90/120/144 Hz displays without
accelerating physics. The garage renders only after changes or during camera
transitions, avoiding continuous GPU work while choosing parts.
Hidden compact route maps are not repainted while driving. Pedestrian batches
submit only occupied instance slots, and receive-only terrain/paving stays out of
shadow passes without reducing the visible crowd or changing driving physics.

Run `node --test tablet.test.js mobile-ui.test.js game-lifecycle.test.js modifier-preview.test.js`
for device detection, rendering budgets, frame pacing, resize, garage-idle, and
multi-touch interruption checks. Chromium and WebKit mobile emulation cover small
phones, portrait/landscape rotation, paused resizing, and garage interactions.
Chromium also covers simultaneous touch steering and acceleration, and tablets.
Emulation does not establish real mobile GPU performance; validate on physical
iOS Safari and Android Chrome devices before claiming a frame-rate target.

Serve this folder with `python3 -m http.server 8765`, then open http://localhost:8765.

- WASD or arrow keys: accelerate, brake/reverse, steer.
- Space: handbrake.
- Shift or the BOOST button: five-second rocket boost, followed by a gradual return to normal speed.
- F or the large item button: deploy your collected toy with one press or tap.
- C: chase, overhead, or inside camera. Inside view includes a live rear-view mirror,
  steering wheel, analog/digital speedometer, drive gear, boost timer, trip distance,
  and handbrake indicator, with dashboard trim, vents, and windshield pillars.
- R: reset the car and boost.

## Playful collectible items

Drive through a floating collectible to collect one item. Each pickup has a large
item-shaped model, colored ground ring, and sparkles. The bottom-center item button
shows full-color artwork, its name, a Ready label, and its action: Drop, Fire, Throw,
Use, or Zap. An empty pocket has a dashed outline and says Empty / No item.
Tap the button or press F, including while
holding touch steering and a pedal. Holding F does not repeatedly deploy items.
Your pocket holds one item; passing another pickup never replaces it.

| Item | What it does |
| --- | --- |
| Banana Peel | Drops a peel behind you for a short, wobbly slip. |
| Silly Oil | Drops a purple, slippery puddle. |
| Confetti Mine | Drops a colorful toy puck that pops confetti and slows cars within 9 m. |
| Foam Rocket | Fires a soft rocket straight ahead, inheriting your forward speed. |
| Buddy Rocket | Gently steers a soft rocket towards a nearby racer ahead. |
| Bouncy Ball | Throws a ball that bounces off the ground and scenery. |
| Water Balloon | Throws an arcing balloon with a 7 m splash. |
| Bubble Shield | Clears slips and blocks item effects for 6 seconds. |
| Turbo Star | Gives extra acceleration, 45% more cruise speed, and protection for 5 seconds. |
| Lightning | Slows every other racer, anywhere on the map, for 4 seconds. |

Each map scatters 60 collectibles across safe road and off-road spots, including remote
exploration areas. Colored minimap diamonds mark available items. All ten types
appear, with the strongest items less common. Pickups return after 18 seconds of
driving; the player collects them, while all five friend racers react to effects.
Dropped toys disappear after 24 seconds. They can catch you too after a brief
safe drop window, so watch out on the return trip!

Everything is cartoon play: temporary slows and gentle wobbles, no damage,
elimination, scary explosions, camera shake, or flashing-screen lightning.
Steering stays responsive. Pause, menus, the garage, and backgrounding freeze all
item timers. Reset clears your pocket and deployed toys and restores the pickups;
items are not saved between reloads. Reduced motion removes decorative bobbing,
spinning, and confetti movement.

`item-system.js` owns the simulation, `item-world.js` batches the shared 3D toys,
and `item-ui.js` owns the one-button controls. Run `node --test item-*.test.js`
for placement, swept collisions, item effects, visuals, and input/lifecycle tests.

Rendering retains physically based materials and HDR reflections. `daylight.js`
coordinates moving sun and moon lights, sky colors, ambient light, exposure and
reflection intensity. All maps use summer timings: sunrise at 05:00 and sunset at
21:00 give 16 hours of daylight and 8 hours of night. At the default 12-minute
cycle, that is 8 active minutes above the horizon and 4 below, with twilight
blending at each crossing. Texel-snapped local shadow maps follow the car, including
moving vehicles, people and props; ground contact occlusion remains directionless.
`night-lights.js` fades occupied windows, street lamps and vehicle lenses at dusk.
Two scene-owned headlights with soft dipped-beam patterns illuminate the road even
in cockpit view, and a bounded pool of nearby streetlights casts shadows (four on
desktop, two on tablet).
`roadside-lights.js` adds warm hanging lanterns, solar-capped guide posts and
drive-over cat's-eyes along the routes. Lunar fixtures use weathered metal and
amber light; existing urban lamps and landmark access paths retain their space.
Lantern pools use the same shadow-light budget, while small guide lenses glow
at dusk without allocating a light per post. All hardware remains visible by day.
Roadside lights, guide posts and city street lamps are non-colliding scenery:
driving through a lamp never causes a bounce or a speed penalty.
Chevron signs and road reflectors return real, shadowed headlight illumination
toward the driver through `road-reflectors.js`, rather than glowing in darkness.
Run `node --test roadside-lights.test.js road-reflectors.test.js` for placement,
lighting budgets and reflective-material checks. The reflector test also supports
an optional WebGL run via `ROAD_REFLECTORS_PLAYWRIGHT` (an installed Playwright
module path) and `ROAD_REFLECTORS_CHROME` (a Chrome executable path).
Time advances only during active driving, not in menus, pause or background tabs;
choosing another time while paused still redraws the lighting immediately.
The full cycle repeats: daylight, warm amber/rose sunset, cobalt blue hour, night,
blue hour, warm sunrise, then daylight again. Sky, fog, cloud glow and ambient
light blend smoothly in both directions. The solar clock uses active elapsed time
independently of the capped physics step, with a one-second cap for long stalls.
A half-float HDR
resolve adds restrained highlight bloom, color grading, and vignette, with a
direct-render fallback on devices without the required render-target support.

`course.js` defines the shared drivable terrain and longer, banked routes.
`world.js` plants conifers, meadow grass, and weathered stone on those hills,
with continuous mountain/coastal relief beyond them. `architecture.js` builds the city's stepped glass/travertine
facades and planted terraces, forest visitor pavilions, and stunt-park canopy.
`atmosphere.js` and `celestial-sky.js` supply sun glow, aerial haze, cirrus, pollen,
stars, a dusty Milky Way, a cratered moon, stylized planets (including ringed Saturn),
and green/teal/violet aurora curtains. Moon Run retains its black vacuum sky and
Earth landmark, without an atmospheric aurora or a second moon.
Its expedition palette pairs charcoal regolith and fractured basalt with muted
metal habitats and amber route markings. A low white sun, minimal ambient and
reflection fill, and no bloom separate sunlit faces from deep shadows. Eight
impact basins and broken off-road relief share the driving/physics height sampler;
the circuit, base and flat ramp runways stay unchanged. Local terrain and rocks
cast shadows, while distant ridges and thin road ribbons remain receive-only to
avoid blacking out the route or producing self-shadow stripes.
Reduced-motion preferences stop decorative wind, water, cloud, aurora and pollen motion.
Road surfaces, four-point chassis grounding, cameras, buildings, and scenery all
sample the same elevations. `terrain-physics.js` supplies matching Cannon
heightfields for cones, toys, pedestrians, and ramp flight. Run `npm test` for
geometry, road-clearance, collision, and rendering-budget regression checks.

## Hill circuits

- Pine Valley: 5.10 km with 231 m cumulative ascent, outer ridge excursions,
  woodland switchbacks, banked bends, and inset valley descents.
- Downtown: 3.48 km through downtown streets and broad, rolling outer avenues.
- Stunt Park: 3.60 km with asymmetric hill loops, S-bends, and two ramp straights.
- Moon Run: 3.63 km with crater-side sweeps, lunar hills, and low-gravity jumps.
- Amsterdam: canal-side streets and drivable bridges in a compressed city district.
- Wellington: a 4.06 km waterfront circuit on mapped quays, with Oriental Bay open for free driving.

The map includes a live elevation profile, altitude, and road grade. Chevron
signs mark tighter bends. Climbing affects acceleration, lower speeds allow
tighter steering, and sequential checkpoints record lap times and a session
best. Ramp approaches and landings retain flat, full-width safety zones.

Pine Valley, Downtown, Stunt Park and Moon Run also have five detailed destinations,
marked with golden stars on the map and linked to the road by eight-metre-wide trails:

- Forest: mushroom village, timber camp, ranger lookout, caravan campsite, and steam railway.
- City: fairground wheel, fire station, railway depot, crane/excavator yard, and ice-cream market.
- Stunt: drive-through circus, retired truck workshop, spectator wheel, tow-truck garage, and monster-truck display.
- Moon: launch rocket, connected habitats, drive-through greenhouse, rover depot, and satellite observatory.

`landmarks.js` places and material-batches the scenery from
`landmark-neighborhoods.js` and `landmark-adventures.js`. Terrain-following
clearings keep vegetation and rocks off the access lanes. Buildings and vehicles
have localized colliders; overhead structures do not become invisible ground walls.
Tablet mode retains every destination with lower curved-geometry detail.
Saves retain the car's position and build when circuits change, but incompatible
checkpoint progress and best-lap records restart for the new course length.

The speed boost and visible teaching parts are arcade behavior, not a simulation of real vehicle specifications.

Porsche model: Ddiaz Design, CC BY-NC-SA 4.0, noncommercial use. Tesla Model 3:
David_Holiday, CC BY 4.0. Volkswagen Golf GTI Mk1: Ddiaz Design, declared
CC BY-NC-SA 4.0, but underlying game-model rights are unverified; local internal
evaluation only, not cleared for public or commercial distribution. See
[CREDITS.md](CREDITS.md) for attribution, adaptations, and the Golf provenance caveat.
All three car assets are local; no runtime CDN or model-download account is required.

## Wellington Waterfront

Choose Wellington in Maps or open `http://localhost:8765/?level=wellington`.
The 3 km district preserves real-world horizontal scale and north orientation,
with a simplified OpenStreetMap/LINZ coastline, wharves, lagoons, and street layout.
The skyline includes the Beehive, Parliament, railway station, Majestic and Aon
towers, Te Papa, Takina, Michael Fowler Centre, and St Gerard's above Oriental Bay.
Harbour water, shoreline safety, and the north-up minimap share the same geometry.

Landmarks have simplified architectural massing; secondary buildings and distant
hills are illustrative. This is not photogrammetry, surveyed terrain, or a legal
driving itinerary. See [WELLINGTON.md](WELLINGTON.md) for fidelity limits, sources,
published versus estimated heights, and map-data licensing.

## Car configurator

Tap Garage to enter My garage, a native modal that fills the iPad screen.
The road is put away and the same live car sits on a studio turntable.
It stays still until you swipe or tap Turn car. Selecting a part turns to
a useful viewing angle, and every choice changes the car immediately.

Choose your car offers the original Porsche 911 GT3 RS, Tesla Model 3,
Volkswagen Golf GTI Mk1 (1976 hot hatch), BYD Atto 1, and Volvo EX40,
each with its own illustrated silhouette.
Switching preserves paint, wheels, springs, wing, and rocket, and fits the selected
car's default engine: four cylinders for the Porsche and Golf, electric for the
Tesla, Atto 1, and EX40. Other engine choices remain available as playful upgrades. Tapping the
current car keeps its customized engine. The choice and custom build save across
reloads and maps; driving position and heading do not change. Only the selected
imported model downloads; the two code-authored EVs need no model download.
Failed switches keep the current car, and closing the garage cancels a pending
switch. If a saved Tesla or Golf cannot load on startup, the game tries the Porsche.
Replaced models release their geometry, materials, and decoded textures.

The Atto 1 is an original approximation of the 2025 AU/NZ Premium export model,
with its 3.990 m body, 16-inch wheels, angular six-strip headlights, dotted
floating-roof pillars and full-width rear light. The EX40 uses the facelift
electric SUV exterior: 4.440 m body, 19-inch wheels, upright black roof/rails,
closed grille, Thor's Hammer headlights and hooked vertical rear lamps.
These two retain real-world exterior scale and wheelbase instead of the imported
cars' established 4.6-unit normalization. Their body profiles, glazing, open
arches, wheel details and badges are authored in `byd-atto-1.js`, `volvo-ex40.js`
and `authored-car-geometry.js`, then use the same paint, steering, lights,
upgrades and disposal pipeline as the GLBs. They are reference-led game models,
not factory CAD or exact replicas; interiors and optics are simplified.
Manufacturer references and fidelity limits are recorded in
[CREDITS.md](CREDITS.md#byd-atto-1-and-volvo-ex40).

The bundled Golf is [Ddiaz Design's 1976 Volkswagen Golf GTI Mk1](https://sketchfab.com/3d-models/1976-volkswagen-golf-gti-mk1-1fc46cb37bd748e3bb9355fcedaf3817),
obtained from the public race-flow mirror and prepared as `golf-gti-mk1.glb`.
It is self-contained, with baked transforms, four separate tire/disk corners with
stable wheel names, a dedicated headlight material, retained textures and
attribution, and +Y up / +Z front. No runtime model decoder is required.
The listing declares CC BY-NC-SA 4.0 but explicitly says "Based on a Need For Speed
Heat 3d model" and credits GM25. Underlying rights are **not verified**; the Golf
is included for local internal evaluation, not cleared for public distribution. See
[CREDITS.md](CREDITS.md#volkswagen-golf-gti-mk1) for the full provenance and caveat.

Six illustrated buttons select Paint, Wheels, Springs, Engine, Wing, and
Rocket. Large paint pots and part pictures make choosing possible without
reading. The preview and category buttons stay in place while the workbench
scrolls, in both orientations. Tapping a part tab scrolls its choices into view.
Undo reverses part changes on the current car and resets when switching models.
Let's drive returns to the road without an extra Apply step. Parts presets are
tucked under Try a parts setup and keep the chosen model and paint colour.

The visible teaching engine has four, six, or eight cylinder caps, or an
electric battery pack. Monster wheels lift the body, springs visibly change
ride height, and hub motors add four cyan wheel centres. Wings and rockets
change size or disappear. Read fact reads the selected educational fact aloud;
rapid tapping does not queue spoken instructions.

The Engine tab's Hear engine button plays a two-second synthesized rev for the
selected four-cylinder, V6, V8 or electric engine. Driving sound responds to speed,
throttle and boost. The toolbar Sound button mutes driving audio; explicit garage
previews still work when muted. Engine audio is independent of people voices.
Audio starts only after a user gesture, with no autoplay permission required.
Pausing, opening menus, closing the garage and backgrounding silence the engine.
If playback is blocked, tap Enable sound or Hear engine again and check device/tab
volume. These are procedural arcade sounds, not recordings of the Porsche.

Entering the garage stops the car, clears held controls, and cancels boost.
It never changes the driving position or heading. Closing, Escape, rotation,
and app interruptions release input safely; an existing pause stays paused.
The preview reuses the same WebGL renderer rather than creating another
graphics context. Desktop, emulated iPad portrait/landscape, phone, touch-drag,
and context-loss checks were run; physical iPad performance still needs device
validation.

Modifications change real performance: wide wheels and bigger spoilers
steer harder, monster wheels and lift kits cruise faster off-road, bigger
engines raise cruise speed and acceleration, electric hub motors accelerate
instantly, and a bigger rocket boosts longer and faster. Removing the
rocket disables BOOST until one is fitted again.

`modifier-data.js` is a pure module describing parts, facts, and physics
multipliers; `modifier-ui.js` builds the panel, `modifier-car.js` applies the 3D
visuals, and `modifier-preview.js` manages the live preview. `vehicle-data.js`
lists the available cars; `vehicle-model.js` loads, adapts, and releases their
models. Run `npm test` for tuning, actual-GLB geometry and attribution checks,
authored-EV dimensions, open wheel arches and geometry budgets,
vehicle loading/cancellation, persistence, and garage integration tests.
Run `node --test modifier-ui.test.js session.test.js` for the garage roster,
Golf selection, default/custom engines, swap semantics, and saved-state checks.
Automated attribution checks do not verify underlying intellectual-property rights.

## Rebuild

Run `npm install` and `npm run build` in this folder. The editable application is `game-source.js`.

`bootstrap.js` starts the lightweight loading screen before downloading the game bundle. Loading stages and recovery live in `loading.js`, with destination artwork and transitions in `experience.css`. Rebuild after JavaScript changes for local internal evaluation, keeping `build/bootstrap.js` together with all its generated game and shared chunks. Do not publish or deploy builds containing the Golf asset; see the restrictions in [CREDITS.md](CREDITS.md#volkswagen-golf-gti-mk1).

## Levels and collisions

Use Maps or the Level menu to choose Pine Valley (forest), Downtown (city), Stunt Park, Moon Run, Amsterdam, or Wellington. Direct links: `?level=forest`, `?level=city`, `?level=stunt`, `?level=moon`, `?level=amsterdam`, and `?level=wellington`. Each map resumes its own locally saved drive, or starts at the beginning on a first visit.

Collisions use a swept circular car collider against tree/rock circles and building/street-furniture rectangles. Impacts reflect velocity with 12% restitution, preserve tangential motion, and quickly damp lateral momentum. World edges also bounce the car. `collision.js` contains the reusable physics code.

## Amsterdam

Choose Amsterdam from Maps or the Level menu, or open `?level=amsterdam`.
The procedural district is a compressed, Amsterdam-inspired setting, not a
geographically exact reconstruction. Three nested, asymmetric canal rings form
tree-lined horseshoes around the old centre: Herengracht, Keizersgracht, and
Prinsengracht. Their western arms open onto the IJ and their eastern arms join
the curved Amstel. Radial streets connect the quays over bridges oriented to
their crossings, including the drivable Magere Brug. Narrow stepped- and
bell-gabled houses follow the curved banks.

Landmarks include Centraal, the Rijksmuseum, Westerkerk, Dam Square and the Royal
Palace, NEMO, and the De Gooyer windmill. A market, bikes, cafes, and houseboats
fill out the canal streets. Tablet mode uses reduced geometry, and reduced-motion
preferences keep decorative movement still.

The 1.81 km circuit follows the curved quays and connecting streets through a
district with individually detailed canal houses and 16 crossings. Brickwork,
four gable styles, sash windows, hoisting beams, shop awnings, houseboats,
three glass-roof tour boats, flower stalls, and a parked blue-and-cream tram
give the streets their own character.
Canal holes, bridge crests, car grounding and water safety use one shared layout;
pedestrians and loose toys recover to dry ground if knocked into a canal.

`amsterdam-geometry.js` supplies curve and polygon operations;
`amsterdam-layout.js` shares the canal paths, water boundaries, streets and
oriented bridges used by `amsterdam-course.js` to define the driving world.
`amsterdam-world.js` batches the neighborhoods and street details, while
`amsterdam-landmarks.js` builds the six architectural sites. The minimap shows
the water and connecting streets. `amsterdam-course.test.js` and
`amsterdam-world.test.js` cover route clearance, deck heights, water holes,
detail budgets, actor placement, reduced motion and owned-resource disposal.

## Pedestrians (ragdolls)

Walkers wander along the road edges in every level. Each is a procedural
instanced humanoid — randomized height, build, skin tone, hairdo, shirt
pattern/color, pants or shorts, shoes, and occasional cap or glasses — built
from capsule limbs, a rounded torso, and a detailed head. Shared instanced
meshes keep the crowd's draw-call count bounded. The first walkers spawn
alongside the road ahead of the starting car.

Pedestrians have 15 Cannon bodies joined by point-to-point constraints during
impacts. Walking uses an animated, connected pose without running a physics
solver for each walker. Behaviors:

- Walking and wandering; they pick fresh destinations.
- Panic sprint: a fast car nearby sends them running away, arms flailing, and
  they occasionally face-plant mid-sprint.
- Knocked down: hits launch the whole ragdoll up and sideways with extra
  spin; they tumble, bounce, and pile into each other.
- Pancake: the car driving over a fallen walker squashes them flat, then they
  rubber-spring back up when it passes.
- Get up: settled ragdolls blend back into a connected upright pose, then
  continue walking.
- Voice: with Voices enabled in the toolbar or drive menu they yell comedy lines on impact.

`people.js` contains the controller; run `node --test people.test.js` for
spawn/walk/hit/recover/reset regression checks, including finite mesh transforms,
complete visible bodies, and recovery of the struck pedestrian.

## Friend Racers

Vincent, Lea, Camilla, Maxey, and Loulou drive in every map. Vincent has a red
V6 sports car, Lea a yellow four-cylinder with a big rocket, Camilla a blue
electric car with hub motors, Maxey a pink V8 with a mega wing, and Loulou a
green lifted monster-wheel car. Each has a physical, two-sided taxi-style roof
sign with their name. Their parts use the same visuals and tuning as the garage.

Large rear-mounted flags identify Camilla (Portugal), Maxey (Canada), Vincent
(Belgium), Lea and Loulou (France), and Elio (New Zealand, on all three player cars).
The 70 cm-tall cloth sits on a rear-bumper bracket behind the spoiler, making it
easier to see from the chase camera without increasing the cloth mesh budget.
The cloth droops under gravity, catches a light breeze when parked, and streams
and flutters faster with actual driving speed, including boosts, slides and reverse.
Pinned fabric constraints keep it attached during turns. Pause freezes the cloth;
Reset and garage entry clear its momentum, and reduced-motion mode keeps it still.
`car-flag.js` owns the lightweight cloth physics; `country-flag-texture.js` draws
the local flag textures without network requests. Run
`node --test car-flag.test.js country-flag-texture.test.js` for flag checks.

Drive near a friend to start a friendly rolling race. Friends who spot each
other briefly gather, then compete at their fitted engine's full road speed.
They choose passing lanes and overtake Elio and each other rather than staying
in a fixed convoy. Rocket-equipped cars use visible boosters on clear straights,
with the same speed and duration multipliers as the garage, then cool down before
boosting again. Camilla's rocket-free electric build keeps its instant acceleration.
They brake ahead of tight bends, follow the hills, and jump the ramps. Races wind
down back to brisk cruising; there is no entry screen, penalty, or lost life.

Cars exchange momentum when bumped. Elio can shove a friend off track rather than
bounce off an immovable obstacle. Friends slide after an impact, lose their boost,
and steer back onto the road under their own power. Cars can bump each other too.
Small car-to-car bumps do not cancel Elio's rocket; solid scenery still does.
Matching colored dots show the racers on the map. Pause, menus, and garage visits
freeze the racers too; Reset places them ahead of Elio again.

`friend-racers.js` owns the road-following and race behavior;
`friend-racer-car.js` builds material-batched cars and their rooftop signs.
`racer-physics.js` advances Elio and the racers together with swept car contacts,
mass-weighted impulses, and the existing static-scenery collision response.
The cars use moving contact shadows rather than regenerating the sun shadow map.
Run `node --test friend-racers.test.js racer-physics.test.js` for speed, overtaking,
boost/cooldown, impact/recovery, terrain, geometry, and integration checks.

## Track and cone physics

Both loops now have asphalt and continuous red/white curb strips. Boost tops out
at 38 m/s on the track (normal cruising limit: 32), ramps at 8 m/s squared,
and ends when braking or hitting a solid obstacle. Off-road boost is capped at
20 m/s. Steering sensitivity and the boost camera effect are also reduced.

Twenty-eight traffic cones use Cannon ES rigid bodies with ground, obstacle,
and cone contacts. They tip, slide, and settle to sleep; the car is kinematic
in the cone simulation so cones cannot launch it backward. Three instanced
meshes render all cones. Reset restores them. Run npm test for tablet input,
soft collision response, and cone hit/sleep/reset regression checks.


## Stunt Park and Moon Run

Choose either new level from the Level menu, or open ?level=stunt or ?level=moon.
Both use a wider stadium loop with two broad uphill ramps, chevrons, and clear
landing areas. Drive straight up a ramp to jump; no extra button is needed.
Cannon handles ramp contact, takeoff, gravity, and low-rebound landing. Steering
in the air is reduced, the camera follows height, and the shadow stays below.
Reset clears the jump and restores the cones. Existing friend deliveries remain
available but cannot trigger while airborne.

Moon Run has a star sky, illustrated Earth, crater scenery, and a small lunar
base. Its gravity is tuned for approachable play (3.2 versus Stunt Park's 9.82),
not an exact lunar simulation. Cones use the same lower gravity and can collide
with ramps. Ramp tests cover takeoff, landing, lower-gravity air time, reset, and
missing a ramp. Browser checks also exercise the actual driving loop and capture
both grounded and airborne views, plus a phone layout.
