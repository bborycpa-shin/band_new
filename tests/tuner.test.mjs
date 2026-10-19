import assert from "node:assert/strict";
import test from "node:test";
import { createPitchSmoother, createTunerDetector, createTunerInput, midiFrequency, midiNote, tunerFrameSize, tunerModes, tuningReading } from "../src/lib/tuner.js";

function signal(frequency, sampleRate, noise = 0) {
  let seed = 123456;
  return Float32Array.from({ length: tunerFrameSize }, (_, index) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const phase = 2 * Math.PI * frequency * index / sampleRate;
    return 0.12 * Math.sin(phase) + 0.09 * Math.sin(phase * 2) + 0.04 * Math.sin(phase * 3) + noise * (seed / 2 ** 32 - 0.5);
  });
}

function assertPitch(actual, expected) {
  assert(actual > 0 && Math.abs(1200 * Math.log2(actual / expected)) < 0.01, `${actual}Hz does not match ${expected}Hz`);
}

test("all guitar and 4/5-string bass open strings are detected at common sample rates", () => {
  for (const sampleRate of [44100, 48000]) {
    const detector = createTunerDetector();
    for (const mode of tunerModes.slice(0, 3)) {
      for (const [id, midi] of mode.strings) {
        const expected = midiFrequency(midi);
        const detected = detector.detect(signal(expected, sampleRate, 0.01), sampleRate);
        assert(detected.frequency, `${mode.id} ${id} was not detected`);
        assert(Math.abs(1200 * Math.log2(detected.frequency / expected)) < 1, `${mode.id} ${id} pitch error`);
        assert.equal(tuningReading(detected.frequency, mode.id).target.id, id);
      }
    }
  }
});

test("quiet low strings remain measurable below the previous microphone volume gate", () => {
  const detector = createTunerDetector();
  for (const sampleRate of [44100, 48000, 96000]) {
    for (const midi of [23, 28, 40, 45]) {
      const frequency = midiFrequency(midi);
      const input = signal(frequency, sampleRate, 0.01).map(value => value * 0.005);
      const reading = detector.detect(input, sampleRate);
      assert(reading.hasInput);
      assert(reading.level > 0);
      assert(reading.frequency, `Quiet MIDI ${midi} at ${sampleRate}Hz was rejected`);
      assert(Math.abs(1200 * Math.log2(reading.frequency / frequency)) < 2);
    }
  }
});

test("decaying guitar low strings tolerate microphone noise without losing pitch", () => {
  const detector = createTunerDetector();
  for (const frequency of [midiFrequency(40), midiFrequency(45)]) {
    let seed = 12345;
    const input = signal(frequency, 48000).map((value, index) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return value * 0.1 * Math.exp(-index / 48000 / 0.07) + 0.01 * (seed / 2 ** 32 - 0.5);
    });
    const reading = detector.detect(input, 48000);
    assert(reading.clarity < 0.9, "This is a regression fixture rejected by the old confidence gate");
    assert(reading.frequency, `Decaying ${frequency}Hz was rejected`);
    assert(Math.abs(1200 * Math.log2(reading.frequency / frequency)) < 15);
  }
});

test("silence, quiet inputs, unpitched noise and out-of-range tones do not produce notes", () => {
  const detector = createTunerDetector();
  assert.equal(detector.detect(new Float32Array(tunerFrameSize), 48000).frequency, null);
  assert.equal(detector.detect(signal(110, 48000).map((value) => value * 0.001), 48000).frequency, null);
  const noise = signal(0, 48000, 0.2);
  assert.equal(detector.detect(noise, 48000).frequency, null);
  assert.equal(detector.detect(signal(18, 48000), 48000).frequency, null);
  assert.equal(detector.detect(signal(1900, 48000), 48000).frequency, null);
});

test("sharp, flat and in-tune readings use cents, with configurable concert pitch", () => {
  const e = midiFrequency(40);
  assert.equal(tuningReading(e, "guitar").direction, "정확");
  const sharp = tuningReading(e * 2 ** (17 / 1200), "guitar");
  const flat = tuningReading(e * 2 ** (-12 / 1200), "guitar");
  assert.equal(sharp.direction, "높음"); assert(Math.abs(sharp.cents - 17) < 0.001);
  assert.equal(flat.direction, "낮음"); assert(Math.abs(flat.cents + 12) < 0.001);
  assert.equal(tuningReading(442, "chromatic", "auto", 442).inTune, true);
  assert.equal(tuningReading(440, "chromatic", "auto", 442).direction, "낮음");
});

