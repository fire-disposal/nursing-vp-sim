# LLM 管理页面重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 LLM 管理页面从"密钥→用途指派"重构为"用途→模型指派"模式，前端卡片网格布局 + 后端 `model_override` 字段支持。

**Architecture:** 后端 `llm_configs` 表新增 `model_override` 可选字段；LLM 调用链 `client.py` → `router.py` 在获取 model 时优先使用 override，否则回退 `llm_profile.py` 默认。前端拆分为 `ApiManagementTab`(容器)、`SecretList`(密钥表)、`PurposeCardGrid`(网格)、`PurposeCard`(卡片) 四个组件。

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), React 19 + TypeScript + TanStack Query + Tailwind CSS v4 (frontend)

---

### Task 1: 后端迁移 — `llm_configs` 加 `model_override` 列

**Files:**
- Create: `backend/migrations/versions/ddl/<auto>_llm_config_model_override.py`

- [ ] **Step 1: 生成迁移文件**

```bash
cd backend; uv run alembic revision --autogenerate -m "llm_config_model_override"
```

Expected: 生成新的迁移文件在 `backend/migrations/versions/ddl/` 下。

- [ ] **Step 2: 验证迁移内容正确**

```bash
cd backend; uv run python -c "import ast; path='migrations/versions/ddl/'; import os; files=sorted([f for f in os.listdir(path) if f.endswith('.py')], reverse=True); print(files[0])"
```

读取最新迁移文件，确认包含：
- `def upgrade():` 中有 `op.add_column('llm_configs', sa.Column('model_override', sa.String(length=80), nullable=True))`
- `def downgrade():` 中有 `op.drop_column('llm_configs', 'model_override')`

- [ ] **Step 3: 执行迁移**

```bash
cd backend; uv run alembic upgrade head
```

Expected: 迁移成功，`llm_configs` 表新增 `model_override` 列，现有行均为 NULL。

- [ ] **Step 4: 验证迁移可逆**

```bash
cd backend; uv run alembic downgrade -1; uv run alembic upgrade head
```

Expected: 两次操作均成功。

---

### Task 2: 后端 ORM 模型 + Schema 变更

**Files:**
- Modify: `backend/models/llm.py:48-56`
- Modify: `backend/schemas/llm.py:54-80`

- [ ] **Step 1: `LLMConfig` 模型新增字段**

编辑 `backend/models/llm.py`，在 `LLMConfig` 类的 `status` 行后添加：

```python
model_override: Mapped[str | None] = mapped_column(String(80), nullable=True, default=None)
```

- [ ] **Step 2: Schema `LLMConfigCreate` 新增可选字段**

编辑 `backend/schemas/llm.py`，在 `LLMConfigCreate` 中添加：

```python
model_override: str | None = Field(default=None, max_length=80)
```

- [ ] **Step 3: Schema `LLMConfigUpdate` 新增可选字段**

编辑 `backend/schemas/llm.py`，在 `LLMConfigUpdate` 中添加：

```python
model_override: str | None = Field(default=None, max_length=80)
```

- [ ] **Step 4: Schema `LLMConfigResponse` 新增字段**

编辑 `backend/schemas/llm.py`，在 `LLMConfigResponse` 中添加：

```python
model_override: str | None = None
```

---

### Task 3: 后端 Service 层 — `LLMConfigService` 适配 `model_override`

**Files:**
- Modify: `backend/services/llm.py:121-144` (list_all)
- Modify: `backend/services/llm.py:146-175` (create_or_reactivate)
- Modify: `backend/services/llm.py:177-185` (update)

- [ ] **Step 1: `list_all` 返回 `model_override`**

编辑 `backend/services/llm.py`，在 `LLMConfigService.list_all` 的 result dict 中添加：

```python
{
    ...
    "model_override": getattr(c, "model_override", None),
}
```

插入位置：在 `"status": c.status,` 之前或之后。

- [ ] **Step 2: `create_or_reactivate` 处理 `model_override`**

编辑 `backend/services/llm.py`，方法签名新增参数：

```python
def create_or_reactivate(self, secret_id: int, purpose: str, label: str, model_override: str | None = None) -> int:
```

