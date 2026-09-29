import { IconBulb, IconCircle, IconCircleCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { useRecordMeta, useTrainingData } from "@/engine/TrainingDataContext";
import { useTrainingStore } from "@/stores/trainingStore";
import type { ChatMessage } from "@/engine/types";
import {
	PROGRESS_BG,
	PROGRESS_TEXT,
	computeCovered,
	getInquiryLabel,
	parseGuidedHints,
	progressColor,
} from "./inquiryProgress";


/**
 * 内置问诊面板（非 Activity），两种呈现共用一份服务端事实：
 *
 * 1. **引导提示优先**（`record.guided_hints`）：领域 + 评估意义，
 *    不给唯一问句、不要求按顺序完成、不显示完成度。
 * 2. 提示为空时回落到既有的关键词自检清单（`required_inquiries`）。
 *
 * 关键词命中只做学生自检，不参与完成判定；因此本面板不读 manifest、不接面板 props。
 * 非引导模式一律不展示任何提示。
 */
export default function InquiryTool() {
	const messages = useTrainingStore((s) => s.messages);
	const record = useTrainingData();
	const { mode, requiredInquiries: inquiries } = useRecordMeta();
	const hints = useMemo(() => parseGuidedHints(record?.guided_hints), [record]);

	const studentText = useMemo(
		() =>
			(messages as ChatMessage[])
				.filter((m) => m.role === "student")
				.map((m) => String(m.content || ""))
				.join(""),
		[messages],
	);

	const covered = useMemo(() => computeCovered(inquiries, studentText), [inquiries, studentText]);

	// 盲盒/独立考核不披露引导信息（服务端也已置空，这里再守一道）
	if (mode !== "guided") {
		return <Text size="sm" c="dimmed" ta="center" py={32} px="sm">本次训练不提供问诊提示</Text>;
	}

	if (hints.length > 0) {
		return (
			<Box p="sm">
				<Group justify="space-between" mb={8} wrap="nowrap">
					<Text size="xs" c="dimmed" fw={600}>引导提示（领域与评估意义）</Text>
					<Text size="xs" c="dimmed" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
						{hints.length} 个领域
					</Text>
				</Group>
				<Stack gap={10}>
					{hints.map((hint) => (
						<Group key={hint.clueId || hint.domain} align="flex-start" gap={8} wrap="nowrap">
							<IconBulb
								size={14}
								style={{ color: "var(--mantine-color-yellow-6)", marginTop: 2, flexShrink: 0 }}
							/>
							<Box style={{ minWidth: 0 }}>
								<Text size="sm" fw={500} lh={1.4}>
									{hint.domain}
								</Text>
								{hint.significance && (
									<Text size="xs" c="dimmed" lh={1.5} mt={2}>
										{hint.significance}
									</Text>
								)}
							</Box>
						</Group>
					))}
				</Stack>
				<Text
					size="sm"
					c="dimmed"
					mt="md"
					pt={8}
					lh={1.6}
					style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
				>
					提示只说明还需弄清的领域及其意义，不指定问句、不要求按顺序提问，也不参与评分。
				</Text>
			</Box>
		);
	}

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
					style={{ borderRadius: 999, background: "var(--mantine-color-default-hover)", overflow: "hidden" }}
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
								<IconCircle size={14} style={{ color: "var(--mantine-color-dimmed)", marginTop: 2, flexShrink: 0 }} />
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
				size="sm"
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
