import { useMemo } from "react";
import { Avatar, Box, Group, Stack, Text } from "@mantine/core";
import { Card } from "@/components/ui/card";
import { useTrainingStore } from "@/stores/trainingStore";
import type { PatientData } from "@/engine/types";
import { getPatientAvatar, safeAvatarUrl } from "@/utils/avatar";
import { getQuickPrompts } from "./quick-prompts";

interface WelcomeScreenProps {
	patient: PatientData;
	onQuickPrompt?: (text: string) => void;
	capabilities?: Record<string, boolean>;
}

export function WelcomeScreen({ patient, onQuickPrompt, capabilities = {} }: WelcomeScreenProps) {
	const portraitUrl = useTrainingStore((s) => s.portraitUrl);
	const fallbackAvatar = getPatientAvatar({ name: patient.name, gender: patient.gender });
	const avatarSrc = safeAvatarUrl(portraitUrl, fallbackAvatar);

	const genderLabel = patient.gender === "male" ? "男" : "女";
	const ageLabel = patient.age ? `${patient.age}岁` : "";
	const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

	const flowSteps = useMemo(() => {
		const steps = ["问诊采集"];
		if (capabilities.physical_exam) steps.push("护理查体");
		if (capabilities.nursing_record) steps.push("护理记录");
		steps.push("结束评分");
		return steps;
	}, [capabilities]);

	const quickPrompts = useMemo(
		() => getQuickPrompts(patient),
		[patient],
	);

	return (
		<Box px="xs" py="md" mx="auto" w="100%" maw={768}>
			<Card p="xl">
				<Stack gap="md">
					<Group gap="md" wrap="nowrap">
						<Avatar src={avatarSrc} alt={patient.name} size={56} radius="xl" />
						<Box style={{ minWidth: 0 }}>
							<Text fw={700} truncate>{patient.name}</Text>
							<Text size="sm" c="dimmed">{subInfo}</Text>
							{patient.chiefComplaint && (
								<Text size="xs" c="dimmed" mt={2} truncate>主诉：{patient.chiefComplaint}</Text>
							)}
						</Box>
					</Group>

					<Group gap={8} wrap="wrap">
						{flowSteps.map((label, i) => (
							<Group key={label} gap={6} wrap="nowrap">
								<Box
									w={16}
									h={16}
									style={{
										borderRadius: 999,
										background: "var(--mantine-primary-color-light)",
										color: "var(--mantine-primary-color-light-color)",
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: 10,
										fontWeight: 600,
										fontVariantNumeric: "tabular-nums",
									}}
								>
									{i + 1}
								</Box>
								<Text size="xs" c="dimmed">{label}</Text>
							</Group>
						))}
					</Group>

					{onQuickPrompt && (
						<Box
							style={{
								borderRadius: 12,
								border: "1px solid var(--mantine-color-default-border)",
								background: "var(--mantine-color-body)",
								padding: 12,
							}}
						>
							<Text size="xs" fw={500} c="dimmed" mb={8}>建议开场</Text>
							<Group gap={8} wrap="wrap">
								{quickPrompts.map((prompt) => (
									<Box
										key={prompt}
										component="button"
										type="button"
										onClick={() => onQuickPrompt(prompt)}
										style={{
											borderRadius: 999,
											border: "1px solid var(--mantine-color-default-border)",
											background: "var(--mantine-color-body)",
											padding: "6px 12px",
											textAlign: "left",
											fontSize: 12,
											color: "var(--mantine-color-text)",
											cursor: "pointer",
										}}
									>
										{prompt}
									</Box>
								))}
							</Group>
						</Box>
					)}

					<Text
						size="xs"
						c="dimmed"
						style={{ borderTop: "1px solid var(--mantine-color-default-border)", paddingTop: 8, lineHeight: 1.6 }}
					>
						在下方输入框中向患者提问，开始采集病史。完成问诊后点击右上角
						<Text component="span" fw={500} c="var(--mantine-color-text)">"结束训练"</Text>提交评分。
					</Text>
				</Stack>
			</Card>
		</Box>
	);
}
