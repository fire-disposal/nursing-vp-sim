/**
 * High-fidelity patient monitor — Canvas-rendered waveforms.
 * Receives status labels, generates realistic waveforms internally.
 */
import { useEffect, useMemo, useRef, useState } from "react"

export type HrStatus = "normal" | "tachycardia" | "bradycardia"
export type Spo2Status = "normal" | "low" | "critical"
export type BpStatus = "normal" | "elevated" | "hypertensive"
export type RrStatus = "normal" | "tachypnea" | "bradypnea"
export type TempStatus = "normal" | "fever" | "hypothermia"
export type PainStatus = "none" | "mild" | "moderate" | "severe"

export interface MonitorStatus {
  hr: HrStatus; spo2: Spo2Status; bp: BpStatus
  rr: RrStatus; temp: TempStatus; pain: PainStatus
}

interface PatientMonitorProps {
  status: MonitorStatus
  patientName?: string
}

// ── Pre-computed ECG lookup table (P-QRS-T, 400 points) ──
const ECG_TABLE = new Float32Array(400)
for (let i = 0; i < 400; i++) {
  const x = i / 400
  let y = 0
  // P wave (0.05–0.20)
  if (x > 0.05 && x < 0.20) y -= Math.sin((x - 0.05) / 0.15 * Math.PI) * 0.08
  // Q wave (0.22–0.26)
  if (x > 0.22 && x < 0.26) y += Math.sin((x - 0.22) / 0.04 * Math.PI) * 0.12
  // R wave (0.26–0.33)
  if (x > 0.26 && x < 0.33) y -= Math.sin((x - 0.26) / 0.07 * Math.PI) * 0.85
  // S wave (0.33–0.38)
  if (x > 0.33 && x < 0.38) y += Math.sin((x - 0.33) / 0.05 * Math.PI) * 0.25
  // T wave (0.45–0.70)
  if (x > 0.45 && x < 0.70) y -= Math.sin((x - 0.45) / 0.25 * Math.PI) * 0.18
  ECG_TABLE[i] = y
}

// ── Map status → parameters ──
function resolve(s: MonitorStatus) {
  const hrMap = { normal: 72, tachycardia: 118, bradycardia: 48 }
  const spo2Map = { normal: { val: 98, amp: 1 }, low: { val: 91, amp: 0.4 }, critical: { val: 84, amp: 0.1 } }
  const bpMap = { normal: [120, 80], elevated: [145, 90], hypertensive: [175, 105] }
  const rrMap = { normal: 16, tachypnea: 28, bradypnea: 8 }
  const tempMap = { normal: 36.8, fever: 38.6, hypothermia: 35.2 }
  const painMap = { none: 0, mild: 3, moderate: 6, severe: 9 }

  const hr = hrMap[s.hr]
  const spo2 = spo2Map[s.spo2]
  const [bpSys, bpDia] = bpMap[s.bp]
  const rr = rrMap[s.rr]
  const temp = tempMap[s.temp]
  const pain = painMap[s.pain]

  const alarms: string[] = []
  if (s.hr !== "normal") alarms.push("HR")
  if (s.spo2 !== "normal") alarms.push("SpO₂")
  if (s.bp !== "normal") alarms.push("NIBP")
  if (s.rr !== "normal") alarms.push("RR")
  if (s.temp !== "normal") alarms.push("TEMP")

  return {
    hr, spo2Val: spo2.val, spo2Amp: spo2.amp,
    bpSys, bpDia, rr, temp, pain, alarms,
    ecgSpeed: 60 / hr,         // seconds per cycle
    respSpeed: 60 / rr,
    ecgColor: alarms.includes("HR") ? "#e74c3c" : "#4fc3f7",
    plethColor: alarms.includes("SpO₂") ? "#e74c3c" : "#66bb6a",
    respColor: alarms.includes("RR") ? "#e74c3c" : "#ffa726",
  }
}

