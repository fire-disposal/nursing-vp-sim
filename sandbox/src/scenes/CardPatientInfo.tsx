import { useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import type { SceneCardProps, SceneMeta } from "../scene-types"
import PatientInfoCard from "./cards/PatientInfoCard"

export default function CardPatientInfo() {
  const [bus] = useState(() => createMockBus())
  return <PatientInfoCard bus={bus as MessageBus} mode="sandbox" recordId="sandbox" />
}
export const sceneMeta: SceneMeta = {
  id: "card-patient", name: "卡片: 患者信息", description: "患者信息场景卡片", icon: "👤",
  size: { w: 280, h: 200 },
}
