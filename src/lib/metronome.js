export function createMetronome(context, onBeat) {
  const output = context.createGain();
  output.connect(context.destination);
  const voices = new Set();
  let settings = { bpm: 120, beats: 4, volume: 0.7 };
  let running = false;
  let timerId;
  let frameId;
  let nextTime = 0;
  let nextBeat = 0;
  let pendingBeats = [];

  function scheduleClick(time, beat) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(beat === 0 ? 1600 : 1000, time);
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(beat === 0 ? 0.5 : 0.35, time + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    oscillator.connect(envelope);
    envelope.connect(output);
    voices.add(oscillator);
    oscillator.onended = () => {
      voices.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start(time);
    oscillator.stop(time + 0.05);
    pendingBeats.push({ time, beat });
  }

  function schedule() {
    if (!running || context.state !== "running") return;
    const now = context.currentTime;
    // Use the audio clock ahead of time, and skip missed beats after a stalled tab.
    if (nextTime < now) nextTime = now + 0.025;
    while (nextTime < now + 0.12) {
      scheduleClick(nextTime, nextBeat);
      nextTime += 60 / settings.bpm;
      nextBeat = (nextBeat + 1) % settings.beats;
    }
  }

  function updateIndicator() {
    if (!running) return;
    let beat;
    while (pendingBeats.length && pendingBeats[0].time <= context.currentTime) {
      beat = pendingBeats.shift().beat;
    }
    if (beat !== undefined) onBeat(beat);
    frameId = requestAnimationFrame(updateIndicator);
  }

  function stop() {
    running = false;
    clearInterval(timerId);
    cancelAnimationFrame(frameId);
    pendingBeats = [];
    for (const oscillator of voices) {
      oscillator.stop(context.currentTime);
    }
  }

  function start() {
    if (running) return;
    running = true;
    nextTime = context.currentTime + 0.035;
    nextBeat = 0;
    schedule();
    timerId = setInterval(schedule, 25);
    frameId = requestAnimationFrame(updateIndicator);
  }

  return {
    start,
    stop,
    setSettings(nextSettings) {
      const restart = running && (nextSettings.bpm !== settings.bpm || nextSettings.beats !== settings.beats);
      if (restart) stop();
      settings = { ...nextSettings };
      output.gain.setTargetAtTime(settings.volume, context.currentTime, 0.01);
      if (restart) start();
    },
    dispose() {
      stop();
      output.disconnect();
    }
  };
}