// ── Canvas waveform renderer ──
function useWaveform(amp: number, speed: number, table: Float32Array | null, color: string, paused: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufRef = useRef<HTMLCanvasElement | null>(null)
  const posRef = useRef(0)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1

    // Setup offscreen buffer
    if (!bufRef.current || bufRef.current.width !== cvs.width) {
      const buf = document.createElement("canvas")
      buf.width = cvs.width
      buf.height = cvs.height
      bufRef.current = buf
    }
    const buf = bufRef.current
    const bctx = buf.getContext("2d")!
    const W = cvs.width
    const H = cvs.height
    const mid = H / 2
    const pxPerSec = 60 * dpr   // pixels per second of waveform
    const periodPx = pxPerSec * speed  // pixels per full cycle
    let animId = 0

    const draw = () => {
      if (paused) { animId = requestAnimationFrame(draw); return }

      // Scroll left by 1px
      bctx.drawImage(buf, 1, 0, W - 1, H, 0, 0, W - 1, H)
      bctx.clearRect(W - 1, 0, 1, H)

      // Sample the waveform table at current position
      const frac = (posRef.current % periodPx) / periodPx
      let val = 0
      if (table) {
        const idx = Math.floor(frac * table.length) % table.length
        val = table[idx] * amp * (H * 0.35)
      }
      posRef.current += 1 * dpr
      if (posRef.current > periodPx * 10) posRef.current -= periodPx * 10

      // Draw pixel column at right edge
      const y = mid + val
      bctx.fillStyle = color
      bctx.fillRect(W - 1, Math.round(y), 1, 1)

      // Blit to visible canvas
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(buf, 0, 0)

      animId = requestAnimationFrame(draw)
    }
    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [amp, speed, table, color, paused])

  return canvasRef
}

