import { useEffect, useRef, useState } from "react"
import type { MockMessageBus } from "../mock/bus"
import { DEFAULT_EMOTION_SEQUENCE, playSequence } from "../mock/events"

export function DebugPanel({ bus }: { bus: MockMessageBus }) {
  const [log, setLog] = useState<ReturnType<MockMessageBus["getLog"]>>([])
  const [playing, setPlaying] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setLog([...bus.getLog()]), 200)
    return () => clearInterval(id)
  }, [bus])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [log])

  return (
    <div style={{
      width: 320, background: "#1a1a2e", borderLeft: "1px solid #333",
      display: "flex", flexDirection: "column", fontSize: 12, fontFamily: "monospace",
    }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "#888" }}>DEBUG</span>
        <button onClick={() => bus.clearLog()}
          style={{ padding: "2px 8px", background: "#333", border: "none", borderRadius: 4, color: "#ccc", cursor: "pointer", fontSize: 11 }}>
          Clear
        </button>
        <button onClick={() => { setPlaying(true); playSequence(bus, DEFAULT_EMOTION_SEQUENCE); setTimeout(() => setPlaying(false), 13500) }} disabled={playing}
          style={{ padding: "2px 8px", background: playing ? "#333" : "#2d4a3e", border: "none", borderRadius: 4, color: "#ccc", cursor: "pointer", fontSize: 11 }}>
          {playing ? "Playing…" : "▶ Emotion Seq"}
        </button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        {log.length === 0 && <div style={{ padding: "12px", color: "#555", textAlign: "center" }}>No events yet</div>}
        {log.map((e, i) => (
          <div key={i} style={{ padding: "4px 12px", borderBottom: "1px solid #222" }}>
            <div style={{ color: "#4fc3f7", fontWeight: 500 }}>{e.event}</div>
            <div style={{ color: "#888", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{JSON.stringify(e.args)}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
