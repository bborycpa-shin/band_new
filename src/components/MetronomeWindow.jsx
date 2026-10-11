import React, { useEffect, useRef, useState } from "react";
import { Hand, Metronome, Minus, Play, Plus, Square, Volume2, X } from "lucide-react";
import { createMetronome } from "../lib/metronome";

const settingsKey = "band-metronome-settings";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey)) ?? {};
    return {
      bpm: Number.isFinite(saved.bpm) ? clamp(Math.round(saved.bpm), 30, 240) : 120,
      beats: Number.isFinite(saved.beats) ? clamp(Math.round(saved.beats), 1, 8) : 4,
      volume: Number.isFinite(saved.volume) ? clamp(saved.volume, 0, 1) : 0.7
    };
  } catch {
    return { bpm: 120, beats: 4, volume: 0.7 };
  }
}

export default function MetronomeWindow({ getAudioContext, isActive, onFocus, onClose }) {
  const [settings, setSettings] = useState(readSettings);
  const [bpmInput, setBpmInput] = useState(String(settings.bpm));
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [error, setError] = useState("");
  const [position, setPosition] = useState(() => ({
    left: Math.max(8, window.innerWidth - 316),
    top: Math.min(144, Math.max(8, window.innerHeight - 350))
  }));
  const windowRef = useRef(null);
  const engineRef = useRef(null);
  const mountedRef = useRef(true);
  const dragRef = useRef(null);
  const tapsRef = useRef([]);

  useEffect(() => {
    setBpmInput(String(settings.bpm));
  }, [settings.bpm]);

  useEffect(() => {
    engineRef.current?.setSettings(settings);
    try {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    } catch {
      // The metronome still works when browser storage is unavailable.
    }
  }, [settings]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      setPosition({
        left: clamp(drag.left + event.clientX - drag.x, 8, Math.max(8, window.innerWidth - drag.width - 8)),
        top: clamp(drag.top + event.clientY - drag.y, 8, Math.max(8, window.innerHeight - drag.height - 8))
      });
    };
    const endDrag = () => { dragRef.current = null; };
    const fitWindow = () => {
      const bounds = windowRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition((current) => ({
        left: clamp(current.left, 8, Math.max(8, window.innerWidth - bounds.width - 8)),
        top: clamp(current.top, 8, Math.max(8, window.innerHeight - bounds.height - 8))
      }));
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", fitWindow);
    fitWindow();
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      window.removeEventListener("resize", fitWindow);
    };
  }, []);

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    const bounds = windowRef.current.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      x: event.clientX, y: event.clientY,
      left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height
    };
  }

  function setBpm(value) {
    const next = clamp(Math.round(value), 30, 240);
    setSettings((current) => ({ ...current, bpm: next }));
    setBpmInput(String(next));
  }

  function commitBpm() {
    setBpm(bpmInput.trim() && Number.isFinite(Number(bpmInput)) ? Number(bpmInput) : settings.bpm);
  }

  function tapTempo() {
    const now = performance.now();
    const previous = tapsRef.current;
    const last = previous.at(-1);
    if (last !== undefined && now - last < 150) return;
    const taps = last === undefined || now - last > 2500 ? [now] : [...previous, now].slice(-5);
    tapsRef.current = taps;
    if (taps.length > 1) setBpm(60000 * (taps.length - 1) / (taps.at(-1) - taps[0]));
  }

  async function toggle() {
    if (isStarting) return;
    if (isRunning) {
      engineRef.current?.stop();
      setIsRunning(false);
      setActiveBeat(-1);
      return;
    }
    setIsStarting(true);
    setError("");
    try {
      const context = getAudioContext();
      if (!context) throw new Error("이 브라우저는 메트로놈 소리를 지원하지 않습니다.");
      await context.resume();
      if (!mountedRef.current) return;
      if (context.state !== "running") throw new Error("메트로놈 소리를 시작할 수 없습니다. 다시 눌러 주세요.");
      if (!engineRef.current) engineRef.current = createMetronome(context, setActiveBeat);
      engineRef.current.setSettings(settings);
      engineRef.current.start();
      setIsRunning(true);
    } catch (failure) {
      if (mountedRef.current) setError(failure.message);
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  }

  return (
    <aside
      ref={windowRef}
      className="metronome-window"
      style={{ ...position, zIndex: isActive ? 10 : 8 }}
      role="dialog"
      aria-label="메트로놈"
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="metronome-head" onPointerDown={startDrag}>
        <div className="metronome-title">
          <Metronome size={18} />
          <strong>메트로놈</strong>
          {isRunning && <span className="metronome-running" aria-label="메트로놈 작동 중" />}
        </div>
        <button type="button" className="metronome-close" title="메트로놈 닫기" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="metronome-controls">
        <div className="metronome-beats" aria-label="박자 표시" style={{ gridTemplateColumns: `repeat(${settings.beats}, minmax(0, 1fr))` }}>
          {Array.from({ length: settings.beats }, (_, beat) => (
            <span key={beat} className={`metronome-beat${beat === 0 ? " accent" : ""}${activeBeat === beat ? " active" : ""}`}>
              {beat + 1}
            </span>
          ))}
        </div>
        <div className="metronome-tempo">
          <button type="button" title="템포 1 낮추기" disabled={settings.bpm <= 30} onClick={() => setBpm(settings.bpm - 1)}><Minus size={18} /></button>
          <label className="metronome-bpm">
            <input
              type="number" inputMode="numeric" aria-label="BPM" min="30" max="240" step="1"
              value={bpmInput} onChange={(event) => setBpmInput(event.target.value)}
              onBlur={commitBpm} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
            <span>BPM</span>
          </label>
          <button type="button" title="템포 1 높이기" disabled={settings.bpm >= 240} onClick={() => setBpm(settings.bpm + 1)}><Plus size={18} /></button>
        </div>
        <input type="range" aria-label="템포" min="30" max="240" step="1" value={settings.bpm} onChange={(event) => setBpm(Number(event.target.value))} />
        <label className="metronome-meter">
          <span>박자</span>
          <select aria-label="마디당 박자 수" value={settings.beats} onChange={(event) => setSettings((current) => ({ ...current, beats: Number(event.target.value) }))}>
            {Array.from({ length: 8 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}박</option>)}
          </select>
        </label>
        <div className="metronome-volume">
          <Volume2 size={16} />
          <input type="range" aria-label="메트로놈 볼륨" min="0" max="1" step="0.01" value={settings.volume} onChange={(event) => setSettings((current) => ({ ...current, volume: Number(event.target.value) }))} />
          <span>{Math.round(settings.volume * 100)}%</span>
        </div>
        <div className="metronome-actions">
          <button type="button" className="metronome-tap" title="탭 템포" onClick={tapTempo}><Hand size={16} />탭</button>
          <button type="button" className={isRunning ? "metronome-toggle running" : "metronome-toggle"} title={isRunning ? "메트로놈 정지" : "메트로놈 시작"} onClick={toggle} disabled={isStarting}>
            {isRunning ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            {isStarting ? "시작 중" : isRunning ? "정지" : "시작"}
          </button>
        </div>
        {error && <p className="metronome-error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}
