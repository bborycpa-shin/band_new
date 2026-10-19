import React, { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, Minus, Plus, Square, X } from "lucide-react";
import { createTunerInput, midiNote, tunerModes, tuningReading } from "../lib/tuner";

const settingsKey = "band-tuner-settings";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey)) ?? {};
    return { mode: tunerModes.some((mode) => mode.id === saved.mode) ? saved.mode : "guitar",
      reference: Number.isFinite(saved.reference) ? clamp(Math.round(saved.reference), 430, 450) : 440 };
  } catch { return { mode: "guitar", reference: 440 }; }
}

export default function TunerWindow({ isActive, onFocus, onClose }) {
  const [settings, setSettings] = useState(readSettings);
  const [referenceInput, setReferenceInput] = useState(String(settings.reference));
  const [stringId, setStringId] = useState("auto");
  const [state, setState] = useState("idle");
  const [signal, setSignal] = useState({ frequency: null, level: 0 });
  const [error, setError] = useState("");
  const [position, setPosition] = useState(() => ({ left: Math.max(8, window.innerWidth - 336),
    top: Math.min(150, Math.max(8, window.innerHeight - 420)) }));
  const windowRef = useRef(null);
  const engineRef = useRef(null);
  const dragRef = useRef(null);
  const mode = tunerModes.find((item) => item.id === settings.mode);
  const reading = tuningReading(signal.frequency, mode.id, stringId, settings.reference);
  const markerPosition = reading ? 50 + clamp(reading.cents, -50, 50) : 50;
  const status = state === "starting" ? "마이크 권한 확인 중" : state !== "listening" ? "마이크 꺼짐"
    : reading ? reading.direction : signal.hasInput ? "음정 분석 중" : "소리를 기다리는 중";

  useEffect(() => {
    engineRef.current = createTunerInput({ onReading: setSignal, onState: setState, onError: setError });
    const handleVisibility = () => { if (document.hidden) engineRef.current?.stop(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { /* Tuning also works without saved preferences. */ }
    setReferenceInput(String(settings.reference));
  }, [settings]);

  useEffect(() => {
    const fitWindow = () => {
      const bounds = windowRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition((current) => ({ left: clamp(current.left, 8, Math.max(8, window.innerWidth - bounds.width - 8)),
        top: clamp(current.top, 8, Math.max(8, window.innerHeight - bounds.height - 8)) }));
    };
    const move = (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      setPosition({ left: clamp(drag.left + event.clientX - drag.x, 8, Math.max(8, window.innerWidth - drag.width - 8)),
        top: clamp(drag.top + event.clientY - drag.y, 8, Math.max(8, window.innerHeight - drag.height - 8)) });
    };
    const stopDrag = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
    window.addEventListener("resize", fitWindow);
    const observer = new ResizeObserver(fitWindow);
    observer.observe(windowRef.current);
    fitWindow();
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stopDrag);
      window.removeEventListener("pointercancel", stopDrag);
      window.removeEventListener("resize", fitWindow);
      observer.disconnect();
    };
  }, []);

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const bounds = windowRef.current.getBoundingClientRect();
    dragRef.current = { x: event.clientX, y: event.clientY, left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  }

  function changeReference(value) {
    const next = Number(value);
    const reference = Number.isFinite(next) && value !== "" ? clamp(Math.round(next), 430, 450) : settings.reference;
    setSettings((current) => ({ ...current, reference }));
    setReferenceInput(String(reference));
  }

  function toggle() {
    setError("");
    if (state !== "idle") engineRef.current?.stop();
    else engineRef.current?.start();
  }

  return (
    <aside ref={windowRef} className="tuner-window" style={{ ...position, zIndex: isActive ? 10 : 8 }}
      role="dialog" aria-label="튜너" onPointerDownCapture={onFocus} onFocusCapture={onFocus}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") onClose(); }}>
      <div className="tuner-head" onPointerDown={startDrag}>
        <div className="tuner-title"><AudioLines size={18} /><strong>튜너</strong>
          {state === "listening" && <span className="tuner-live" aria-label="마이크 사용 중" />}
        </div>
        <button type="button" className="tuner-close" title="튜너 닫기" onClick={onClose}><X size={20} /></button>
      </div>
      <div className="tuner-controls">
        <div className="tuner-modes" role="radiogroup" aria-label="튜너 악기">
          {tunerModes.map((item) => <button key={item.id} type="button" role="radio" aria-label={item.name}
            aria-checked={mode.id === item.id} onClick={() => { setSettings((current) => ({ ...current, mode: item.id })); setStringId("auto"); }}>
            {item.label}
          </button>)}
        </div>
        <div className="tuner-strings" style={{ gridTemplateColumns: `repeat(${mode.strings.length + 1}, minmax(0, 1fr))` }} aria-label="튜닝할 줄">
          <button type="button" aria-pressed={stringId === "auto"} onClick={() => setStringId("auto")}>자동</button>
          {mode.strings.map(([id, midi]) => {
            const note = midiNote(midi);
            return <button type="button" key={id} title={`${id}번 줄 ${note.name}${note.octave}`}
              aria-pressed={stringId === id} className={stringId === "auto" && reading?.target?.id === id ? "detected" : ""}
              onClick={() => setStringId(id)}><small>{id}번</small><span>{note.name}<sub>{note.octave}</sub></span></button>;
          })}
        </div>
        <div className={`tuner-readout${reading?.inTune ? " in-tune" : ""}`}>
          <output className="tuner-note" aria-label="감지 음정">{reading?.name || "--"}<small>{reading?.octave ?? ""}</small></output>
          <span className="tuner-frequency">{reading ? `${reading.frequency.toFixed(1)} Hz` : "-- Hz"}</span>
          <span className="tuner-target">{reading?.target ? `목표 ${reading.target.id}번 줄 ${reading.target.name}${reading.target.octave}` : mode.name}</span>
        </div>
        <div className={`tuner-meter${reading?.inTune ? " in-tune" : ""}`} role="meter" aria-label="음정 오차"
          aria-valuemin={-50} aria-valuemax={50} aria-valuenow={reading ? Math.round(clamp(reading.cents, -50, 50)) : 0}
          aria-valuetext={reading ? `${Math.round(reading.cents)}센트, ${reading.direction}` : status}>
          <div className="tuner-meter-scale">
            <span className="tuner-center-zone" />
            {Array.from({ length: 21 }, (_, index) => <i key={index} className={index % 5 === 0 ? "major" : ""} />)}
            <span className={reading ? "tuner-needle" : "tuner-needle hidden"} style={{ left: `${markerPosition}%` }} />
          </div>
          <div className="tuner-meter-labels"><span>-50</span><span>-25</span><span>0</span><span>+25</span><span>+50</span></div>
        </div>
        <div className="tuner-pitch-status">
          <span role="status" className={reading?.inTune ? "in-tune" : ""}>{status}</span>
          <span className="tuner-cents">{reading ? `${Math.round(reading.cents) > 0 ? "+" : ""}${Math.round(reading.cents)} c` : "-- c"}</span>
        </div>
        <div className="tuner-reference"><span>A4</span>
          <button type="button" title="기준음 1Hz 낮추기" disabled={settings.reference <= 430} onClick={() => changeReference(settings.reference - 1)}><Minus size={14} /></button>
          <input type="number" inputMode="numeric" aria-label="기준음 A4" min="430" max="450" step="1" value={referenceInput}
            onChange={(event) => setReferenceInput(event.target.value)} onBlur={() => changeReference(referenceInput)}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span>Hz</span>
          <button type="button" title="기준음 1Hz 높이기" disabled={settings.reference >= 450} onClick={() => changeReference(settings.reference + 1)}><Plus size={14} /></button>
        </div>
        <div className="tuner-input-level"><Mic size={14} /><meter min="0" max="1" value={signal.level} aria-label="마이크 입력 크기" /></div>
        <button type="button" className={state === "idle" ? "tuner-toggle" : "tuner-toggle listening"} onClick={toggle}>
          {state === "idle" ? <Mic size={17} /> : <Square size={16} fill="currentColor" />}
          {state === "idle" ? "튜너 시작" : state === "starting" ? "시작 취소" : "마이크 끄기"}
        </button>
        {error && <p className="tuner-error" role="alert">{error}</p>}
      </div>
    </aside>
  );
}
