import { Stethoscope } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { ExamPanel } from "./ExamPanel";

const TOTAL_EXAMS = 8;

export default definePlugin({
	id: "physical-exam",
	meta: { name: "护理查体", description: "通过专属面板执行体检操作" },
	tab: {
		icon: Stethoscope,
		label: "护理查体",
		priority: 3,
		badge: (ctx) => {
			let count = 0;
			for (const msg of ctx.messages) {
				if (msg.role === "system") {
					const stripped = (msg.content ?? "").replace(
						/[:\s]/g,
						"",
					);
					if (
						stripped.includes("生命体征") ||
						stripped.includes("体温") ||
						stripped.includes("心率") ||
						stripped.includes("血压") ||
						stripped.includes("血氧") ||
						stripped.includes("呼吸") ||
						stripped.includes("皮肤") ||
						stripped.includes("疼痛")
					) {
						count++;
					}
				}
			}
			if (count === 0) return null;
			return {
				text: `${count}/${TOTAL_EXAMS}`,
				variant: "default" as const,
			};
		},
	},
	component: ExamPanel,
});
