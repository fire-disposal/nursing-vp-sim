/**
 * Simulated patient monitor — internally generates seamless waveforms
 * from high‑level state labels.  No raw numeric vitals required.
 *
 * Usage:
 *   <PatientMonitor status={{
 *     hr: "tachycardia", spo2: "low", bp: "elevated",
 *     rr: "normal", temp: "fever", pain: "moderate"
 *   }} />
 */

import { useEffect, useMemo, useRef, useState } from "react"

// ── Public API ──

export type HrStatus = "normal" | "tachycardia" | "bradycardia"
export type Spo2Status = "normal" | "low" | "critical"
export type BpStatus = "normal" | "elevated" | "hypertensive"
export type RrStatus = "normal" | "tachypnea" | "bradypnea"
export type TempStatus = "normal" | "fever" | "hypothermia"
export type PainStatus = "none" | "mild" | "moderate" | "severe"

export interface MonitorStatus {
  hr: HrStatus
  spo2: Spo2Status
  bp: BpStatus
  rr: RrStatus
  temp: TempStatus
  pain: PainStatus
}

interface PatientMonitorProps {
  status: MonitorStatus
  patientName?: string
}

// ── Internal: map state → numeric parameters ──

interface Params {
  hr: number          // beats per minute
  hrAmp: number       // ECG amplitude (normalised)
  spo2Amp: number     // pleth amplitude
  rr: number          // breaths per minute
  respAmp: number     // resp amplitude
  ecgColor: string
  plethColor: string
  respColor: string
  nbpSys: number
  nbpDia: number
  spo2Val: number
  tempVal: number
  painVal: number
  alarms: string[]
}

const HR_MAP: Record<HrStatus, { bpm: number; amp: number }> = {
  normal:       { bpm: 72, amp: 1 },
  tachycardia:  { bpm: 118, amp: 0.8 },
  bradycardia:  { bpm: 48, amp: 1.2 },
}

const SPO2_MAP: Record<Spo2Status, { val: number; amp: number }> = {
  normal:   { val: 98, amp: 1 },
  low:      { val: 91, amp: 0.5 },
  critical: { val: 84, amp: 0.2 },
}

const BP_MAP: Record<BpStatus, { sys: number; dia: number }> = {
  normal:         { sys: 120, dia: 80 },
  elevated:       { sys: 145, dia: 90 },
  hypertensive:   { sys: 175, dia: 105 },
}

const RR_MAP: Record<RrStatus, { rr: number; amp: number }> = {
  normal:    { rr: 16, amp: 1 },
  tachypnea: { rr: 28, amp: 0.7 },
  bradypnea: { rr: 8, amp: 1.3 },
}

const TEMP_MAP: Record<TempStatus, number> = {
  normal:     36.8,
  fever:      38.6,
  hypothermia: 35.2,
}

const PAIN_MAP: Record<PainStatus, number> = {
  none:     0,
  mild:     3,
  moderate: 6,
  severe:   9,
}

function resolveParams(s: MonitorStatus): Params {
  const hrCfg = HR_MAP[s.hr]
  const spo2Cfg = SPO2_MAP[s.spo2]
  const bpCfg = BP_MAP[s.bp]
  const rrCfg = RR_MAP[s.rr]
  const tempVal = TEMP_MAP[s.temp]
  const painVal = PAIN_MAP[s.pain]

  const alarms: string[] = []
  if (s.hr === "tachycardia" || s.hr === "bradycardia") alarms.push("HR")
  if (s.spo2 === "low" || s.spo2 === "critical") alarms.push("SpO₂")
  if (s.bp === "elevated" || s.bp === "hypertensive") alarms.push("NIBP")
  if (s.rr === "tachypnea" || s.rr === "bradypnea") alarms.push("RR")
  if (s.temp === "fever" || s.temp === "hypothermia") alarms.push("TEMP")

  return {
    hr: hrCfg.bpm, hrAmp: hrCfg.amp,
    spo2Amp: spo2Cfg.amp,
    rr: rrCfg.rr, respAmp: rrCfg.amp,
    nbpSys: bpCfg.sys, nbpDia: bpCfg.dia,
    spo2Val: spo2Cfg.val,
    tempVal, painVal,
    ecgColor: alarms.includes("HR") ? "#e74c3c" : "#4fc3f7",
    plethColor: alarms.includes("SpO₂") ? "#e74c3c" : "#66bb6a",
    respColor: alarms.includes("RR") ? "#e74c3c" : "#ffa726",
    alarms,
  }
}

