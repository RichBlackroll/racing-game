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
  {
    id: "golf",
    name: "Volkswagen Golf GTI Mk1",
    description: "1976 hot hatch",
    file: "golf-gti-mk1.glb",
    engine: "four",
  },
  {
    id: "byd-atto-1",
    name: "BYD Atto 1",
    description: "AU/NZ Premium electric hatch",
    authored: true,
    length: 3.99,
    engine: "electric",
  },
  {
    id: "volvo-ex40",
    name: "Volvo EX40",
    description: "Facelift electric SUV",
    authored: true,
    length: 4.44,
    engine: "electric",
  },
];

export function getVehicle(id) {
  return VEHICLES.find((vehicle) => vehicle.id === id) || VEHICLES[0];
}
