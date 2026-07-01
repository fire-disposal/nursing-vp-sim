import { useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import type { SceneCardProps } from "../scene-types"
import PatientInfoCard from "./PatientInfoCard"

export default function CardPatientInfo() {
  const [bus] = useState(() => createMockBus())
  return <PatientInfoCard bus={bus as MessageBus} mode="sandbox" recordId="sandbox" />
}
