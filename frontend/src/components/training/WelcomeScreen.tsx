import { useMemo } from "react";
import { Avatar, Badge, Box, Group, Stack, Text } from "@mantine/core";
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

/**
 * WelcomeScreen — 问诊开场：患者卡片 + 训练流程 + 建议开场。
 * 以"接诊第一眼"呈现患者信息，帮助学生快速进入角色。
 */
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
			<Card p={{ base: "md", sm: "xl" }}>
				<Stack gap="lg">
					{/* 患者卡：头像背板 + 姓名 + 主诉 */}
					<Group gap="md" wrap="nowrap" align="center">
						<Box
							style={{
								borderRadius: "var(--mantine-radius-lg)",
								padding: 10,
								background:
									"radial-gradient(120% 100% at 50% 0%, var(--mantine-color-brand-0) 0%, var(--mantine-color-body) 75%)",
								border: "1px solid var(--mantine-color-brand-1)",
								flexShrink: 0,
							}}
						>
							<Avatar src={avatarSrc} alt={patient.name} size={64} radius="lg" />
						</Box>
						<Box style={{ minWidth: 0 }}>
							<Text fw={700} size="lg" lh={1.3} truncate>
								{patient.name}
							</Text>
							<Group gap={6} mt={2} wrap="nowrap">
								<Text size="sm" c="dimmed">
									{subInfo}
								</Text>
								{patient.chiefComplaint && (
									<Badge
										variant="light"
										color="brand"
										size="sm"
										style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
									>
										主诉：{patient.chiefComplaint}
									</Badge>
								)}
							</Group>
						</Box>
					</Group>

					{/* 训练流程 */}
					<Group gap={8} wrap="wrap">
						{flowSteps.map((label, i) => (
							<Group
								key={label}
								gap={6}
								wrap="nowrap"
								style={{
									borderRadius: 999,
									border: "1px solid var(--mantine-color-default-border)",
									background: "var(--mantine-color-gray-0)",
									padding: "3px 10px 3px 6px",
								}}
							>
								<Box
									w={18}
									h={18}
									style={{
										borderRadius: 999,
										background: "var(--mantine-primary-color-filled)",
										color: "var(--mantine-primary-color-contrast)",
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										fontSize: 10,
										fontWeight: 700,
										fontVariantNumeric: "tabular-nums",
									}}
								>
									{i + 1}
								</Box>
								<Text size="xs" c="dimmed" fw={500}>
									{label}
								</Text>
							</Group>
						))}
					</Group>

					{onQuickPrompt && (
						<Box>
							<Text size="xs" fw={600} c="dimmed" mb={8}>
								建议开场
							</Text>
							<Group gap={8} wrap="wrap">
								{quickPrompts.map((prompt) => (
									<Box
										key={prompt}
										component="button"
										type="button"
										onClick={() => onQuickPrompt(prompt)}
										style={{
											borderRadius: 999,
											border: "1px solid var(--mantine-color-brand-3)",
											background: "var(--mantine-color-brand-0)",
											padding: "7px 14px",
											textAlign: "left",
											fontSize: 12,
											color: "var(--mantine-color-brand-8)",
											cursor: "pointer",
											transition: "background 120ms ease, border-color 120ms ease",
										}}
										onMouseEnter={(e) => { e.currentTarget.style.background = "var(--mantine-color-brand-1)"; }}
										onMouseLeave={(e) => { e.currentTarget.style.background = "var(--mantine-color-brand-0)"; }}
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
						style={{ borderTop: "1px solid var(--mantine-color-default-border)", paddingTop: 12, lineHeight: 1.6 }}
					>
						在下方输入框中向患者提问，开始采集病史。完成问诊后点击右上角
						<Text component="span" fw={500} c="var(--mantine-color-text)">"结束训练"</Text>提交评分。
					</Text>
				</Stack>
			</Card>
		</Box>
	);
}
