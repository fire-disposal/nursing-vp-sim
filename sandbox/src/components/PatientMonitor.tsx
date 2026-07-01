import { useEffect, useMemo, useState } from "react"

interface VitalsData {
  hr?: number; bp_sys?: number; bp_dia?: number
  rr?: number; spo2?: number; temp?: number; pain?: number
}

interface PatientMonitorProps {
  vitals: VitalsData
  hasPulse?: boolean
  patientName?: string
}

const SFX = "__pmfx"
if (typeof document !== "undefined" && !document.getElementById(SFX)) {
  const s = document.createElement("style")
  s.id = SFX
  s.textContent = "@keyframes scr{from{transform:translateX(0)}to{transform:translateX(-50%)}}"
  document.head.appendChild(s)
}

// ── Realistic P‑QRS‑T complex (single beat, 120px wide) ──
const ECG = [
  "M0,20",           // start baseline
  "L8,20",           // baseline before P
  "Q10,18",          // P wave up
  "C12,16 14,16 16,18", // P wave crest
  "L20,20",          // back to baseline
  "L22,20",          // PR segment
  "L24,20",          // start of QRS
  "Q26,24 28,2",     // Q wave down then R wave up
  "C28,0 30,-2 32,1", // R wave peak and initial descent
  "Q34,6 36,18",     // S wave
  "L40,20",          // back to baseline
  "L46,20",          // ST segment
  "C48,19 52,16 56,15", // T wave upslope
  "C60,14 64,14 68,15", // T wave crest
  "C72,16 76,19 78,20", // T wave downslope
  "L84,20",          // back to baseline
  "L120,20",         // end of cycle
].join(" ")

// ── Pleth (arterial pulse wave, smooth) ──
const PLETH = [
  "M0,20",
  "L12,20",
  "C14,20 16,14 18,10",   // steep upstroke
  "C20,6 22,4 24,4",       // systolic peak (flat)
  "C28,4 30,5 32,7",       // early downslope
  "C36,11 42,14 48,15",    // dicrotic notch down
  "C52,16 55,16 58,15",    // dicrotic notch up
  "C64,14 72,16 80,18",    // gradual diastolic run-off
  "C90,19 100,20 120,20",  // return to baseline
].join(" ")

// ── RESP (sine wave) ──
const RESP = [
  "M0,14",
  "C10,6 20,2 30,2",    // inspiration up
  "C40,2 50,6 60,14",   // peak → exhale start
  "C70,22 80,26 90,26", // exhalation down
  "C100,26 110,22 120,14", // back to baseline
].join(" ")

function pad(n: number | undefined, d = 3): string {
  return n != null ? String(n).padStart(d, " ") : "—".padStart(d, " ")
}

