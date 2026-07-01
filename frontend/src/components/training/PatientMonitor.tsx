/**
 * Simulated patient monitor — CSS/vector based, no canvas.
 * Displays live vitals with animated waveforms.
 */
import { useEffect, useMemo, useState } from "react";

interface VitalsData {
  hr?: number;
  bp_sys?: number;
  bp_dia?: number;
  rr?: number;
  spo2?: number;
  temp?: number;
  pain?: number;
}

interface PatientMonitorProps {
  vitals: VitalsData;
  /** Pulse detection — when true, ECG gains a visible QRS complex. */
  hasPulse?: boolean;
  size?: "sm" | "md" | "lg";
}

// ── Waveform SVG paths — one cycle of each, CSS-repeated ──

/** ECG path: P-QRS-T complex, 1 cycle = 1s at normal HR */
const ECG_PATH = "M0,30 L4,30 L6,28 L8,30 L12,30 L14,30 L16,29 L18,30 L24,30 L26,10 L28,4 L30,10 L32,30 L36,30 L38,28 L40,30 L44,30 L46,31 L48,30 L52,30 L54,29 L56,30 L60,30";
/** Pleth (SpO₂) waveform: arterial pulse wave */
const PLETH_PATH = "M0,28 L3,28 L6,27 L9,28 L12,28 L15,26 L18,24 L20,22 L22,20 L24,18 L26,16 L28,14 L30,12 L32,10 L34,10 L36,12 L38,14 L40,16 L42,18 L44,20 L46,22 L48,24 L51,26 L54,27 L57,28 L60,28";
/** Respiration waveform: sinusoidal */
const RESP_PATH = "M0,16 L4,14 L8,10 L12,6 L16,4 L20,6 L24,10 L28,14 L32,16 L36,18 L40,22 L44,26 L48,28 L52,26 L56,22 L60,18";

// ── Alarm thresholds ──
function alarms(v: VitalsData): string[] {
  const a: string[] = [];
  if (v.hr != null && (v.hr > 120 || v.hr < 50)) a.push("HR");
  if (v.spo2 != null && v.spo2 < 90) a.push("SpO₂");
  if (v.bp_sys != null && (v.bp_sys > 180 || v.bp_sys < 80)) a.push("NIBP");
  if (v.rr != null && (v.rr > 30 || v.rr < 8)) a.push("RR");
  return a;
}

function pad(n: number | undefined, digits = 3): string {
  if (n == null) return "—";
  return String(n).padStart(digits, " ");
}

