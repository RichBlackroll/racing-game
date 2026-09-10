# WILDRUN — Porsche forest drive

Elios racing game.

## iPad and touch screens

Both portrait and landscape layouts have separate steering, accelerator/brake,
handbrake, and boost controls. Hold steering and a pedal together; lifted or
cancelled touches release independently. Safe-area padding keeps controls away
from the home indicator. Pause/Resume is available in the top toolbar; switching
apps automatically pauses the drive and clears held controls.

iPad (including Safari's desktop identity) automatically uses the same baked
renderer as desktop. Tablet rendering caps the drawing buffer at
1.2 million pixels, targets at most 60 updates per second, and adjusts resolution
after sustained slow frames. Normal and roughness ground downloads are skipped.
The iPad profile uses a smaller baked shadow atlas and disables multisample AA.

Run `node --test tablet.test.js` for device detection, rendering-budget, and
multi-touch interruption checks. Browser emulation does not establish real iPad
GPU performance; validate on the target iPad before claiming a frame-rate target.

Serve this folder with `python3 -m http.server 8765`, then open http://localhost:8765.

- WASD or arrow keys: accelerate, brake/reverse, steer.
- Space: handbrake.
- Shift or the BOOST button: five-second rocket boost, followed by a gradual return to normal speed.
- C: chase, overhead, or hood camera.
- R: reset the car and boost.

Rendering uses one-time procedural lighting: a procedural ground-shadow atlas,
baked static vertex lighting, spatially culled forest batches, indexed car
geometry, HDR car reflections, and a soft contact shadow. It never creates a path
tracer and does not render live shadow maps, so the frame rate stays smooth.

The speed boost is arcade behavior, not a simulation of Porsche specifications.

Porsche model: Ddiaz Design, CC BY-NC-SA 4.0, noncommercial use. See CREDITS.md for attribution and details. All asset files are local; no runtime CDN is required.

## Car configurator

Tap the 🛠 CAR button to open the configurator. While it is open the driving
physics pause and the car spins slowly like a turntable next to a close
camera, so every change is easy to see. Tabs change paint colour, wheels,
suspension, engine, spoiler, and rocket booster. One-tap presets build a
Race Car, a Monster Truck, or a Quiet Electric. Every option shows a short
educational fact (count the cylinders, name the colour, every push has an
opposite push) and can be read aloud with the 🔊 button.

Modifications change real performance: wide wheels and bigger spoilers
steer harder, monster wheels and lift kits cruise faster off-road, bigger
engines raise cruise speed and acceleration, electric hub motors accelerate
instantly, and a bigger rocket boosts longer and faster. Removing the
rocket disables BOOST until one is fitted again.

`modifier-data.js` is a pure module describing parts, facts, and physics
multipliers; `modifier-ui.js` builds the panel and applies the 3D visuals.
Run `node --test modifier.test.js` for the tuning-model checks.

## Rebuild

Run `npm install` and `npm run build` in this folder. The editable application is `game-source.js`.

## Levels and collisions

Use the Level menu to choose Pine Valley (forest), Downtown (city), Stunt Park, or Moon Run. Direct links: `?level=forest` and `?level=city`. The drive resets when the level changes.

Collisions use a swept circular car collider against tree/rock circles and building/street-furniture rectangles. Impacts reflect velocity with 12% restitution, preserve tangential motion, and quickly damp lateral momentum. World edges also bounce the car. `collision.js` contains the reusable physics code.

## Pedestrians (ragdolls)

Walkers wander along the road edges in every level. Each is a procedural
instanced humanoid — randomized height, build, skin tone, hairdo, shirt
pattern/color, pants or shorts, shoes, and occasional cap or glasses — built
from capsule limbs, a rounded torso, and a detailed head. Fifteen instanced
draw calls render any crowd size.

Pedestrians are Cannon-body ragdolls (no hard joints): soft positional springs
and orientation springs hold ~11 body parts together, so everything bends,
twists, and flails believably. While walking, the hips are puppeted kinematically
and the gait drives the limbs. Behaviors:

- Walking and wandering; they glance and pick fresh destinations.
- Panic sprint: a fast car nearby sends them running away, arms flailing, and
  they occasionally face-plant mid-sprint.
- Knocked down: hits launch the whole ragdoll up and sideways with extra
  spin; they tumble, bounce, and pile into each other.
- Pancake: the car driving over a fallen walker squashes them flat, then they
  rubber-spring back up when it passes.
- Get up: fallen walkers roll to a push-up pose, rise to their knees, then
  stand and continue walking.
- Voice: with friend-voice enabled they yell comedy lines on impact.

`people.js` contains the controller; run `node --test people.test.js` for
spawn/walk/hit/recover/reset regression checks.

## Friend Picnic Adventure

Vincent, Lea, Camilla, Maxey, and Loulou each have a delivery: one ball,
two stars, three cubes, four rings, and five gems. Follow the matching map marker,
drive through each collectible, then meet the named friend. The car stops while
Elios taps each object into the friend's basket. Each tap counts once, with
spoken counting when sound is enabled. The last object completes the delivery
automatically; there is no separate number question. There are no mission timers or lost lives.
The sound button enables spoken English clues when browser speech is available.
Progress saves locally, independently of level; Reset moves the car without
losing the delivery. After all five stamps, the picnic celebration opens and
Play Again becomes available. No likenesses of the real children are used.

Adventure code and responsive UI live in friends.js and friends.css. Scene
objects reuse five low-poly geometries and one label canvas. Tablet rendering
budgets are retained.
Desktop and emulated tablet/phone browser renders and the full delivery sequence
were checked; frame rate still needs validation on the actual iPad.

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