在 create 分支 `LLMConfig(...)` 构造中传入 `model_override=model_override`；在 reactivate 分支中设置 `existing.model_override = model_override`。

- [ ] **Step 3: `update` 方法支持 `model_override`**

编辑 `backend/services/llm.py`，在 `LLMConfigService.update` 的字段循环中，`"label"` 后添加：

```python
"model_override",
```

---

### Task 4: 后端路由 — Router + Client 使用 `model_override`

**Files:**
- Modify: `backend/routers/admin/secrets.py:79-86` (create_config)
- Modify: `backend/infrastructure/llm/client.py:545-574` (_select_config)

- [ ] **Step 1: Router `create_config` 传递 `model_override`**

编辑 `backend/routers/admin/secrets.py`，`create_config` 调用中传入 `model_override`：

```python
cfg_id = LLMConfigService(db).create_or_reactivate(
    secret_id=data.secret_id,
    purpose=data.purpose,
    label=data.label or "",
    model_override=data.model_override,
)
```

- [ ] **Step 2: 修改 `state.model` 赋值逻辑 — 优先使用 `model_override`**

编辑 `backend/infrastructure/llm/client.py:574`，将：

```python
state.model = get_model(purpose)
```

改为：

```python
state.model = getattr(config, "model_override", None) or get_model(purpose)
```

- [ ] **Step 3: 验证后端类型检查通过**

```bash
cd backend; uv run ty check
```

Expected: 类型检查通过，无新增错误。

---

### Task 5: 运行 Python 编译检查 + 现有测试

**Files:** (验证性步骤，不修改文件)

- [ ] **Step 1: Python 编译检查**

```bash
cd backend; uv run python -m compileall -q .
```

Expected: 无语法错误。

- [ ] **Step 2: 运行现有测试**

```bash
cd backend; uv run python -m pytest -x -q
```

Expected: 所有现有测试通过。

---

### Task 6: 重新生成 API Types + 前端 API 层适配

**Files:**
- Regenerate: `frontend/src/api/api-types.gen.ts` (auto)
- Regenerate: `openapi.json` (auto)
- Modify: `frontend/src/api/admin/api-management.ts` (如需)

- [ ] **Step 1: 运行 API 更新**

```bash
pnpm run api:update
```

Expected: `openapi.json` 和 `api-types.gen.ts` 重新生成，`LLMConfigCreate`、`LLMConfigUpdate`、`LLMConfigResponse` 类型包含 `model_override` 字段。

- [ ] **Step 2: 验证类型生成正确**

检查 `frontend/src/api/api-types.gen.ts` 中 `LLMConfigCreate` / `LLMConfigUpdate` / `LLMConfigResponse` 包含 `model_override?: string | null`。

- [ ] **Step 3: 前端 API 客户端无需改动**

`updateConfig` 函数签名使用 `Schemas["LLMConfigUpdate"]`，typegen 后自动包含 `model_override`。

---

### Task 7: 前端 — 新建 `SecretList` 组件

**Files:**
- Create: `frontend/src/components/admin/SecretList.tsx`

- [ ] **Step 1: 编写 `SecretList` 组件**

