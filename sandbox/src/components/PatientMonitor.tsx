import { useEffect, useMemo, useState } from "react"

interface VitalsData {
  hr?: number; bp_sys?: number; bp_dia?: number
  rr?: number; spo2?: number; temp?: number; pain?: number
}

interface PatientMonitorProps {
  vitals: VitalsData
  hasPulse?: boolean
  patientName?: string
  alarms?: string[]
}

// ── Inject keyframes once ──
const SFX = "__pm_sfx"
if (typeof document !== "undefined" && !document.getElementById(SFX)) {
  const s = document.createElement("style")
  s.id = SFX
  s.textContent = `@keyframes scr{from{transform:translateX(0)}to{transform:translateX(-50%)}}`
  document.head.appendChild(s)
}

// ── Waveform segments (one cycle, duplicated for seamless scroll) ──
const ECG = "M0,24 L4,24 L6,22 L8,24 L12,24 L14,24 L16,23 L18,24 L24,24 L26,4 L28,-2 L30,4 L32,24 L36,24 L38,22 L40,24 L44,24 L46,25 L48,24 L52,24 L54,23 L56,24 L60,24"
const PLETH = "M0,24 L4,24 L6,22 L8,24 L12,24 L14,20 L16,16 L18,12 L20,8 L22,6 L24,4 L26,4 L28,6 L30,8 L32,12 L34,16 L36,20 L38,23 L40,24 L44,24 L46,22 L48,24 L52,24 L54,23 L56,24 L60,24"
const RESP = "M0,14 L5,10 L10,4 L15,0 L20,2 L25,6 L30,10 L35,14 L40,18 L45,22 L50,24 L55,22 L60,18"

function MonoSpan({ val, unit, color, digits = 3 }: { val?: number; unit: string; color: string; digits?: number }) {
  return (
    <span style={{ fontVariantNumeric: "tabular-nums" }}>
      <span style={{ color, fontWeight: 700, fontSize: "inherit" }}>{val != null ? String(val).padStart(digits, " ") : "—".padStart(digits, " ")}</span>
      <span style={{ color: "#3a5a7a", fontSize: "0.55em", marginLeft: 2 }}>{unit}</span>
    </span>
  )
}

function WaveBox({ path, speed, color, height }: { path: string; speed: number; color: string; height: number }) {
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
      <svg viewBox="0 0 120 30" aria-hidden="true" style={{
        width: "200%", height, display: "block",
        animation: `scr ${speed}s linear infinite`,
      }}>
        <g stroke={color} strokeWidth={1.2} fill="none"><path d={`${path} ${path}`} /></g>
      </svg>
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 24, background: "linear-gradient(to right, transparent, #080c14)" }} />
    </div>
  )
}

function ParamBox({ label, value, alarm, children }: { label: string; value: React.ReactNode; alarm?: boolean; children?: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 0, background: "#0a0f18", borderRadius: 4, padding: "4px 8px 2px",
      border: `1px solid ${alarm ? "#e74c3c44" : "#14202e"}`, transition: "border-color 0.3s",
    }}>
      <div style={{ fontSize: 9, color: "#3a5a7a", letterSpacing: 1, marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: alarm ? "#e74c3c" : "#c0d8e8", lineHeight: 1.2 }}>
        {value}
      </div>
      {children}
    </div>
  )
}

