export const VEHICLES = [
  {
    id: "porsche",
    name: "Porsche 911 GT3 RS",
    description: "Original sports car",
    file: "porsche-gt3-rs.glb",
    engine: "four",
  },
  {
    id: "tesla",
    name: "Tesla Model 3",
    description: "Electric adventure",
    file: "tesla-model-3.glb",
    engine: "electric",
  },
];

export function getVehicle(id) {
  return VEHICLES.find((vehicle) => vehicle.id === id) || VEHICLES[0];
}