```tsx
import { Edit3, Info, Trash2 } from "lucide-react";
import type { components } from "@/api/api-types.gen";
import { cn } from "@/utils/cn";
import {
	costColorClass,
	degradedReasonLabel,
	recoveryText,
	statusText,
} from "./llm-status";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];

interface SecretListProps {
	secrets: ApiSecretResponse[];
	envFallback: Record<string, unknown> | undefined;
	onEdit: (secret: ApiSecretResponse) => void;
	onDelete: (secret: ApiSecretResponse) => void;
}

const STATUS_DOT: Record<string, string> = {
	active: "bg-green-500",
	degraded: "bg-amber-500",
	disabled: "bg-red-400",
};

export default function SecretList({
	secrets,
	envFallback,
	onEdit,
	onDelete,
}: SecretListProps) {
	return (
		<div className="border border-border rounded-lg overflow-hidden">
			<table className="w-full text-sm">
				<tbody className="divide-y divide-border">
					{secrets.map((s) => {
						const cost = Number(s.monthly_cost_used ?? 0);
						const limit = s.monthly_cost_limit ?? null;
						const recovery =
							s.status === "degraded"
								? recoveryText(s.degraded_until, s.degraded_reason)
								: "";
						return (
							<tr key={s.id} className="hover:bg-muted/40">
								<td className="py-2 px-3 whitespace-nowrap">
									<span
										className={cn(
											"inline-block w-2 h-2 rounded-full mr-2 align-middle",
											STATUS_DOT[s.status] || "bg-gray-400",
										)}
									/>
									<span className="font-semibold">{s.label}</span>
								</td>
								<td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
									sk-...{s.key_suffix}
								</td>
								<td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
									{statusText(s.status)}
									{s.status === "degraded" && (
										<span className="text-muted-foreground/60">
											{" · "}
											{degradedReasonLabel(s.degraded_reason)}
											{recovery ? ` · ${recovery}` : ""}
										</span>
									)}
								</td>
								<td className="py-2 px-3 text-xs whitespace-nowrap">
									<span
										className={cn(costColorClass(cost, limit))}
									>
										¥{cost.toFixed(2)} /{" "}
										{limit ? `¥${Number(limit).toFixed(0)}` : "不限"}
									</span>
								</td>
								<td className="py-2 px-3 whitespace-nowrap">
									<div className="flex gap-1">
										<button
											onClick={() => onEdit(s)}
											className="text-xs text-muted-foreground hover:text-foreground"
										>
											编辑
										</button>
										<button
											onClick={() => onDelete(s)}
											className="text-xs text-destructive hover:text-destructive/80"
										>
											删除
										</button>
									</div>
								</td>
							</tr>
						);
					})}
					{envFallback?.available !== undefined && (
						<tr className="bg-muted/20">
							<td className="py-2 px-3 whitespace-nowrap">
								<span
									className={cn(
										"inline-block w-2 h-2 rounded-full mr-2 align-middle",
										envFallback?.degraded_until &&
											new Date(envFallback.degraded_until as string) > new Date()
											? "bg-amber-500"
											: envFallback?.available
												? "bg-green-400"
												: "bg-red-400",
									)}
								/>
								<span className="font-semibold text-muted-foreground">
									环境变量兜底
								</span>
								<span className="ml-1 text-[10px] px-1 py-px rounded bg-muted text-muted-foreground/70">
									兜底
								</span>
							</td>
							<td className="py-2 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
								sk-...{envFallback?.key_suffix || "****"}
							</td>
							<td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
								{envFallback?.degraded_until &&
								new Date(envFallback.degraded_until as string) > new Date()
									? `熔断 · ${degradedReasonLabel(envFallback?.degraded_reason as string | null)}`
									: envFallback?.available
										? "可用"
										: "不可用"}
							</td>
							<td className="py-2 px-3 text-xs text-muted-foreground/60 whitespace-nowrap">
								{(envFallback?.call_count as number) > 0
									? `${envFallback?.call_count}次 · ¥${envFallback?.total_cost}`
									: ""}
							</td>
							<td className="py-2 px-3">
								<button
									className="text-muted-foreground/40 hover:text-muted-foreground/70"
									title="数据库无可用密钥时自动回退到此环境变量密钥"
								>
									<Info size={12} />
								</button>
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
```

---

### Task 8: 前端 — 新建 `PurposeCard` 组件

**Files:**
- Create: `frontend/src/components/admin/PurposeCard.tsx`

- [ ] **Step 1: 编写 `PurposeCard` 组件**

