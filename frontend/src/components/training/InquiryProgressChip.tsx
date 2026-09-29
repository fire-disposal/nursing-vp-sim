// ListChecks（lucide）在 tabler 无同名图标，语义上取 IconListCheck（清单勾选）。
import { IconBulb, IconListCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { useRecordMeta, useTrainingData } from "@/engine/TrainingDataContext";
import { useTrainingStore } from "@/stores/trainingStore";
import { INQUIRY_PANEL_ID, useWorkspaceStore } from "@/stores/workspaceStore";
import { computeCovered, PROGRESS_BG, PROGRESS_TEXT, parseGuidedHints, progressColor } from "./tools/inquiryProgress";

/**
 * 状态栏的问诊入口 —— 两种形态，都指向同一个面板：
 *
 * - 有引导提示（`guided_hints`）时：只说「有 N 条领域提示」，**不给完成度**——
 *   提示不是清单，按顺序勾完不是要求；
 * - 提示为空时：沿用既有的关键词自检清单进度（仅引导模式）。
 */

const chipStyle = {
	display: "flex",
	alignItems: "center",
	gap: 4,
	padding: "2px 6px",
	borderRadius: 6,
	border: "1px solid var(--mantine-color-default-border)",
	background: "var(--mantine-color-body)",
	fontSize: 12,
	color: "var(--mantine-color-dimmed)",
	cursor: "pointer",
	flexShrink: 0,
	transition: "border-color 120ms ease, background 120ms ease",
} as const;

function useChipHover() {
	return {
		onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
			e.currentTarget.style.borderColor = "var(--mantine-color-brand-outline)";
			e.currentTarget.style.background = "var(--mantine-color-brand-light)";
		},
		onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
			e.currentTarget.style.borderColor = "var(--mantine-color-default-border)";
			e.currentTarget.style.background = "var(--mantine-color-body)";
		},
	};
}

export function InquiryProgressChip() {
	const openPanel = useWorkspaceStore((s) => s.openPanel);
	const record = useTrainingData();
	const { mode, requiredInquiries } = useRecordMeta();
	const messages = useTrainingStore((s) => s.messages);
	const hints = useMemo(() => parseGuidedHints(record?.guided_hints), [record]);
	const hover = useChipHover();

	const studentText = useMemo(
		() =>
			messages
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(
		() => computeCovered(requiredInquiries, studentText),
		[requiredInquiries, studentText],
	);

	// 盲盒/独立考核不出现任何提示入口
	if (mode !== "guided") return null;

	// 引导提示优先：只说明还有哪些领域需要弄清，不假装是进度
	if (hints.length > 0) {
		return (
			<Box
				component="button"
				type="button"
				onClick={() => openPanel(INQUIRY_PANEL_ID)}
				title={`引导提示 ${hints.length} 条（领域与评估意义），点击查看`}
				aria-label={`引导提示 ${hints.length} 条`}
				style={chipStyle}
				{...hover}
			>
				<IconBulb size={12} />
				<Text component="span" size="sm" c="yellow.7" fw={600} style={{ fontVariantNumeric: "tabular-nums" }}>
					提示 {hints.length}
				</Text>
			</Box>
		);
	}

	if (requiredInquiries.length === 0) return null;

	const done = covered.size;
	const total = requiredInquiries.length;
	const band = progressColor(Math.round((done / total) * 100));

	return (
		<Box
			component="button"
			type="button"
			onClick={() => openPanel(INQUIRY_PANEL_ID)}
			title={`问诊任务清单 ${done}/${total}（关键词自检），点击查看`}
			style={chipStyle}
			{...hover}
		>
			<IconListCheck size={12} />
			<Text
				component="span"
				size="sm"
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
