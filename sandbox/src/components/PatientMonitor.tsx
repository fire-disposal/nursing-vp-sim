import { useEffect, useMemo, useState } from "react"

interface VitalsData {
  hr?: number; bp_sys?: number; bp_dia?: number
  rr?: number; spo2?: number; temp?: number; pain?: number
}

interface PatientMonitorProps {
  vitals: VitalsData
  hasPulse?: boolean
  size?: "sm" | "md" | "lg"
}

// ── Keyframes injected once ──
const STYLE_ID = "__pm_keyframes"
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `
    @keyframes pmScroll { from { transform: translateX(0) } to { transform: translateX(-50%) } }
    @keyframes pmAlarm { 0%, 100% { opacity: 1 } 50% { opacity: 0.2 } }
    @keyframes pmBlink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
  `
  document.head.appendChild(style)
}

// ── Waveform segments (one cycle, duplicated for seamless scroll) ──
const ECG_SEG = "M0,24 L4,24 L6,22 L8,24 L12,24 L14,24 L16,23 L18,24 L24,24 L26,4 L28,-2 L30,4 L32,24 L36,24 L38,22 L40,24 L44,24 L46,25 L48,24 L52,24 L54,23 L56,24 L60,24"
const PLETH_SEG = "M0,24 L4,24 L6,22 L8,24 L12,24 L14,20 L16,16 L18,12 L20,8 L22,6 L24,4 L26,4 L28,6 L30,8 L32,12 L34,16 L36,20 L38,23 L40,24 L44,24 L46,22 L48,24 L52,24 L54,23 L56,24 L60,24"
const RESP_SEG = "M0,14 L5,10 L10,4 L15,0 L20,2 L25,6 L30,10 L35,14 L40,18 L45,22 L50,24 L55,22 L60,18"

function pad(n: number | undefined, digits = 3): string {
  return n != null ? String(n).padStart(digits, " ") : "—"
}

