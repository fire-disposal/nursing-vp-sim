# AI 管理 UI 适配与重设计 Design

**日期**: 2026-07-12
**分支**: `refactor/ai-management-cleanup`
**状态**: 已与用户确认，待转 implementation plan

## 目标

围绕系统的真实用法——**N 个普通密钥（通常 1 个）+ 1 个 env 注入兜底密钥**——重设计 `/admin/costs` 的 "LLM API" 标签，让管理员能**清晰、精简、实用**地：
1. 看清每个密钥的健康（正常/熔断/停用）、熔断原因与恢复时间、成本 vs 预算（可靠性可视化，B）；
2. 便捷完成配置与应急处置（key 显示切换、URL 校验、测试连接/全部、绑定路由，C）。

设计原则：**信息密度优先、视觉克制**。不用大卡片/大进度环/倒计时动效；健康与预算信息内联为小圆点 + 文本 + 颜色。

## 非目标（Non-goals）

- **不**把 AI 配置管理独立成新页面（保持内聚在成本管理内）。
- **不**改数据库模型（ApiSecret / LLMConfig 结构不动）。
- **不**写死"2 个密钥"——结构支持任意个普通密钥。
- **不**做花哨可视化（无进度环、无动画倒计时、无仪表盘化改造）。
- **不**碰 TTS/ASR 标签、成本总览、导出等其它标签（本次仅 "LLM API" 标签）。

## 现状事实（已核实）

- 页面：`/admin/costs` → 标签 "LLM API" → `LLMAPITab.tsx` → 内嵌 `ApiManagementTab.tsx`（Secret/Config CRUD）。
- 组件：`ApiManagementTab.tsx`（主体）、`SecretModal.tsx`（密钥增改）、`ConfigModal.tsx`（用途绑定增改）。
- 后端**已暴露**（无需改）：`ApiSecretResponse` 含 `status / degraded_reason / degraded_until / monthly_cost_used / monthly_cost_limit / total_cost_today / call_count_today`。
- 后端**需补**：`FallbackStateResponse`（`schemas/ops.py:168`）当前 `extra="allow"`，运行时已透出但生成类型无字段。需显式声明 `degraded_reason / degraded_until / consecutive_failures`（router 已计算），并 `pnpm run api:update` 重新生成前端类型。
- `LLMConfigResponse` 无 degraded 字段——绑定行的运行时健康由其所属 secret 的状态推导（前端已同时加载 secrets + configs，可交叉引用），无需改后端。
- `testAllConfigs` API 已存在（`api-management.ts`），前端未接入。

## 设计

### 1. 信息架构（不变）
保持 `ApiManagementTab` 在 "LLM API" 标签内。不新增路由/页面。

### 2. 密钥列表（支持 N 个 + env 兜底常驻行）
将现有"密钥卡片 + 独立绑定块"改为**一张紧凑密钥表**：

| 列 | 内容 |
|----|------|
| 标签 | secret.label（env 行显示"环境变量兜底"，淡色 + "兜底"徽标） |
| 密钥 | `••••后4位`（env 行显示 key_suffix） |
| 状态 | 小圆点 + 文字（见 §3） |
| 成本 | `¥今日 / ¥本月上限`（见 §3 颜色规则） |
| 操作 | 测试 / 恢复(仅熔断) / 编辑 / 删除（env 行仅"测试"） |

- 普通密钥按 `created_at` 或 label 排序；**env 兜底行置底**、视觉弱化（背景淡色/顶部细分隔线 + "兜底"标注），不可编辑/删除。
- 布局对 1 个、2 个、N 个密钥一致，不写死数量。

### 3. 可靠性可视化（B，内联克制）
**状态圆点 + 文字**（复用现有 `STATUS_DOT` 色）：
- `active` → 绿点「正常」
- `degraded` → 琥珀点「熔断」+ 同行灰字后缀：`{原因中文} · {恢复文本}`
- `disabled` → 红点「停用」

**degraded_reason → 中文映射**（前端常量）：
- `rate_limited` → "限流"
- `consecutive_failures` → "连续失败"
- `cost_exceeded` → "超预算"
- 其它/空 → "降级"

**恢复文本**（由 `degraded_until` 计算）：
- 有 `degraded_until` 且在未来 → `约 {n}s 后恢复` / `约 {n}分钟后恢复`（`cost_exceeded` 到下月初 → `下月恢复`）
- 无 → 省略

