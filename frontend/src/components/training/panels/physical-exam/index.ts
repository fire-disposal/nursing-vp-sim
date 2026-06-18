import { Stethoscope } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { ExamPanel } from "./ExamPanel";

function countTotalOps(anchors: Record<string, unknown> | undefined): number {
	if (!anchors) return 0;
	const groups = (anchors as any).groups as Array<{ ops: unknown[] }> | undefined;
	if (Array.isArray(groups)) {
		return groups.reduce((sum, g) => sum + g.ops.length, 0);
	}
	let total = 0;
	const vs = anchors.vital_signs as Record<string, unknown> | undefined;
	if (vs) total += Object.keys(vs).length;
	if (anchors.skin) total++;
	if (anchors.pain_score !== undefined) total++;
	return total;
}

export default definePlugin({
	id: "physical-exam",
	meta: { name: "护理查体", description: "通过专属面板执行体检操作" },
	tab: {
		icon: Stethoscope,
		label: "护理查体",
		priority: 3,
		badge: (ctx) => {
			const totalOps = countTotalOps(ctx.patient?.examAnchors);
			if (totalOps === 0) return null;

			let count = 0;
			const seen = new Set<string>();
			for (const msg of ctx.messages) {
				if (msg.examResult?.type && !seen.has(msg.examResult.type)) {
					seen.add(msg.examResult.type);
					count++;
					continue;
				}
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
						const key = stripped.slice(0, 6);
						if (!seen.has(key)) {
							seen.add(key);
							count++;
						}
					}
				}
			}
			if (count === 0) return null;
			return {
				text: `${count}/${totalOps}`,
				variant: "default" as const,
			};
		},
	},
	component: ExamPanel,
});
