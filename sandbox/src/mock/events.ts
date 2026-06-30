import type { MockMessageBus } from "./bus"

export interface TimelineEvent {
  event: string
  args: any[]
  delay: number
}

export function playSequence(bus: MockMessageBus, events: TimelineEvent[], onStep?: (i: number, total: number) => void) {
  let total = 0
  for (let i = 0; i < events.length; i++) {
    total += events[i].delay
    const idx = i
    setTimeout(() => {
      bus.emit(events[idx].event, ...events[idx].args)
      onStep?.(idx + 1, events.length)
    }, total)
  }
}

export const DEFAULT_EMOTION_SEQUENCE: TimelineEvent[] = [
  { event: "emotion:changed", args: [{ state: "neutral", trust: 50, comfort: 50 }], delay: 500 },
  { event: "scene:state", args: [{ patient: { position: "sitting" } }], delay: 2000 },
  { event: "emotion:changed", args: [{ state: "anxious", trust: 40, comfort: 35 }], delay: 3000 },
  { event: "scene:state", args: [{ vitals: { hr: 98, bp: "130/85" } }], delay: 2000 },
  { event: "emotion:changed", args: [{ state: "relaxed", trust: 70, comfort: 65 }], delay: 4000 },
  { event: "scene:state", args: [{ patient: { position: "lying" } }], delay: 2000 },
]
