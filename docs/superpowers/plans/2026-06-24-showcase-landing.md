# 展示落地页（Showcase Landing）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有前端 SPA 内新增一个公开匿名可访问的 `/showcase` 技术亮点展示页，含 GSAP 视差/滚动动效，所有亮点措辞严格对齐当前 HEAD 真实实现。

**Architecture:** 纯前端改动。新增 `frontend/src/pages/showcase/` 目录（页面根 + 复用布局组件 + 数据驱动的亮点内容 + GSAP 动效），在 `App.tsx` 的 `ProtectedRoute` 外层注册公开路由。页面经 `React.lazy` 懒加载，GSAP 仅落在 showcase chunk，不进主包。不改后端 / nginx / CICD。

**Tech Stack:** React 19 + react-router-dom v7 + Tailwind v4（语义 token）+ lucide-react（已有）+ Geist 字体（已有 `@fontsource-variable/geist`）+ GSAP ScrollTrigger（新增）。测试 Vitest + @testing-library/react（已有）。

**参考 spec:** `docs/superpowers/specs/2026-06-24-showcase-landing-design.md`

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `frontend/src/pages/showcase/lib/gsap.ts` | 集中注册 ScrollTrigger + `prefersReducedMotion` / `gsap.matchMedia` 辅助 |
| `frontend/src/pages/showcase/data.ts` | 全部展示文案（亮点 / 概览 / 工程化 / 技术栈 / CTA），严格对齐 spec §2 |
| `frontend/src/pages/showcase/components/ScreenshotPlaceholder.tsx` | 系统截图占位符（用户授权例外） |
| `frontend/src/pages/showcase/components/Reveal.tsx` | IntersectionObserver 滚动揭示，reduced-motion 感知 |
| `frontend/src/pages/showcase/components/SectionHeading.tsx` | 统一段落标题（含 eyebrow 节制） |
| `frontend/src/pages/showcase/components/layouts/FeatureSplit.tsx` | 图文左右分栏布局家族 |
| `frontend/src/pages/showcase/components/layouts/FeatureFull.tsx` | 全宽特性布局家族 |
| `frontend/src/pages/showcase/sections/TopBar.tsx` | 顶栏 + CTA |
| `frontend/src/pages/showcase/sections/Hero.tsx` | Hero + GSAP 多层视差 |
| `frontend/src/pages/showcase/sections/Overview.tsx` | 概览条带 + 数字 count-up |
| `frontend/src/pages/showcase/sections/Highlights.tsx` | 6 大亮点（数据驱动组合布局，含亮点5 sticky-stack） |
| `frontend/src/pages/showcase/sections/EngineeringBand.tsx` | 工程化底座 chips |
| `frontend/src/pages/showcase/sections/TechStack.tsx` | 技术栈（唯一 marquee）|
| `frontend/src/pages/showcase/sections/FinalCta.tsx` | 底部 CTA + Footer |
| `frontend/src/pages/showcase/ShowcasePage.tsx` | 页面根：导入 Geist、设 title、组合 sections |
| `frontend/src/App.tsx` (修改) | 注册公开路由 `/showcase` |

**测试策略说明：** 这是以视觉/动效为主的落地页，GSAP 动画在 jsdom 中不可单测。因此对**可测单元**（占位符渲染、数据完整性、页面渲染 + CTA 指向、路由可达）写 Vitest 测试；GSAP 动效代码用 `prefersReducedMotion()` / 环境守卫在测试环境 no-op，靠最终人工验收（spec §9）。

---

## Task 1: 新增 gsap 依赖 + GSAP 辅助模块

**Files:**
- Modify: `frontend/package.json`（通过 pnpm 命令）
- Create: `frontend/src/pages/showcase/lib/gsap.ts`

- [ ] **Step 1: 安装 gsap（monorepo root 执行）**

Run:
```bash
pnpm --filter frontend add gsap
```
Expected: `frontend/package.json` 的 `dependencies` 出现 `"gsap": "^3.x"`，`pnpm-lock.yaml` 更新。

- [ ] **Step 2: 创建 GSAP 辅助模块**

Create `frontend/src/pages/showcase/lib/gsap.ts`:
```ts
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

export function ensureGsap() {
	if (!registered && typeof window !== "undefined") {
		gsap.registerPlugin(ScrollTrigger);
		registered = true;
	}
	return { gsap, ScrollTrigger };
}

export function prefersReducedMotion(): boolean {
	return (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function" ||
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export { gsap, ScrollTrigger };
```

- [ ] **Step 3: 类型检查**

Run (in `frontend/`):
```bash
npx tsc --noEmit
```
Expected: PASS（无错误）。