export function PatientMonitor({ vitals, hasPulse = true, size = "md" }: PatientMonitorProps) {
  const [alarmFlash, setAlarmFlash] = useState(false)

  const alarms = useMemo(() => {
    const a: string[] = []
    if (vitals.hr != null && (vitals.hr > 120 || vitals.hr < 50)) a.push("HR")
    if (vitals.spo2 != null && vitals.spo2 < 90) a.push("SpO₂")
    if (vitals.bp_sys != null && (vitals.bp_sys > 180 || vitals.bp_sys < 80)) a.push("NIBP")
    if (vitals.rr != null && (vitals.rr > 30 || vitals.rr < 8)) a.push("RR")
    return a
  }, [vitals])

  const hasAlarm = alarms.length > 0

  useEffect(() => {
    if (!hasAlarm) { setAlarmFlash(false); return }
    const id = setInterval(() => setAlarmFlash((f) => !f), 500)
    return () => clearInterval(id)
  }, [hasAlarm])

  // ── Waveform speed based on vitals ──
  const hr = vitals.hr ?? 75
  const rr = vitals.rr ?? 16
  const ecgDur = Math.max(0.5, 60 / hr)
  const respDur = Math.max(2, 60 / rr)

  // ── Size scale ──
  const sc = size === "sm" ? 0.65 : size === "lg" ? 1.3 : 1

  const boxStyle: React.CSSProperties = {
    background: "#080c14",
    border: `1px solid ${hasAlarm ? "#e74c3c" : "#182230"}`,
    borderRadius: 6,
    fontFamily: "'Courier New', Consolas, monospace",
    color: "#b0c8e0",
    fontSize: 10 * sc,
    boxShadow: hasAlarm && alarmFlash ? `0 0 24px rgba(231,76,60,0.4), inset 0 0 60px rgba(0,0,0,0.6)` : `inset 0 0 60px rgba(0,0,0,0.6)`,
    transition: "box-shadow 0.15s",
    position: "relative" as const,
    overflow: "hidden",
  }

  const grid: React.CSSProperties = {
    position: "absolute", inset: 0,
    backgroundImage: `
      linear-gradient(rgba(20,40,70,0.3) 1px, transparent 1px),
      linear-gradient(90deg, rgba(20,40,70,0.3) 1px, transparent 1px)
    `,
    backgroundSize: `${8 * sc}px ${8 * sc}px`,
    pointerEvents: "none",
    zIndex: 0,
  }

  return (
    <div style={boxStyle}>
      {/* Grid overlay */}
      <div style={grid} />

      {/* Alarm bar */}
      {hasAlarm && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "#e74c3c", opacity: alarmFlash ? 1 : 0.2, transition: "opacity 0.15s", zIndex: 2 }} />}

      <div style={{ position: "relative", zIndex: 1, padding: `${6 * sc}px ${8 * sc}px` }}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, fontSize: 8 * sc, color: hasAlarm && alarmFlash ? "#e74c3c" : "#3a6a8a" }}>
          <span style={{ fontWeight: 700, letterSpacing: 1.5 }}>{hasAlarm ? "⚠ ALARM" : "● MONITOR"}</span>
          <span>HR · NIBP · SpO₂ · RR</span>
        </div>

        {/* ── Parameter row 1: HR + ECG waveform ── */}
        <div style={{ display: "flex", gap: 8, marginBottom: 2 }}>
          {/* HR numeric */}
          <div style={{ minWidth: 60, flexShrink: 0 }}>
            <div style={{ fontSize: 7 * sc, color: "#3a5a7a", letterSpacing: 1 }}>HR</div>
            <div style={{ fontSize: 22 * sc, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1, color: alarms.includes("HR") ? "#e74c3c" : "#4fc3f7" }}>
              {pad(vitals.hr)}
              <span style={{ fontSize: 9 * sc, fontWeight: 400, color: "#3a5a7a", marginLeft: 2 }}>bpm</span>
            </div>
          </div>
          {/* ECG waveform */}
          <div style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden" }}>
            <svg viewBox="0 0 120 28" aria-hidden="true" style={{ width: "200%", height: 28 * sc, display: "block", animation: `pmScroll ${ecgDur}s linear infinite` }}>
              <g stroke={hasPulse ? "#4fc3f7" : "#2a4a5a"} strokeWidth={1.2} fill="none">
                <path d={`${ECG_SEG} ${ECG_SEG}`} />
              </g>
            </svg>
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 30, background: "linear-gradient(to right, transparent, #080c14)" }} />
          </div>
        </div>

        {/* ── Parameter row 2: NIBP + SpO₂ + RR ── */}
        <div style={{ display: "flex", gap: 8 }}>
          {/* NIBP */}
          <div style={{ minWidth: 56, flexShrink: 0 }}>
            <div style={{ fontSize: 7 * sc, color: "#3a5a7a", letterSpacing: 1 }}>NIBP</div>
            <div style={{ fontSize: 16 * sc, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, color: alarms.includes("NIBP") ? "#e74c3c" : "#66bb6a" }}>
              {pad(vitals.bp_sys)}<span style={{ fontSize: 10 * sc }}> / </span>{pad(vitals.bp_dia, 2)}
              <span style={{ fontSize: 8 * sc, fontWeight: 400, color: "#3a5a7a" }}> mmHg</span>
            </div>
            {/* BP bar */}
            <svg viewBox="0 0 60 4" aria-hidden="true" style={{ width: "100%", height: 4, marginTop: 2 }}>
              <rect x="0" y="0" width="60" height="4" rx="2" fill="#15202a" />
              <rect x="0" y="0" width={`${Math.min(100, ((vitals.bp_sys || 120) / 200) * 100)}%`} height="4" rx="2" fill="#66bb6a" />
            </svg>
          </div>

          {/* SpO₂ + Pleth */}
          <div style={{ minWidth: 48, flexShrink: 0 }}>
            <div style={{ fontSize: 7 * sc, color: "#3a5a7a", letterSpacing: 1 }}>SpO₂</div>
            <div style={{ fontSize: 16 * sc, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, color: alarms.includes("SpO₂") ? "#e74c3c" : "#4fc3f7" }}>
              {pad(vitals.spo2, 2)}
              <span style={{ fontSize: 8 * sc, fontWeight: 400, color: "#3a5a7a" }}> %</span>
            </div>
            {/* Pleth waveform */}
            <svg viewBox="0 0 120 20" aria-hidden="true" style={{ width: "200%", height: 16 * sc, display: "block", animation: `pmScroll ${ecgDur}s linear infinite` }}>
              <g stroke={vitals.spo2 != null && vitals.spo2 >= 90 ? "#4fc3f7" : "#e74c3c"} strokeWidth={1.5} fill="none">
                <path d={`${PLETH_SEG} ${PLETH_SEG}`} />
              </g>
            </svg>
          </div>

          {/* RR + resp waveform */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 7 * sc, color: "#3a5a7a", letterSpacing: 1 }}>RR</div>
                <div style={{ fontSize: 16 * sc, fontWeight: 700, fontVariantNumeric: "tabular-nums", lineHeight: 1.2, color: alarms.includes("RR") ? "#e74c3c" : "#ffa726" }}>
                  {pad(vitals.rr, 2)}
                  <span style={{ fontSize: 8 * sc, fontWeight: 400, color: "#3a5a7a" }}> /min</span>
                </div>
              </div>
              <div style={{ fontSize: 9 * sc, color: "#3a5a7a" }}>
                {vitals.temp != null ? `${vitals.temp.toFixed(1)}°C` : "—°C"}
                {vitals.pain != null ? ` · P${vitals.pain}` : ""}
              </div>
            </div>
            {/* Resp waveform */}
            <svg viewBox="0 0 120 28" aria-hidden="true" style={{ width: "200%", height: 20 * sc, display: "block", animation: `pmScroll ${respDur}s linear infinite` }}>
              <g stroke={alarms.includes("RR") ? "#e74c3c" : "#ffa726"} strokeWidth={1} fill="none">
                <path d={`${RESP_SEG} ${RESP_SEG}`} />
              </g>
            </svg>
          </div>
        </div>

        {/* Lead indicator */}
        <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 7 * sc, color: "#2a4a5a" }}>
          <span style={{ color: "#4fc3f7" }}>●</span> II
          <span style={{ color: "#66bb6a", marginLeft: 4 }}>●</span> SpO₂
          <span style={{ color: "#ffa726", marginLeft: 4 }}>●</span> RESP
        </div>
      </div>

      {/* Alarm text overlay */}
      {hasAlarm && alarmFlash && (
        <div style={{ position: "absolute", bottom: 4, left: 0, right: 0, textAlign: "center", fontSize: 8 * sc, color: "#e74c3c", zIndex: 3, animation: "pmBlink 0.5s infinite" }}>
          ⚠ ALARM: {alarms.join(" · ")}
        </div>
      )}
    </div>
  )
}
