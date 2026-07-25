/**
 * High-fidelity patient monitor — Canvas-rendered waveforms with RSA & pathology adaptation.
 *
 * - ECG: clinically realistic P-QRS-T composite with respiratory sinus arrhythmia
 * - SpO₂ pleth: respiratory-modulated amplitude
 * - RESP: sine wave
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

export interface MonitorVitals {
  hr?: number; bp_sys?: number; bp_dia?: number
  rr?: number; spo2?: number; temp?: number; pain?: number
}

interface PatientMonitorProps {
  status: MonitorStatus
  patientName?: string
  vitals?: MonitorVitals
}

// ── ECG waveform tables ──────────────────────────────────────────────────
//
// Each table is 400 samples = one cardiac cycle.
// Y is normalised; drawn as y = mid + table[idx] * H * 0.35.

function buildEcgTable(stScale: number, tWidth: number, uAmp: number): Float32Array {
  const t = new Float32Array(400)
  for (let i = 0; i < 400; i++) {
    const x = i / 400
    let y = 0
    // P wave (0.05–0.18) — atrial depolarisation
    if (x > 0.05 && x < 0.18) y -= Math.sin((x - 0.05) / 0.13 * Math.PI) * 0.06
    // Q wave (0.25–0.28)
    if (x > 0.25 && x < 0.28) y += Math.sin((x - 0.25) / 0.03 * Math.PI) * 0.10
    // R wave (0.28–0.33) — main deflection
    if (x > 0.28 && x < 0.33) y -= Math.sin((x - 0.28) / 0.05 * Math.PI) * 0.85
    // S wave (0.33–0.37)
    if (x > 0.33 && x < 0.37) y += Math.sin((x - 0.33) / 0.04 * Math.PI) * 0.22
    // ST segment (0.37–0.45) — scaled by stScale for ischaemia simulation
    if (x > 0.37 && x < 0.45) y += stScale * Math.sin((x - 0.37) / 0.08 * Math.PI) * 0.04
    // T wave (0.45–0.70) — ventricular repolarisation; width scaled by tWidth
    if (x > 0.45 && x < 0.70) {
      const tx = (x - 0.45) / (0.25 * tWidth)
      if (tx < 1) y -= Math.sin(tx * Math.PI) * 0.16
    }
    // U wave (0.70–0.80) — amplitude scaled by uAmp
    if (x > 0.72 && x < 0.80) y -= Math.sin((x - 0.72) / 0.08 * Math.PI) * (0.02 * uAmp)
    t[i] = y
  }
  return t
}

const ECG_NORMAL = buildEcgTable(0, 1, 1)
const ECG_TACHYCARDIA = buildEcgTable(1.5, 0.7, 0.4)    // ST depression, shorter T, smaller U
const ECG_BRADYCARDIA = buildEcgTable(0, 1.4, 2.0)       // flat ST, wider T, prominent U

// ── SpO₂ plethysmograph table ────────────────────────────────────────────

function buildPlethTable(): Float32Array {
  const t = new Float32Array(200)
  for (let i = 0; i < 200; i++) {
    const x = i / 200
    // Rapid systolic upstroke + dicrotic notch + diastolic decay
    if (x < 0.08) t[i] = Math.sin(x / 0.08 * Math.PI / 2) * 0.7
    else if (x < 0.12) t[i] = 0.7 + Math.sin((x - 0.08) / 0.04 * Math.PI) * 0.15
    else if (x < 0.18) t[i] = 0.7 - (x - 0.12) / 0.06 * 0.2
    else t[i] = 0.5 * Math.exp(-(x - 0.18) * 8)
  }
  return t
}

const PLETH_TABLE = buildPlethTable()

// ── Map status → display parameters ──────────────────────────────────────

function resolve(s: MonitorStatus, v?: MonitorVitals) {
  const hr = v?.hr ?? (s.hr === "tachycardia" ? 118 : s.hr === "bradycardia" ? 48 : 72)
  const spo2Val = v?.spo2 ?? (s.spo2 === "critical" ? 84 : s.spo2 === "low" ? 91 : 98)
  const bpSys = v?.bp_sys ?? (s.bp === "hypertensive" ? 175 : s.bp === "elevated" ? 145 : 120)
  const bpDia = v?.bp_dia ?? (s.bp === "hypertensive" ? 105 : s.bp === "elevated" ? 90 : 80)
  const rr = v?.rr ?? (s.rr === "tachypnea" ? 28 : s.rr === "bradypnea" ? 8 : 16)
  const temp = v?.temp ?? (s.temp === "fever" ? 38.6 : s.temp === "hypothermia" ? 35.2 : 36.8)
  const pain = v?.pain ?? (s.pain === "severe" ? 9 : s.pain === "moderate" ? 6 : s.pain === "mild" ? 3 : 0)

  // ECG table selection based on HR status
  const ecgTable = s.hr === "tachycardia" ? ECG_TACHYCARDIA
    : s.hr === "bradycardia" ? ECG_BRADYCARDIA
    : ECG_NORMAL

  // RSA amplitude: respiratory modulation of HR (±5% for normal, ±3% for extreme rates)
  const rsaAmp = s.hr === "tachycardia" || s.hr === "bradycardia" ? 0.015 : 0.04

  const alarms: string[] = []
  if (s.hr !== "normal") alarms.push("HR")
  if (s.spo2 !== "normal") alarms.push("SpO₂")
  if (s.bp !== "normal") alarms.push("NIBP")
  if (s.rr !== "normal") alarms.push("RR")
  if (s.temp !== "normal") alarms.push("TEMP")

  return {
    hr, spo2Val, bpSys, bpDia, rr, temp, pain, alarms,
    ecgTable,
    ecgSpeed: 60 / hr,
    rsaAmp,
    respSpeed: 60 / rr,
    spo2Amp: s.spo2 === "normal" ? 1 : (v?.spo2 != null ? 1 : 0.4),
    ecgColor: "#66bb6a",
    plethColor: "#4fc3f7",
    respColor: "#ffa726",
  }
}

// ── Canvas waveform renderer with RSA + baseline wander ──────────────────

function useEcgWaveform(
  amp: number,
  baseCycleSec: number,
  rsaAmp: number,
  respSec: number,
  table: Float32Array,
  color: string,
  paused: boolean,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufRef = useRef<number[]>([])
  const cardiacPhaseRef = useRef(0)
  const respPhaseRef = useRef(0)
  const beatAmpRef = useRef(1)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    const W = cvs.width
    const H = cvs.height
    const mid = H / 2
    const len = W

    let samples = bufRef.current
    if (samples.length !== len) {
      samples = new Array(len).fill(mid)
      bufRef.current = samples
    }

    let lastTime = performance.now()
    let animId = 0

    const draw = (now: number) => {
      animId = requestAnimationFrame(draw)
      if (paused) return

      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      // ── Respiratory phase (cycles independently at RR rate) ──
      respPhaseRef.current = (respPhaseRef.current + dt / respSec) % 1

      // ── RSA: HR faster during inspiration (respPhase ~0–0.4) ──
      const insp = Math.sin(respPhaseRef.current * Math.PI * 2)
      const rsa = insp * rsaAmp
      const cycleSec = baseCycleSec * (1 - rsa)

      // Advance cardiac phase
      cardiacPhaseRef.current = (cardiacPhaseRef.current + dt / cycleSec) % 1

      // Detect beat boundary → new beat amplitude (±3% jitter)
      if (cardiacPhaseRef.current < dt / cycleSec) {
        beatAmpRef.current = 1 + (Math.random() - 0.5) * 0.06
      }

      // Sample ECG waveform at current phase with beat-level amplitude
      const idx = Math.floor(cardiacPhaseRef.current * table.length) % table.length
      const val = table[idx] * amp * beatAmpRef.current * (H * 0.35)

      // ── Baseline wander: slow respiratory drift (±1% H) ──
      const wander = Math.sin(respPhaseRef.current * Math.PI * 2) * H * 0.01
      const noise = (Math.random() - 0.5) * H * 0.005

      const y = Math.round(mid + val + wander + noise)

      // Rotate sample buffer
      samples.shift()
      samples.push(y)

      // Redraw
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
  }, [amp, baseCycleSec, rsaAmp, respSec, table, color, paused])

  return canvasRef
}

function useSimpleWaveform(
  amp: number, cycleSec: number, table: Float32Array, color: string, paused: boolean,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bufRef = useRef<number[]>([])
  const phaseRef = useRef(0)

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return
    const W = cvs.width
    const H = cvs.height
    const mid = H / 2
    const len = W

    let samples = bufRef.current
    if (samples.length !== len) {
      samples = new Array(len).fill(mid)
      bufRef.current = samples
    }

    let lastTime = performance.now()
    let animId = 0

    const draw = (now: number) => {
      animId = requestAnimationFrame(draw)
      if (paused) return

      const dt = Math.min((now - lastTime) / 1000, 0.05)
      lastTime = now

      phaseRef.current = (phaseRef.current + dt / cycleSec) % 1

      const idx = Math.floor(phaseRef.current * table.length) % table.length
      const val = table[idx] * amp * (H * 0.35)
      const noise = (Math.random() - 0.5) * H * 0.005
      const y = Math.round(mid + val + noise)

      samples.shift()
      samples.push(y)

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

// ── Component ────────────────────────────────────────────────────────────

export function PatientMonitor({ status, patientName, vitals }: PatientMonitorProps) {
  const p = useMemo(() => resolve(status, vitals), [status, vitals])
  const hasAlarm = p.alarms.length > 0
  const [paused] = useState(false)

  const respTable = useMemo(() => {
    const t = new Float32Array(200)
    for (let i = 0; i < 200; i++) t[i] = Math.sin(i / 200 * Math.PI * 2) * 0.5
    return t
  }, [])

  const ecgRef = useEcgWaveform(1, p.ecgSpeed, p.rsaAmp, p.respSpeed, p.ecgTable, p.ecgColor, paused)
  const plethRef = useSimpleWaveform(p.spo2Amp, p.ecgSpeed, PLETH_TABLE, p.plethColor, paused)
  const respRef = useSimpleWaveform(1, p.respSpeed, respTable, p.respColor, paused)

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
            <Lead on color="#66bb6a" label="HR" alarm={p.alarms.includes("HR")} />
            <Lead on color="#4fc3f7" label="SpO₂" alarm={p.alarms.includes("SpO₂")} />
            <Lead on color="#ffa726" label="RESP" alarm={p.alarms.includes("RR")} />
          </div>
        </div>

        {/* ECG row */}
        <div style={{ height: 48, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 40, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>HR</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("HR") ? "#e74c3c" : "#66bb6a" }}>
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
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("SpO₂") ? "#e74c3c" : "#4fc3f7" }}>
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

function Lead({ on, label, alarm, color }: { on: boolean; label: string; alarm?: boolean; color?: string }) {
  return <span style={{ color: alarm ? "#e74c3c" : on ? (color ?? "#66bb6a") : "#3a5a7a" }}>● {label}</span>
}
