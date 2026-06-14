import { MessageCircle } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { InitiativeTab } from "./InitiativeTab";

export default definePlugin({
	id: "initiative",
	meta: { name: "主动追问", description: "患者定时主动追问" },
	tab: { icon: MessageCircle, label: "主动追问", priority: 6 },
	component: InitiativeTab,
	hooks: {
		onInit: (ctx) => {
			let stopped = false;
			const interval = setInterval(async () => {
				if (stopped) return;
				try {
					const { getTrainingState } = await import(
						"@/api/training-state"
					);
					const state = await getTrainingState(
						Number(ctx.recordId),
					);
					const initiative = state.data.initiative;
					ctx.bus.emit("initiative:state", initiative);
					if ((initiative as any)?.should_trigger) {
						const { triggerInitiative } = await import(
							"@/api/training-state"
						);
						const res = await triggerInitiative(
							Number(ctx.recordId),
						);
						if (res.data.triggered && res.data.message) {
							ctx.bus.emit("initiative:triggered", {
								content: res.data.message,
							});
						}
					}
				} catch {
					/* ignore poll errors */
				}
			}, 5000);
			const unsub = ctx.bus.on("training:ended", () => {
				stopped = true;
				clearInterval(interval);
			});
			return () => {
				stopped = true;
				clearInterval(interval);
				unsub();
			};
		},
	},
});
