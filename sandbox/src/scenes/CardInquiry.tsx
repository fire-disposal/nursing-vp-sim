import { useState } from "react"
import { createMockBus } from "../mock/bus"
import type { MessageBus } from "../mock/bus"
import type { SceneCardProps } from "../scene-types"
import InquiryCard from "./InquiryCard"

export default function CardInquiry() {
  const [bus] = useState(() => createMockBus())
  return <InquiryCard bus={bus as MessageBus} mode="sandbox" recordId="sandbox" />
}
