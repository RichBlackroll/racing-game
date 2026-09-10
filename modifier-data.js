// Car configurator DATA model — pure module (no three.js, no DOM).
// The driving game multiplies these effects into its physics each frame;
// modifier-ui.js renders the panel and applies the same options visually.

// Physics multiplier fields the game loop understands. All start at 1.
export const TUNE_FIELDS = [
  "top",
  "offroadTop",
  "boostTop",
  "accel",
  "steer",
  "bounce",
  "boostTime",
];

export const PARTS = [
  {
    id: "color",
    name: "Paint",
    emoji: "🎨",
    options: [
      { id: "red", name: "Red", emoji: "🔴", hex: "#c60920", fact: "Red like a fire truck! Vroom vroom!" },
      { id: "orange", name: "Orange", emoji: "🟠", hex: "#e07712", fact: "Orange like a juicy orange! Sweet!" },
      { id: "yellow", name: "Yellow", emoji: "🟡", hex: "#e6c310", fact: "Yellow like the sun and school buses!" },
      { id: "green", name: "Green", emoji: "🟢", hex: "#3da83d", fact: "Green like a frog leaping through the forest!" },
      { id: "blue", name: "Blue", emoji: "🔵", hex: "#2a6fdb", fact: "Blue like the sky and the deep sea!" },
      { id: "purple", name: "Purple", emoji: "🟣", hex: "#8a3fd0", fact: "Purple like grapes! Fancy!" },
      { id: "pink", name: "Pink", emoji: "🩷", hex: "#e86ab5", fact: "Pink like a flamingo standing on one leg!" },
      { id: "white", name: "White", emoji: "⚪", hex: "#e9edf0", fact: "White like a fluffy cloud!" },
    ],
  },
  {
    id: "wheels",
    name: "Wheels",
    emoji: "🛞",
    options: [
      { id: "standard", name: "Standard", emoji: "🛞", fact: "Regular wheels — good for everything!", effects: {} },
      {
        id: "wide",
        name: "Wide wheels",
        emoji: "⭕",
        fact: "Wider tyres grab the road better — steering feels stronger!",
        effects: { steer: 1.3, top: 0.97 },
      },
      {
        id: "monster",
        name: "Monster wheels",
        emoji: "🦖",
        fact: "GIANT wheels crush bumps and grass — nothing stops a monster truck!",
        effects: { steer: 1.05, offroadTop: 1.4, bounce: 1.6, top: 0.95 },
      },
      {
        id: "hub",
        name: "Hub motors",
        emoji: "⚡",
        fact: "Each wheel gets its own little electric motor! Count them: 1, 2, 3, 4 motors!",
        effects: { accel: 1.25, steer: 1.1 },
      },
    ],
  },
  {
    id: "suspension",
    name: "Suspension",
    emoji: "🪀",
    options: [
      { id: "standard", name: "Standard", emoji: "🪀", fact: "Springs soften the bumps — bounce bounce!", effects: {} },
      {
        id: "sport",
        name: "Sport",
        emoji: "🏎️",
        fact: "Lower and stiffer — corners like a race car!",
        effects: { steer: 1.15, bounce: 0.4 },
      },
      {
        id: "lift",
        name: "Lift kit",
        emoji: "⛰️",
        fact: "Rides high over bumps, grass and rocks!",
        effects: { offroadTop: 1.25, bounce: 1.25 },
      },
    ],
  },
  {
    id: "engine",
    name: "Engine",
    emoji: "🔧",
    options: [
      { id: "four", name: "4-cylinder", emoji: "🔵", fact: "Count the cylinders: 1, 2, 3, 4!", effects: {} },
      {
        id: "six",
        name: "V6",
        emoji: "🔷",
        fact: "Six cylinders standing in a V shape. More power!",
        effects: { top: 1.12, accel: 1.2 },
      },
      {
        id: "eight",
        name: "V8",
        emoji: "🔥",
        fact: "Eight cylinders! Count them: 1-2-3-4-5-6-7-8! RACE CAR POWER!",
        effects: { top: 1.3, accel: 1.6 },
      },
      {
        id: "electric",
        name: "Electric motor",
        emoji: "🔋",
        fact: "Batteries give instant power — and it's quiet! Zzzap!",
        effects: { accel: 1.8, top: 1.05 },
      },
    ],
  },
  {
    id: "spoiler",
    name: "Spoiler",
    emoji: "🪽",
    options: [
      { id: "stock", name: "Small wing", emoji: "🐦", fact: "A little wing — nice for cruising!", effects: {} },
      {
        id: "big",
        name: "Big spoiler",
        emoji: "🦅",
        fact: "Downforce pushes the car onto the road, so corners are easier!",
        effects: { steer: 1.2, top: 0.98 },
      },
      {
        id: "mega",
        name: "Mega wing",
        emoji: "🦖",
        fact: "Look at that wing! Corners stick like glue!",
        effects: { steer: 1.45, top: 0.94 },
      },
    ],
  },
  {
    id: "rocket",
    name: "Rocket",
    emoji: "🚀",
    options: [
      { id: "none", name: "No rocket", emoji: "🚫", fact: "No rocket — safe and steady driving today!", effects: {} },
      { id: "small", name: "Small booster", emoji: "🚀", fact: "A little rocket for a quick boost! Whoosh!", effects: {} },
      {
        id: "big",
        name: "Big booster",
        emoji: "☄️",
        fact: "Bigger rocket = longer boost! Every push has an opposite push!",
        effects: { boostTime: 1.8, boostTop: 1.15 },
      },
    ],
  },
];

export const PRESETS = [
  {
    id: "race",
    name: "Race Car",
    emoji: "🏁",
    config: { engine: "eight", spoiler: "mega", suspension: "sport", wheels: "wide" },
  },
  {
    id: "monster",
    name: "Monster Truck",
    emoji: "🦖",
    config: { wheels: "monster", suspension: "lift", engine: "eight", spoiler: "big" },
  },
  {
    id: "ev",
    name: "Quiet Electric",
    emoji: "⚡",
    config: { engine: "electric", wheels: "hub", suspension: "standard" },
  },
];

export const DEFAULTS = {
  color: "red",
  wheels: "standard",
  suspension: "standard",
  engine: "four",
  spoiler: "stock",
  rocket: "small",
};

// Multiply every selected option's effects into a tuning map.
// Unknown part/option ids are ignored safely.
export function computeTuning(config = {}) {
  const tuning = Object.fromEntries(TUNE_FIELDS.map((f) => [f, 1]));
  for (const part of PARTS) {
    const option = part.options.find((o) => o.id === config[part.id]);
    if (!option || !option.effects) continue;
    for (const [field, value] of Object.entries(option.effects)) {
      if (field in tuning) tuning[field] *= value;
    }
  }
  return tuning;
}
