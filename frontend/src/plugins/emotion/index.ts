import { Smile } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { EmotionTab } from "./EmotionTab";

export default definePlugin({
	id: "emotion",
	meta: { name: "情绪状态", description: "患者情绪状态机追踪" },
	tab: { icon: Smile, label: "情绪状态", priority: 5 },
	component: EmotionTab,
});
