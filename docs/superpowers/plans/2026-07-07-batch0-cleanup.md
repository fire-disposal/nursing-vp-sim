# Batch 0 — 清障（死代码/死残余删除 + 小程序移除 + 重命名）实施计划

> **✅ 本计划已执行完毕，分支已合并至 master。以下为历史记录，仅供参考。**

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans。步骤用 `- [ ]` 跟踪。
> 依据 spec：`docs/superpowers/specs/2026-07-07-training-core-convergence-design.md` §5.G / §5.A(死导出) / D3。

**Goal:** 删除全部已确认零引用的死代码、死 API、死残余，移除小程序工作区，重命名误导性符号，且 `pnpm run check` 保持绿。

**Architecture:** 纯删除 + 机械重命名，无行为变更。三条互不相交的并行轴（前端 / 后端 / 小程序）+ 串行收尾（重命名、类型重生成、全量校验）。

**Tech Stack:** React19/TS/Vite/Biome + FastAPI/ruff/ty + pnpm workspace。

**验证哲学:** 每个删除前 `rg` 确认零引用；每轴完成后 `pnpm run check`；删后端端点后 `pnpm run api:update` 重生成类型。

---

## 文件所有权（防并行冲突）
- 轴 A（前端）：仅动 `frontend/**`（除 `api-types.gen.ts`，由串行收尾重生成）
- 轴 B（后端）：仅动 `backend/**`
- 轴 C（小程序）：仅动 `miniprogram/**`、根 `package.json`、`pnpm-workspace.yaml`、`scripts/generate-miniapp-api.mjs`、`AGENTS.md`

---

## 轴 A — 前端死代码删除

**删除文件（先 `rg` 确认零 import 再删）：**
- [ ] `frontend/src/pages/ChatTraining.tsx` — 确认 `rg "ChatTraining" frontend/src` 仅自身
- [ ] `frontend/src/components/training/PatientPortrait.tsx` — 确认 `rg "PatientPortrait[^U]" frontend/src`（排除 `getPatientPortraitUrl`）仅自身
- [ ] `frontend/src/components/training/PanelErrorBoundary.tsx` — 确认零引用
- [ ] `frontend/src/components/training/panels/scoring-display/ScoringDisplayOverlay.tsx` + 从其 `index.ts` 删除该导出
- [ ] `frontend/src/api/nursing-records.ts` — 确认零 import（Batch 4 会新建结构化端点，此处先删死客户端）
- [ ] `frontend/src/showcase/components/VirtualMaskText.tsx` — 确认 `rg "VirtualMaskText"` 仅自身（活的是 `VirtualPatientMaskText`）
- [ ] `frontend/src/engine/tts/index.ts` — 确认 `rg "engine/tts\"|tts/index"` 无引用（直接 import `./tts/TTSManager` 已用）

**删除死导出（保留文件，删符号 + 无用引用）：**
- [ ] `frontend/src/api/chat.ts`：删 `sendMessage`（非流式，零引用；保留 `sendMessageStream`）
- [ ] `frontend/src/api/qa.ts`：删 `askInQASession`（保留 `askInQASessionStream`）
- [ ] `frontend/src/api/notifications.ts`：删 `getUnreadCount`（指向不存在路由）
- [ ] `frontend/src/api/training-state.ts`：删 `getTrainingState`、`updateTrainingFeatures`（对应后端死端点，轴 B 删）；若文件清空则删文件
- [ ] `frontend/src/engine/scene-state.ts`：删 `onSceneEvent`、`SceneMeta`、`QuickAction`、`SizePref`（零引用；保留 `emitSceneEvent`/`SceneProps`/`SceneState`/`SceneBusProtocol`——`SceneBusProtocol` Batch 3 用）

**清理孤儿开关管道（死 UI）：**
- [ ] `frontend/src/components/training/TrainingHeader.tsx`：删 `features.allow_pause` 暂停按钮（`~:108`）、未使用的 `toggleFeature`/`featuresLocked` 解构（`~:29,33`）
- [ ] 确认删除后 `TrainingContext` 的 `toggleFeature`/`featuresLocked` 是否仍有消费者；若无，标记留待 Batch 2 从 context 移除（本批不动 context 定义，避免与 Batch 2 冲突）

**轴 A 验证：**
- [ ] `cd frontend && pnpm exec tsc -p tsconfig.json --noEmit` 通过
- [ ] `pnpm exec biome check src` 不增新 error

---

## 轴 B — 后端死代码删除

