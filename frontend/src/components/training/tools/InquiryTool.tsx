import { IconCircle, IconCircleCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import { Box, Group, Text } from "@mantine/core";
import { useTrainingStore } from "@/stores/trainingStore";
import type { TrainingToolProps } from "@/engine/TrainingTool";
import type { ChatMessage } from "@/engine/types";
import {
	PROGRESS_BG,
	PROGRESS_TEXT,
	computeCovered,
	getInquiryLabel,
	progressColor,
} from "./inquiryProgress";


export default function InquiryTool(props: TrainingToolProps) {
	const messages = useTrainingStore((s) => s.messages);

	const inquiries = useMemo(
		() => props.recordDetail?.required_inquiries ?? [],
		[props.recordDetail?.required_inquiries],
	);

	const studentText = useMemo(
		() =>
			(messages as ChatMessage[])
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	if (inquiries.length === 0) {
		return <Text size="sm" c="dimmed" ta="center" py={32} px="sm">该病例未配置问诊清单</Text>;
	}

	const doneCount = covered.size;
	const total = inquiries.length;
	const pct = Math.round((doneCount / total) * 100);
	const band = progressColor(pct);

	return (
		<Box p="sm">
			<Box mb="md">
				<Group justify="space-between" mb={4} wrap="nowrap">
					<Text size="xs" c="dimmed">问诊任务清单（关键词自检）</Text>
					<Text size="xs" fw={700} c={PROGRESS_TEXT[band]} style={{ fontVariantNumeric: "tabular-nums" }}>
						{doneCount}/{total}
					</Text>
				</Group>
				<Box
					h={6}
					role="progressbar"
					aria-label="问诊任务完成度"
					aria-valuenow={pct}
					aria-valuemin={0}
					aria-valuemax={100}
					style={{ borderRadius: 999, background: "var(--mantine-color-gray-2)", overflow: "hidden" }}
				>
					<Box
						h="100%"
						style={{
							width: `${pct}%`,
							borderRadius: 999,
							transition: "all 500ms",
							background: PROGRESS_BG[band],
						}}
					/>
				</Box>
			</Box>

			<Box>
				{inquiries.map((inq, i) => {
					const done = covered.has(i);
					return (
						<Group key={i} align="flex-start" gap={8} py={6} wrap="nowrap">
							{done ? (
								<IconCircleCheck size={14} style={{ color: "var(--mantine-color-green-6)", marginTop: 2, flexShrink: 0 }} />
							) : (
								<IconCircle size={14} style={{ color: "var(--mantine-color-gray-4)", marginTop: 2, flexShrink: 0 }} />
							)}
							<Text
								size="sm"
								lh={1.4}
								title={inq}
								style={{ textDecoration: done ? "line-through" : undefined }}
								c={done ? "dimmed" : undefined}
							>
								{getInquiryLabel(inq)}
							</Text>
						</Group>
					);
				})}
			</Box>

			<Text
				size="11px"
				c="dimmed"
				mt="md"
				pt={8}
				lh={1.6}
				style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
			>
				勾选只由关键词推测，可能漏判；交卷与评分不以此为准。请按护理评估框架全面问诊。
			</Text>
		</Box>
	);
}