// ── Component ──
export function PatientMonitor({ status, patientName }: PatientMonitorProps) {
  const p = useMemo(() => resolve(status), [status])
  const [flash, setFlash] = useState(false)
  const hasAlarm = p.alarms.length > 0
  const [paused, setPaused] = useState(false) // pause when hidden

  useEffect(() => {
    if (!hasAlarm) { setFlash(false); return }
    const id = setInterval(() => setFlash((f) => !f), 500)
    return () => clearInterval(id)
  }, [hasAlarm])

  // Waveform tables
  const plethTable = useMemo(() => {
    const t = new Float32Array(200)
    for (let i = 0; i < 200; i++) {
      const x = i / 200
      if (x < 0.1) t[i] = -Math.sin(x / 0.1 * Math.PI / 2) * 0.6
      else if (x < 0.15) t[i] = -0.6
      else if (x < 0.25) t[i] = -0.6 + Math.sin((x - 0.15) / 0.1 * Math.PI) * 0.2
      else t[i] = -0.4 * Math.exp(-(x - 0.25) * 6)
    }
    return t
  }, [])
  const respTable = useMemo(() => {
    const t = new Float32Array(200)
    for (let i = 0; i < 200; i++) t[i] = Math.sin(i / 200 * Math.PI * 2) * 0.5
    return t
  }, [])

  const ecgRef = useWaveform(1, p.ecgSpeed, ECG_TABLE, p.ecgColor, paused)
  const plethRef = useWaveform(p.spo2Amp, p.ecgSpeed, plethTable, p.plethColor, paused)
  const respRef = useWaveform(1, p.respSpeed, respTable, p.respColor, paused)

  const DPR = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1

  return (
    <div style={{
      background: "#060a12",
      border: `2px solid ${hasAlarm && flash ? "#e74c3c" : "#14202e"}`,
      borderRadius: 8, fontFamily: "'Courier New', Consolas, monospace", color: "#b0c8e0", fontSize: 11,
      boxShadow: hasAlarm && flash ? "0 0 30px rgba(231,76,60,0.3), inset 0 0 60px rgba(0,0,0,0.6)" : "inset 0 0 60px rgba(0,0,0,0.6)",
      transition: "box-shadow 0.15s, border-color 0.15s", position: "relative", overflow: "hidden",
    }}>
      {/* Grid */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: "linear-gradient(rgba(20,50,80,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(20,50,80,0.15) 1px, transparent 1px)",
        backgroundSize: "12px 12px",
      }} />

      <div style={{ position: "relative", zIndex: 1, padding: "6px 10px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 9, color: "#3a5a7a", borderBottom: "1px solid #14202e", paddingBottom: 3 }}>
          <span style={{ color: "#6aa0c0", fontWeight: 700 }}>{patientName || "Pt. UNKNOWN"}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <Lead on label="HR" alarm={p.alarms.includes("HR")} />
            <Lead on label="SpO₂" alarm={p.alarms.includes("SpO₂")} />
            <Lead on label="RESP" alarm={p.alarms.includes("RR")} />
          </div>
        </div>

        {/* ECG row */}
        <div style={{ height: 48, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 40, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>HR</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("HR") ? "#e74c3c" : "#4fc3f7" }}>
              {String(p.hr).padStart(3, " ")}<span style={{ fontSize: 8, fontWeight: 400, color: "#3a5a7a", marginLeft: 1 }}>bpm</span>
            </div>
            <div style={{ fontSize: 6, color: "#2a4a5a" }}>LIMIT 60-100</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
            <canvas ref={ecgRef} width={240 * DPR} height={48 * DPR} style={{ width: 240, height: 48, display: "block" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, background: "linear-gradient(to left, #060a12 30%, transparent)" }} />
          </div>
        </div>

        {/* SpO₂ row */}
        <div style={{ height: 26, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 40, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>SpO₂</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("SpO₂") ? "#e74c3c" : "#66bb6a" }}>
              {String(p.spo2Val).padStart(2, " ")}%
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
            <canvas ref={plethRef} width={240 * DPR} height={26 * DPR} style={{ width: 240, height: 26, display: "block" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, background: "linear-gradient(to left, #060a12 30%, transparent)" }} />
          </div>
        </div>

        {/* RESP row */}
        <div style={{ height: 22, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 40, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>RR</div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("RR") ? "#e74c3c" : "#ffa726" }}>
              {String(p.rr).padStart(2, " ")}<span style={{ fontSize: 8, fontWeight: 400, color: "#3a5a7a" }}>/min</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
            <canvas ref={respRef} width={240 * DPR} height={22 * DPR} style={{ width: 240, height: 22, display: "block" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, background: "linear-gradient(to left, #060a12 30%, transparent)" }} />
          </div>
        </div>

        {/* Bottom bar */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", borderTop: "1px solid #14202e", paddingTop: 3, marginTop: 1, fontSize: 8 }}>
          <span><span style={{ color: "#3a5a7a" }}>NIBP </span><span style={{ color: p.alarms.includes("NIBP") ? "#e74c3c" : "#66bb6a" }}>{p.bpSys}/{p.bpDia}</span> <span style={{ color: "#3a5a7a" }}>mmHg</span></span>
          <span><span style={{ color: "#3a5a7a" }}>TEMP </span><span style={{ color: p.alarms.includes("TEMP") ? "#e74c3c" : "#b0c8e0" }}>{p.temp.toFixed(1)}°C</span></span>
          <span><span style={{ color: "#3a5a7a" }}>PAIN </span><span style={{ color: p.pain > 4 ? "#e74c3c" : "#b0c8e0" }}>{p.pain}/10</span></span>
        </div>

        {/* Alarm */}
        {hasAlarm && (
          <div style={{ textAlign: "center", fontSize: 9, color: "#e74c3c", fontWeight: 700, opacity: flash ? 1 : 0.2, transition: "opacity 0.15s" }}>
            ⚠ {p.alarms.join(" · ")}
          </div>
        )}
      </div>
    </div>
  )
}

function Lead({ on, label, alarm }: { on: boolean; label: string; alarm?: boolean }) {
  return <span style={{ color: alarm ? "#e74c3c" : on ? "#66bb6a" : "#3a5a7a" }}>● {label}</span>
}