// ── Waveform path generator — mathematically continuous ──
//   Each function returns ONE cycle of the waveform as SVG path data.
//   The path starts and ends at the same Y so two copies tile seamlessly.

const H = 24              // viewBox height
const W = 120             // viewBox width  (one cycle)
const BASELINE = H / 2    // centre line

/** Normal‑sinus P‑QRS‑T complex (amplitude-scaled). */
function ecgPath(amp: number): string {
  const bp = BASELINE
  const s = amp             // scale factor
  const pt = (y: number) => (y - 12) * s * 1.2 + bp  // translate + scale
  // prettier: hand‑tuned control points for one beat
  const pts = [
    [0, 12], [8, 12],                 // baseline
    [10, 10.5],                         // P onset
    [13, 9.5],                          // P peak
    [16, 10.5],                         // P end
    [18, 12],                           // PR segment
    [20, 12],
    [22, 14.5],                         // Q wave
    [23.5, 2.5],                        // R upstroke
    [25, 0.5],                          // R peak
    [26.5, 3],                          // R downstroke
    [28, 7],                            // S wave
    [30, 12],                           // back to baseline
    [35, 12],                           // ST segment
    [40, 10.5],                         // T onset
    [48, 9],                            // T peak
    [56, 10.5],                         // T end
    [60, 12],                           // return to baseline
    [80, 12],                           // diastasis
    [120, 12],                          // end
  ].map(([x, y]) => `${x},${pt(y).toFixed(1)}`).join(" L")
  return `M${pts}`
}

/** Plethysmograph — subtle pulse wave (barely visible). */
function plethPath(amp: number): string {
  const bp = BASELINE
  const s = amp * 0.3  // pleth is deliberately tiny
  const pt = (y: number) => (y - 12) * s + bp
  const pts = [
    [0, 12], [16, 12],
    [18, 10.5], [19, 9], [20, 8.5], [21, 8.8], [22, 9.5],  // upstroke + peak
    [25, 11], [30, 11.5],                                     // dicrotic notch
    [40, 11.8], [60, 12], [120, 12],                          // return
  ].map(([x, y]) => `${x},${pt(y).toFixed(1)}`).join(" L")
  return `M${pts}`
}

/** Respiration — smooth sine wave. */
function respPath(amp: number): string {
  const bp = BASELINE
  const a = amp * 5
  // Generate 1 cycle of sine
  const steps = 24
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const x = (i / steps) * W
    const y = bp - Math.sin(angle) * a
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return `M${pts.join(" L")}`
}

// ── SVG style inject ──
const SFX = "__pmfx_2"
if (typeof document !== "undefined" && !document.getElementById(SFX)) {
  const s = document.createElement("style")
  s.id = SFX
  s.textContent = `@keyframes scr2{from{transform:translateX(0)}to{transform:translateX(-50%)}}`
  document.head.appendChild(s)
}

// ── Wave Row ──
function WaveRow({ path, speed, color, height }: { path: string; speed: number; color: string; height: number }) {
  return (
    <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
      <svg viewBox={`0 0 ${W * 2} ${H}`} aria-hidden="true" style={{
        width: "200%", height: "100%", display: "block",
        animation: `scr2 ${speed}s linear infinite`,
      }}>
        <g stroke={color} strokeWidth={1.2} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d={`${path} M${W},${BASELINE} ${path}`} />
        </g>
      </svg>
      {/* Edge fade */}
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 12, background: "linear-gradient(to left, #080c14 40%, transparent)" }} />
    </div>
  )
}

// ── Parameter cell ──
function Param({ label, value, unit, color }: { label: string; value: string; unit: string; color?: string }) {
  return (
    <span>
      <span style={{ color: "#3a5a7a", fontSize: 8 }}>{label} </span>
      <span style={{ color: color ?? "#b0c8e0", fontWeight: 700 }}>{value}</span>
      <span style={{ color: "#3a5a7a", fontSize: 8 }}> {unit}</span>
    </span>
  )
}

