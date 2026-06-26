import { useMemo, useState } from "react";
import { cn } from "@/utils/cn";
import Reveal from "../components/Reveal";
import SectionHeading from "../components/SectionHeading";

const STAGES = [
	{
		label: "代码提交",
		accent: "bg-violet-500",
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
		accent: "bg-cyan-500",
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
		accent: "bg-amber-500",
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
		accent: "bg-pink-500",
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
		accent: "bg-rose-500",
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
		accent: "bg-purple-500",
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
		accent: "bg-emerald-500",
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
		<section className="mx-auto max-w-7xl px-6 py-24">
			<SectionHeading eyebrow="工程化底座" title="全自动交付流水线" className="mb-12" />

			<Reveal>
				<div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.55)] md:p-8">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(13,148,136,0.05),transparent_50%),radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.04),transparent_50%)]" />

					<div className="relative z-10 grid gap-6 md:grid-cols-[240px_1fr]">
						<div className="space-y-1.5">
							<div className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">CI/CD Pipeline</div>
							{STAGES.map((s, i) => (
								<button
									key={s.label}
									type="button"
									onClick={() => setActive(i)}
									className={cn(
										"flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition-all",
										active === i
											? "border-primary/40 bg-primary/[0.06] text-primary"
											: "border-transparent text-foreground/70 hover:border-border/60 hover:bg-background/50",
									)}
								>
									<div className={cn("size-2 shrink-0 rounded-full", s.accent)} />
									{s.label}
								</button>
							))}
						</div>

						<div className="rounded-2xl border border-border/50 bg-muted/20 p-5 md:p-6">
							<div className="mb-4 flex items-center gap-3">
								<div className={cn("size-2.5 rounded-full", stage.accent)} />
								<div>
									<div className="text-lg font-bold text-foreground">{stage.label}</div>
									<div className="text-xs text-muted-foreground">Step {active + 1} / {STAGES.length}</div>
								</div>
							</div>
							<p className="text-sm leading-relaxed text-muted-foreground">{stage.desc}</p>

						<div className="mt-5 grid grid-cols-2 gap-3">
								{stage.chips.map((chip) => (
									<div key={chip.k} className="rounded-xl border border-border/50 bg-background/50 px-3 py-2.5 text-xs">
										<span className="font-semibold text-foreground/80">{chip.k}</span>
										<span className="text-muted-foreground"> {chip.v}</span>
									</div>
								))}
							</div>
						</div>
					</div>
				</div>
			</Reveal>
		</section>
	);
}
