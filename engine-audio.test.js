import test from "node:test";
import assert from "node:assert/strict";
import { createEngineAudio } from "./engine-audio.js";

class FakeParam {
  constructor(context, value) {
    this.context = context;
    this.initial = value;
    this.events = [];
    this.cancellations = [];
  }
  get value() { return this.at(this.context.currentTime); }
  set value(value) { this.initial = value; }
  schedule(event) {
    assert.ok(Number.isFinite(event.value));
    assert.ok(Number.isFinite(event.time) && event.time >= 0);
    const index = this.events.findIndex(({ type, time }) => type === event.type && time === event.time);
    if (index < 0) this.events.push(event);
    else this.events[index] = event;
    this.events.sort((a, b) => a.time - b.time);
  }
  setValueAtTime(value, time) { this.schedule({ type: "set", value, time }); }
  linearRampToValueAtTime(value, time) { this.schedule({ type: "ramp", value, time }); }
  setTargetAtTime(value, time, constant) { this.schedule({ type: "target", value, time, constant }); }
  cancelScheduledValues(time) {
    this.cancellations.push(time);
    this.events = this.events.filter((event) => event.time < time);
  }
  at(time) {
    let value = this.initial, previousTime = 0, target;
    for (const event of this.events) {
      if (event.type === "ramp") {
        if (time < event.time) {
          return value + (event.value - value) * (time - previousTime) / (event.time - previousTime);
        }
      } else if (time < event.time) break;
      if (target) value = target.value + (value - target.value) * Math.exp(-(event.time - previousTime) / target.constant);
      target = event.type === "target" ? event : undefined;
      if (!target) value = event.value;
      previousTime = event.time;
    }
    return target ? target.value + (value - target.value) * Math.exp(-(time - previousTime) / target.constant) : value;
  }
}