// ── Component ──
export function PatientMonitor({ status, patientName }: PatientMonitorProps) {
  const p = useMemo(() => resolveParams(status), [status])
  const [flash, setFlash] = useState(false)
  const hasAlarm = p.alarms.length > 0

  useEffect(() => {
    if (!hasAlarm) { setFlash(false); return }
    const id = setInterval(() => setFlash((f) => !f), 500)
    return () => clearInterval(id)
  }, [hasAlarm])

  const ecgSpeed = Math.max(0.35, 60 / p.hr)
  const respSpeed = Math.max(1.2, 60 / p.rr)

  const ecgD = useMemo(() => ecgPath(p.hrAmp), [p.hrAmp])
  const plethD = useMemo(() => plethPath(p.spo2Amp), [p.spo2Amp])
  const respD = useMemo(() => respPath(p.respAmp), [p.respAmp])

  return (
    <div style={{
      background: "#080c14",
      border: `2px solid ${hasAlarm && flash ? "#e74c3c" : "#182230"}`,
      borderRadius: 8,
      fontFamily: "'Courier New', Consolas, monospace",
      color: "#b0c8e0", fontSize: 11,
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
        {/* Top bar */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 9, color: "#3a6a8a", borderBottom: "1px solid #14202e", paddingBottom: 3,
        }}>
          <span style={{ color: "#6aa0c0", fontWeight: 700 }}>{patientName || "Pt. UNKNOWN"}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <Lead on label="HR" alarm={p.alarms.includes("HR")} />
            <Lead on label="SpO₂" alarm={p.alarms.includes("SpO₂")} />
            <Lead on label="RESP" alarm={p.alarms.includes("RR")} />
          </div>
        </div>

        {/* ECG row */}
        <div style={{ height: 48, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 42, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>HR</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("HR") ? "#e74c3c" : "#4fc3f7" }}>
              {String(p.hr).padStart(3, " ")}
              <span style={{ fontSize: 8, fontWeight: 400, color: "#3a5a7a", marginLeft: 1 }}>bpm</span>
            </div>
          </div>
          <WaveRow path={ecgD} speed={ecgSpeed} color={p.ecgColor} height={48} />
        </div>

        {/* SpO₂ row */}
        <div style={{ height: 26, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 42, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>SpO₂</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("SpO₂") ? "#e74c3c" : "#66bb6a" }}>
              {String(p.spo2Val).padStart(2, " ")}%
            </div>
          </div>
          <WaveRow path={plethD} speed={ecgSpeed} color={p.plethColor} height={26} />
        </div>

        {/* RESP row */}
        <div style={{ height: 22, display: "flex", gap: 6, alignItems: "stretch" }}>
          <div style={{ minWidth: 42, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontSize: 7, color: "#3a5a7a" }}>RR</div>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1, color: p.alarms.includes("RR") ? "#e74c3c" : "#ffa726" }}>
              {String(p.rr).padStart(2, " ")}
              <span style={{ fontSize: 8, fontWeight: 400, color: "#3a5a7a" }}>/min</span>
            </div>
          </div>
          <WaveRow path={respD} speed={respSpeed} color={p.respColor} height={22} />
        </div>

        {/* Bottom bar */}
        <div style={{
          display: "flex", gap: 10, alignItems: "center",
          borderTop: "1px solid #14202e", paddingTop: 3, marginTop: 1, fontSize: 8,
        }}>
          <Param label="NIBP" value={`${p.nbpSys}/${p.nbpDia}`} unit="mmHg" color={p.alarms.includes("NIBP") ? "#e74c3c" : "#66bb6a"} />
          <Param label="TEMP" value={`${p.tempVal.toFixed(1)}`} unit="°C" color={p.alarms.includes("TEMP") ? "#e74c3c" : "#b0c8e0"} />
          <Param label="PAIN" value={`${p.painVal}`} unit="/10" color={p.painVal > 4 ? "#e74c3c" : "#b0c8e0"} />
        </div>

        {hasAlarm && (
          <div style={{
            textAlign: "center", fontSize: 9, color: "#e74c3c", fontWeight: 700,
            opacity: flash ? 1 : 0.2, transition: "opacity 0.15s",
          }}>
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
