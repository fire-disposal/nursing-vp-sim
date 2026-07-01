import type { SceneProps } from "../scene-types"
import InquiryCard from "./InquiryCard"

export default function CardInquiry(props: SceneProps) {
  return <InquiryCard bus={props.bus} mode={props.mode} recordId="sandbox" />
}
