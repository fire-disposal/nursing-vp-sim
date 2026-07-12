# AI 管理 UI 适配与重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/admin/costs` 的 "LLM API" 标签重构为一张紧凑的多密钥表（含 env 兜底常驻行），内联展示健康/熔断原因/恢复时间/成本预算，并补齐 key 显示切换、URL 校验、测试全部。

**Architecture:** 后端仅给 `FallbackStateResponse` 补 3 个 degraded 字段并重生成类型。前端把健康/成本/恢复文本抽成纯函数（TDD 单测），再重构 `ApiManagementTab` 与 `SecretModal`。

**Tech Stack:** 后端 FastAPI/Pydantic（`uv run` from `backend/`）；前端 React + TS + zod + Vitest（`npx` from `frontend/`）。

**关联 spec:** `docs/superpowers/specs/2026-07-12-ai-management-ui-redesign-design.md`

---

## Task 1: 后端 env 兜底 degraded 字段透出

**Files:**
- Modify: `backend/schemas/ops.py:168-181`（`FallbackStateResponse`）
- Regen: `openapi.json`, `frontend/src/api/api-types.gen.ts`

- [ ] **Step 1: 加字段**

`schemas/ops.py` 的 `FallbackStateResponse`，在 `total_cost` 后、`model_config` 前加：

```python
    degraded_reason: str | None = None
    degraded_until: datetime | None = None
    consecutive_failures: int = 0
```

确认文件顶部已 `from datetime import datetime`（若无则加）。

- [ ] **Step 2: 重生成类型**

Run: `pnpm run api:update`
Expected: `openapi.json` 与 `frontend/src/api/api-types.gen.ts` 更新，`FallbackStateResponse` 含新字段。

- [ ] **Step 3: 校验后端**

Run: `cd backend; uv run ruff check schemas/ops.py; uv run ty check schemas/ops.py`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add backend/schemas/ops.py openapi.json frontend/src/api/api-types.gen.ts
git commit -m "✨ feat: env 兜底响应透出 degraded_reason/until/consecutive_failures"
```

---

## Task 2: LLM 状态展示纯函数 + 单测（TDD）

**Files:**
- Create: `frontend/src/components/admin/llm-status.ts`
- Test: `frontend/src/components/admin/llm-status.test.ts`

- [ ] **Step 1: 写失败测试**

`frontend/src/components/admin/llm-status.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import {
	costColorClass,
	degradedReasonLabel,
	recoveryText,
	statusText,
} from "./llm-status";

describe("degradedReasonLabel", () => {
	it("maps known reasons", () => {
		expect(degradedReasonLabel("rate_limited")).toBe("限流");
		expect(degradedReasonLabel("consecutive_failures")).toBe("连续失败");
		expect(degradedReasonLabel("cost_exceeded")).toBe("超预算");
	});
	it("falls back for unknown/empty", () => {
		expect(degradedReasonLabel(null)).toBe("降级");
		expect(degradedReasonLabel("weird")).toBe("降级");
	});
});

describe("statusText", () => {
	it("maps status", () => {
		expect(statusText("active")).toBe("正常");
		expect(statusText("degraded")).toBe("熔断");
		expect(statusText("disabled")).toBe("停用");
		expect(statusText("other")).toBe("停用");
	});
});

describe("recoveryText", () => {
	const now = new Date("2026-07-12T00:00:00Z");
	it("returns empty when no degradedUntil", () => {
		expect(recoveryText(null, "rate_limited", now)).toBe("");
	});
	it("returns empty when already past", () => {
		expect(recoveryText("2026-07-11T23:59:00Z", "rate_limited", now)).toBe("");
	});
	it("seconds", () => {
		expect(recoveryText("2026-07-12T00:00:45Z", "rate_limited", now)).toBe("约 45s 后恢复");
	});
	it("minutes", () => {
		expect(recoveryText("2026-07-12T00:05:00Z", "consecutive_failures", now)).toBe("约 5 分钟后恢复");
	});
	it("cost_exceeded shows 下月恢复", () => {
		expect(recoveryText("2026-08-01T00:00:00Z", "cost_exceeded", now)).toBe("下月恢复");
	});
});

