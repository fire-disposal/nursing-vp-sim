# 前后端通讯与 Tool 体系审查（Phase 2.5）

> 基线：9410d921。触发：主程序提出"是否学 simulation——按钮背后接指令而非封包"。本文件 = 通讯审计 + 指令/封包决策 + 落地步骤。

---

## 1. 现状通讯架构审计（三通道）

| 通道 | 协议 | 承载 | 方向 | 复杂度来源 |
|---|---|---|---|---|
| chat | HTTP SSE（`/api/chat/{id}/message/stream`） | 患者回复流式文本 | 客户端→服务端（发起）+ 服务端→客户端（流） | 泄漏纠正双推（T1）、重试重放（T2）、rAF 批处理 |
| tools | WebSocket（`/api/training/ws`） | 工具调用 `{tool,action,params}` → `tool:result/tool:error` | 双向 | request_id 幂等、pending 追踪、断线 settle、scene patch |
| events | 同上 WS + RealtimeHub（PG LISTEN/NOTIFY） | scoring 进度、emotion 变化、initiative、心跳 | 服务端→客户端 | 跨 worker 扇出、重连退避 |

**核心矛盾**：工具调用是**请求/响应语义**，却被放在**发布/订阅传输**（WS）上跑，于是前端必须自建一套"请求-应答关联"机制（`useToolBridge.ts`）：

- `pendingByBus`（WeakMap 全局态）+ `PendingWaiter`（remaining 集合 + 定时器 + resolve/reject）；
- `waitForPendingToolRequests`（`useToolBridge.ts:59-77`）：**结束训练必须等所有在途工具请求落库**，否则记录 finalize 时工具结果丢失；
- 断线 `settleAllPending`（`:49-57,96-103`）：WS 断开 → 立即拒绝所有等待者（这是 93e85944 为修"endTraining 死锁"打的补丁）；
- `tool:result` 同时携带 `scene` patch 与 `emotion` 桥接（`:133-153`）——一个消息干三件事。

这堆代码就是"WS 设计无疑具有复杂性"的具体账单：**请求/响应被塞进 pub/sub 传输，复杂度是架构错配的必然产物，不是功能需要。**

## 2. 工具协议现状（后端）

- 协议：`{tool: "physical_exam", action: "measure", params, request_id}`（`router/ws.py:120-135`）。
- 执行链：`execute_tool_request`（`tools/service.py:80-157`）→ 授权（owner/score_review + status + capability）→ **行锁** `with_for_update` → `_cached_result` 幂等回放 → 双写：
  - `TrainingToolRequest`（RPC 去重日志，`models/training.py:149-166`，unique(record_id, request_id)）；
  - `TrainingAction`（域时间线，`models/training.py:168-186`，评分读取的唯一事实源）。
- 错误路径：`IntegrityError` → 回滚 → 查缓存 → 冲突/回放；失败也落库（response 带 error）。

**重复建设**：`TrainingToolRequest` 与 `TrainingAction` 是**同一事务里同一请求的两行记录**——一个用于幂等、一个用于评分时间线。它们的数据（record_id/request_id/tool/action/params/result）**完全同构**，unique 约束也相同。双表 = 双写 = 双份维护成本，没有独立价值。

## 3. simulation 对照（指令模型的真相）

| 维度 | simulation（`/api/simulations/{id}/actions`） | 训练工具（当前） |
|---|---|---|
| 传输 | HTTP POST，请求/响应，同步返回完整快照 | WS，请求/响应被 pub/sub 化，结果需 request_id 关联 |
| 状态 | **引擎独占** `SessionState`（纯函数状态机，`engine.py`） | handler 各自 patch `runtime_state`/`scene`（无统一状态机） |
| 并发 | `revision` 单调计数（`engine.py:338`） | 行锁 + request_id 幂等 + IntegrityError 处理 |
| 审计 | `public_log` 在状态内 | 双表（RPC 日志 + 时间线） |
| 前端 | 终端渲染快照，无 pending 概念 | `useToolBridge` pending 追踪 + scene patch + 结束等待 |

**结论：simulation 的简单性来自三个源头**——(a) HTTP 请求/响应；(b) 服务端单一状态机 + revision 并发；(c) 状态即模型（无独立审计表）。训练工具只学这三点即可获得同等简单性，**不需要**照搬字符串命令解析与终端 UI。

## 4. 决策：指令而非封包——但学"语义"，不学"外壳"

**拍板（2026-08-15，主程序）**：工具面统一为**结构化指令面**（command surface），从 WS 迁到 HTTP，聊天保持 SSE 流式。

### 学什么
1. **单一指令注册表**：`{cmd: "physical_exam.measure", params, idem_key, revision}` —— `registry` 改为 `cmd → handler` 单表（当前是 tool+action 两段式，字段冗余）。
2. **工具走 HTTP POST**：`POST /api/training/{record_id}/tools`，同步返回 `{ok, data, scene, revision}`。请求/响应天然匹配工具语义；**WS 只保留服务端推送事件**（scoring/emotion/initiative/心跳，RealtimeHub 不变）。
3. **revision 乐观并发**（学 `engine.py:338`）：`training_records.revision` 单调递增，每次变更返回新 revision，前端下次请求携带——结构上消灭 JSONB 无锁覆盖（T5），替代"行锁 + request_id 幂等"的复杂组合（行锁保留给最终一致性兜底，不作为主机制）。
4. **单审计表**：`TrainingAction` 与 `TrainingToolRequest` 合并为一张 `training_actions`（unique(record_id, request_id) 同时承担幂等与时间线）；评分契约（读 TrainingAction 时间线）不变，评分域零影响。
5. **前端快照化**：每个工具响应带**完整** `scene`（当前 service 已返回 scene，前端 patch 改为替换），删除 `useToolBridge` 的 pending 机制与 `waitForPendingToolRequests`（结束训练不再等工具——HTTP 请求天然先于 endTraining 完成）。

