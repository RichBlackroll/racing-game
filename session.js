import { DEFAULTS, PARTS } from "./modifier-data.js";
import { getVehicle } from "./vehicle-data.js";

const key = "wildrun-session-v1";
const levels = ["forest", "city", "stunt", "moon", "amsterdam", "wellington"];
const sessions = new WeakMap();

export function resolveLevel(search, savedLevel) {
  const requested = new URLSearchParams(search).get("level");
  return levels.includes(requested) ? requested : levels.includes(savedLevel) ? savedLevel : "forest";
}

function normalize(saved) {
  const vehicle = getVehicle(saved?.vehicle);
  const config = { ...DEFAULTS, engine: vehicle.engine }, drives = {};
  for (const part of PARTS) {
    if (part.options.some((option) => option.id === saved?.config?.[part.id])) config[part.id] = saved.config[part.id];
  }
  for (const level of levels) {
    const drive = saved?.drives?.[level];
    if (drive && [drive.x, drive.z, drive.heading].every(Number.isFinite) &&
        Math.abs(drive.x) <= 2000 && Math.abs(drive.z) <= 2000 &&
        Number.isInteger(drive.checkpoint) && drive.checkpoint >= 0 && drive.checkpoint < 8 &&
        Number.isSafeInteger(drive.lap) && drive.lap >= 1) {
      drives[level] = {
        x: drive.x, z: drive.z, heading: drive.heading % (Math.PI * 2), checkpoint: drive.checkpoint, lap: drive.lap,
        lapSeconds: Number.isFinite(drive.lapSeconds) && drive.lapSeconds >= 0 ? drive.lapSeconds : 0,
        bestLap: Number.isFinite(drive.bestLap) && drive.bestLap >= 0 ? drive.bestLap : 0,
        ...(Number.isSafeInteger(drive.courseLength) && drive.courseLength > 0 ? { courseLength: drive.courseLength } : {}),
      };
    }
  }
  return {
    level: resolveLevel("", saved?.level), vehicle: vehicle.id, config, drives,
    camera: [0, 1, 2].includes(saved?.camera) ? saved.camera : 0,
    voice: saved?.voice === true,
    sound: saved?.sound !== false,
    selectedPart: PARTS.some((part) => part.id === saved?.selectedPart) ? saved.selectedPart : "color",
  };
}

// One in-memory session per page also works when browser storage is blocked.
export function createSession(win = window) {
  if (sessions.has(win)) return sessions.get(win);
  let storage, saved, persistent = false;
  try { storage = win.localStorage; persistent = !!storage; } catch { /* Private browsing can deny access. */ }
  try { saved = JSON.parse(storage?.getItem(key) ?? "null"); } catch { /* Ignore corrupt saves. */ }
  let value = normalize(saved);
  const session = {
    get value() { return normalize(value); },
    get persistent() { return persistent; },
    refresh() {
      if (!persistent) return false;
      try {
        const next = normalize(JSON.parse(storage.getItem(key)));
        const changed = JSON.stringify(next) !== JSON.stringify(value);
        value = next;
        return changed;
      } catch { return false; }
    },
    update(patch) {
      value = normalize({ ...value, ...patch });
      try {
        if (!storage) return false;
        storage.setItem(key, JSON.stringify(value));
        persistent = true;
      } catch { persistent = false; }
      return persistent;
    },
  };
  sessions.set(win, session);
  return session;
}
