import { useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import type { SceneCardProps, SceneMeta } from "../scene-types"
import NotesCard from "./cards/NotesCard"

export default function CardNotes() {
  const [bus] = useState(() => createMockBus())
  return <NotesCard bus={bus as MessageBus} mode="sandbox" recordId="sandbox" />
}
export const sceneMeta: SceneMeta = {
  id: "card-notes", name: "卡片: 笔记", description: "笔记场景卡片", icon: "📝",
  size: { w: 280, h: 240 },
}