### 不学什么
1. **自由文本命令解析**（`/give morphine`、`aliases.ts`）：核心训练的按钮是结构化交互，字符串解析只属于 simulation 的终端美学。
2. **聊天命令化**：对话是流式、非确定的 LLM 交互，强行塞进指令封包会摧毁 SSE 体验；chat 保持现状（T1/T2 按 pipeline 域修复）。
3. **终端 UI 外壳**：核心训练保持表单/按钮/面板范式。

### 迁移收益（量化）
- 删除 `useToolBridge.ts` 全部 pending 逻辑（~150 行）+ `useTrainingWS` 的 sendTool 分支 + `waitForPendingToolRequests` 调用点；
- 删除 `TrainingToolRequest` 表/模型/双写（~60 行 + 迁移）；
- 消灭"endTraining 死锁"整类 bug（93e85944 的 settle-all 补丁可随迁移除或保留为事件通道的健壮性）；
- 工具错误从"WS 断线=结果未知"变为"HTTP 响应明确 4xx/5xx"，前端错误态可信。

## 5. 落地步骤（文件级）

### 后端
1. `schemas/training/tool.py`（新）：`ToolCommandRequest{cmd, params, idem_key, revision}`、`ToolCommandResponse{ok, data, scene, revision, error}`；cmd 枚举由 registry 生成（`Literal` 联合或运行时校验）。
2. `modules/training/tools/registry.py`：`registry: dict[str, ToolHandler]` 改 `cmd → handler`（`physical_exam.measure` 全名）；`dispatch(cmd, params, ctx)` 保持；`_authorize` 从 `tool_name` 改为 `cmd` 前缀（保留 capability 检查）。
3. `modules/training/router/tools.py`（新端点）：`POST /api/training/{record_id}/tools`；校验 idem_key/revision；`revision` 不匹配 → 409 + 当前 revision（前端重取快照）；幂等回放用 `training_actions` 唯一约束。
4. `models/training.py`：`TrainingToolRequest` 删除（迁移 drop 表）；`TrainingAction` 加 `idem_key` 语义（request_id 即 idem_key）+ `revision` 列；`TrainingRecord` 加 `revision` 列（`UPDATE ... SET revision = revision + 1, runtime_state = runtime_state || :patch`）。
5. `router/ws.py`：删除 tool 分支（`tool:` 消息类型不再处理）；WS 仅剩事件推送 + 心跳 + ping。
6. `tools/service.py`：`execute_tool_request` 简化——去行锁主路径（revision 校验代替）、去双写（单表）、失败响应带 revision。

### 前端
7. `engine/useToolBridge.ts`：删除 pending 机制；`sendTool` → `fetch POST /tools`（组件局部 loading 状态）；`waitForPendingToolRequests` 删除；endTraining 不再等待。
8. `engine/TrainingTool.ts`/各工具面板：调用签名从 `{tool, action, params}` 改为 `cmd`；scene 状态从 patch 改快照替换（`scene:state` 事件保留）。
9. `useTrainingWS`：仅事件订阅（scoring/emotion/initiative/heartbeat）。

### 兼容与灰度
10. WS tool 协议保留一个发布周期（旧前端可用），新前端切 HTTP 后下个周期移除；`training_actions` 历史行直接可读（schema 兼容）。

## 6. 验收与回归（克制）

- 关键回归（3 个）：
  - `test_tool_revision_stale_rejected`（T5 根治：旧 revision 提交 409）；
  - `test_training_actions_single_source`（双写合并后幂等回放与评分时间线同一张表）；
  - `test_tool_http_endpoint`（新端点授权/幂等/错误响应带 revision 冒烟）。
- 其余（前端 pending 机制删除、endTraining 不再等待、WS 工具分支移除）以**代码删除本身**为验收：`grep useToolBridge pending` 零命中、`waitForPendingToolRequests` 无引用即可，不建测试。
- 训练页冒烟：查体/护理记录/quiz 全流程走 HTTP 指令面，断线重试错误即时可见。

## 7. 与其他域的关系

- **T5（JSONB 并发）**：本方案是根治；`refactor-pipeline.md §2.5` 降级为"revision 校验细节"，不再需要 JSONB `||` 补丁方案。
- **评分域**：`TrainingAction` 时间线契约不变（refactor-scoring.md §3.9 依赖它），评分零影响。
- **D5 硬截止**：chat 准入守卫不受影响（HTTP 工具与 chat 分离后更清晰）。
- **D6 simulation 实验位**：simulation 保持自身 HTTP 指令面不动；本方案是"学其思想"，不合并代码。
