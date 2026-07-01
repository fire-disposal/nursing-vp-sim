import { useEffect, useMemo, useRef, useState } from "react"
import type { MockMessageBus } from "../mock/bus"
import { DEFAULT_EMOTION_SEQUENCE, playSequence } from "../mock/events"

function eventColor(event: string, dark: boolean): string {
  if (event.startsWith("interaction")) return dark ? "#4fc3f7" : "#0288d1"
  if (event.startsWith("state") || event === "scene:state") return dark ? "#81c784" : "#388e3c"
  if (event.startsWith("emotion")) return dark ? "#ce93d8" : "#7b1fa2"
  if (event.startsWith("scene:")) return dark ? "#80cbc4" : "#00897b"
  return dark ? "#888" : "#888"
}

export function DebugPanel({ bus, dark }: { bus: MockMessageBus; dark: boolean }) {
  const [log, setLog] = useState<ReturnType<MockMessageBus["getLog"]>>([])
  const [playing, setPlaying] = useState(false)
  const [filter, setFilter] = useState("")
  const [groupByType, setGroupByType] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setLog([...bus.getLog()]), 200)
    return () => clearInterval(id)
  }, [bus])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [log])

  const filtered = useMemo(() => {
    if (!filter.trim()) return log
    const q = filter.toLowerCase()
    return log.filter(
      (e) =>
        e.event.toLowerCase().includes(q) ||
        JSON.stringify(e.args).toLowerCase().includes(q),
    )
  }, [log, filter])

  const grouped = useMemo(() => {
    if (!groupByType) return null
    const groups: Record<string, typeof log> = {}
    for (const entry of filtered) {
      const type = entry.event.split(":")[0] || "other"
      if (!groups[type]) groups[type] = []
      groups[type].push(entry)
    }
    return groups
  }, [filtered, groupByType])

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontSize: 11,
        fontFamily: "monospace",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          gap: 3,
          padding: "4px 7px",
          borderBottom: `1px solid ${dark ? "#1e1e28" : "#eee"}`,
          background: dark ? "#0d0d12" : "#fafafa",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 50,
            padding: "2px 5px",
            background: dark ? "#1c1c26" : "#fff",
            border: `1px solid ${dark ? "#2a2a35" : "#ddd"}`,
            borderRadius: 3,
            color: dark ? "#ccc" : "#333",
            fontSize: 9,
            fontFamily: "monospace",
            outline: "none",
          }}
        />
        <button
          onClick={() => bus.clearLog()}
          style={{
            padding: "2px 5px",
            background: dark ? "#2a2a35" : "#eee",
            border: `1px solid ${dark ? "#333" : "#ddd"}`,
            borderRadius: 3,
            color: dark ? "#aaa" : "#555",
            cursor: "pointer",
            fontSize: 9,
          }}
        >
          Clear
        </button>
        <button
          onClick={() => {
            setPlaying(true)
            playSequence(bus, DEFAULT_EMOTION_SEQUENCE)
            setTimeout(() => setPlaying(false), 13500)
          }}
          disabled={playing}
          style={{
            padding: "2px 5px",
            background: playing
              ? dark ? "#333" : "#ddd"
              : dark ? "#2d4a3e" : "#c8e6c9",
            border: `1px solid ${dark ? "#444" : "#ccc"}`,
            borderRadius: 3,
            color: playing
              ? dark ? "#555" : "#999"
              : dark ? "#ccc" : "#333",
            cursor: "pointer",
            fontSize: 9,
          }}
        >
          {playing ? "Playing…" : "▶ Emotion"}
        </button>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            color: dark ? "#777" : "#888",
            cursor: "pointer",
            fontSize: 9,
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={groupByType}
            onChange={(e) => setGroupByType(e.target.checked)}
            style={{ margin: 0, width: 10, height: 10 }}
          />
          Group
        </label>
      </div>

      {/* Event list */}
      <div style={{ flex: 1, overflow: "auto", padding: "2px 0" }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: "14px 10px",
              color: dark ? "#333" : "#bbb",
              textAlign: "center",
              fontSize: 10,
            }}
          >
            {log.length === 0 ? "No events yet" : "No matching events"}
          </div>
        )}

        {groupByType && grouped
          ? Object.entries(grouped).map(([type, entries]) => (
              <div key={type}>
                <div
                  style={{
                    padding: "2px 9px",
                    background: dark ? "#1c1c26" : "#f0f0f4",
                    borderBottom: `1px solid ${dark ? "#1e1e28" : "#eee"}`,
                    color: dark ? "#888" : "#999",
                    fontWeight: 600,
                    fontSize: 9,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  {type} · {entries.length}
                </div>
                {entries.map((e, i) => (
                  <EventRow key={`${type}-${i}`} event={e} dark={dark} />
                ))}
              </div>
            ))
          : filtered.map((e, i) => <EventRow key={i} event={e} dark={dark} />)}

        <div ref={endRef} />
      </div>
    </div>
  )
}

function EventRow({
  event,
  dark,
}: {
  event: { event: string; args: any[]; ts: number }
  dark: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const color = eventColor(event.event, dark)
  const shortArgs = event.args
    .map((a) => {
      if (typeof a === "object") return JSON.stringify(a).slice(0, 80)
      return String(a).slice(0, 80)
    })
    .join(", ")

  return (
    <div
      style={{
        padding: "2px 9px",
        borderBottom: `1px solid ${dark ? "#14141c" : "#f0f0f4"}`,
        cursor: "pointer",
        userSelect: "none",
      }}
      onClick={() => setExpanded((e) => !e)}
    >
      <div style={{ color, fontWeight: 500, fontSize: 10, display: "flex", alignItems: "baseline", gap: 5 }}>
        <span>{event.event}</span>
        <span
          style={{
            color: dark ? "#444" : "#bbb",
            fontWeight: 400,
            fontSize: 8,
          }}
        >
          {(event.ts / 1000).toFixed(2)}s
        </span>
      </div>
      <div
        style={{
          color: dark ? "#666" : "#999",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontSize: 9,
        }}
      >
        {shortArgs}
      </div>
      {expanded && (
        <pre
          style={{
            margin: "3px 0 0",
            padding: "3px 5px",
            background: dark ? "#0d0d12" : "#fafafa",
            borderRadius: 2,
            fontSize: 8,
            lineHeight: 1.3,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            color: dark ? "#888" : "#aaa",
            maxHeight: 160,
            overflow: "auto",
          }}
        >
          {event.args.map((a, i) => `${i}: ${JSON.stringify(a, null, 2)}`).join("\n\n")}
        </pre>
      )}
    </div>
  )
}
