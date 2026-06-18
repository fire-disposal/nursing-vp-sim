import { ListChecks } from "lucide-react";
import { definePlugin } from "@/engine/types";
import { InquiryTab } from "./InquiryTab";

export default definePlugin({
	id: "inquiry",
	meta: { name: "问诊进度", description: "展示问诊要求完成进度" },
	tab: {
		icon: ListChecks,
		label: "问诊进度",
		priority: 1,
		badge: (ctx) => {
			const inquiries = ctx.patient.requiredInquiries ?? [];
			if (inquiries.length === 0) return null;
			const studentMsgs = ctx.messages.filter(
				(m) => m.role === "student",
			);
			const keywords = inquiries.map((inq) =>
				inq.split(/[,，、\s]+/).filter(Boolean),
			);
			const done = keywords.filter((kws) =>
				kws.some((kw) =>
					studentMsgs.some((m) =>
						(m.content ?? "")
							.toLowerCase()
							.includes(kw.toLowerCase()),
					),
				),
			).length;
			return { text: `${done}/${inquiries.length}`, variant: "default" };
		},
	},
	component: InquiryTab,
});