**成本颜色规则**（`monthly_cost_used` vs `monthly_cost_limit`）：
- limit 为空/0 → 常规色，显示 `¥{今日} / 不限`
- used ≥ limit → 数字红色
- used ≥ 0.9×limit → 数字琥珀色
- 否则 → 常规色
- 展示格式 `¥{today_cost} / ¥{limit}`，tooltip 显示本月已用完整值。

**env 兜底行健康**：用新暴露的 `degraded_reason/degraded_until/consecutive_failures` 同规则渲染；未熔断时显示"兜底 · 可用"。

### 4. 用途绑定（收纳，支持多密钥路由）
5 个 purpose 的绑定保留，收进**默认折叠的"用途路由"区块**（标题行显示"5 用途已绑定"+ 展开箭头）：
- 展开后每 purpose 一行：`{purpose中文} → {secret标签}` + 该 secret 的状态圆点 + "改绑"下拉 + "停用/启用"。
- purpose 中文取自已建的 `frontend/src/config/llm-purposes.ts`（单一来源）。
- 未绑定的 purpose 显示"→ env 兜底"灰字提示。

### 5. 管理操作（C）
- **SecretModal**：
  - `raw_key` 输入加**显示/隐藏切换**（眼睛图标，type 在 password/text 间切换）。
  - `base_url` 加校验：非空时必须 `^https?://`（zod `.url()` 或 regex），错误提示"请输入完整 URL（含 https://）"。
- **顶部工具区**：加 **"测试全部"** 按钮 → 调 `testAllConfigs`，结果以 toast/内联汇总（成功 N / 失败 M）。
- **每行操作**：测试（现有 `testConfig` 语义，密钥级探活）/ 恢复（仅 `degraded` 时可见，调 `resetConfig`/reload）/ 编辑 / 删除。保持现有确认弹窗。

### 6. 后端改动（最小）
1. `schemas/ops.py` `FallbackStateResponse` 显式增加：
   ```python
   degraded_reason: str | None = None
   degraded_until: datetime | None = None
   consecutive_failures: int = 0
   ```
2. `pnpm run api:update`（重生成 openapi.json + api-types.gen.ts）。
3. 无其它后端逻辑改动（值 router 已产出）。

## 组件与文件影响

| 文件 | 改动 |
|------|------|
| `backend/schemas/ops.py` | +3 字段（env 兜底 degraded 状态） |
| `openapi.json` / `frontend/src/api/api-types.gen.ts` | 重生成（勿手改） |
| `frontend/src/components/admin/ApiManagementTab.tsx` | 重构为密钥表 + env 行 + 折叠绑定区 + 测试全部 + 内联健康/成本 |
| `frontend/src/components/admin/SecretModal.tsx` | key 显示切换 + URL 校验 |
| `frontend/src/schemas/llm-config.ts` 或 secret schema | URL 校验规则 |
| `frontend/src/config/llm-purposes.ts` | 复用（purpose 中文），必要时加 degraded_reason 中文映射（或新建小常量文件） |
| 可能新增 `frontend/src/components/admin/llm-status.ts(x)` | 状态/成本/恢复文本的纯函数 + 徽标小组件（便于单测） |

## 错误处理

- env 兜底端点/密钥列表加载失败 → 现有 `EmptyState`/错误提示复用。
- "测试全部"部分失败 → 汇总展示，不阻断。
- URL 校验失败 → 表单内联报错，阻止提交。

## 测试

- **前端单测（vitest）**：对 §3 的纯函数（`degradedText(reason, until)`、`costColor(used, limit)`、`recoveryText(until, reason)`）写单测（含边界：limit=0、until 过期、cost_exceeded 到下月）。
- **类型**：`tsc` 通过；`pnpm run check:api` diff 干净（生成文件同步）。
- **后端**：`FallbackStateResponse` 新字段——现有 ops/secrets 测试通过；如有 fallback 端点测试则断言字段存在。
- 手动核验：staging 上制造一次熔断（或 mock），确认原因/恢复文本、成本颜色正确。

## 成功标准

1. 管理员在 "LLM API" 标签能一眼看到每个密钥（含 env 兜底）的状态、熔断原因与恢复时间、今日/本月成本 vs 预算（超标变色）。
2. 支持任意个普通密钥，env 兜底作为置底特殊行清晰区分。
3. 可完成：新建/编辑密钥（key 可显示、URL 有校验）、测试单个/全部、绑定路由、熔断后恢复。
4. 视觉克制（无进度环/动画倒计时）；信息内联、密度优先。
5. 全量门禁绿（tsc/biome/vitest + 后端 ruff/ty/pytest + api 同步）。
</content>
