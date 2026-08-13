import { Badge, Box, Group, Paper, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import { useMemo, useState } from "react";

type Stage = {
	label: string;
	detail: string;
	accent: string;
	subDetails: string[];
};

const STAGES: Stage[] = [
	{
		label: "Guard",
		detail: "权限 / 场景 / 输入校验",
		accent: "cyan",
		subDetails: ["用户身份验证与角色鉴权", "训练场景参数合法性检查", "对话内容安全过滤与长度限制"],
	},
	{
		label: "Prompt",
		detail: "上下文装配 / 角色注入",
		accent: "violet",
		subDetails: ["加载患者人设、病史与性格特征", "拼接历史对话与当前情绪状态", "组合系统指令、评分标准与输出格式"],
	},
	{
		label: "LLM",
		detail: "角色扮演 / 信息逐步披露",
		accent: "blue",
		subDetails: ["模拟患者语气、用词与情绪反应", "按信任度逐步暴露隐藏病史信息", "根据等待时长与沟通质量主动追问"],
	},
	{
		label: "Memory",
		detail: "状态 / 情绪 / 病史写回",
		accent: "orange",
		subDetails: ["更新患者信任值与舒适度坐标", "已披露病史持久化写入数据库", "完整对话记录归档与增量索引"],
	},
	{
		label: "SSE",
		detail: "流式评分 / 证据回传",
		accent: "pink",
		subDetails: ["逐维度评分结果实时推送", "每项评分附带对话原文引用", "前端逐项展开显示评分与证据"],
	},
	{
		label: "Effects",
		detail: "记录 / 结算 / 通知",
		accent: "indigo",
		subDetails: ["生成结构化训练报告与建议", "评分完成后推送结算提醒", "自动生成个性化复习方向"],
	},
];

export default function ProcessPipeline() {
	const [active, setActive] = useState(2);
	const stage = useMemo(() => STAGES[active], [active]);

	return (
		<Paper withBorder radius="md" p="lg" pos="relative" style={{ overflow: "hidden" }}>
			<Group justify="space-between" gap="md" pos="relative" style={{ zIndex: 10 }}>
				<Stack gap={4}>
					<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
						数据流管道
					</Text>
					<Text size="lg" fw={700}>
						守卫 → 提示 → 模型 → 记忆 → 流式反馈
					</Text>
				</Stack>
				<Badge variant="default" radius="xl">
					hover / click
				</Badge>
			</Group>

			<SimpleGrid cols={{ base: 1, md: 6 }} spacing="sm" mt="lg" pos="relative" style={{ zIndex: 10 }}>
				{STAGES.map((item, index) => {
					const isActive = index === active;
					const isPast = index < active;
					return (
						<Paper
							key={item.label}
							component="button"
							onMouseEnter={() => setActive(index)}
							onFocus={() => setActive(index)}
							onClick={() => setActive(index)}
							p="md"
							px="sm"
							radius="md"
							style={{
								position: "relative",
								textAlign: "left",
								cursor: "pointer",
								transition: "all 300ms",
								opacity: isPast && !isActive ? 0.9 : 1,
								transform: isActive ? "scale(1.03)" : undefined,
								border: isActive
									? "1px solid var(--mantine-primary-color-4)"
									: "1px solid var(--mantine-color-default-border)",
								background: isActive
									? "var(--mantine-color-body)"
									: "var(--mantine-color-gray-0)",
								boxShadow: isActive ? "var(--mantine-shadow-md)" : undefined,
							}}
						>
							<ThemeIcon
								size={40}
								radius="md"
								variant="filled"
								color={item.accent}
								mb="md"
							>
								<Text size="sm" fw={700} c="white">
									{index + 1}
								</Text>
							</ThemeIcon>
							<Text size="sm" fw={700}>
								{item.label}
							</Text>
							<Text size="xs" c="dimmed" mt={4} lh={1.6}>
								{item.detail}
							</Text>
						</Paper>
					);
				})}
			</SimpleGrid>

			<Paper
				withBorder
				radius="md"
				p="lg"
				mt="lg"
				pos="relative"
				style={{ zIndex: 10, background: "var(--mantine-color-gray-0)" }}
			>
				<Group justify="space-between" gap="md">
					<Stack gap={4}>
						<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.3em" }}>
							当前焦点
						</Text>
						<Text size="xl" fw={700}>
							{stage.label}
						</Text>
					</Stack>
					<Box
						h={10}
						w={112}
						style={{
							borderRadius: "9999px",
							background: `var(--mantine-color-${stage.accent}-6)`,
						}}
					/>
				</Group>
				<SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm" mt="md">
					{stage.subDetails.map((text, index) => (
						<Paper
							key={text}
							withBorder
							radius="md"
							p="md"
							style={{ background: "var(--mantine-color-gray-0)" }}
						>
							<Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.25em" }}>
								0{index + 1}
							</Text>
							<Text size="sm" fw={500} mt={8}>
								{text}
							</Text>
						</Paper>
					))}
				</SimpleGrid>
			</Paper>
		</Paper>
	);
}
