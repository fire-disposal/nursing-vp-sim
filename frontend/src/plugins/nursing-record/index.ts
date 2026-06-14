import { ClipboardList } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { NURSING_RECORD_SHEET_CONFIG } from "./config";
import { NursingRecordPanel } from "./NursingRecordPanel";

export { ITEM_COMPONENTS } from "./items/registry";

const TOTAL_ITEMS = NURSING_RECORD_SHEET_CONFIG.sections.reduce(
	(sum, s) => sum + s.items.length,
	0,
);

function countFilled(
	data: Record<string, Record<string, unknown>>,
): number {
	let count = 0;
	for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
		const sectionData = data[section.key] || {};
		for (const item of section.items) {
			const val = sectionData[item.key];
			if (val !== undefined && val !== null && val !== "") count++;
		}
	}
	return count;
}

export default definePlugin({
	id: "nursing-record",
	meta: { name: "护理记录", description: "填写护理检查单" },
	tab: {
		icon: ClipboardList,
		label: "护理记录",
		priority: 4,
		badge: (ctx) => {
			try {
				const raw = localStorage.getItem(
					`nursing_record_sheet_${ctx.recordId}`,
				);
				const data = raw ? JSON.parse(raw) : {};
				const filled = countFilled(data);
				return {
					text: `${filled}/${TOTAL_ITEMS}`,
					variant: "default",
				};
			} catch {
				return null;
			}
		},
	},
	component: NursingRecordPanel,
});
