import { MessageCircle } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { InitiativeTab } from "./InitiativeTab";

export default definePlugin({
	id: "initiative",
	meta: { name: "主动追问", description: "患者定时主动追问" },
	tab: { icon: MessageCircle, label: "主动追问", priority: 6 },
	component: InitiativeTab,
	hooks: {},
});