- [ ] **Step 4: 提交**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml "frontend/src/pages/showcase/lib/gsap.ts"
git commit -m "📦 build: 新增 gsap 依赖 + showcase GSAP 辅助模块"
```

---

## Task 2: ScreenshotPlaceholder 组件（TDD）

**Files:**
- Create: `frontend/src/pages/showcase/components/ScreenshotPlaceholder.tsx`
- Test: `frontend/src/pages/showcase/components/ScreenshotPlaceholder.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/pages/showcase/components/ScreenshotPlaceholder.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScreenshotPlaceholder from "./ScreenshotPlaceholder";

describe("ScreenshotPlaceholder", () => {
	it("renders the label with dimensions in black centered text", () => {
		render(<ScreenshotPlaceholder width={1440} height={900} />);
		expect(screen.getByText("系统截图 · 1440×900")).toBeInTheDocument();
	});

	it("reserves aspect ratio to avoid CLS", () => {
		const { container } = render(
			<ScreenshotPlaceholder width={1600} height={1000} />,
		);
		const box = container.firstChild as HTMLElement;
		expect(box.style.aspectRatio).toBe("1600 / 1000");
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/components/ScreenshotPlaceholder.test.tsx
```
Expected: FAIL（找不到模块 `./ScreenshotPlaceholder`）。

- [ ] **Step 3: 实现组件**

Create `frontend/src/pages/showcase/components/ScreenshotPlaceholder.tsx`:
```tsx
interface ScreenshotPlaceholderProps {
	width: number;
	height: number;
	label?: string;
	className?: string;
}

/* TODO: 替换为真实系统截图（用户授权的临时占位符） */
export default function ScreenshotPlaceholder({
	width,
	height,
	label,
	className,
}: ScreenshotPlaceholderProps) {
	return (
		<div
			style={{ aspectRatio: `${width} / ${height}` }}
			className={`flex w-full items-center justify-center rounded-2xl border border-border bg-muted ${className ?? ""}`}
		>
			<span className="select-none text-center text-sm font-medium text-black">
				系统截图 · {label ?? `${width}×${height}`}
			</span>
		</div>
	);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/components/ScreenshotPlaceholder.test.tsx
```
Expected: PASS（2 passed）。

- [ ] **Step 5: 提交**

```bash
git add "frontend/src/pages/showcase/components/ScreenshotPlaceholder.tsx" "frontend/src/pages/showcase/components/ScreenshotPlaceholder.test.tsx"
git commit -m "✨ feat: showcase 系统截图占位符组件"
```

---

## Task 3: Reveal 滚动揭示组件（TDD）

**Files:**
- Create: `frontend/src/pages/showcase/components/Reveal.tsx`
- Test: `frontend/src/pages/showcase/components/Reveal.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `frontend/src/pages/showcase/components/Reveal.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Reveal from "./Reveal";

describe("Reveal", () => {
	it("always renders children (IntersectionObserver absent in jsdom → visible fallback)", () => {
		render(
			<Reveal>
				<p>可见内容</p>
			</Reveal>,
		);
		expect(screen.getByText("可见内容")).toBeInTheDocument();
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/components/Reveal.test.tsx
```
Expected: FAIL（找不到模块 `./Reveal`）。

- [ ] **Step 3: 实现组件**

Create `frontend/src/pages/showcase/components/Reveal.tsx`:
```tsx
import { type ReactNode, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/gsap";

interface RevealProps {
	children: ReactNode;
	delay?: number;
	className?: string;
}

export default function Reveal({ children, delay = 0, className }: RevealProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState(
		() => prefersReducedMotion() || typeof IntersectionObserver === "undefined",
	);

	useEffect(() => {
		if (shown || !ref.current) return;
		const el = ref.current;
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						setShown(true);
						io.disconnect();
					}
				}
			},
			{ threshold: 0.2 },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [shown]);

	return (
		<div
			ref={ref}
			className={className}
			style={{
				opacity: shown ? 1 : 0,
				transform: shown ? "none" : "translateY(24px)",
				transition: `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
			}}
		>
			{children}
		</div>
	);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/components/Reveal.test.tsx
```
Expected: PASS（1 passed）。

- [ ] **Step 5: 提交**

```bash
git add "frontend/src/pages/showcase/components/Reveal.tsx" "frontend/src/pages/showcase/components/Reveal.test.tsx"
git commit -m "✨ feat: showcase 滚动揭示组件（reduced-motion 感知）"
```

---

## Task 4: 展示内容数据（TDD）

**Files:**
- Create: `frontend/src/pages/showcase/data.ts`
- Test: `frontend/src/pages/showcase/data.test.ts`

> 文案严格对齐 spec §2 核对结论：训练引擎架构（非插件化）、RAG 关键词/IDF（非 pgvector）、情绪 6 状态、5 面板、19 项。

- [ ] **Step 1: 写失败测试**

Create `frontend/src/pages/showcase/data.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HIGHLIGHTS, OVERVIEW_STATS } from "./data";

describe("showcase data", () => {
	it("has exactly 6 highlights", () => {
		expect(HIGHLIGHTS).toHaveLength(6);
	});

	it("does not mention deprecated/inaccurate terms", () => {
		const blob = JSON.stringify(HIGHLIGHTS) + JSON.stringify(OVERVIEW_STATS);
		expect(blob).not.toMatch(/插件化|manifest|pgvector|向量检索/);
	});

	it("overview stats reflect real numbers", () => {
		const values = OVERVIEW_STATS.map((s) => s.value);
		expect(values).toContain(5);
		expect(values).toContain(19);
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/data.test.ts
```
Expected: FAIL（找不到模块 `./data`）。

- [ ] **Step 3: 实现数据**

Create `frontend/src/pages/showcase/data.ts`:
```ts
import {
	Activity,
	AudioLines,
	BookOpenCheck,
	Boxes,
	HeartPulse,
	MessagesSquare,
	type LucideIcon,
} from "lucide-react";

export const PRODUCT_NAME = "虚拟患者训练系统";
export const HERO_TITLE = "把 LLM 做成可教学、可评估的虚拟患者";
export const HERO_SUBTITLE = "护理病史采集技能训练平台：多模态对话、透明化评分、可溯源知识。";
export const CTA_LABEL = "进入系统";
export const CTA_HREF = "/login";

export interface OverviewStat {
	value: number;
	suffix: string;
	label: string;
}

export const OVERVIEW_STATS: OverviewStat[] = [
	{ value: 5, suffix: " 个", label: "可配置训练面板" },
	{ value: 19, suffix: " 项", label: "评分维度" },
	{ value: 6, suffix: " 种", label: "患者情绪状态" },
];

export type HighlightLayout = "full" | "split" | "split-reverse" | "bento" | "sticky";

export interface Highlight {
	id: string;
	icon: LucideIcon;
	title: string;
	body: string;
	points: string[];
	layout: HighlightLayout;
	screenshot?: { width: number; height: number; label: string };
}

export const HIGHLIGHTS: Highlight[] = [
	{
		id: "engine",
		icon: Boxes,
		title: "训练引擎架构",
		body: "六阶段流式处理管道，按特性开关装配训练面板，组合出不同的训练场景。",
		points: [
			"管道：守卫 → 转换 → 提示 → LLM → 持久化 → 副作用",
			"5 个可配置面板：问诊 / 查体 / 护理记录 / 情绪 / 自主反馈",
			"特性开关驱动，按需启用能力",
		],
		layout: "full",
		screenshot: { width: 1440, height: 900, label: "1440×900（训练面板）" },
	},
	{
		id: "patient",
		icon: MessagesSquare,
		title: "LLM 虚拟患者对话",
		body: "角色扮演 + 隐藏信息逐步披露，患者会主动追问，逼近真实问诊节奏。",
		points: [
			"隐藏病史按提问逐步披露",
			"患者主动追问：按等待时长 / 信任 / 舒适度触发",
			"LLM 生成 + 规则兜底，指数退避自动停止",
		],
		layout: "split",
		screenshot: { width: 1280, height: 960, label: "1280×960（对话页）" },
	},
	{
		id: "emotion",
		icon: HeartPulse,
		title: "患者情绪系统",
		body: "基于信任-舒适二维模型，LLM 逐轮分析驱动 6 种情绪状态，立绘实时联动。",
		points: [
			"6 状态：沉默回避 / 防御抵触 / 焦虑不安 / 正常配合 / 放松友好 / 开放信任",
			"8 类患者 × 情绪变体立绘",
			"对话中情绪随沟通质量动态变化",
		],
		layout: "bento",
	},
	{
		id: "voice",
		icon: AudioLines,
		title: "语音交互",
		body: "火山引擎 TTS / ASR 流式，情绪联动音色，双路提供方与优雅降级。",
		points: [
			"SeedTTS 2.0 合成 + BigASR 流式识别",
			"双路：火山引擎 + 浏览器兜底",
			"熔断保护，失败自动降级",
		],
		layout: "split-reverse",
	},
	{
		id: "scoring",
		icon: Activity,
		title: "流式评分 + 透明化",
		body: "SSE 逐项进度，双面板展示 LLM 思考过程，19 项证据化反馈逐条可查。",
		points: [
			"评分 + 反馈并行，思考过程实时流式",
			"19 项维度：沟通技能 14 + 病史采集 5",
			"每项附对话证据与评分理由",
		],
		layout: "sticky",
		screenshot: { width: 1440, height: 900, label: "1440×900（评分页）" },
	},
	{
		id: "rag",
		icon: BookOpenCheck,
		title: "教材知识库 RAG",
		body: "关键词 / IDF 加权检索 + 层级章节浏览，引用出处可溯源回教材原文。",
		points: [
			"章节浏览作为 LLM Tool Calls 暴露",
			"关键词 / IDF 加权检索，中文停用词过滤",
			"引用可点击回看教材原文",
		],
		layout: "bento",
	},
];

export interface Chip {
	label: string;
}

export const ENGINEERING: Chip[] = [
	{ label: "多 Provider 路由" },
	{ label: "熔断 / 限流" },
	{ label: "月度成本上限" },
	{ label: "流式 SSE" },
	{ label: "LLM 调用日志" },
	{ label: "统一成本面板" },
	{ label: "运维面板 + 自动告警" },
	{ label: "CI/CD 自动部署" },
];

export const TECH_STACK: string[] = [
	"React 19",
	"FastAPI",
	"PostgreSQL",
	"SQLAlchemy",
	"Alembic",
	"DeepSeek",
	"火山引擎 TTS·ASR",
];
```

- [ ] **Step 4: 运行测试确认通过**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/data.test.ts
```
Expected: PASS（3 passed）。

- [ ] **Step 5: 提交**

```bash
git add "frontend/src/pages/showcase/data.ts" "frontend/src/pages/showcase/data.test.ts"
git commit -m "✨ feat: showcase 展示内容数据（对齐 HEAD 真实实现）"
```

---

## Task 5: SectionHeading + 布局组件（FeatureSplit / FeatureFull）

**Files:**
- Create: `frontend/src/pages/showcase/components/SectionHeading.tsx`
- Create: `frontend/src/pages/showcase/components/layouts/FeatureSplit.tsx`
- Create: `frontend/src/pages/showcase/components/layouts/FeatureFull.tsx`

- [ ] **Step 1: SectionHeading**

Create `frontend/src/pages/showcase/components/SectionHeading.tsx`:
```tsx
interface SectionHeadingProps {
	eyebrow?: string;
	title: string;
	className?: string;
}

export default function SectionHeading({
	eyebrow,
	title,
	className,
}: SectionHeadingProps) {
	return (
		<div className={`flex flex-col gap-2 ${className ?? ""}`}>
			{eyebrow ? (
				<span className="text-[11px] uppercase tracking-[0.18em] text-primary">
					{eyebrow}
				</span>
			) : null}
			<h2 className="text-3xl font-bold tracking-tight md:text-4xl [font-family:'Geist_Variable',sans-serif]">
				{title}
			</h2>
		</div>
	);
}
```

- [ ] **Step 2: FeatureSplit（图文分栏，支持反向）**

Create `frontend/src/pages/showcase/components/layouts/FeatureSplit.tsx`:
```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Reveal from "../Reveal";

interface FeatureSplitProps {
	icon: LucideIcon;
	title: string;
	body: string;
	points: string[];
	reverse?: boolean;
	visual: ReactNode;
}

export default function FeatureSplit({
	icon: Icon,
	title,
	body,
	points,
	reverse,
	visual,
}: FeatureSplitProps) {
	return (
		<div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
			<Reveal className={reverse ? "md:order-2" : ""}>
				<div className="flex flex-col gap-4">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={24} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-2xl font-bold tracking-tight [font-family:'Geist_Variable',sans-serif]">
						{title}
					</h3>
					<p className="max-w-[65ch] leading-relaxed text-muted-foreground">
						{body}
					</p>
					<ul className="flex flex-col gap-2">
						{points.map((p) => (
							<li key={p} className="flex gap-2 text-sm text-foreground/80">
								<span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
								<span>{p}</span>
							</li>
						))}
					</ul>
				</div>
			</Reveal>
			<Reveal delay={120} className={reverse ? "md:order-1" : ""}>
				{visual}
			</Reveal>
		</div>
	);
}
```

- [ ] **Step 3: FeatureFull（全宽）**

Create `frontend/src/pages/showcase/components/layouts/FeatureFull.tsx`:
```tsx
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import Reveal from "../Reveal";

interface FeatureFullProps {
	icon: LucideIcon;
	title: string;
	body: string;
	points: string[];
	visual?: ReactNode;
}

export default function FeatureFull({
	icon: Icon,
	title,
	body,
	points,
	visual,
}: FeatureFullProps) {
	return (
		<Reveal>
			<div className="flex flex-col gap-8">
				<div className="flex flex-col gap-4">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={24} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-2xl font-bold tracking-tight md:text-3xl [font-family:'Geist_Variable',sans-serif]">
						{title}
					</h3>
					<p className="max-w-[65ch] leading-relaxed text-muted-foreground">
						{body}
					</p>
				</div>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{points.map((p) => (
						<div
							key={p}
							className="rounded-2xl border border-border bg-card p-4 text-sm text-foreground/80"
						>
							{p}
						</div>
					))}
				</div>
				{visual}
			</div>
		</Reveal>
	);
}
```

- [ ] **Step 4: 类型检查**

Run (in `frontend/`):
```bash
npx tsc --noEmit
```
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add "frontend/src/pages/showcase/components/SectionHeading.tsx" "frontend/src/pages/showcase/components/layouts/"
git commit -m "✨ feat: showcase 段落标题与图文布局组件"
```

---

## Task 6: TopBar

**Files:**
- Create: `frontend/src/pages/showcase/sections/TopBar.tsx`

- [ ] **Step 1: 实现 TopBar**

Create `frontend/src/pages/showcase/sections/TopBar.tsx`:
```tsx
import { Stethoscope } from "lucide-react";
import { Link } from "react-router-dom";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function TopBar() {
	return (
		<header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
				<div className="flex items-center gap-2.5">
					<div className="flex size-9 items-center justify-center rounded-xl bg-primary">
						<Stethoscope size={20} strokeWidth={1.5} className="text-primary-foreground" />
					</div>
					<span className="font-semibold tracking-tight">{PRODUCT_NAME}</span>
				</div>
				<Link
					to={CTA_HREF}
					className="inline-flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition active:scale-[0.98]"
				>
					{CTA_LABEL}
				</Link>
			</div>
		</header>
	);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/sections/TopBar.tsx"
git commit -m "✨ feat: showcase 顶栏"
```

---

## Task 7: Hero（GSAP 多层视差）

**Files:**
- Create: `frontend/src/pages/showcase/sections/Hero.tsx`

- [ ] **Step 1: 实现 Hero**

Create `frontend/src/pages/showcase/sections/Hero.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import ScreenshotPlaceholder from "../components/ScreenshotPlaceholder";
import { CTA_HREF, CTA_LABEL, HERO_SUBTITLE, HERO_TITLE, PRODUCT_NAME } from "../data";
import { ensureGsap, prefersReducedMotion } from "../lib/gsap";

export default function Hero() {
	const root = useRef<HTMLElement>(null);
	const glow = useRef<HTMLDivElement>(null);
	const shot = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
			const mm = gsap.matchMedia();
			mm.add("(min-width: 768px)", () => {
				gsap.to(glow.current, {
					yPercent: 30,
					ease: "none",
					scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true },
				});
				gsap.to(shot.current, {
					yPercent: -12,
					ease: "none",
					scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: true, invalidateOnRefresh: true },
				});
			});
		}, root);
		return () => ctx.revert();
	}, []);

	return (
		<section
			ref={root}
			className="relative flex min-h-[100dvh] items-center overflow-hidden pt-24"
		>
			<div
				ref={glow}
				className="pointer-events-none absolute -top-32 left-1/4 size-[40rem] rounded-full bg-primary/15 blur-3xl"
			/>
			<div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-12 px-6 md:grid-cols-2">
				<div className="flex flex-col gap-6">
					<span className="text-sm font-medium text-primary">{PRODUCT_NAME}</span>
					<h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl [font-family:'Geist_Variable',sans-serif]">
						{HERO_TITLE}
					</h1>
					<p className="max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
						{HERO_SUBTITLE}
					</p>
					<div>
						<Link
							to={CTA_HREF}
							className="inline-flex h-12 items-center rounded-full bg-primary px-7 font-medium text-primary-foreground transition active:scale-[0.98] hover:-translate-y-px"
						>
							{CTA_LABEL}
						</Link>
					</div>
				</div>
				<div ref={shot} className="relative">
					{/* TODO: 替换为真实系统截图 */}
					<ScreenshotPlaceholder width={1440} height={900} label="1440×900（产品总览）" />
				</div>
			</div>
		</section>
	);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/sections/Hero.tsx"
git commit -m "✨ feat: showcase Hero 与 GSAP 多层视差"
```

---

## Task 8: Overview（数字 count-up）

**Files:**
- Create: `frontend/src/pages/showcase/sections/Overview.tsx`

- [ ] **Step 1: 实现 Overview**

Create `frontend/src/pages/showcase/sections/Overview.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { OVERVIEW_STATS, type OverviewStat } from "../data";
import { prefersReducedMotion } from "../lib/gsap";

function Stat({ stat }: { stat: OverviewStat }) {
	const ref = useRef<HTMLDivElement>(null);
	const [n, setN] = useState(() => (prefersReducedMotion() ? stat.value : 0));

	useEffect(() => {
		if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
			setN(stat.value);
			return;
		}
		const el = ref.current;
		if (!el) return;
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				io.disconnect();
				const start = performance.now();
				const dur = 900;
				const tick = (t: number) => {
					const p = Math.min(1, (t - start) / dur);
					setN(Math.round(stat.value * (1 - (1 - p) ** 3)));
					if (p < 1) requestAnimationFrame(tick);
				};
				requestAnimationFrame(tick);
			}
		}, { threshold: 0.5 });
		io.observe(el);
		return () => io.disconnect();
	}, [stat.value]);

	return (
		<div ref={ref} className="flex flex-col items-center gap-1 text-center">
			<div className="text-4xl font-bold tracking-tight md:text-5xl [font-family:'Geist_Variable',sans-serif]">
				{n}
				<span className="text-2xl text-primary">{stat.suffix}</span>
			</div>
			<div className="text-sm text-muted-foreground">{stat.label}</div>
		</div>
	);
}

