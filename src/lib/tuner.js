import { PitchDetector } from "pitchy";

export const tunerModes = [
  { id: "guitar", label: "기타", name: "기타 6현", strings: [["6", 40], ["5", 45], ["4", 50], ["3", 55], ["2", 59], ["1", 64]] },
  { id: "bass4", label: "베이스4", name: "베이스 4현", strings: [["4", 28], ["3", 33], ["2", 38], ["1", 43]] },
  { id: "bass5", label: "베이스5", name: "베이스 5현", strings: [["5", 23], ["4", 28], ["3", 33], ["2", 38], ["1", 43]] },
  { id: "chromatic", label: "전체음", name: "크로매틱", strings: [] }
];
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const tunerFrameSize = 8192;
const minimumInputRms = 0.0002;
const minimumPitchClarity = 0.7;

export function midiFrequency(midi, reference = 440) {
  return reference * 2 ** ((midi - 69) / 12);
}

export function midiNote(midi) {
  return { name: noteNames[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1 };
}

export function tuningReading(frequency, modeId = "guitar", stringId = "auto", reference = 440) {
  if (!Number.isFinite(frequency) || frequency <= 0) return null;
  const mode = tunerModes.find((item) => item.id === modeId) ?? tunerModes[0];
  const midi = Math.round(69 + 12 * Math.log2(frequency / reference));
  const detected = midiNote(midi);
  const candidates = mode.strings.map(([id, note]) => ({ id, midi: note, cents: 1200 * Math.log2(frequency / midiFrequency(note, reference)) }));
  const nearest = [...candidates].sort((a, b) => Math.abs(a.cents) - Math.abs(b.cents))[0];
  const target = stringId === "auto"
    ? nearest && Math.abs(nearest.cents) <= 200 ? nearest : null
    : candidates.find((item) => item.id === stringId);
  const cents = target ? target.cents : 1200 * Math.log2(frequency / midiFrequency(midi, reference));
  return { frequency, ...detected, target: target ? { ...target, ...midiNote(target.midi) } : null,
    cents, inTune: Math.abs(cents) <= 5, direction: Math.abs(cents) <= 5 ? "정확" : cents < 0 ? "낮음" : "높음" };
}

export function createTunerDetector(size = tunerFrameSize) {
  const detector = PitchDetector.forFloat32Array(size);
  detector.minVolumeAbsolute = minimumInputRms;
  detector.clarityThreshold = 0.9;
  return {
    detect(input, sampleRate) {
      let energy = 0;
      for (const value of input) energy += value * value;
      const rms = Math.sqrt(energy / input.length);
      const [frequency, clarity] = detector.findPitch(input, sampleRate);
      return { frequency: clarity >= minimumPitchClarity && frequency >= 25 && frequency <= 1400 ? frequency : null,
        clarity, hasInput: rms >= minimumInputRms,
        level: rms ? Math.min(1, Math.max(0, (20 * Math.log10(rms) + 80) / 68)) : 0 };
    }
  };
}

export function createPitchSmoother() {
  let samples = [];
  let lastGoodAt = -Infinity;
  let displayed = null;
  let displayedAt = -Infinity;
  const holdMs = 650;
  return {
    update(frequency, now, clarity = 1) {
      if (now - lastGoodAt > holdMs) samples = [];
      if (now - displayedAt > holdMs) displayed = null;
      if (!Number.isFinite(frequency) || frequency <= 0) {
        return displayed;
      }
      if (samples.length && Math.abs(1200 * Math.log2(frequency / samples.at(-1))) > 80) samples = [];
      samples = [...samples, frequency].slice(-3);
      lastGoodAt = now;
      // Quieter, less periodic plucks need repeated agreement, not a stricter volume gate.
      if (samples.length >= (clarity >= 0.85 ? 2 : 3)) {
        displayed = [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
        displayedAt = now;
      }
      return displayed;
    }
  };
}

export function tunerErrorMessage(error) {
  if (["NotAllowedError", "SecurityError"].includes(error?.name)) return "마이크 사용이 차단됐습니다. 브라우저의 마이크 권한을 허용해주세요.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "연결된 마이크를 찾을 수 없습니다.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "마이크를 사용할 수 없습니다. 다른 앱의 마이크 사용 상태를 확인해주세요.";
  return error?.message || "튜너를 시작할 수 없습니다. 다시 시도해주세요.";
}

export function createTunerInput({ onReading, onState, onError }, environment = {}) {
  const mediaDevices = environment.mediaDevices ?? globalThis.navigator?.mediaDevices;
  const createContext = environment.createContext ?? (() => new (window.AudioContext || window.webkitAudioContext)());
  const schedule = environment.schedule ?? ((callback) => requestAnimationFrame(callback));
  const cancel = environment.cancel ?? ((id) => cancelAnimationFrame(id));
  let state = "idle";
  let sequence = 0;
  let disposed = false;
  let resources;
  let frameId;

  function release(session) {
    if (!session) return;
    session.stream.getTracks().forEach((track) => {
      track.removeEventListener("ended", session.onEnded);
      track.stop();
    });
    for (const node of [session.source, session.filter, session.lowpass, session.analyser]) {
      try { node?.disconnect(); } catch { /* The input may already be disconnected. */ }
    }
    if (session.context?.state !== "closed") session.context?.close().catch(() => {});
  }

  function setState(next) { state = next; if (!disposed) onState(next); }

  function stop() {
    sequence++;
    cancel(frameId);
    release(resources);
    resources = undefined;
    setState("idle");
    if (!disposed) onReading({ frequency: null, level: 0 });
  }

  return {
    async start() {
      if (disposed || state !== "idle") return false;
      const request = ++sequence;
      let session;
      setState("starting");
      try {
        if (globalThis.isSecureContext === false) throw new Error("마이크는 HTTPS 또는 이 PC의 localhost 주소에서 사용할 수 있습니다.");
        if (!mediaDevices?.getUserMedia) throw new Error("이 브라우저에서는 마이크를 사용할 수 없습니다.");
        const stream = await mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        session = { stream };
        if (disposed || sequence !== request) { release(session); return false; }
        resources = session;
        session.context = createContext();
        await session.context.resume();
        if (disposed || sequence !== request) { release(session); return false; }
        if (session.context.state !== "running") throw new Error("마이크 분석을 시작할 수 없습니다. 다시 눌러주세요.");
        session.source = session.context.createMediaStreamSource(stream);
        session.filter = session.context.createBiquadFilter();
        session.filter.type = "highpass";
        session.filter.frequency.value = 20;
        session.lowpass = session.context.createBiquadFilter();
        session.lowpass.type = "lowpass";
        session.lowpass.frequency.value = 1000;
        session.lowpass.Q.value = Math.SQRT1_2;
        session.analyser = session.context.createAnalyser();
        session.analyser.fftSize = tunerFrameSize;
        session.analyser.smoothingTimeConstant = 0;
        session.source.connect(session.filter);
        session.filter.connect(session.lowpass);
        session.lowpass.connect(session.analyser);
        const input = new Float32Array(tunerFrameSize);
        const detector = createTunerDetector();
        const smoother = createPitchSmoother();
        let lastFrameAt = -Infinity;
        session.onEnded = () => {
          if (sequence !== request || disposed) return;
          stop(); onError("마이크 연결이 종료됐습니다. 다시 시작해주세요.");
        };
        stream.getTracks().forEach((track) => track.addEventListener("ended", session.onEnded));
        setState("listening");
        const read = (now) => {
          if (sequence !== request || disposed) return;
          try {
            if (now - lastFrameAt >= 60) {
              lastFrameAt = now;
              session.analyser.getFloatTimeDomainData(input);
              const detected = detector.detect(input, session.context.sampleRate);
              onReading({ ...detected, frequency: smoother.update(detected.frequency, now, detected.clarity) });
            }
            frameId = schedule(read);
          } catch (error) { stop(); onError(tunerErrorMessage(error)); }
        };
        frameId = schedule(read);
        return true;
      } catch (error) {
        if (sequence === request && !disposed) {
          stop(); onError(tunerErrorMessage(error));
        } else release(session);
        return false;
      }
    },
    stop,
    dispose() { disposed = true; stop(); }
  };
}
