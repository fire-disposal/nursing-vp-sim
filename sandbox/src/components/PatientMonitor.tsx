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

// ── Pre-computed ECG lookup table (clinically realistic P‑QRS‑T) ──
//  0–400 samples = one cardiac cycle.  Y is normalised; amp*H*0.35 in draw.
const ECG_TABLE = new Float32Array(400)
for (let i = 0; i < 400; i++) {
  const x = i / 400
  let y = 0
  // P wave  (0.05–0.18) — small, rounded, positive
  if (x > 0.05 && x < 0.18) y -= Math.sin((x - 0.05) / 0.13 * Math.PI) * 0.06
  // PR segment (0.18–0.25) — flat
  // Q wave  (0.25–0.28) — small, sharp, negative
  if (x > 0.25 && x < 0.28) y += Math.sin((x - 0.25) / 0.03 * Math.PI) * 0.10
  // R wave  (0.28–0.33) — tall, sharp, positive (main deflection)
  if (x > 0.28 && x < 0.33) y -= Math.sin((x - 0.28) / 0.05 * Math.PI) * 0.85
  // S wave  (0.33–0.37) — sharp, negative, below baseline
  if (x > 0.33 && x < 0.37) y += Math.sin((x - 0.33) / 0.04 * Math.PI) * 0.22
  // ST segment (0.37–0.45) — flat, isoelectric
  // T wave  (0.45–0.70) — broad, rounded, positive (larger area than P)
  if (x > 0.45 && x < 0.70) y -= Math.sin((x - 0.45) / 0.25 * Math.PI) * 0.16
  // U wave  (0.70–0.80) — tiny, optional
  if (x > 0.72 && x < 0.80) y -= Math.sin((x - 0.72) / 0.08 * Math.PI) * 0.02
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
    ecgSpeed: 60 / hr,
    respSpeed: 60 / rr,
    ecgColor: "#4fc3f7",     // fixed — waveform colour never changes; alarm shown via text/value
    plethColor: "#66bb6a",
    respColor: "#ffa726",
  }
}

// ── Canvas waveform renderer (sample‑buffer, always connected) ──
function useWaveform(amp: number, cycleSec: number, table: Float32Array | null, color: string, paused: boolean) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const samplesRef = useRef<number[]>([])
  const phaseRef = useRef(0)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    const W = cvs.width
    const H = cvs.height
    const mid = H / 2
    const len = W  // one sample per pixel
    let samples = samplesRef.current
    if (samples.length !== len) {
      samples = new Array(len).fill(mid)
      samplesRef.current = samples
    }
    let lastTime = performance.now()
    let animId = 0

    const draw = (now: number) => {
      animId = requestAnimationFrame(draw)
      if (paused) return

      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      // Advance phase and sample
      phaseRef.current = (phaseRef.current + dt / cycleSec) % 1
      let val = 0
      if (table) {
        const idx = Math.floor(phaseRef.current * table.length) % table.length
        val = table[idx] * amp * (H * 0.35)
      }
      const y = Math.round(mid + val)

      // Rotate sample buffer
      samples.shift()
      samples.push(y)

      // Redraw entire waveform as one continuous polyline
      ctx.clearRect(0, 0, W, H)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.beginPath()
      for (let i = 0; i < len; i++) {
        if (i === 0) ctx.moveTo(i, samples[i])
        else ctx.lineTo(i, samples[i])
      }
      ctx.stroke()
    }
    animId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animId)
  }, [amp, cycleSec, table, color, paused])

  return canvasRef
}

// ── Component ──
export function PatientMonitor({ status, patientName }: PatientMonitorProps) {
  const p = useMemo(() => resolve(status), [status])
  const hasAlarm = p.alarms.length > 0
  const [paused, setPaused] = useState(false)

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
      border: "2px solid #14202e",
      borderRadius: 8, fontFamily: "'Courier New', Consolas, monospace", color: "#b0c8e0", fontSize: 11,
      boxShadow: "inset 0 0 60px rgba(0,0,0,0.6)", position: "relative", overflow: "hidden",
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
          <div style={{ textAlign: "center", fontSize: 9, color: "#e74c3c", fontWeight: 700 }}>
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