**删除死端点（先确认无 FE/小程序引用；FE 由轴 A 删，小程序由轴 C 删）：**
- [ ] REST 查体：删 `backend/contexts/training/router/physical_exam.py` 整文件 + 从 `backend/contexts/training/router/__init__.py` 删其 import 与挂载（`:6,18`）。**保留** `backend/services/physical_exam.py`（WS 共用）
- [ ] SSE 通知流：删 `backend/contexts/training/router/scoring.py` 中 `notifications_stream`（`~:477-498`）及其 hub `subscribe`。保留 `/notifications`、`/notifications/read-all`、`/{id}/read`、PUT `/{id}/unread`
- [ ] 中途改开关：删 `backend/contexts/training/router/_config.py` 整文件 + 从 `router/__init__.py` 删挂载
- [ ] 训练态查询：删 `backend/contexts/training/router/progress.py` 中 `GET /state`（`~:83-143`）+ 相关 `schemas/training.py` 的 `TrainingStateResponse`（若零其他引用）

**删除死能力残余：**
- [ ] `backend/profiles/registry.py`：删 `TrainingProfile.capabilities` 字段 + 各 profile 填充（`history_taking/profile.py`、`triage/profile.py`）。**注意** `has_emotion`/`has_initiative` Batch 2 才删，本批保留
- [ ] `backend/core/case_schema.py`：删 `supported_plugins`（`~:79-84`）+ 确认 `contexts/case_generation/prompts.py` 中引用一并清理

**清理陈旧编译产物：**
- [ ] 删 `backend/services/llm/__pycache__/`（源已迁 `infrastructure/llm/`）；确认 `backend/services/llm/` 无 `.py` 源

**轴 B 验证：**
- [ ] `cd backend && uv run ruff check . && uv run ruff format --check .`
- [ ] `cd backend && uv run ty check .`（不增新 error）
- [ ] `cd backend && uv run python -m pytest -x -q`（现有测试不回归；若测试引用了删除的端点，更新或删除对应测试）

---

## 轴 C — 小程序移除（D3）

- [ ] 确认小程序未被后端运行时依赖：`rg "miniprogram" backend` 应无运行时引用
- [ ] 删除整个 `miniprogram/` 目录
- [ ] 根 `package.json`：删 `dev:miniapp`（若有）、`api:update:all` 中的 `api:generate:miniapp`、`api:generate:miniapp` 脚本本身
- [ ] `pnpm-workspace.yaml`：删 `miniprogram`（保留 `sandbox`）
- [ ] 删 `scripts/generate-miniapp-api.mjs`
- [ ] `AGENTS.md`：删 miniapp 相关行（`api:update:all` 描述、自动生成文件表中 `miniprogram/api/types.gen.ts`）
- [ ] `.github/workflows/`：确认无小程序专属步骤；若有则删

**轴 C 验证：**
- [ ] `pnpm install`（workspace 变更后）成功
- [ ] `pnpm run api:update`（不含 miniapp）成功

---

## 串行收尾（三轴完成后，我本人执行）

- [ ] 后端端点删除后重生成类型：`pnpm run api:update`（`api:spec` + `api:generate`），确认 `api-types.gen.ts` 移除了 `/exam/{op_type}`、`/notifications/stream`、`/features`、`/state` 路径
- [ ] 重命名（机械，全仓 `rg` 定位后逐一改）：
  - `SSEManager` → `RealtimeHub`（`backend/infrastructure/sse_manager.py` 类名 + 文件名 + 所有 `app.state.sse_manager` 引用点保持属性名或一并改为 `realtime_hub`；选择**保留属性名 `sse_manager` 暂不改**以缩小面，仅改类名与文件，或整体改——决策：仅改类名 `SSEManager→RealtimeHub`，文件重命名 `sse_manager.py→realtime_hub.py`，`app.state` 属性改 `realtime_hub`，全仓更新引用）
  - 前端 `notifySSEProgress`/`onSSEProgress` → `notifyProgress`/`onProgress`（`engine/ScoreManager.ts`、`engine/index.ts`、`hooks/useScoringNotifications.ts`）
  - 前端 `api/api-client.ts`（barrel）与 `api/client.ts`（axios 实例）消歧：将 barrel 重命名为 `api/index.ts` 或 `api/domains.ts`，更新引用（选 `api/index.ts`）
- [ ] 全量校验：`pnpm run check` EXIT=0
- [ ] 全量测试：`pnpm run check:full`（pytest）通过
- [ ] 提交（分轴多次或单次）：
  - `🔥 remove: 删除前端死代码与死 API 导出`
  - `🔥 remove: 删除后端死端点与死能力残余`
  - `🔥 remove: 移除小程序工作区`
  - `♻️ refactor: 重命名 RealtimeHub/notifyProgress，api barrel 消歧`

---

## Self-Review 覆盖检查
- spec §5.G 前端删除 7 文件 ✅ / 后端删除 ✅ / 小程序 ✅ / 死导出 ✅
- spec §5.A 重命名（RealtimeHub/notifyProgress/client 消歧）✅
- 未触及 Batch 2 领域（`has_emotion`/`has_initiative`/context 定义/生成器）——刻意留后 ✅
- 风险点：删端点→类型重生成→FE 引用必须先删（顺序：轴 A/B 先删 FE 客户端与后端端点，再重生成）✅
- 无占位符；删除项均有 spec file:line 依据 ✅