function harness({ initialState = "suspended", resume, construct, createGain, legacy = false } = {}) {
  const contexts = [];
  class FakeAudioContext {
    constructor() {
      construct?.();
      this.state = initialState;
      this.currentTime = 0;
      this.nodes = [];
      this.listeners = [];
      this.resumeCalls = 0;
      this.destination = { kind: "destination" };
      contexts.push(this);
    }
    node(kind) {
      const node = { kind, connections: [], connect(destination) { this.connections.push(destination); } };
      this.nodes.push(node);
      return node;
    }
    createOscillator() {
      const node = this.node("oscillator");
      node.frequency = new FakeParam(this, 440);
      node.starts = 0;
      node.start = () => {
        assert.equal(this.nodes.at(-1).gain.value, 0, "graph is muted before oscillators start");
        node.starts++;
      };
      return node;
    }
    createGain() {
      createGain?.();
      const node = this.node("gain");
      node.gain = new FakeParam(this, 1);
      return node;
    }
    createBiquadFilter() {
      const node = this.node("filter");
      node.frequency = new FakeParam(this, 350);
      node.Q = new FakeParam(this, 1);
      return node;
    }
    addEventListener(type, listener) {
      assert.equal(type, "statechange");
      this.listeners.push(listener);
    }
    changeState(state) {
      this.state = state;
      this.listeners.forEach((listener) => listener());
    }
    resume() {
      this.resumeCalls++;
      if (resume) return resume(this);
      this.changeState("running");
      return Promise.resolve();
    }
    close() {
      this.changeState("closed");
      return Promise.resolve();
    }
  }
  const audio = createEngineAudio({ [legacy ? "webkitAudioContext" : "AudioContext"]: FakeAudioContext });
  return {
    audio, contexts,
    get context() { return contexts.at(-1); },
    get primary() { return this.context.nodes[0]; },
    get overtone() { return this.context.nodes[1]; },
    get blend() { return this.context.nodes[2]; },
    get filter() { return this.context.nodes[3]; },
    get output() { return this.context.nodes[4]; },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("construction, updates and muting are lazy; unlock resumes synchronously but stays silent", async () => {
  const h = harness();
  assert.deepEqual(h.audio.state(), {
    enabled: true, contextState: "uninitialized", unlocked: false, previewPending: false, previewing: false,
  });
  h.audio.updateDriving({ speed: 40, throttle: 1 });
  h.audio.silence();
  h.audio.setEnabled(false);
  h.audio.setEnabled(true);
  assert.equal(h.contexts.length, 0);
  const ready = h.audio.unlock();
  assert.equal(h.contexts.length, 1);
  assert.equal(h.context.resumeCalls, 1, "resume is called before unlock yields");
  assert.equal(h.output.gain.value, 0);
  assert.equal(await ready, true);
  assert.equal(h.audio.state().unlocked, true);
  assert.equal(h.output.gain.at(30), 0, "unlock never schedules output");
  assert.equal(await h.audio.unlock(), true);
  assert.equal(h.context.resumeCalls, 1);
  assert.equal(h.context.nodes.length, 5);
  assert.deepEqual(h.primary.connections, [h.filter]);
  assert.deepEqual(h.overtone.connections, [h.blend]);
  assert.deepEqual(h.blend.connections, [h.filter]);
  assert.deepEqual(h.filter.connections, [h.output]);
  assert.deepEqual(h.output.connections, [h.context.destination]);
  assert.equal(h.filter.type, "lowpass");
  assert.equal(h.filter.Q.value, 0.7);
  assert.equal(h.primary.starts, 1);
  assert.equal(h.overtone.starts, 1);
});

test("missing Web Audio, constructor and graph failures are safe and retryable", async () => {
  for (const win of [{}, null]) {
    const audio = createEngineAudio(win);
    assert.equal(await audio.unlock(), false);
    assert.equal(await audio.preview("six"), false);
    assert.equal(audio.state().previewPending, false);
    audio.silence();
  }
  let attempts = 0;
  const h = harness({ construct() { if (++attempts === 1) throw new Error("unavailable"); } });
  assert.equal(await h.audio.unlock(), false);
  assert.equal(await h.audio.unlock(), true);
  assert.equal(h.contexts.length, 1);
  let gains = 0;
  const broken = harness({ createGain() { if (++gains === 1) throw new Error("allocation"); } });
  assert.equal(await broken.audio.unlock(), false);
  assert.equal(broken.context.state, "closed");
  assert.equal(await broken.audio.unlock(), true);
  assert.equal(broken.contexts.length, 2);
  assert.equal(broken.output.gain.value, 0);
  assert.equal(await harness({ legacy: true }).audio.unlock(), true);
});

test("resume rejection and synchronous throws retry on the same silent graph", async () => {
  for (const synchronous of [false, true]) {
    const h = harness({ resume(context) {
      if (context.resumeCalls === 1) {
        if (synchronous) throw new Error("blocked");
        return Promise.reject(new Error("blocked"));
      }
      context.changeState("running");
      return Promise.resolve();
    } });
    assert.equal(await h.audio.preview("four"), false);
    assert.equal(h.audio.state().previewPending, false);
    h.audio.updateDriving({ throttle: 1 });
    assert.equal(h.output.gain.at(10), 0);
    assert.equal(await h.audio.unlock(), true);
    assert.equal(h.context.resumeCalls, 2);
    assert.equal(h.contexts.length, 1);
    assert.equal(h.output.gain.at(10), 0);
  }
  const suspended = harness({ resume: () => Promise.resolve() });
  assert.equal(await suspended.audio.unlock(), false, "resolved resume alone does not authorize playback");
});

test("a muted audition unlocks directly and ends on the audio clock without timers or updates", async () => {
  const h = harness();
  h.audio.setEnabled(false);
  const preview = h.audio.preview("six");
  assert.equal(h.context.resumeCalls, 1);
  assert.equal(h.audio.state().previewPending, true);
  assert.equal(h.output.gain.value, 0);
  assert.equal(await preview, true);
  assert.equal(h.audio.state().enabled, false);
  assert.equal(h.audio.state().previewing, true);
  assert.equal(h.primary.type, "triangle");
  assert.equal(h.overtone.type, "sawtooth");
  assert.equal(h.blend.gain.value, 0.32);
  assert.equal(h.primary.frequency.at(0), 64);
  assert.equal(h.primary.frequency.at(0.85), 284);
  assert.equal(h.overtone.frequency.at(0.85), 852);
  assert.ok(Math.abs(h.filter.frequency.at(0.85) - 3300) < 1e-9);
  assert.equal(h.primary.frequency.at(1.8), 64);
  assert.equal(h.output.gain.at(0), 0);
  assert.equal(h.output.gain.at(0.08), 0.14);
  assert.ok(h.output.gain.at(0.04) > 0 && h.output.gain.at(0.04) < 0.14);
  assert.ok(h.output.gain.at(1.9) > 0);
  assert.equal(h.output.gain.at(2), 0);
  assert.equal(h.output.gain.at(200), 0);
  h.context.currentTime = 2;
  assert.equal(h.audio.state().previewing, false);
  h.audio.updateDriving({ throttle: 1 });
  assert.equal(h.output.gain.at(3), 0);
});

test("repeated previews reuse the graph, replace envelopes and ignore driving updates", async () => {
  const h = harness();
  assert.equal(await h.audio.preview("four"), true);
  const first = structuredClone(h.output.gain.events);
  h.audio.updateDriving({ engineId: "electric", speed: 50, throttle: 1, boosting: true });
  assert.equal(h.primary.type, "sawtooth");
  assert.deepEqual(h.output.gain.events, first);
  h.context.currentTime = 0.5;
  assert.equal(await h.audio.preview("eight"), true);
  assert.equal(h.contexts.length, 1);
  assert.equal(h.context.nodes.length, 5);
  assert.equal(h.primary.starts, 1);
  assert.equal(h.overtone.starts, 1);
  assert.equal(h.overtone.type, "square");
  assert.equal(h.primary.frequency.at(0.5), 34);
  assert.equal(h.primary.frequency.at(1.35), 159);
  assert.equal(h.output.gain.at(0.5), 0);
  assert.ok(h.output.gain.at(2) > 0, "old preview end does not cut off the new preview");
  assert.equal(h.output.gain.at(2.5), 0);
  assert.deepEqual(h.output.gain.events.filter((event) => event.time >= 0.5).map((event) => event.time), [0.5, 0.58, 1.35, 2.15, 2.5]);
  h.context.currentTime = 2.5;
  h.audio.updateDriving({ engineId: "electric", speed: 20 });
  assert.equal(h.primary.type, "sine");
  assert.ok(h.output.gain.at(3) > 0, "fresh driving updates can resume after the audition");
});

test("silence and disabling cancel all future automation and mute immediately", async () => {
  for (const cancel of ["silence", "disable"]) {
    const h = harness();
    await h.audio.preview("eight");
    h.context.currentTime = 0.4;
    assert.ok(h.output.gain.value > 0);
    if (cancel === "silence") h.audio.silence();
    else h.audio.setEnabled(false);
    assert.equal(h.output.gain.value, 0);
    assert.equal(h.output.gain.at(20), 0);
    for (const param of [h.primary.frequency, h.overtone.frequency, h.filter.frequency, h.output.gain]) {
      assert.equal(param.cancellations.at(-1), 0.4);
      assert.ok(param.events.every((event) => event.time <= 0.4));
    }
    assert.equal(h.audio.state().previewing, false);
    assert.equal(h.audio.state().previewPending, false);
    h.audio.setEnabled(true);
    await h.audio.unlock();
    assert.equal(h.output.gain.at(20), 0, "enabling and unlocking do not restart sound");
    assert.equal(await h.audio.preview("electric"), true);
    h.audio.setEnabled(false);
    assert.equal(h.output.gain.value, 0);
    assert.equal(await h.audio.preview("four"), true, "explicit audition overrides driving preference");
    h.audio.setEnabled(false);
    assert.equal(h.output.gain.value, 0, "false still cancels an audition when already disabled");
  }
});

test("pending resumes cannot revive canceled previews or start driving automatically", async () => {
  for (const cancel of ["silence", "disable"]) {
    const pending = deferred();
    const h = harness({ resume: () => pending.promise });
    const preview = h.audio.preview("six");
    const unlock = h.audio.unlock();
    assert.equal(h.context.resumeCalls, 1, "concurrent unlock shares the in-flight resume");
    h.audio.updateDriving({ throttle: 1 });
    if (cancel === "silence") h.audio.silence();
    else h.audio.setEnabled(false);
    h.audio.setEnabled(true);
    h.context.changeState("running");
    pending.resolve();
    assert.equal(await preview, false);
    assert.equal(await unlock, true);
    assert.equal(h.output.gain.at(20), 0);
    assert.equal(h.audio.state().previewPending, false);
    assert.equal(h.audio.state().previewing, false);
    h.audio.updateDriving({ throttle: 1 });
    assert.ok(h.output.gain.at(1) > 0, "only a fresh update starts driving");
  }
});

test("latest pending audition wins, even when another unlock has already resumed", async () => {
  const pending = deferred();
  const h = harness({ resume: () => pending.promise });
  const first = h.audio.preview("four");
  const latest = h.audio.preview("electric");
  assert.equal(h.context.resumeCalls, 1);
  h.context.changeState("running");
  h.audio.updateDriving({ engineId: "eight", throttle: 1 });
  assert.equal(h.output.gain.value, 0);
  pending.resolve();
  assert.equal(await first, false);
  assert.equal(await latest, true);
  assert.equal(h.primary.type, "sine");
  assert.equal(h.primary.frequency.at(0.85), 800);
  assert.equal(h.audio.state().previewing, true);
  const canceled = h.audio.preview("six");
  h.audio.silence();
  assert.equal(await canceled, false, "running-context await is also cancellable");
  assert.equal(h.output.gain.at(20), 0);
});

test("interruption or shutdown cancels auditions and cannot cause late playback", async () => {
  for (const state of ["suspended", "interrupted", "closed"]) {
    const h = harness();
    await h.audio.preview("four");
    h.context.currentTime = 0.3;
    h.context.changeState(state);
    assert.equal(h.output.gain.value, 0);
    assert.equal(h.output.gain.at(20), 0);
    assert.equal(h.audio.state().unlocked, false);
    assert.equal(h.audio.state().previewing, false);
    assert.equal(h.audio.state().contextState, state);
    h.audio.updateDriving({ throttle: 1 });
    assert.equal(await h.audio.unlock(), state !== "closed");
    assert.equal(h.output.gain.at(20), 0);
    assert.equal(await h.audio.preview("six"), state !== "closed");

    const pending = deferred();
    const waiting = harness({ resume: () => pending.promise });
    const preview = waiting.audio.preview("eight");
    waiting.context.changeState(state);
    if (state !== "closed") waiting.context.changeState("running");
    pending.resolve();
    assert.equal(await preview, false);
    assert.equal(waiting.output.gain.at(20), 0);
    assert.equal(waiting.audio.state().previewPending, false);
  }
});

test("resume clears stale driving output even before statechange is delivered", async () => {
  const h = harness();
  await h.audio.unlock();
  h.audio.updateDriving({ throttle: 1 });
  h.context.currentTime = 1;
  assert.ok(h.output.gain.value > 0);
  h.context.state = "interrupted";
  assert.equal(await h.audio.unlock(), true);
  assert.equal(h.output.gain.at(20), 0);
  h.context.state = "interrupted";
  assert.equal(await h.audio.preview("eight"), true);
  h.audio.silence();
  const preview = h.audio.preview("six");
  h.context.state = "suspended";
  assert.equal(await preview, false, "state is rechecked after awaiting unlock");
  h.context.changeState("running");
  assert.equal(h.output.gain.at(20), 0);
});

test("driving changes real pitch, harmonics, filter and load for all four profiles", async () => {
  const h = harness();
  await h.audio.unlock();
  const signatures = [], pitches = [];
  for (const engineId of ["four", "six", "eight", "electric"]) {
    h.audio.updateDriving({ engineId });
    h.context.currentTime += 1;
    const idle = h.primary.frequency.value, quiet = h.output.gain.value, dark = h.filter.frequency.value;
    signatures.push([h.primary.type, h.overtone.type, Math.round(idle), h.blend.gain.value].join(","));
    h.audio.updateDriving({ engineId, throttle: 1 });
    h.context.currentTime += 1;
    const loaded = h.primary.frequency.value;
    assert.ok(loaded > idle);
    assert.ok(h.output.gain.value > quiet);
    assert.ok(h.filter.frequency.value > dark);
    h.audio.updateDriving({ engineId, speed: 40, throttle: 1 });
    h.context.currentTime += 1;
    const fast = h.primary.frequency.value, loud = h.output.gain.value;
    assert.ok(fast > loaded);
    h.audio.updateDriving({ engineId, speed: 40, throttle: 1, boosting: true });
    h.context.currentTime += 1;
    assert.ok(h.primary.frequency.value > fast);
    pitches.push(h.primary.frequency.value);
    assert.ok(h.output.gain.value > loud);
    assert.ok(h.overtone.frequency.value > h.primary.frequency.value);
    assert.ok(h.output.gain.value < 0.2);
    assert.equal(h.primary.frequency.events.at(-1).type, "target");
  }
  assert.equal(new Set(signatures).size, 4);
  const [four, six, eight, electric] = pitches;
  assert.ok(eight < four && four < six && six < electric);
  assert.equal(h.contexts.length, 1);
});

test("driving inputs are bounded, reverse uses magnitude, and unknown profiles fall back", async () => {
  const h = harness({ initialState: "running" });
  await h.audio.unlock();
  assert.equal(h.context.resumeCalls, 0);
  h.audio.updateDriving({ engineId: "toString", speed: Infinity, throttle: NaN });
  assert.equal(h.primary.type, "sawtooth");
  assert.equal(h.primary.frequency.events.at(-1).value, 48);
  for (const [speed, throttle] of [[55, 1], [-55, -1], [1e9, 1e9]]) {
    h.audio.updateDriving({ engineId: "__proto__", speed, throttle });
    assert.equal(h.primary.frequency.events.at(-1).value, 228);
    assert.equal(h.output.gain.events.at(-1).value, 0.12);
  }
  h.context.currentTime = 1;
  assert.ok(h.output.gain.value > 0);
  h.audio.setEnabled(false);
  h.audio.updateDriving({ speed: 40, throttle: 1 });
  assert.equal(h.output.gain.value, 0);
  assert.equal(h.output.gain.at(20), 0);
  h.audio.setEnabled(true);
  assert.equal(h.output.gain.at(20), 0);
  h.audio.updateDriving();
  assert.ok(h.output.gain.at(20) > 0);
});
