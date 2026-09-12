const handling = { top: 1, accel: 1, steer: 1, reverse: 9, radius: 1.12, mass: 1.6,
  height: 1.6, wheelbase: 2.9, track: 1.7, halfExtents: [1.05, .55, 2.2] };
const camera = { distance: 9, height: 3.6, targetHeight: 1.3, anchor: 1.7, lookAhead: 6, side: 0,
  overhead: 25, eye: [.35, 1.45, .1], mirror: [0, 1.7, -2.5] };

export const VEHICLES = [
  {
    id: "porsche",
    name: "Porsche 911 GT3 RS",
    description: "Original sports car",
    file: "porsche-gt3-rs.glb",
    engine: "four",
    action: { id: "sprint", label: "Sprint", description: "A short sports-car surge with golden trails.", duration: 3, cooldown: 8 },
  },
  {
    id: "tesla",
    name: "Tesla Model 3",
    description: "Electric adventure",
    file: "tesla-model-3.glb",
    engine: "electric",
    action: { id: "pulse", label: "Light pulse", description: "Send a glowing electric wave across the ground.", duration: 2, cooldown: 6 },
  },
  {
    id: "golf",
    name: "Volkswagen Golf GTI Mk1",
    description: "1976 hot hatch",
    file: "golf-gti-mk1.glb",
    engine: "four",
    action: { id: "hop", label: "Hop", description: "Give the little GTI a playful suspension bounce.", duration: 1.2, cooldown: 4 },
  },
  {
    id: "byd-atto-1",
    name: "BYD Atto 1",
    description: "AU/NZ Premium electric hatch",
    authored: true,
    length: 3.99,
    engine: "electric",
    action: { id: "bubbles", label: "Bubbles", description: "Blow a trail of floating bubbles.", duration: 4, cooldown: 6 },
  },
  {
    id: "volvo-ex40",
    name: "Volvo EX40",
    description: "Facelift electric SUV",
    authored: true,
    length: 4.44,
    engine: "electric",
    action: { id: "beacon", label: "Beacon", description: "Switch on a sweeping amber adventure beacon.", duration: 4, cooldown: 6 },
  },
  {
    id: "backhoe", name: "Giant Backhoe Digger", description: "Big wheels, two scoops, real digging action",
    file: "backhoe-loader.glb", utility: true, length: 8.8, engine: "four", color: "yellow",
    handling: { top: .52, accel: .55, steer: .72, reverse: 5, radius: 1.8, mass: 5,
      height: 3.15, wheelbase: 3.1, track: 2.5, halfExtents: [1.7, 1.45, 2.7] },
    camera: { distance: 16, height: 7.2, targetHeight: 2.1, anchor: 3.2, lookAhead: -7, side: 4,
      overhead: 32, eye: [.4, 2.65, 0], mirror: [0, 3.4, -6.5] },
    action: { id: "dig", label: "Dig", description: "Park off-road on soil. Lower the scoop, lift dirt and tip it out.", duration: 4.5, cooldown: 2, parked: true },
  },
  {
    id: "dhl-van", name: "DHL Delivery Van", description: "Yellow parcel van with opening rear doors",
    file: "dhl-delivery-van.glb", utility: true, length: 5.8, engine: "four", color: "yellow",
    handling: { top: .78, accel: .75, steer: .86, reverse: 7, radius: 1.65, mass: 2.5,
      height: 2.85, wheelbase: 3.55, track: 2.65, halfExtents: [1.6, 1.35, 2.85] },
    camera: { distance: 12, height: 5.2, targetHeight: 1.8, anchor: 2.8, lookAhead: -5.5, side: 3,
      overhead: 28, eye: [.5, 2.15, 1.35], mirror: [0, 3, -3.2] },
    action: { id: "delivery", label: "Deliver", description: "Park, open the rear doors and deliver a parcel.", duration: 3, cooldown: 2, parked: true },
  },
].map(vehicle => ({ handling, camera, ...vehicle }));

export function getVehicle(id) {
  return VEHICLES.find((vehicle) => vehicle.id === id) || VEHICLES[0];
}