export function PatientMonitor({ vitals, hasPulse = true, patientName }: PatientMonitorProps) {
  const [flash, setFlash] = useState(false)

  const als = useMemo(() => {
    const a: string[] = []
    if (vitals.hr != null && (vitals.hr > 120 || vitals.hr < 50)) a.push("HR")
    if (vitals.spo2 != null && vitals.spo2 < 90) a.push("SpO₂")
    if (vitals.bp_sys != null && (vitals.bp_sys > 180 || vitals.bp_sys < 80)) a.push("NIBP")
    if (vitals.rr != null && (vitals.rr > 30 || vitals.rr < 8)) a.push("RR")
    return a
  }, [vitals])

  const hasAlarm = als.length > 0
  useEffect(() => {
    if (!hasAlarm) { setFlash(false); return }
    const id = setInterval(() => setFlash((f) => !f), 500)
    return () => clearInterval(id)
  }, [hasAlarm])

  const hr = vitals.hr ?? 75
  const rr = vitals.rr ?? 16
  const ecgSpeed = Math.max(0.4, 60 / hr)
  const respSpeed = Math.max(1.5, 60 / rr)
  const plethSpeed = ecgSpeed // tied to HR

  // ── Waveform row component ──
  function WaveRow({ path, speed, color, height }: { path: string; speed: number; color: string; height: number }) {
    return (
      <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
        <svg viewBox="0 0 240 24" aria-hidden="true" style={{
          width: "200%", height: "100%", display: "block",
          animation: `scr ${speed}s linear infinite`,
        }}>
          <g stroke={color} strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={`${path} M120,20 ${path}`} />
          </g>
        </svg>
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 20, background: "linear-gradient(to left, #080c14 20%, transparent)" }} />
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "#080c14" }} />
      </div>
    )
  }

  return (
    <div style={{
      background: "#080c14",
      border: `2px solid ${hasAlarm && flash ? "#e74c3c" : "#182230"}`,
      borderRadius: 8,
      fontFamily: "'Courier New', Consolas, monospace",
      color: "#b0c8e0",
      fontSize: 11,
      boxShadow: hasAlarm && flash ? "0 0 30px rgba(231,76,60,0.3), inset 0 0 60px rgba(0,0,0,0.5)" : "inset 0 0 60px rgba(0,0,0,0.5)",
      transition: "box-shadow 0.15s, border-color 0.15s",
      position: "relative", overflow: "hidden",
    }}>
      {/* Grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "linear-gradient(rgba(20,40,70,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(20,40,70,0.2) 1px, transparent 1px)",
        backgroundSize: "10px 10px",
        pointerEvents: "none", zIndex: 0,
      }} />

      <div style={{ position: "relative", zIndex: 1, padding: "6px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
        {/* ── Top bar ── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 9, color: "#3a6a8a", borderBottom: "1px solid #14202e", paddingBottom: 3,
        }}>
          <span style={{ color: "#6aa0c0", fontWeight: 700, letterSpacing: 0.5 }}>{patientName || "Pt. UNKNOWN"}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Lead status="on" label="HR" /> <Lead status="on" label="SpO₂" /> <Lead status="on" label="RESP" />
          </div>
        </div>

        {/* ── ECG row ── */}
        <div style={{ height: 48, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 44, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a", letterSpacing: 1 }}>HR</div>
            <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: als.includes("HR") ? "#e74c3c" : "#4fc3f7" }}>
              {pad(vitals.hr, 3)}
              <span style={{ fontSize: 9, fontWeight: 400, color: "#3a5a7a", marginLeft: 1 }}>bpm</span>
            </div>
          </div>
          <WaveRow path={ECG} speed={ecgSpeed} color={hasPulse ? "#4fc3f7" : "#2a4a5a"} height={48} />
        </div>

        {/* ── SpO₂ row ── */}
        <div style={{ height: 30, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 44, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a", letterSpacing: 1 }}>SpO₂</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: als.includes("SpO₂") ? "#e74c3c" : "#66bb6a" }}>
              {pad(vitals.spo2, 2)}
            </div>
          </div>
          <WaveRow path={PLETH} speed={plethSpeed} color={vitals.spo2 != null && vitals.spo2 >= 90 ? "#66bb6a" : "#e74c3c"} height={30} />
        </div>

        {/* ── RESP row ── */}
        <div style={{ height: 24, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 44, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a", letterSpacing: 1 }}>RR</div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1, color: als.includes("RR") ? "#e74c3c" : "#ffa726" }}>
              {pad(vitals.rr, 2)}
              <span style={{ fontSize: 8, fontWeight: 400, color: "#3a5a7a" }}>/min</span>
            </div>
          </div>
          <WaveRow path={RESP} speed={respSpeed} color={als.includes("RR") ? "#e74c3c" : "#ffa726"} height={24} />
        </div>

        {/* ── Bottom params bar ── */}
        <div style={{
          display: "flex", gap: 8, alignItems: "center",
          borderTop: "1px solid #14202e", paddingTop: 3, marginTop: 1,
          fontSize: 9, color: "#3a5a7a",
        }}>
          <span><span style={{ color: "#66bb6a" }}>NIBP</span> <span style={{ color: "#b0c8e0" }}>{pad(vitals.bp_sys)}/{pad(vitals.bp_dia, 2)}</span> mmHg</span>
          <span>TEMP {vitals.temp != null ? `${vitals.temp.toFixed(1)}°C` : "—°C"}</span>
          <span>PAIN {vitals.pain != null ? `${vitals.pain}/10` : "—"}</span>
        </div>

        {/* ── Alarm ── */}
        {hasAlarm && (
          <div style={{
            textAlign: "center", fontSize: 10, color: "#e74c3c", fontWeight: 700, letterSpacing: 1,
            opacity: flash ? 1 : 0.2, transition: "opacity 0.15s",
          }}>
            ⚠ {als.join(" · ")}
          </div>
        )}
      </div>
    </div>
  )
}

function Lead({ status, label }: { status: "on" | "off"; label: string }) {
  return <span style={{ color: status === "on" ? "#66bb6a" : "#3a5a7a" }}>● {label}</span>
}
