import { MessageCircle } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { InitiativeTab } from "./InitiativeTab";

export default definePlugin({
	id: "initiative",
	meta: { name: "患者自主反应", description: "患者根据情绪和等待时间自主反应" },
	tab: { icon: MessageCircle, label: "自主反应", priority: 6 },
	component: InitiativeTab,
	hooks: {},
});