export default function Overview() {
	return (
		<section className="mx-auto max-w-5xl px-6 py-20">
			<div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
				{OVERVIEW_STATS.map((s) => (
					<Stat key={s.label} stat={s} />
				))}
			</div>
		</section>
	);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/sections/Overview.tsx"
git commit -m "✨ feat: showcase 概览条带与数字 count-up"
```

---

## Task 9: Highlights（6 大亮点，含 sticky-stack）

**Files:**
- Create: `frontend/src/pages/showcase/sections/Highlights.tsx`

- [ ] **Step 1: 实现 Highlights**

Create `frontend/src/pages/showcase/sections/Highlights.tsx`:
```tsx
import { useEffect, useRef } from "react";
import ScreenshotPlaceholder from "../components/ScreenshotPlaceholder";
import FeatureFull from "../components/layouts/FeatureFull";
import FeatureSplit from "../components/layouts/FeatureSplit";
import Reveal from "../components/Reveal";
import { HIGHLIGHTS, type Highlight } from "../data";
import { ensureGsap, prefersReducedMotion } from "../lib/gsap";

function shot(h: Highlight) {
	if (!h.screenshot) return null;
	return (
		/* TODO: 替换为真实系统截图 */
		<ScreenshotPlaceholder
			width={h.screenshot.width}
			height={h.screenshot.height}
			label={h.screenshot.label}
		/>
	);
}

function BentoHighlight({ h }: { h: Highlight }) {
	const Icon = h.icon;
	return (
		<Reveal>
			<div className="rounded-2xl border border-border bg-card p-8">
				<div className="mb-5 flex items-center gap-3">
					<div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={22} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-xl font-bold tracking-tight [font-family:'Geist_Variable',sans-serif]">
						{h.title}
					</h3>
				</div>
				<p className="mb-5 leading-relaxed text-muted-foreground">{h.body}</p>
				<div className="flex flex-wrap gap-2">
					{h.points.map((p) => (
						<span
							key={p}
							className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-foreground/80"
						>
							{p}
						</span>
					))}
				</div>
			</div>
		</Reveal>
	);
}

function StickyHighlight({ h }: { h: Highlight }) {
	const root = useRef<HTMLDivElement>(null);
	const card = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (prefersReducedMotion() || !root.current) return;
		const { gsap } = ensureGsap();
		const ctx = gsap.context(() => {
			const mm = gsap.matchMedia();
			mm.add("(min-width: 768px)", () => {
				gsap.fromTo(
					card.current,
					{ scale: 0.96, opacity: 0.7 },
					{
						scale: 1,
						opacity: 1,
						ease: "none",
						scrollTrigger: { trigger: root.current, start: "top 80%", end: "top 30%", scrub: true },
					},
				);
			});
		}, root);
		return () => ctx.revert();
	}, []);

	const Icon = h.icon;
	return (
		<div ref={root}>
			<div ref={card} className="rounded-2xl border border-border bg-card p-8 md:p-12">
				<div className="flex flex-col gap-6">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
						<Icon size={24} strokeWidth={1.5} className="text-primary" />
					</div>
					<h3 className="text-2xl font-bold tracking-tight md:text-3xl [font-family:'Geist_Variable',sans-serif]">
						{h.title}
					</h3>
					<p className="max-w-[65ch] leading-relaxed text-muted-foreground">{h.body}</p>
					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						{h.points.map((p) => (
							<div key={p} className="rounded-2xl border border-border bg-background p-4 text-sm text-foreground/80">
								{p}
							</div>
						))}
					</div>
					{shot(h)}
				</div>
			</div>
		</div>
	);
}

