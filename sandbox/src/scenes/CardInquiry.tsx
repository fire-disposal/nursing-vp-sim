import type { SceneMeta, SceneProps } from "../scene-types"
import InquiryCard from "./cards/InquiryCard"

export default function CardInquiry(props: SceneProps) {
  return <InquiryCard bus={props.bus} mode={props.mode} recordId="sandbox" />
}
export const sceneMeta: SceneMeta = {
  id: "card-inquiry", name: "卡片: 问诊清单", description: "问诊清单场景卡片", icon: "📋",
  size: { w: 300, h: 260 },
}