```tsx
import { useState } from "react";
import { updateConfig, toggleConfig } from "@/api";
import type { components } from "@/api/api-types.gen";
import { useToast } from "@/components/Toast";
import { cn } from "@/utils/cn";
import type { LlmPurpose } from "@/config/llm-purposes";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

interface PurposeCardProps {
	purpose: LlmPurpose;
	config: LLMConfigResponse | null;
	secrets: ApiSecretResponse[];
	profile: {
		model: string;
		temperature: number;
		max_tokens: number;
		semaphore: number;
	};
	onChanged: () => void;
}

const MODELS = [
	"deepseek-v4-flash",
	"deepseek-v4-pro",
	"deepseek-chat",
	"deepseek-reasoner",
];

export default function PurposeCard({
	purpose,
	config,
	secrets,
	profile,
	onChanged,
}: PurposeCardProps) {
	const toast = useToast();
	const [saving, setSaving] = useState(false);
	const isEnabled = config?.status === "active";
	const currentModel = config?.model_override || profile.model;

	const handleModelChange = async (model: string) => {
		if (!config) return;
		setSaving(true);
		try {
			await updateConfig(config.id, { model_override: model });
			toast.success("模型已更新");
			onChanged();
		} catch (e: unknown) {
			toast.apiError(e, "更新失败");
		} finally {
			setSaving(false);
		}
	};

	const handleToggle = async () => {
		if (!config) return;
		try {
			await toggleConfig(config.id);
			onChanged();
		} catch (e: unknown) {
			toast.apiError(e, "操作失败");
		}
	};

	return (
		<div
			className={cn(
				"border border-border rounded-lg p-4 space-y-3",
				!isEnabled && "opacity-60",
			)}
		>
			<div className="flex items-center justify-between">
				<div>
					<h4 className="font-semibold text-sm">{purpose.label}</h4>
					<p className="text-xs text-muted-foreground">{purpose.desc}</p>
				</div>
				{config && (
					<button
						onClick={handleToggle}
						className={cn(
							"text-xs font-medium px-2 py-0.5 rounded border cursor-pointer",
							isEnabled
								? "border-green-500/50 text-green-600 bg-green-50"
								: "border-red-400/50 text-red-500 bg-red-50",
						)}
					>
						{isEnabled ? "已启用" : "已停用"}
					</button>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<label className="text-xs text-muted-foreground w-10 shrink-0">
						模型
					</label>
					<select
						value={currentModel}
						onChange={(e) => handleModelChange(e.target.value)}
						disabled={saving || !config}
						className="flex-1 py-1 px-2 border border-border rounded-md text-sm bg-card disabled:opacity-50"
					>
						{MODELS.map((m) => (
							<option key={m} value={m}>
								{m}
								{m === profile.model && !config?.model_override
									? " (默认)"
									: ""}
							</option>
						))}
						{!MODELS.includes(currentModel) && (
							<option value={currentModel}>{currentModel}</option>
						)}
					</select>
				</div>

				<div className="flex items-center gap-2">
					<label className="text-xs text-muted-foreground w-10 shrink-0">
						密钥
					</label>
					<span className="text-sm">
						{config
							? `${config.secret_label} (sk-...${config.secret_suffix})`
							: "未指派"}
					</span>
				</div>
			</div>

			<div className="flex gap-2 flex-wrap">
				<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
					{profile.max_tokens} tokens
				</span>
				<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
					temp {profile.temperature}
				</span>
				<span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
					{profile.semaphore} 并发
				</span>
			</div>
		</div>
	);
}
```

---

### Task 9: 前端 — 新建 `PurposeCardGrid` 容器

**Files:**
- Create: `frontend/src/components/admin/PurposeCardGrid.tsx`

- [ ] **Step 1: 编写 `PurposeCardGrid` 组件**

```tsx
import type { components } from "@/api/api-types.gen";
import { LLM_PURPOSES } from "@/config/llm-purposes";
import PurposeCard from "./PurposeCard";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];
type LLMConfigResponse = components["schemas"]["LLMConfigResponse"];

const PROFILES: Record<string, { model: string; temperature: number; max_tokens: number; semaphore: number }> = {
	patient_chat: { model: "deepseek-v4-flash", temperature: 0.3, max_tokens: 512, semaphore: 50 },
	qa: { model: "deepseek-v4-flash", temperature: 0.7, max_tokens: 1024, semaphore: 50 },
	scoring: { model: "deepseek-v4-pro", temperature: 0, max_tokens: 4096, semaphore: 10 },
	scoring_feedback: { model: "deepseek-v4-pro", temperature: 0.3, max_tokens: 2048, semaphore: 10 },
	case_generation: { model: "deepseek-v4-flash", temperature: 0.3, max_tokens: 4096, semaphore: 3 },
};

interface PurposeCardGridProps {
	configs: LLMConfigResponse[];
	secrets: ApiSecretResponse[];
	onChanged: () => void;
}

export default function PurposeCardGrid({
	configs,
	secrets,
	onChanged,
}: PurposeCardGridProps) {
	const configByPurpose: Record<string, LLMConfigResponse | undefined> = {};
	configs.forEach((c) => {
		if (!configByPurpose[c.purpose] || c.status === "active") {
			configByPurpose[c.purpose] = c;
		}
	});

	return (
		<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{LLM_PURPOSES.map((p) => {
				const cfg = configByPurpose[p.value] || null;
				const profile = PROFILES[p.value] || {
					model: "deepseek-v4-flash",
					temperature: 0.7,
					max_tokens: 512,
					semaphore: 50,
				};
				return (
					<PurposeCard
						key={p.value}
						purpose={p}
						config={cfg}
						secrets={secrets}
						profile={profile}
						onChanged={onChanged}
					/>
				);
			})}
		</div>
	);
}
```

