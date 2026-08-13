// ListChecks（lucide）在 tabler 无同名图标，语义上取 IconListCheck（清单勾选）。
import { IconListCheck } from "@tabler/icons-react";
import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
import { useTrainingStore } from "@/stores/trainingStore";
import { computeCovered } from "./tools/inquiryProgress";

export function InquiryProgressChip() {
	const bus = useTrainingStore((s) => s.bus);
	const recordDetail = useTrainingStore((s) => s.recordDetail);
	const messages = useTrainingStore((s) => s.messages);

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

	if (inquiries.length === 0) return null;

	const done = covered.size;
	const total = inquiries.length;

	return (
		<Box
			component="button"
			type="button"
			onClick={() => bus!.emit("tool:open", { id: "inquiry" })}
			title={`问诊目标 ${done}/${total}，点击查看指引`}
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
			}}
		>
			<IconListCheck size={12} />
			<Text component="span" size="11px" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
				{done}/{total}
			</Text>
			{done < total && <Box w={6} h={6} style={{ borderRadius: 999, background: "var(--mantine-color-yellow-6)" }} />}
		</Box>
	);
}