describe("costColorClass", () => {
	it("normal below 90%", () => {
		expect(costColorClass(10, 100)).toBe("");
	});
	it("amber at 90%+", () => {
		expect(costColorClass(90, 100)).toBe("text-warning-foreground");
	});
	it("red at/over limit", () => {
		expect(costColorClass(100, 100)).toBe("text-danger-foreground");
	});
	it("no limit -> normal", () => {
		expect(costColorClass(50, null)).toBe("");
		expect(costColorClass(50, 0)).toBe("");
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend; npx vitest run src/components/admin/llm-status.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`frontend/src/components/admin/llm-status.ts`：

```typescript
const REASON_LABELS: Record<string, string> = {
	rate_limited: "限流",
	consecutive_failures: "连续失败",
	cost_exceeded: "超预算",
};

export function degradedReasonLabel(reason: string | null | undefined): string {
	return (reason && REASON_LABELS[reason]) || "降级";
}

export function statusText(status: string | null | undefined): string {
	if (status === "active") return "正常";
	if (status === "degraded") return "熔断";
	return "停用";
}

/** 熔断恢复文本。cost_exceeded 到下月 → "下月恢复"；否则按剩余秒/分钟。 */
export function recoveryText(
	degradedUntil: string | null | undefined,
	reason: string | null | undefined,
	now: Date = new Date(),
): string {
	if (!degradedUntil) return "";
	const until = new Date(degradedUntil).getTime();
	const diffMs = until - now.getTime();
	if (Number.isNaN(until) || diffMs <= 0) return "";
	if (reason === "cost_exceeded") return "下月恢复";
	const secs = Math.round(diffMs / 1000);
	if (secs < 90) return `约 ${secs}s 后恢复`;
	return `约 ${Math.round(secs / 60)} 分钟后恢复`;
}

/** 成本颜色：>=limit 红，>=90% 琥珀，否则常规；无 limit 常规。 */
export function costColorClass(used: number, limit: number | null | undefined): string {
	if (!limit || limit <= 0) return "";
	if (used >= limit) return "text-danger-foreground";
	if (used >= 0.9 * limit) return "text-warning-foreground";
	return "";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd frontend; npx vitest run src/components/admin/llm-status.test.ts`
Expected: PASS（全部）

- [ ] **Step 5: tsc + biome + Commit**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/admin/llm-status.ts src/components/admin/llm-status.test.ts`

```bash
git add frontend/src/components/admin/llm-status.ts frontend/src/components/admin/llm-status.test.ts
git commit -m "✨ feat: LLM 状态/成本/恢复文本纯函数 + 单测"
```

---

## Task 3: SecretModal — key 显示切换 + URL 校验

**Files:**
- Modify: `frontend/src/schemas/secret.ts`
- Modify: `frontend/src/components/admin/SecretModal.tsx:147-168`（rawKey 字段）

- [ ] **Step 1: URL 校验规则**

`frontend/src/schemas/secret.ts` 把 `baseUrl` 改为：

```typescript
	baseUrl: z
		.string()
		.optional()
		.refine((v) => !v || /^https?:\/\/.+/.test(v), {
			message: "请输入完整 URL（含 https://）",
		}),
```

- [ ] **Step 2: rawKey 显示/隐藏切换**

`SecretModal.tsx`：在组件内加 `const [showKey, setShowKey] = useState(false);`（确认已 `import { useEffect, useState } from "react";`）。将 rawKey 的 `<FormControl>` 内 `<input>` 替换为带切换按钮的包裹：

```tsx
										<FormControl>
											<div className="relative">
												<input
													type={showKey ? "text" : "password"}
													placeholder="sk-..."
													className={`${inputClass} pr-9`}
													{...field}
												/>
												<button
													type="button"
													onClick={() => setShowKey((v) => !v)}
													className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
													title={showKey ? "隐藏" : "显示"}
												>
													{showKey ? <EyeOff size={15} /> : <Eye size={15} />}
												</button>
											</div>
										</FormControl>
```

在顶部 import 加 `import { Eye, EyeOff } from "lucide-react";`。

- [ ] **Step 3: tsc + biome**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/schemas/secret.ts src/components/admin/SecretModal.tsx`
Expected: clean（biome 若报 import 排序，`npx biome check --write` 后再验）

- [ ] **Step 4: Commit**

```bash
git add frontend/src/schemas/secret.ts frontend/src/components/admin/SecretModal.tsx
git commit -m "✨ feat: 密钥表单加 API Key 显示切换 + base_url URL 校验"
```

---

## Task 4: ApiManagementTab — 紧凑密钥表 + env 行 + 折叠绑定 + 测试全部

**Files:**
- Modify: `frontend/src/components/admin/ApiManagementTab.tsx`

采用增量替换，保留现有 query/handler 逻辑，仅改渲染层与新增少量 handler。

- [ ] **Step 1: 引入依赖与 handler**

顶部 import 增加：

```typescript
import { ChevronDown, ChevronRight } from "lucide-react";
import { testAllConfigs } from "@/api";
import { costColorClass, degradedReasonLabel, recoveryText, statusText } from "./llm-status";
```

组件内 state 增加：

```typescript
	const [bindingsOpen, setBindingsOpen] = useState(false);
	const [testingAll, setTestingAll] = useState(false);
```

加 handler：

```typescript
	const handleTestAll = async () => {
		setTestingAll(true);
		try {
			const r = await testAllConfigs();
			const results = r.data.results ?? [];
			const ok = results.filter((x) => x.ok).length;
			const fail = results.length - ok;
			fail === 0
				? toast.success(`全部连通（${ok} 项）`)
				: toast.error(`成功 ${ok} · 失败 ${fail}`);
		} catch {
			toast.error("测试失败");
		} finally {
			setTestingAll(false);
		}
	};
```

- [ ] **Step 2: 密钥区改为紧凑表 + env 常驻行**

将 `{/* Env fallback status */}` 块与 `{/* Secrets section */}` 块（当前 163-280 行）整体替换为：标题行（"API 密钥" + "测试全部" + "添加密钥"）+ 一张表，普通密钥每行一列（标签/后缀/状态/成本/操作），env 兜底置底特殊行。完整 JSX：

```tsx
			{/* Secrets table */}
			<div className="mb-4">
				<div className="flex justify-between items-center mb-2">
					<h3 className="text-sm font-semibold text-foreground">API 密钥</h3>
					<div className="flex gap-2">
						<button
							onClick={handleTestAll}
							disabled={testingAll}
							className="inline-flex items-center gap-1 py-1 px-3 border border-border rounded-md bg-muted text-foreground cursor-pointer text-sm disabled:opacity-50"
						>
							<Activity size={14} /> {testingAll ? "测试中..." : "测试全部"}
						</button>
						<button
							onClick={() => {
								setEditingSecret(null);
								setShowSecretModal(true);
							}}
							className="inline-flex items-center gap-1 py-1 px-3 border-none rounded-md bg-primary text-primary-foreground cursor-pointer text-sm"
						>
							<Plus size={14} /> 添加密钥
						</button>
					</div>
				</div>
				<div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
					{secrets.length === 0 && !envFallback?.available && (
						<EmptyState title="暂无密钥" description="添加 DeepSeek API Key 以开始使用" />
					)}
					{secrets.map((s) => {
						const cost = Number(s.monthly_cost_used ?? 0);
						const limit = s.monthly_cost_limit ?? null;
						const recovery = s.status === "degraded" ? recoveryText(s.degraded_until, s.degraded_reason) : "";
						return (
							<div key={s.id} className="flex items-center gap-2 py-2 px-3 hover:bg-muted/40">
								<span className={cn("inline-block w-[7px] h-[7px] rounded-full shrink-0", STATUS_DOT[s.status] || "bg-gray-400")} />
								<span className="font-semibold text-sm truncate">{s.label}</span>
								<span className="text-[0.68rem] text-muted-foreground/70 font-mono shrink-0">sk-...{s.key_suffix}</span>
								<span className="text-xs text-muted-foreground shrink-0">
									{statusText(s.status)}
									{s.status === "degraded" && (
										<span className="text-muted-foreground/60">
											{" · "}{degradedReasonLabel(s.degraded_reason)}{recovery ? ` · ${recovery}` : ""}
										</span>
									)}
								</span>
								<Tooltip content={limit ? `本月已用 ¥${cost.toFixed(2)} / 上限 ¥${Number(limit).toFixed(0)}` : `本月已用 ¥${cost.toFixed(2)}`}>
									<span className={cn("ml-auto text-[0.7rem] shrink-0", costColorClass(cost, limit))}>
										¥{Number(s.total_cost_today ?? 0).toFixed(2)} / {limit ? `¥${Number(limit).toFixed(0)}` : "不限"}
									</span>
								</Tooltip>
								<div className="flex gap-0.5 shrink-0">
									<button onClick={() => { setEditingSecret(s); setShowSecretModal(true); }} className="text-muted-foreground/70 hover:text-foreground p-0.5" title="编辑"><Edit3 size={12} /></button>
									<button onClick={() => handleDeleteSecret(s)} className="text-destructive p-0.5" title="删除"><Trash2 size={12} /></button>
								</div>
							</div>
						);
					})}
					{/* env 兜底常驻行 */}
					<div className="flex items-center gap-2 py-2 px-3 bg-muted/30">
						<span className={cn("inline-block w-[7px] h-[7px] rounded-full shrink-0", envFallback?.degraded_until && new Date(envFallback.degraded_until) > new Date() ? "bg-amber-500" : envFallback?.available ? "bg-green-400" : "bg-red-400")} />
						<span className="font-semibold text-sm text-muted-foreground">环境变量兜底</span>
						<span className="text-[0.6rem] px-1 py-px rounded bg-muted text-muted-foreground/70 shrink-0">兜底</span>
						<span className="text-[0.68rem] text-muted-foreground/70 font-mono shrink-0">sk-...{envFallback?.key_suffix || "****"}</span>
						<span className="text-xs text-muted-foreground shrink-0">
							{envFallback?.degraded_until && new Date(envFallback.degraded_until) > new Date()
								? <>熔断 · {degradedReasonLabel(envFallback.degraded_reason)}{recoveryText(envFallback.degraded_until, envFallback.degraded_reason) ? ` · ${recoveryText(envFallback.degraded_until, envFallback.degraded_reason)}` : ""}</>
								: envFallback?.available ? "可用" : "不可用"}
						</span>
						{envFallback?.call_count != null && envFallback.call_count > 0 && (
							<span className="ml-auto text-[0.68rem] text-muted-foreground/60 shrink-0">{envFallback.call_count}次 · ¥{envFallback.total_cost}</span>
						)}
						<Tooltip content="数据库无可用密钥时自动回退到此环境变量密钥；连续失败/限流会临时熔断以避免无谓重试">
							<button className="text-muted-foreground/40 hover:text-muted-foreground/70 p-0.5"><Info size={12} /></button>
						</Tooltip>
					</div>
				</div>
			</div>
```

- [ ] **Step 3: 用途绑定改为可折叠**

将 `{/* Purpose bindings */}` 块的外层标题行改为可点击折叠头，内容区按 `bindingsOpen` 条件渲染。把 283-299 行的标题 `<div>` 替换为：

```tsx
			<div>
				<div className="flex justify-between items-center mb-2">
					<button
						onClick={() => setBindingsOpen((v) => !v)}
						className="flex items-center gap-1 text-sm font-semibold text-foreground bg-transparent border-none cursor-pointer"
					>
						{bindingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
						用途路由（{configs.filter((c) => c.status !== "disabled").length}/{PURPOSES.length} 已绑定）
					</button>
					<button
						onClick={() =>
							reloadRouter()
								.then(() => { invalidate(); toast.success("已重载"); })
								.catch(() => toast.error("重载失败"))
						}
						className="inline-flex items-center gap-1 py-1 px-2 border border-border rounded-md bg-muted text-foreground cursor-pointer text-sm"
						title="重载路由"
					>
						<RefreshCw size={14} />
					</button>
				</div>
```

并把其后的 `<div className="border border-border rounded-lg overflow-hidden">...</div>`（绑定明细）用 `{bindingsOpen && ( ... )}` 包裹。

- [ ] **Step 4: tsc + biome**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/admin/ApiManagementTab.tsx`
Expected: tsc clean；biome 若报 import 排序 → `npx biome check --write src/components/admin/ApiManagementTab.tsx` 后再验。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/admin/ApiManagementTab.tsx
git commit -m "♻️ refactor: LLM API 密钥改紧凑表+env兜底行+熔断原因/恢复/预算内联+测试全部+折叠绑定"
```

---

## 阶段收尾 Checkpoint

- [ ] **前端**：`cd frontend; npx tsc --noEmit; npx biome check; npx vitest run`
  Expected: tsc 0；biome exit 0；vitest 仅遗留 showcase 用例失败（与本次无关），新增 llm-status 用例全绿。
- [ ] **后端**：`cd backend; uv run ruff check; uv run ty check`（本分支未改后端逻辑，仅 schema）
- [ ] **API 同步**：`pnpm run check:api`（生成文件 diff 干净）

---

## Self-Review

- **Spec 覆盖**：§2 密钥表→Task4-S2；§3 健康/成本→Task2(纯函数)+Task4-S2；§4 折叠绑定→Task4-S3；§5 key切换/URL/测试全部→Task3 + Task4-S1/S2；§6 后端字段→Task1。
- **无占位符**：每步含完整代码/命令。
- **类型/命名一致**：`degradedReasonLabel/statusText/recoveryText/costColorClass` 四函数在 Task2 定义、Task4 引用，签名一致；`testAllConfigs` 返回 `{results: TestResultItem[]}`（后端 `TestAllResultsResponse`）；`s.degraded_until/degraded_reason/total_cost_today/monthly_cost_used/monthly_cost_limit` 均为 `ApiSecretResponse` 既有字段；env 新字段来自 Task1。
- **风险**：Task4 是大块 JSX 替换，逐 Step tsc 验证；env 行对 `envFallback` 可空做了 `?.` 保护。
</content>