---

### Task 10: 前端 — 重构 `ApiManagementTab` 为容器组件

**Files:**
- Modify: `frontend/src/components/admin/ApiManagementTab.tsx`

- [ ] **Step 1: 重写 `ApiManagementTab` 为容器组件**

完全替换 `ApiManagementTab.tsx` 内容：

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus } from "lucide-react";
import { useState } from "react";
import {
	createConfig,
	deleteSecret,
	fetchConfigs,
	fetchEnvFallback,
	fetchSecrets,
	testAllConfigs,
} from "@/api";
import type { components } from "@/api/api-types.gen";
import { queryKeys } from "@/api/query-keys";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import EmptyState from "@/components/ui/empty-state";
import PurposeCardGrid from "./PurposeCardGrid";
import SecretList from "./SecretList";
import SecretModal from "./SecretModal";

type ApiSecretResponse = components["schemas"]["ApiSecretResponse"];

export default function ApiManagementTab() {
	const toast = useToast();
	const queryClient = useQueryClient();
	const { confirm } = useConfirm();
	const [showSecretModal, setShowSecretModal] = useState(false);
	const [editingSecret, setEditingSecret] = useState<ApiSecretResponse | null>(null);
	const [testingAll, setTestingAll] = useState(false);

	const { data: secrets = [] } = useQuery({
		queryKey: queryKeys.apiManagement.secrets,
		queryFn: () => fetchSecrets().then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: configs = [] } = useQuery({
		queryKey: queryKeys.apiManagement.configs(),
		queryFn: () => fetchConfigs(undefined).then((r) => r.data),
		staleTime: 5 * 60_000,
	});
	const { data: envFallback } = useQuery({
		queryKey: queryKeys.apiManagement.fallback,
		queryFn: () => fetchEnvFallback().then((r) => r.data),
		staleTime: 5 * 60_000,
	});

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.apiManagement.secrets });
		void queryClient.invalidateQueries({ queryKey: queryKeys.apiManagement.configs() });
	};

	const handleDeleteSecret = async (s: ApiSecretResponse) => {
		if (
			!(await confirm({
				title: "删除密钥",
				message: `删除 "${s.label}"？${s.config_count > 0 ? ` 该密钥仍有 ${s.config_count} 个用途绑定。` : ""}`,
				danger: true,
			}))
		)
			return;
		try {
			await deleteSecret(s.id);
			toast.success("已删除");
			invalidate();
		} catch (e: unknown) {
			toast.apiError(e, "删除失败");
		}
	};

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

	return (
		<>
			<div className="mb-6">
				<div className="flex justify-between items-center mb-2">
					<h3 className="text-sm font-semibold text-foreground">API 密钥</h3>
					<div className="flex gap-2">
						<button
							onClick={handleTestAll}
							disabled={testingAll}
							className="inline-flex items-center gap-1 py-1 px-3 border border-border rounded-md bg-muted text-foreground cursor-pointer text-sm disabled:opacity-50"
						>
							<Activity size={14} /> {testingAll ? "测试中..." : "测试连通性"}
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
				{secrets.length === 0 && !envFallback?.available ? (
					<EmptyState
						title="暂无密钥"
						description="添加 DeepSeek API Key 以开始使用"
					/>
				) : (
					<SecretList
						secrets={secrets}
						envFallback={envFallback}
						onEdit={(s) => {
							setEditingSecret(s);
							setShowSecretModal(true);
						}}
						onDelete={handleDeleteSecret}
					/>
				)}
			</div>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">用途配置</h3>
				<PurposeCardGrid
					configs={configs}
					secrets={secrets}
					onChanged={invalidate}
				/>
			</div>

			<SecretModal
				open={showSecretModal}
				secret={editingSecret}
				onClose={() => {
					setShowSecretModal(false);
					setEditingSecret(null);
				}}
				onSaved={invalidate}
			/>
		</>
	);
}
```

- [ ] **Step 2: 清理不再需要的内联函数**

确保组件不再包含已迁移到子组件的 `getConfig`、`handleDeleteConfig`、`handleToggle`、`handleReset`、`handleTest`、`handleQuickBind` 等函数。

**注意：** 移除 `configsByPurpose`、`getConfig`、`handleDeleteConfig`、`handleToggle`、`handleReset`、`handleTest`、`handleQuickBind`、`PURPOSES`、`STATUS_DOT`、`selectClass`、`bindingsOpen` 等旧代码。

---

### Task 11: 前端 — 更新 `LLMAPITab` 去掉 Card 包装

**Files:**
- Modify: `frontend/src/pages/admin/cost/LLMAPITab.tsx`

- [ ] **Step 1: 去掉外层 Card 包装**

将当前内容从 `<Card><CardContent><ApiManagementTab /></CardContent></Card>` 改为直接渲染 `<ApiManagementTab />`，移除不再需要的 `Card/CardHeader/CardTitle/CardContent` 导入和 `Key` 图标。

```tsx
import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, Cpu, TrendingUp } from "lucide-react";
import { fetchSecrets } from "@/api/admin/api-management";
import { queryKeys } from "@/api/query-keys";
import ApiManagementTab from "@/components/admin/ApiManagementTab";
import LoadingSkeleton from "@/components/ui/loading-skeleton";
import StatCard from "@/components/ui/stat-card";

