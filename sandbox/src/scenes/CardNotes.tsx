import { useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import type { SceneCardProps } from "../scene-types"
import NotesCard from "./NotesCard"

export default function CardNotes() {
  const [bus] = useState(() => createMockBus())
  return <NotesCard bus={bus as MessageBus} mode="sandbox" recordId="sandbox" />
}
