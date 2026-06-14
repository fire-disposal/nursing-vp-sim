import { Image } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { PortraitTab } from "./PortraitTab";

export default definePlugin({
	id: "portrait",
	meta: { name: "患者立绘", description: "高级患者表情立绘" },
	tab: { icon: Image, label: "患者立绘", priority: 7 },
	component: PortraitTab,
});