export function PatientMonitor({ vitals, hasPulse = true, patientName, alarms: forcedAlarms }: PatientMonitorProps) {
  const [flash, setFlash] = useState(false)

  const als = useMemo(() => {
    if (forcedAlarms) return forcedAlarms
    const a: string[] = []
    if (vitals.hr != null && (vitals.hr > 120 || vitals.hr < 50)) a.push("HR")
    if (vitals.spo2 != null && vitals.spo2 < 90) a.push("SpO₂")
    if (vitals.bp_sys != null && (vitals.bp_sys > 180 || vitals.bp_sys < 80)) a.push("NIBP")
    if (vitals.rr != null && (vitals.rr > 30 || vitals.rr < 8)) a.push("RR")
    return a
  }, [vitals, forcedAlarms])

  const hasAlarm = als.length > 0
  useEffect(() => {
    if (!hasAlarm) { setFlash(false); return }
    const id = setInterval(() => setFlash((f) => !f), 500)
    return () => clearInterval(id)
  }, [hasAlarm])

  const hr = vitals.hr ?? 75
  const rr = vitals.rr ?? 16
  const ecgDur = Math.max(0.4, 60 / hr)
  const respDur = Math.max(1.5, 60 / rr)

  return (
    <div style={{
      background: "#080c14",
      border: `2px solid ${hasAlarm && flash ? "#e74c3c" : "#182230"}`,
      borderRadius: 8,
      fontFamily: "'Courier New', Consolas, monospace",
      color: "#b0c8e0",
      fontSize: 12,
      boxShadow: hasAlarm && flash ? "0 0 32px rgba(231,76,60,0.35), inset 0 0 80px rgba(0,0,0,0.5)" : "inset 0 0 80px rgba(0,0,0,0.5)",
      transition: "box-shadow 0.15s, border-color 0.15s",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "linear-gradient(rgba(20,40,70,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(20,40,70,0.25) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
        pointerEvents: "none", zIndex: 0,
      }} />

      {/* Alarm flash overlay */}
      {hasAlarm && <div style={{ position: "absolute", inset: 0, background: flash ? "rgba(231,76,60,0.04)" : "transparent", transition: "background 0.15s", zIndex: 1, pointerEvents: "none" }} />}

      <div style={{ position: "relative", zIndex: 2, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        {/* ── TOP BAR: patient info + quick params ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "#3a6a8a", borderBottom: "1px solid #14202e", paddingBottom: 4 }}>
          <span style={{ color: "#6aa0c0", fontWeight: 700 }}>{patientName || "Pt. UNKNOWN"}</span>
          <div style={{ display: "flex", gap: 10 }}>
            <span><span style={{ color: "#4fc3f7", fontWeight: 700 }}>{pad(vitals.hr, 3)}</span> <span style={{ color: "#3a5a7a" }}>BPM</span></span>
            <span>
              <span style={{ color: als.includes("SpO₂") ? "#e74c3c" : "#4fc3f7" }}>{pad(vitals.spo2, 2)}</span>
              <span style={{ color: "#3a5a7a" }}>%</span>
            </span>
          </div>
        </div>

        {/* ── ROW 1: ECG waveform (dominant) ── */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ minWidth: 60, flexShrink: 0, paddingTop: 4 }}>
            <div style={{ fontSize: 9, color: "#4fc3f7", letterSpacing: 1 }}>HR</div>
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: als.includes("HR") ? "#e74c3c" : "#4fc3f7", marginBottom: 2 }}>
              {pad(vitals.hr, 3)}
              <span style={{ fontSize: 11, fontWeight: 400, color: "#3a5a7a", marginLeft: 2 }}>bpm</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, height: 48, display: "flex", alignItems: "center" }}>
            <WaveBox path={ECG} speed={ecgDur} color={hasPulse ? "#4fc3f7" : "#2a4a5a"} height={48} />
          </div>
        </div>

        {/* ── ROW 2: Parameters grid ── */}
        <div style={{ display: "flex", gap: 6 }}>
          {/* NIBP */}
          <ParamBox label="NIBP" value={<span style={{ color: als.includes("NIBP") ? "#e74c3c" : "#66bb6a" }}>
            {pad(vitals.bp_sys)}<span style={{ fontSize: 14, color: "#3a5a7a" }}>/</span>{pad(vitals.bp_dia, 2)}
            <span style={{ fontSize: 11, fontWeight: 400, color: "#3a5a7a" }}> mmHg</span>
          </span>}>
            <svg viewBox="0 0 60 3" aria-hidden="true" style={{ width: "100%", height: 3, marginTop: 1 }}>
              <rect x="0" y="0" width="60" height="3" rx="1.5" fill="#14202e" />
              <rect x="0" y="0" width={`${Math.min(100, ((vitals.bp_sys || 120) / 200) * 100)}%`} height="3" rx="1.5" fill="#66bb6a" />
            </svg>
          </ParamBox>

          {/* SpO₂ */}
          <ParamBox label="SpO₂" value={<span style={{ color: als.includes("SpO₂") ? "#e74c3c" : "#4fc3f7" }}>
            {pad(vitals.spo2, 2)}<span style={{ fontSize: 11, fontWeight: 400, color: "#3a5a7a" }}> %</span>
          </span>}>
            <div style={{ height: 20, marginTop: 1 }}>
              <WaveBox path={PLETH} speed={ecgDur} color={vitals.spo2 != null && vitals.spo2 >= 90 ? "#4fc3f7" : "#e74c3c"} height={20} />
            </div>
          </ParamBox>

          {/* RR */}
          <ParamBox label="RR" value={<span style={{ color: als.includes("RR") ? "#e74c3c" : "#ffa726" }}>
            {pad(vitals.rr, 2)}<span style={{ fontSize: 11, fontWeight: 400, color: "#3a5a7a" }}> /min</span>
          </span>}>
            <div style={{ height: 20, marginTop: 1 }}>
              <WaveBox path={RESP} speed={respDur} color={als.includes("RR") ? "#e74c3c" : "#ffa726"} height={20} />
            </div>
          </ParamBox>

          {/* TEMP */}
          <ParamBox label="TEMP" value={
            <span style={{ color: vitals.temp != null && (vitals.temp > 38 || vitals.temp < 36) ? "#ff7043" : "#b0c8e0" }}>
              {vitals.temp != null ? vitals.temp.toFixed(1) : "—"}<span style={{ fontSize: 11, fontWeight: 400, color: "#3a5a7a" }}> °C</span>
            </span>
          }>
            <svg viewBox="0 0 60 3" aria-hidden="true" style={{ width: "100%", height: 3, marginTop: 6 }}>
              <rect x="0" y="0" width="60" height="3" rx="1.5" fill="#14202e" />
              <rect x="15" y="0" width="30" height="3" rx="1.5" fill="#3a5a7a" opacity={0.4} />
              {vitals.temp != null && (
                <rect x={15 + ((vitals.temp - 35) / (42 - 35)) * 30} y="-0.5" width="2" height="4" rx="1" fill="#ff7043" />
              )}
            </svg>
          </ParamBox>

          {/* PAIN */}
          <ParamBox label="PAIN" value={
            <span style={{ color: (vitals.pain ?? 0) > 4 ? "#e74c3c" : "#b0c8e0" }}>
              {vitals.pain != null ? `${vitals.pain}` : "—"}<span style={{ fontSize: 11, fontWeight: 400, color: "#3a5a7a" }}> /10</span>
            </span>
          }>
            <svg viewBox="0 0 60 3" aria-hidden="true" style={{ width: "100%", height: 3, marginTop: 6 }}>
              <rect x="0" y="0" width="60" height="3" rx="1.5" fill="#14202e" />
              {vitals.pain != null && (
                <rect x="0" y="0" width={`${(vitals.pain / 10) * 100}%`} height="3" rx="1.5"
                  fill={vitals.pain <= 3 ? "#66bb6a" : vitals.pain <= 6 ? "#ffa726" : "#e74c3c"} />
              )}
            </svg>
          </ParamBox>
        </div>

        {/* ── Lead / status bar ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 8, color: "#2a4a5a", borderTop: "1px solid #14202e", paddingTop: 3, marginTop: 1 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span><span style={{ color: "#4fc3f7" }}>●</span> II</span>
            <span><span style={{ color: hasPulse ? "#66bb6a" : "#555" }}>●</span> SpO₂</span>
            <span><span style={{ color: "#ffa726" }}>●</span> RESP</span>
          </div>
          <div style={{ display: "flex", gap: 6, color: "#3a5a7a" }}>
            <span>⚡</span>
          </div>
        </div>

        {/* ── Alarm text ── */}
        {hasAlarm && (
          <div style={{
            position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center",
            fontSize: 11, color: "#e74c3c", fontWeight: 700, letterSpacing: 1,
            opacity: flash ? 1 : 0.3, transition: "opacity 0.15s",
          }}>
            ⚠ {als.join(" · ")}
          </div>
        )}
      </div>
    </div>
  )
}

function pad(n: number | undefined, digits = 3): string {
  return n != null ? String(n).padStart(digits, " ") : "—".padStart(digits, " ")
}