export function PatientMonitor({ vitals, hasPulse = true, size = "md" }: PatientMonitorProps) {
  const alarmList = useMemo(() => alarms(vitals), [vitals]);
  const hasAlarm = alarmList.length > 0;

  const [alarmFlash, setAlarmFlash] = useState(false);
  useEffect(() => {
    if (!hasAlarm) { setAlarmFlash(false); return; }
    const id = setInterval(() => setAlarmFlash((f) => !f), 500);
    return () => clearInterval(id);
  }, [hasAlarm]);

  // Scale
  const sc = size === "sm" ? 0.7 : size === "lg" ? 1.3 : 1;

  const styles: Record<string, React.CSSProperties> = {
    box: {
      background: "#0a0e14",
      border: `1px solid ${hasAlarm ? "#e74c3c" : "#1a2a3a"}`,
      borderRadius: 8,
      padding: `${8 * sc}px`,
      fontFamily: "'Courier New', monospace",
      color: "#c0d0e0",
      width: "100%",
      boxShadow: hasAlarm ? "0 0 20px rgba(231,76,60,0.3)" : "inset 0 0 30px rgba(0,0,0,0.5)",
      transition: "box-shadow 0.3s",
      transform: `scale(${sc})`,
      transformOrigin: "top left",
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 10,
      color: "#4a6a8a",
      borderBottom: "1px solid #1a2a3a",
      paddingBottom: 4,
      marginBottom: 6,
    },
    row: {
      display: "flex",
      gap: 12,
      marginBottom: 4,
    },
    paramBox: {
      flex: 1,
      background: "#0d1219",
      borderRadius: 4,
      padding: "3px 6px",
      border: "1px solid #15202a",
    },
    paramLabel: {
      fontSize: 8,
      color: "#4a6a8a",
      textTransform: "uppercase" as const,
      letterSpacing: 1,
    },
    paramValue: {
      fontSize: 16,
      fontWeight: 700,
      fontVariantNumeric: "tabular-nums",
      lineHeight: 1.2,
    },
    paramUnit: {
      fontSize: 8,
      color: "#4a6a8a",
      marginLeft: 2,
    },
    waveform: {
      marginTop: 4,
      marginBottom: 2,
    },
    alarmBar: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      background: "#e74c3c",
      opacity: alarmFlash ? 1 : 0.3,
      transition: "opacity 0.15s",
    },
  };

  return (
    <div style={styles.box}>
      {hasAlarm && <div style={styles.alarmBar} />}

      {/* Header */}
      <div style={styles.header}>
        <span style={{ fontWeight: 700, color: hasAlarm ? "#e74c3c" : "#4fc3f7" }}>
          {hasAlarm ? "⚠ " : "● "}PATIENT MONITOR
        </span>
        <span style={{ color: "#3a5a7a" }}>HR BPM / NIBP mmHg / SpO₂ %</span>
      </div>

      {/* Vitals row 1: HR, BP, SpO₂ */}
      <div style={styles.row}>
        <ParamBox style={styles.paramBox}>
          <div style={styles.paramLabel}>HR</div>
          <div style={{ ...styles.paramValue, color: alarmList.includes("HR") ? "#e74c3c" : "#4fc3f7" }}>
            {pad(vitals.hr, 3)}
            <span style={styles.paramUnit}>bpm</span>
          </div>
          {/* ECG waveform */}
          <svg viewBox="0 0 60 36" aria-hidden="true" style={{ width: "100%", height: 20 }}>
            <path d={ECG_PATH} fill="none" stroke={hasPulse ? "#4fc3f7" : "#2a4a5a"} strokeWidth={1}
              strokeDasharray={hasPulse ? "none" : "2,2"}>
              {hasPulse && (
                <animate attributeName="stroke-dashoffset" from="0" to="-60" dur={`${60 / (vitals.hr || 75)}s`} repeatCount="indefinite" />
              )}
            </path>
          </svg>
        </ParamBox>

        <ParamBox style={styles.paramBox}>
          <div style={styles.paramLabel}>NIBP</div>
          <div style={{ ...styles.paramValue, fontSize: 14, color: alarmList.includes("NIBP") ? "#e74c3c" : "#66bb6a" }}>
            {pad(vitals.bp_sys)}<span style={{ fontSize: 10 }}>/</span>{pad(vitals.bp_dia, 2)}
            <span style={styles.paramUnit}>mmHg</span>
          </div>
          <svg viewBox="0 0 60 12" aria-hidden="true" style={{ width: "100%", height: 8 }}>
            <rect x="0" y="4" width="60" height="4" rx="2" fill="#15202a" />
            <rect x="0" y="4" width={`${((vitals.bp_sys || 120) / 200) * 100}%`} height="4" rx="2" fill="#66bb6a" />
          </svg>
        </ParamBox>

        <ParamBox style={styles.paramBox}>
          <div style={styles.paramLabel}>SpO₂</div>
          <div style={{ ...styles.paramValue, color: alarmList.includes("SpO₂") ? "#e74c3c" : "#4fc3f7" }}>
            {pad(vitals.spo2, 2)}
            <span style={styles.paramUnit}>%</span>
          </div>
          {/* Pleth waveform */}
          <svg viewBox="0 0 60 32" aria-hidden="true" style={{ width: "100%", height: 18 }}>
            <path d={PLETH_PATH} fill="none" stroke={vitals.spo2 != null && vitals.spo2 >= 90 ? "#4fc3f7" : "#e74c3c"} strokeWidth={1.2}>
              <animate attributeName="stroke-dashoffset" from="0" to="-60" dur="1s" repeatCount="indefinite" />
            </path>
          </svg>
        </ParamBox>
      </div>

      {/* Vitals row 2: RR, Temp, Pain */}
      <div style={styles.row}>
        <ParamBox style={styles.paramBox}>
          <div style={styles.paramLabel}>RR</div>
          <div style={{ ...styles.paramValue, color: alarmList.includes("RR") ? "#e74c3c" : "#ffa726" }}>
            {pad(vitals.rr, 2)}
            <span style={styles.paramUnit}>/min</span>
          </div>
          <svg viewBox="0 0 60 32" aria-hidden="true" style={{ width: "100%", height: 16 }}>
            <path d={RESP_PATH} fill="none" stroke={alarmList.includes("RR") ? "#e74c3c" : "#ffa726"} strokeWidth={1}>
              <animate attributeName="stroke-dashoffset" from="0" to="-60" dur={`${60 / (vitals.rr || 16)}s`} repeatCount="indefinite" />
            </path>
          </svg>
        </ParamBox>

        <ParamBox style={styles.paramBox}>
          <div style={styles.paramLabel}>TEMP</div>
          <div style={{ ...styles.paramValue, fontSize: 14, color: vitals.temp != null && (vitals.temp > 38 || vitals.temp < 36) ? "#ff7043" : "#aaa" }}>
            {vitals.temp != null ? vitals.temp.toFixed(1) : "—"}
            <span style={styles.paramUnit}>°C</span>
          </div>
          <svg viewBox="0 0 60 12" aria-hidden="true" style={{ width: "100%", height: 8 }}>
            <rect x="0" y="4" width="60" height="4" rx="2" fill="#15202a" />
            <rect x="18" y="4" width="24" height="4" rx="2" fill="#3a5a7a" opacity={0.5} />
            {vitals.temp != null && (
              <rect x={18 + ((vitals.temp - 35) / (42 - 35)) * 24} y="3" width="2" height="6" rx="1" fill="#ff7043" />
            )}
          </svg>
        </ParamBox>

        <ParamBox style={styles.paramBox}>
          <div style={styles.paramLabel}>PAIN</div>
          <div style={{ ...styles.paramValue, fontSize: 14, color: (vitals.pain ?? 0) > 4 ? "#e74c3c" : "#aaa" }}>
            {vitals.pain != null ? `${vitals.pain}/10` : "—"}
          </div>
          <svg viewBox="0 0 60 12" aria-hidden="true" style={{ width: "100%", height: 8 }}>
            <rect x="0" y="4" width="60" height="4" rx="2" fill="#15202a" />
            {vitals.pain != null && (
              <rect x="0" y="4" width={`${(vitals.pain / 10) * 100}%`} height="4" rx="2"
                fill={vitals.pain <= 3 ? "#66bb6a" : vitals.pain <= 6 ? "#ffa726" : "#e74c3c"} />
            )}
          </svg>
        </ParamBox>
      </div>

      {/* Alarm text */}
      {hasAlarm && (
        <div style={{ fontSize: 9, color: "#e74c3c", marginTop: 4, textAlign: "center" }}>
          ⚠ ALARM: {alarmList.join(" · ")}
        </div>
      )}
    </div>
  );
}

function ParamBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={style}>{children}</div>;
}
