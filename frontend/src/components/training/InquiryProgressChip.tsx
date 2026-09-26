// ListChecks（lucide）在 tabler 无同名图标，语义上取 IconListCheck（清单勾选）。
import { IconListCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { useTrainingStore } from "@/stores/trainingStore";
import { INQUIRY_PANEL_ID, useWorkspaceStore } from "@/stores/workspaceStore";
import { computeCovered, PROGRESS_BG, PROGRESS_TEXT, progressColor } from "./tools/inquiryProgress";

export function InquiryProgressChip() {
	const openPanel = useWorkspaceStore((s) => s.openPanel);
	const recordDetail = useTrainingStore((s) => s.recordDetail);
	const messages = useTrainingStore((s) => s.messages);
	const mode = useTrainingStore((s) => s.recordDetail?.mode ?? "guided");

	const inquiries: string[] = useMemo(() => {
		return (recordDetail as { required_inquiries?: string[] })?.required_inquiries ?? [];
	}, [recordDetail]);

	const studentText = useMemo(
		() =>
			messages
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	if (mode !== "guided" || inquiries.length === 0) return null;

	const done = covered.size;
	const total = inquiries.length;
	const band = progressColor(Math.round((done / total) * 100));

	return (
		<Box
			component="button"
			type="button"
			onClick={() => openPanel(INQUIRY_PANEL_ID)}
			title={`问诊任务清单 ${done}/${total}（关键词自检），点击查看`}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 4,
				padding: "2px 6px",
				borderRadius: 6,
				border: "1px solid var(--mantine-color-default-border)",
				background: "var(--mantine-color-body)",
				fontSize: 11,
				color: "var(--mantine-color-dimmed)",
				cursor: "pointer",
				flexShrink: 0,
				transition: "border-color 120ms ease, background 120ms ease",
			}}
			onMouseEnter={(e) => {
				e.currentTarget.style.borderColor = "var(--mantine-color-brand-4)";
				e.currentTarget.style.background = "var(--mantine-color-brand-0)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.borderColor = "var(--mantine-color-default-border)";
				e.currentTarget.style.background = "var(--mantine-color-body)";
			}}
		>
			<IconListCheck size={12} />
			<Text
				component="span"
				size="11px"
				c={PROGRESS_TEXT[band]}
				fw={600}
				style={{ fontVariantNumeric: "tabular-nums" }}
			>
				清单 {done}/{total}
			</Text>
			{done < total && (
				<Box w={6} h={6} style={{ borderRadius: 999, background: PROGRESS_BG[band] }} />
			)}
		</Box>
	);
}