test("manual string choice stays targeted, while chromatic mode covers nonstandard tuning", () => {
  const manual = tuningReading(110, "guitar", "6");
  assert.equal(manual.target.id, "6");
  assert.equal(manual.name, "A");
  assert(Math.abs(manual.cents - 500) < 0.001);
  const chromatic = tuningReading(midiFrequency(49), "chromatic");
  assert.equal(chromatic.name, "C#"); assert.equal(chromatic.octave, 3); assert.equal(chromatic.target, null);
  assert.deepEqual(midiNote(23), { name: "B", octave: 0 });
  assert.equal(tuningReading(0), null); assert.equal(tuningReading(NaN), null);
});

test("display smoothing rejects a single unstable note and clears stale input", () => {
  const smoother = createPitchSmoother();
  assert.equal(smoother.update(110, 0), null);
  assertPitch(smoother.update(110, 60), 110);
  assertPitch(smoother.update(110.2, 120), 110);
  assertPitch(smoother.update(220, 180), 110);
  assertPitch(smoother.update(220, 240), 110);
  assertPitch(smoother.update(220, 300), 220);
  assertPitch(smoother.update(null, 360), 220);
  assert.equal(smoother.update(null, 960), null);
});

test("needle jitter is reduced while quiet low strings keep their readings", () => {
  const jitter = [-24, 22, -18, 27, 4, -21, 16, -25, 24, -8, 20, -23];
  for (const midi of [23, 28, 40, 45, 64]) {
    for (const clarity of [0.75, 0.97]) {
      const smoother = createPitchSmoother();
      const base = midiFrequency(midi);
      for (let index = 0; index < 6; index++) smoother.update(base, index * 60, clarity);
      const offsets = Array.from({ length: 48 }, (_, index) => {
        const input = base * 2 ** (jitter[index % jitter.length] / 1200);
        const frequency = smoother.update(input, (index + 6) * 60, clarity);
        assert(frequency, `MIDI ${midi} lost its reading`);
        return 1200 * Math.log2(frequency / base);
      });
      assert(Math.max(...offsets) - Math.min(...offsets) < 12, `MIDI ${midi}: excessive needle movement`);
    }
  }
});

test("real tuning adjustments settle promptly without jumping at isolated spikes", () => {
  for (const midi of [28, 40, 45]) {
    for (const clarity of [0.75, 0.97]) {
      const smoother = createPitchSmoother();
      const base = midiFrequency(midi);
      for (let index = 0; index < 6; index++) smoother.update(base, index * 60, clarity);
      const spike = smoother.update(base * 2 ** (45 / 1200), 360, clarity);
      assert(Math.abs(1200 * Math.log2(spike / base)) < 1);
      let frequency;
      for (let index = 0; index < 16; index++) frequency = smoother.update(base * 2 ** (20 / 1200), 420 + index * 60, clarity);
      assert(Math.abs(1200 * Math.log2(frequency / base) - 20) < 2, "Adjustment should settle within a second");
      const next = base * 2 ** (500 / 1200);
      smoother.update(next, 1440, clarity);
      smoother.update(next, 1500, clarity);
      assert(Math.abs(1200 * Math.log2(smoother.update(next, 1560, clarity) / next)) < 1, "A new string switches promptly");
    }
  }
});

test("lower-confidence pitches require repeated agreement and unstable noise cannot renew a stale note", () => {
  const smoother = createPitchSmoother();
  assert.equal(smoother.update(82.4, 0, 0.75), null);
  assert.equal(smoother.update(82.5, 60, 0.75), null);
  assertPitch(smoother.update(82.3, 120, 0.75), 82.4);
  assertPitch(smoother.update(null, 400), 82.4);
  for (let index = 0; index < 6; index++) smoother.update(index % 2 ? 150 : 220, 460 + index * 60, 0.75);
  assert.equal(smoother.update(300, 820, 0.75), null);
  assert.equal(smoother.update(110, 2000), null, "A long gap starts a new candidate");
});