export default function Highlights() {
	const bentos = HIGHLIGHTS.filter((h) => h.layout === "bento");
	return (
		<div className="mx-auto flex max-w-7xl flex-col gap-28 px-6 py-12">
			{HIGHLIGHTS.map((h) => {
				if (h.layout === "full")
					return <FeatureFull key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={shot(h)} />;
				if (h.layout === "split")
					return <FeatureSplit key={h.id} icon={h.icon} title={h.title} body={h.body} points={h.points} visual={shot(h)} />;
				if (h.layout === "split-reverse")
					return (
						<FeatureSplit
							key={h.id}
							icon={h.icon}
							title={h.title}
							body={h.body}
							points={h.points}
							reverse
							visual={
								<div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
									火山引擎 · 双路语音
								</div>
							}
						/>
					);
				if (h.layout === "sticky") return <StickyHighlight key={h.id} h={h} />;
				return null;
			})}
			<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
				{bentos.map((h) => (
					<BentoHighlight key={h.id} h={h} />
				))}
			</div>
		</div>
	);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/sections/Highlights.tsx"
git commit -m "✨ feat: showcase 六大亮点（含 sticky-stack 滚动转场）"
```

---

## Task 10: EngineeringBand + TechStack（唯一 marquee）

**Files:**
- Create: `frontend/src/pages/showcase/sections/EngineeringBand.tsx`
- Create: `frontend/src/pages/showcase/sections/TechStack.tsx`

- [ ] **Step 1: EngineeringBand**

Create `frontend/src/pages/showcase/sections/EngineeringBand.tsx`:
```tsx
import SectionHeading from "../components/SectionHeading";
import Reveal from "../components/Reveal";
import { ENGINEERING } from "../data";

export default function EngineeringBand() {
	return (
		<section className="mx-auto max-w-7xl px-6 py-20">
			<SectionHeading eyebrow="工程化底座" title="可观测、可控、可部署" className="mb-10" />
			<Reveal>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{ENGINEERING.map((c) => (
						<div
							key={c.label}
							className="rounded-2xl border border-border bg-card px-4 py-5 text-center text-sm font-medium text-foreground/80"
						>
							{c.label}
						</div>
					))}
				</div>
			</Reveal>
		</section>
	);
}
```

- [ ] **Step 2: TechStack（唯一 marquee，reduced-motion 静态）**

Create `frontend/src/pages/showcase/sections/TechStack.tsx`:
```tsx
import { TECH_STACK } from "../data";

export default function TechStack() {
	const items = [...TECH_STACK, ...TECH_STACK];
	return (
		<section className="border-y border-border/60 py-10">
			<div className="group relative flex overflow-hidden">
				<div className="flex shrink-0 animate-[marquee_24s_linear_infinite] gap-12 pr-12 motion-reduce:animate-none">
					{items.map((t, i) => (
						<span
							key={`${t}-${i}`}
							className="whitespace-nowrap text-lg font-medium text-muted-foreground [font-family:'Geist_Variable',sans-serif]"
						>
							{t}
						</span>
					))}
				</div>
			</div>
		</section>
	);
}
```

- [ ] **Step 3: 定义 marquee 关键帧（全局样式）**

在 `frontend/src/index.css`（或项目主样式入口，确认实际文件名后追加）末尾追加：
```css
@keyframes marquee {
	from { transform: translateX(0); }
	to { transform: translateX(-50%); }
}
```
> 若主样式入口非 `index.css`，先 `Get-ChildItem frontend/src/*.css`（用 Glob 工具）确认，再追加到被 `main.tsx` import 的那个 css。

- [ ] **Step 4: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/sections/EngineeringBand.tsx" "frontend/src/pages/showcase/sections/TechStack.tsx" frontend/src/index.css
git commit -m "✨ feat: showcase 工程化底座与技术栈跑马灯"
```

---

## Task 11: FinalCta + Footer

**Files:**
- Create: `frontend/src/pages/showcase/sections/FinalCta.tsx`

- [ ] **Step 1: 实现 FinalCta**

Create `frontend/src/pages/showcase/sections/FinalCta.tsx`:
```tsx
import { Link } from "react-router-dom";
import { CTA_HREF, CTA_LABEL, PRODUCT_NAME } from "../data";

export default function FinalCta() {
	return (
		<>
			<section className="relative overflow-hidden px-6 py-32 text-center">
				<div className="pointer-events-none absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl" />
				<div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
					<h2 className="text-3xl font-bold tracking-tight md:text-5xl [font-family:'Geist_Variable',sans-serif]">
						开始一次虚拟患者训练
					</h2>
					<Link
						to={CTA_HREF}
						className="inline-flex h-12 items-center rounded-full bg-primary px-8 font-medium text-primary-foreground transition active:scale-[0.98] hover:-translate-y-px"
					>
						{CTA_LABEL}
					</Link>
				</div>
			</section>
			<footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
				{PRODUCT_NAME} · 2026
			</footer>
		</>
	);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/sections/FinalCta.tsx"
git commit -m "✨ feat: showcase 底部 CTA 与页脚"
```

---

## Task 12: ShowcasePage 页面根

**Files:**
- Create: `frontend/src/pages/showcase/ShowcasePage.tsx`

- [ ] **Step 1: 实现 ShowcasePage**

Create `frontend/src/pages/showcase/ShowcasePage.tsx`:
```tsx
import "@fontsource-variable/geist";
import { useEffect } from "react";
import { PRODUCT_NAME } from "./data";
import EngineeringBand from "./sections/EngineeringBand";
import FinalCta from "./sections/FinalCta";
import Hero from "./sections/Hero";
import Highlights from "./sections/Highlights";
import Overview from "./sections/Overview";
import TechStack from "./sections/TechStack";
import TopBar from "./sections/TopBar";

export default function ShowcasePage() {
	useEffect(() => {
		const prev = document.title;
		document.title = `${PRODUCT_NAME} · 产品介绍`;
		return () => {
			document.title = prev;
		};
	}, []);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<TopBar />
			<main>
				<Hero />
				<Overview />
				<Highlights />
				<EngineeringBand />
				<TechStack />
				<FinalCta />
			</main>
		</div>
	);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run (in `frontend/`): `npx tsc --noEmit` → Expected: PASS。
```bash
git add "frontend/src/pages/showcase/ShowcasePage.tsx"
git commit -m "✨ feat: showcase 页面根组合"
```

---

## Task 13: 注册公开路由（TDD：渲染 + CTA 指向）

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/pages/showcase/ShowcasePage.test.tsx`

- [ ] **Step 1: 写失败测试（页面渲染 + CTA 指向 /login）**

Create `frontend/src/pages/showcase/ShowcasePage.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ShowcasePage from "./ShowcasePage";

describe("ShowcasePage", () => {
	it("renders hero title and a CTA linking to /login", () => {
		render(
			<MemoryRouter>
				<ShowcasePage />
			</MemoryRouter>,
		);
		expect(
			screen.getByRole("heading", { name: /虚拟患者/ }),
		).toBeInTheDocument();
		const ctas = screen.getAllByRole("link", { name: "进入系统" });
		expect(ctas.length).toBeGreaterThan(0);
		expect(ctas[0]).toHaveAttribute("href", "/login");
	});
});
```

- [ ] **Step 2: 运行测试确认失败（路由未接，但页面应可渲染）**

Run (in `frontend/`):
```bash
npx vitest run src/pages/showcase/ShowcasePage.test.tsx
```
Expected: PASS（ShowcasePage 自身可渲染）。若 FAIL 则修复组件后再继续。
> 本步用于锁定页面行为；路由接线在 Step 3。

- [ ] **Step 3: 在 App.tsx 注册公开路由**

Modify `frontend/src/App.tsx`：

(a) 在懒加载声明区（约 25 行附近，与其它 `lazy` 并列）新增：
```tsx
const Showcase = lazy(() => import("@/pages/showcase/ShowcasePage"));
```

(b) 在 `<Routes>` 内、与 `<Route path="/login" element={<Login />} />` 同级（紧随其后），新增公开路由：
```tsx
<Route path="/login" element={<Login />} />
<Route path="/showcase" element={<Showcase />} />
```
> 必须在 `ProtectedRoute` 包裹块**之外**；末尾的 `<Route path="*" element={<Navigate to="/login" replace />} />` 保持不变。

- [ ] **Step 4: 类型检查 + lint + 全量前端单测**

Run (in `frontend/`):
```bash
npx tsc --noEmit
npx biome check
npx vitest run
```
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/App.tsx "frontend/src/pages/showcase/ShowcasePage.test.tsx"
git commit -m "✨ feat: 注册 /showcase 公开路由"
```

---

## Task 14: 最终验收

**Files:** 无（验证）

- [ ] **Step 1: 推送前完整门禁（frontend）**

Run (in `frontend/`):
```bash
npx tsc --noEmit
npx biome check
npx vitest run
```
Expected: 全部 PASS。

- [ ] **Step 2: 本地起前端人工核对（spec §9）**

Run (monorepo root):
```bash
pnpm run dev
```
浏览器打开 `http://localhost:3000/showcase`，确认：
- 匿名可访问、渲染完整；点任一「进入系统」跳 `/login`。
- 桌面 / 移动（DevTools 窄屏）无破版；视差 / sticky 顺滑。
- DevTools 开启 `prefers-reduced-motion: reduce` 后动效全部静止、内容可读。
- 已登录状态访问 `/showcase` 仍可见（不被拦截）。
- 主包未被 GSAP 拖大（`pnpm --filter frontend run build` 后确认 gsap 在 showcase chunk）。

- [ ] **Step 3: 构建验证 GSAP 分包**

Run (monorepo root):
```bash
pnpm --filter frontend run build
```
Expected: 构建成功；产物中 gsap 位于按需 chunk（非主 `index-*.js`）。

- [ ] **Step 4: 标记完成**

无需额外提交（功能性提交已在前序任务完成）。在 PR / 合并前确认本计划所有 checkbox 已勾选。

---

## 范围之外（勿做）
- 真实截图替换、暗色模式专项、i18n。
- 任何后端 / nginx / Dockerfile / CICD 改动。
- 引入 Motion / Lottie（动效统一用 GSAP）。