function LLMCostSummary() {
	/* 保持现有实现不变 */
}

export default function LLMAPITab() {
	return (
		<div className="space-y-6 mt-4">
			<LLMCostSummary />
			<ApiManagementTab />
		</div>
	);
}
```

---

### Task 12: 前端类型检查 + Lint

**Files:** (验证性步骤)

- [ ] **Step 1: TypeScript 类型检查**

```bash
cd frontend; npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 2: Biome lint**

```bash
cd frontend; npx biome check
```

Expected: 无新增 lint 错误。如有格式问题，运行 `npx biome format --write` 修复。

---

### Task 13: 完整验证

**Files:** (验证性步骤)

- [ ] **Step 1: 启动开发服务器验证功能**

```bash
pnpm run dev
```

验证步骤：
1. 打开 `http://localhost:3000`，登录管理员账号
2. 进入 费用管理 → LLM API 页面
3. 确认费用概览正常显示
4. 确认密钥列表为表格式展示，环境变量兜底行带分隔
5. 确认用途配置区为卡片网格（2-3列）
6. 点击某用途卡片的模型下拉框，切换模型后确认更新成功
7. 点击某用途卡片的启用/停用按钮，确认状态切换
8. 添加新密钥、编辑密钥、删除密钥，确认功能正常
9. 点击"测试连通性"，确认全部密钥测试正常返回

- [ ] **Step 2: 运行完整检查**

```bash
pnpm run check
```

Expected: ruff + ty + biome + tsc 全绿。

---

### Task 14: 提交

- [ ] **Step 1: 查看变更**

```bash
git status
git diff --stat
```

- [ ] **Step 2: 提交**

```bash
git add backend/migrations/versions/ddl/*_llm_config_model_override.py
git add backend/models/llm.py backend/schemas/llm.py backend/services/llm.py
git add backend/routers/admin/secrets.py backend/infrastructure/llm/client.py
git add openapi.json frontend/src/api/api-types.gen.ts
git add frontend/src/components/admin/SecretList.tsx
git add frontend/src/components/admin/PurposeCard.tsx
git add frontend/src/components/admin/PurposeCardGrid.tsx
git add frontend/src/components/admin/ApiManagementTab.tsx
git add frontend/src/pages/admin/cost/LLMAPITab.tsx
git commit -m "✨ feat: LLM管理页面重设计 — 用途→模型指派 + 卡片网格布局"
```