function inputFixture({ pending = false, denied = false, brokenContext = false } = {}) {
  const states = [], readings = [], errors = [], requests = [];
  const frames = new Map(); const tracks = []; const contexts = [];
  let resolvePermission;
  const createStream = () => {
    const listeners = new Map();
    const track = { stopped: false, stop() { this.stopped = true; }, addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type) { listeners.delete(type); }, end() { listeners.get("ended")?.(); } };
    tracks.push(track);
    return { getTracks: () => [track] };
  };
  const environment = {
    mediaDevices: { getUserMedia(options) {
      requests.push(options);
      if (denied) return Promise.reject(Object.assign(new Error("Denied"), { name: "NotAllowedError" }));
      if (pending) return new Promise((resolve) => { resolvePermission = () => resolve(createStream()); });
      return Promise.resolve(createStream());
    } },
    createContext() {
      if (brokenContext) throw new Error("Context failure");
      const node = () => ({ connections: [], disconnected: false, connect(next) { this.connections.push(next); }, disconnect() { this.disconnected = true; } });
      const context = { state: "suspended", sampleRate: 48000, destination: {}, nodes: [],
        async resume() { this.state = "running"; }, async close() { this.state = "closed"; },
        createMediaStreamSource() { const n = node(); this.nodes.push(n); return n; },
        createBiquadFilter() { const n = { ...node(), frequency: { value: 0 }, Q: { value: 0 } }; this.nodes.push(n); return n; },
        createAnalyser() { const n = { ...node(), getFloatTimeDomainData(input) { input.set(signal(41.2034446, 48000)); } }; this.nodes.push(n); return n; }
      };
      contexts.push(context); return context;
    },
    schedule(callback) { const id = crypto.randomUUID(); frames.set(id, callback); return id; },
    cancel(id) { frames.delete(id); }
  };
  const engine = createTunerInput({ onState: (state) => states.push(state), onReading: (reading) => readings.push(reading), onError: (error) => errors.push(error) }, environment);
  return { engine, states, readings, errors, requests, frames, tracks, contexts,
    resolvePermission: () => resolvePermission(),
    frame(now) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(now); } };
}

test("microphone analysis produces bass pitch without routing the mic to speakers", async () => {
  const f = inputFixture();
  assert.equal(await f.engine.start(), true);
  assert.equal(await f.engine.start(), false);
  f.frame(0); f.frame(65);
  assert(Math.abs(f.readings.at(-1).frequency - 41.2034446) < 0.01);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].audio.echoCancellation, false);
  assert(f.contexts[0].nodes.every((node) => !node.connections.includes(f.contexts[0].destination)));
  f.engine.stop();
  assert(f.tracks.every((track) => track.stopped)); assert.equal(f.frames.size, 0);
  assert.equal(f.contexts[0].state, "closed"); assert.equal(f.states.at(-1), "idle");
});

test("closing while permission is pending releases a late stream and never starts analysis", async () => {
  const f = inputFixture({ pending: true });
  const start = f.engine.start();
  assert.equal(await f.engine.start(), false);
  f.engine.dispose(); f.resolvePermission();
  assert.equal(await start, false);
  assert(f.tracks.every((track) => track.stopped)); assert.equal(f.contexts.length, 0);
  assert.equal(f.frames.size, 0); assert.deepEqual(f.errors, []);
});

test("start cancellation, device removal and audio failures release microphone resources", async () => {
  const pending = inputFixture({ pending: true });
  const start = pending.engine.start(); pending.engine.stop(); pending.resolvePermission(); await start;
  assert(pending.tracks.every((track) => track.stopped));
  const removed = inputFixture(); await removed.engine.start(); removed.tracks[0].end();
  assert(removed.tracks[0].stopped); assert.equal(removed.frames.size, 0); assert.match(removed.errors[0], /연결이 종료/);
  const broken = inputFixture({ brokenContext: true });
  assert.equal(await broken.engine.start(), false); assert(broken.tracks[0].stopped); assert.equal(broken.states.at(-1), "idle");
});

test("permission denial is recoverable and cannot leave the microphone running", async () => {
  const f = inputFixture({ denied: true });
  assert.equal(await f.engine.start(), false);
  assert.equal(f.states.at(-1), "idle"); assert.match(f.errors[0], /권한/);
  assert.equal(f.contexts.length, 0); assert.equal(f.tracks.length, 0);
});
