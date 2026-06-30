import { useEffect, useRef, useState } from "react"

export interface LogEntry {
  ts: string
  text: string
  done?: boolean
}

export function InteractionLog({ entries }: { entries: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [entries.length])

  return (
    <div style={{
      width: 240, background: "#1a1a2e", borderLeft: "1px solid #333",
      display: "flex", flexDirection: "column", fontFamily: "monospace", fontSize: 12,
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", color: "#888", fontWeight: 600 }}>LOG</div>
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {entries.map((e, i) => (
          <div key={i} style={{
            padding: "3px 12px", color: e.done ? "#4fc3f7" : "#aaa",
            borderBottom: "1px solid #222", fontSize: 11,
          }}>
            <span style={{ color: "#555", marginRight: 6 }}>{e.ts}</span>
            {e.done && <span style={{ color: "#4fc3f7" }}>✓ </span>}
            {e.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
