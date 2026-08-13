import { Box, Grid, Group, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import Reveal from "../components/Reveal";
import SectionHeading from "../components/SectionHeading";

const STAGES = [
	{
		label: "代码提交",
		accent: "violet",
		desc: "每次 git push 自动触发代码质量检查：类型校验（TypeScript/Python）、格式规范（Biome/Ruff）、提交信息格式校验。",
		chips: [
			{ k: "类型检查", v: "tsc + ty" },
			{ k: "代码格式", v: "biome + ruff" },
			{ k: "提交规范", v: "emoji + type" },
			{ k: "问题拦截", v: "不进仓库" },
		],
	},
	{
		label: "迁移验证",
		accent: "cyan",
		desc: "数据库结构变更由工具自动生成（Alembic），禁止手写 DDL。每次推送前在临时数据库完成双向升级/降级往返校验，杜绝迁移漂移。",
		chips: [
			{ k: "DDL 生成", v: "自动建表改表" },
			{ k: "数据迁移", v: "独立手工管理" },
			{ k: "往返校验", v: "临时库升降级" },
			{ k: "单头防分叉", v: "禁止多分支" },
		],
	},
	{
		label: "构建镜像",
		accent: "yellow",
		desc: "前后端分别打包为 Docker 镜像，支持 x86 和 ARM 双架构，推送至 GitHub 容器仓库。利用缓存加速，构建通常在 2 分钟内完成。",
		chips: [
			{ k: "容器化", v: "Docker 镜像" },
			{ k: "多架构", v: "amd64 + arm64" },
			{ k: "镜像仓库", v: "GitHub GHCR" },
			{ k: "缓存加速", v: "分钟级构建" },
		],
	},
	{
		label: "测试部署",
		accent: "pink",
		desc: "打 Tag 自动部署到测试服务器 test.205716.xyz。部署后自动健康检查，不健康则秒级回滚。测试人员按核对单逐项验证，通过后放行。",
		chips: [
			{ k: "自动触发", v: "Tag push" },
			{ k: "健康检查", v: "60 秒循环" },
			{ k: "失败回滚", v: "秒级恢复" },
			{ k: "人工核验", v: "核对单放行" },
		],
	},
	{
		label: "智能守护",
		accent: "red",
		desc: "内置诊断面板，实时监控服务健康：LLM 调用成功率、评分任务积压、活跃会话数。异常指标自动告警，触发 Agent 诊断与修复建议。",
		chips: [
			{ k: "运维面板", v: "一键诊断" },
			{ k: "异常告警", v: "自动通知" },
			{ k: "Agent 修复", v: "智能诊断" },
			{ k: "错误日志", v: "环缓冲追溯" },
		],
	},
	{
		label: "AI 治理",
		accent: "grape",
		desc: "项目结构针对 AI 编码友好设计：AGENTS.md 全局约束、TypeScript/Python 双类型检查、自动生成文件只读保护、API 变更自动检测，确保人与 AI 协作安全可控。",
		chips: [
			{ k: "AGENTS.md", v: "全局约束规范" },
			{ k: "类型安全", v: "双语言全覆盖" },
			{ k: "只读保护", v: "自动生成文件" },
			{ k: "变更检测", v: "check:api 门禁" },
		],
	},
	{
		label: "生产发布",
		accent: "green",
		desc: "测试服验证通过后，手动触发部署至 iomt.205716.xyz。部署前自动备份数据库，部署后健康检查失败秒级回滚，全程零停机。",
		chips: [
			{ k: "版本门禁", v: "测试服一致" },
			{ k: "自动备份", v: "部署前全量" },
			{ k: "秒级回滚", v: "失败自恢复" },
			{ k: "零停机", v: "滚动更新" },
		],
	},
];

export default function EngineeringBand() {
	const [active, setActive] = useState(0);
	const stage = useMemo(() => STAGES[active], [active]);

	return (
		<Box component="section" mx="auto" px="md" py={96} style={{ maxWidth: "80rem" }}>
			<SectionHeading eyebrow="工程化底座" title="全自动交付流水线" mb={48} />

			<Reveal>
				<Paper withBorder radius="xl" p={{ base: "lg", md: "xl" }} pos="relative" style={{ overflow: "hidden" }}>
					<Grid gap="lg" pos="relative" style={{ zIndex: 10 }}>
						<Grid.Col span={{ base: 12, md: 3 }}>
							<Stack gap={6}>
								<Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={8} style={{ letterSpacing: "0.25em" }}>
									CI/CD Pipeline
								</Text>
								{STAGES.map((s, i) => (
									<Group
										key={s.label}
										component="button"
										onClick={() => setActive(i)}
										gap={12}
										px="md"
										py={12}
										wrap="nowrap"
										style={{
											width: "100%",
											textAlign: "left",
											cursor: "pointer",
											borderRadius: "var(--mantine-radius-md)",
											transition: "all 200ms",
											border: active === i
												? "1px solid var(--mantine-primary-color-4)"
												: "1px solid transparent",
											background: active === i
												? "var(--mantine-primary-color-light)"
												: "transparent",
											color: active === i
												? "var(--mantine-primary-color-light-color)"
												: "var(--mantine-color-dimmed)",
										}}
									>
										<Box
											style={{
												width: 8,
												height: 8,
												borderRadius: "50%",
												background: `var(--mantine-color-${s.accent}-6)`,
												flexShrink: 0,
											}}
										/>
										<Text size="sm" fw={600}>
											{s.label}
										</Text>
									</Group>
								))}
							</Stack>
						</Grid.Col>

						<Grid.Col span={{ base: 12, md: 9 }}>
							<Box
								p={{ base: "lg", md: "xl" }}
								style={{
									border: "1px solid var(--mantine-color-default-border)",
									borderRadius: "var(--mantine-radius-md)",
									background: "var(--mantine-color-gray-0)",
								}}
							>
								<Group gap={12} mb="md">
									<Box
										style={{
											width: 10,
											height: 10,
											borderRadius: "50%",
											background: `var(--mantine-color-${stage.accent}-6)`,
										}}
									/>
									<Box>
										<Text size="lg" fw={700}>
											{stage.label}
										</Text>
										<Text size="xs" c="dimmed">
											Step {active + 1} / {STAGES.length}
										</Text>
									</Box>
								</Group>
								<Text size="sm" c="dimmed" lh={1.6}>
									{stage.desc}
								</Text>

								<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="lg">
									{stage.chips.map((chip) => (
										<Box
											key={chip.k}
											px="sm"
											py={10}
											style={{
												border: "1px solid var(--mantine-color-default-border)",
												borderRadius: "var(--mantine-radius-md)",
												background: "var(--mantine-color-body)",
											}}
										>
											<Text size="xs">
												<Text span fw={600}>
													{chip.k}
												</Text>
												<Text span c="dimmed">
													{" "}
													{chip.v}
												</Text>
											</Text>
										</Box>
									))}
								</SimpleGrid>
							</Box>
						</Grid.Col>
					</Grid>
				</Paper>
			</Reveal>
		</Box>
	);
}
