const profiles = {
  four: { wave: "sawtooth", overtone: "triangle", idle: 48, range: 180, ratio: 2, mix: 0.28, cutoff: 1100, level: 0.12 },
  six: { wave: "triangle", overtone: "sawtooth", idle: 64, range: 220, ratio: 3, mix: 0.32, cutoff: 1500, level: 0.14 },
  eight: { wave: "sawtooth", overtone: "square", idle: 34, range: 125, ratio: 1.5, mix: 0.38, cutoff: 800, level: 0.11 },
  electric: { wave: "sine", overtone: "triangle", idle: 150, range: 650, ratio: 2.01, mix: 0.12, cutoff: 3000, level: 0.10 },
};

// Construct without touching Web Audio; call unlock/preview directly from a user gesture.
export function createEngineAudio(win = window) {
  let context, primary, overtone, blend, filter, output, resuming;
  let enabled = true, unlocked = false, generation = 0, previewPending = false, previewUntil = 0;

  function silence() {
    generation++;
    previewPending = false;
    previewUntil = 0;
    if (!context) return;
    const now = context.currentTime;
    for (const param of [primary.frequency, overtone.frequency, filter.frequency, output.gain]) {
      param.cancelScheduledValues(now);
    }
    output.gain.setValueAtTime(0, now);
  }

  async function unlock() {
    try {
      if (!context) {
        const AudioContext = win?.AudioContext ?? win?.webkitAudioContext;
        if (!AudioContext) return false;
        const next = new AudioContext();
        try {
          primary = next.createOscillator();
          overtone = next.createOscillator();
          blend = next.createGain();
          filter = next.createBiquadFilter();
          output = next.createGain();
          output.gain.value = 0;
          filter.type = "lowpass";
          filter.Q.value = 0.7;
          primary.connect(filter);
          overtone.connect(blend);
          blend.connect(filter);
          filter.connect(output);
          output.connect(next.destination);
          primary.start();
          overtone.start();
        } catch (error) {
          void next.close().catch(() => {});
          throw error;
        }
        context = next;
        context.addEventListener("statechange", () => {
          if (context.state !== "running") {
            unlocked = false;
            silence();
          }
        });
      }
      if (context.state === "closed") return false;
      if (context.state !== "running") {
        // Also clear stale sound if the browser's statechange event has not fired yet.
        if (unlocked) silence();
        unlocked = false;
        if (!resuming) {
          resuming = Promise.resolve(context.resume())
            .then(() => context.state === "running", () => false)
            .finally(() => { resuming = undefined; });
        }
        if (!await resuming) return false;
      }
      unlocked = context.state === "running";
      return unlocked;
    } catch {
      return false;
    }
  }

  function voice(engineId) {
    const profile = Object.hasOwn(profiles, engineId) ? profiles[engineId] : profiles.four;
    primary.type = profile.wave;
    overtone.type = profile.overtone;
    blend.gain.setValueAtTime(profile.mix, context.currentTime);
    return profile;
  }

  async function preview(engineId) {
    silence();
    // Invoke resume before yielding, while still in the calling user gesture.
    const ready = unlock();
    const request = generation;
    previewPending = true;
    if (!await ready || request !== generation || context.state !== "running") {
      if (request === generation) previewPending = false;
      return false;
    }
    previewPending = false;
    const profile = voice(engineId), now = context.currentTime;
    for (const [param, idle, peak] of [
      [primary.frequency, profile.idle, profile.idle + profile.range],
      [overtone.frequency, profile.idle * profile.ratio, (profile.idle + profile.range) * profile.ratio],
      [filter.frequency, profile.cutoff * 0.65, profile.cutoff * 2.2],
    ]) {
      param.setValueAtTime(idle, now);
      param.linearRampToValueAtTime(peak, now + 0.85);
      param.linearRampToValueAtTime(idle, now + 1.8);
    }
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(profile.level, now + 0.08);
    output.gain.linearRampToValueAtTime(profile.level * 1.2, now + 0.85);
    output.gain.linearRampToValueAtTime(profile.level * 0.65, now + 1.65);
    output.gain.linearRampToValueAtTime(0, now + 2);
    previewUntil = now + 2;
    return true;
  }

  // Speed is signed world units/second; throttle is -1..1. Invalid numbers become zero.
  function updateDriving({ engineId = "four", speed = 0, throttle = 0, boosting = false } = {}) {
    if (!enabled || !unlocked || context?.state !== "running" || previewPending || context.currentTime < previewUntil) return;
    const pace = Number.isFinite(speed) ? Math.min(1, Math.abs(speed) / 55) : 0;
    const load = Number.isFinite(throttle) ? Math.min(1, Math.abs(throttle)) : 0;
    const boost = boosting ? 1 : 0;
    const profile = voice(engineId), now = context.currentTime;
    const pitch = profile.idle + profile.range * (pace * 0.75 + load * 0.25 + boost * 0.18);
    const level = profile.level * (0.3 + pace * 0.2 + load * 0.5 + boost * 0.2);
    for (const [param, value] of [
      [primary.frequency, pitch],
      [overtone.frequency, pitch * profile.ratio],
      [filter.frequency, profile.cutoff * (0.65 + pace * 0.8 + load * 0.65 + boost * 0.2)],
      [output.gain, level],
    ]) {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, 0.06);
    }
  }

  return {
    unlock,
    setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) silence();
    },
    preview,
    updateDriving,
    silence,
    state() {
      return {
        enabled,
        contextState: context?.state ?? "uninitialized",
        unlocked: unlocked && context?.state === "running",
        previewPending,
        previewing: context?.state === "running" && context.currentTime < previewUntil,
      };
    },
  };
}
