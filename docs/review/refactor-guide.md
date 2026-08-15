# 分布补救重构指南（总纲）

> 版本：v1（基线 9410d921，2026-08-15）
> 授权：前后端无限大。约束：**先文档后代码**——本文档为重构行动的单一事实源，分域指南逐步落地。
> 配套：`defect-list.md`（缺陷清单，58+ 条已复核）、`refactor-scoring.md`（评分域）、`refactor-pipeline.md`（管道域）、`refactor-cases.md`（病例域）、`refactor-frontend.md`（前端+Mantine 收敛+ASR）、`refactor-infra.md`（基建域）。

---

## 0. 定位与使用方式

1. 本文档定义**为什么改、按什么顺序改、改到什么程度算完**；分域文档定义**每个文件怎么改**。
2. 每个 Phase 都有**验收口径**（见 §6），必须是可测量的（staging 指标或自动化测试），不许"感觉好了"。
3. **直接修复优先，测试克制**：核心数据契约与并发/时间不变量（INV-*、revision、deadline）各落 ≤2 个回归测试；UI/体验修复以 staging 冒烟清单 + 关键路径组件测试为准，**不逐项建测试**——测试是为关键不变量上保险，不是流程仪式（单人 + AI 辅助形态尤其如此）。
4. 任何 Phase 不得引入新的 `except Exception: pass` 静默路径；降级必须有显式标记与 UI 呈现。

## 1. 现状基线（不可辩驳的事实）

| 维度 | 事实 |
|---|---|
| 代码 | master=9410d921；Mantine v9 迁移已完成（43 提交）；后端评分/管道/模拟引擎 43 提交零改动 |
| 评分故障 | staging 实测：467 completed → 74 条评分故障（15.8%）= 41 次超时 + 33 条 0 分兜底 |
| 分数区间 | case1（难度1）avg 39.9 最低、case5（难度3）max 仅 65、全库无 >93；难度与得分倒挂 |
| 教师复核 | score_reviews = 0 行：功能存在但从未被使用 |
| 前端 | 已全量 Mantine v9（core/form/hooks/modals/notifications/spotlight），Tailwind/shadcn/lucide 已移除 |
| 产品语义 | 负责人认可"100 分映射直观"，评分标准由负责人撰写（raw 57→24 项实际 72）；部分条目（非语言沟通等）在纯文本媒介中**无法体现** |

## 2. 重构目标与非目标

### 产品方向（2026-08-15 主程序决策）
> **收敛、稳定、核心体验优秀；外延技术尝试边缘化。** 核心 = 病史采集训练闭环（对话→评分→复核→成绩）。计时器**硬截止 30 分钟**（D5）。simulation 定位**技术尝试**，安排临时入口（D6）。ASR/电话方向同为技术尝试，按实验室轨道推进，不阻塞核心路径。

### 目标（按优先级）
1. **G1 评分可信**：消除 15.8% 故障率中的确定性缺陷；总分与逐项明细有可审计的算术关系；0 分兜底可识别。
2. **G2 分数区间合理**：修正难度-得分倒挂与天花板压缩；评分与病例/媒介匹配（砍或改不可观察条目）。
3. **G3 对话与状态一致**：流式泄漏守卫真实生效；情绪/计时/结算三处时钟口径统一；并发写入无交错。
4. **G4 数据不教错**：病例矛盾与医学硬伤清零；生成病例与内置病例同一 schema 校验。
5. **G5 引擎名实相符**：CHF 生理表现可观测；乳酸/pH 临床合理区间；训练模块查体从静态配置走向会话级状态（或诚实降级命名）。
6. **G6 基建止血**：成本闸门、密钥与日志脱敏、队列持久化、多 worker 观测可信。
7. **G7 前端收敛**：Mantine 迁移的残余 shim 清理与主题/无障碍审计；ASR/电话方向以独立组件族落地。

### 非目标（明确不做，避免范围蔓延）
- 不重写 simulations 引擎的确定性内核（它是仓库最扎实的部分，只做临床校准）。
- 不引入第二套评分标准（rubric 语义裁剪≠换标准）。
- 不做全站无障碍重写——只修已登记项（U7）并立"新组件必须键盘可达"的门禁。
- 不重构既有 43 提交的 Mantine 迁移本体（已合入，反向操作无收益），只做**收敛与补漏**。

## 3. 全局原则

| 原则 | 内容 |
|---|---|
| P1 单一事实源 | 每个数据实体只有一个写入路径；`runtime_state` 类 JSONB 禁止无锁读改写；fallback 只进显式标记，不静默 |
| P2 双轨展示 | 后端返回 raw（测量值）与 display（映射值）双字段；UI 两者都展示，映射策略变化不重评 |
| P3 超时预算唯一 | 任何调用链：客户端超时 < 阶段超时 < 全局超时，重试总预算必须 < 全局 - 余量，写进常量并测试锁定 |
| P4 失败可见 | 评分降级/兜底/重试耗尽是数据事件：落库标记 + UI 呈现 + 指标上报，三级缺一不可 |
| P5 度量先于迁移 | 每个 Phase 开工前先落测量点（staging 查询或测试基线），验收时对比 |
| P6 后端先行 | 前端 Mantine 收敛（Phase 5）必须在后端契约（Phase 1-4）稳定后开始，避免双端同时漂移 |
| P7 核心域重设计优先 | 评分语义（raw/display 双轨+Σ条目）、工具指令面（HTTP+revision）、计时语义（硬截止）、流式单通道——**结构性重设计优先于增量修补**；体验缺陷（U 类）随重设计一并解决，不单独排期 |

## 4. 阶段路线图

依赖关系：`P0 → P1 → P2/P3（可并行）→ P4 → P5 → P6`（P2 与 P3 无相互依赖，可并行执行）。

### Phase 0 — 冻结与基线（进行中）
- **目标**：建立重构前的不可变基线。
- **交付物**：本文档 + defect-list.md（已复核）+ staging 指标快照（已采集：15.8% 故障率等）。
- **动作**：把 staging 指标查询固化为 `scripts/score-health.sql`（仓库内，只读），每次发布前后跑。
- **验收**：基线指标入库；无任何代码改动。

### Phase 1 — 评分正确性（最高优先，直击 15.8% 故障率）
- **范围**：S1-S10 全部；`backend/modules/training/scoring/*` + `prompts/scoring.py` + `schemas/score*`。
- **关键决策**（产品语义，需负责人确认后锁死）：
  1. 未涉及条目：1 分（保底 33）→ **0 分**，允许真 0（配合 G1 的 fallback 标记区分"真 0"与"故障 0"）；
  2. 总分口径：**Σ条目分**（用户可审计），维度分仅作 LLM 自评展示；
  3. 不可观察条目（comm_08/comm_10/comm_02）：从计分中删除或改写为文本可观测行为（"主动核对信息"）；
  4. raw 与 display 双轨：`Score.raw_total` + `Score.display_total` + 映射曲线版本号。
- **入口**：`refactor-scoring.md`。
- **验收**：见 §6 Phase 1。

### Phase 2 — 训练管道一致性
- **范围**：T1-T10；`pipeline/*`、`patient_ai/*`、`context/*`、`session/*`。**工具指令面（Phase 2.5）见 `refactor-tools.md`**——工具从 WS 迁 HTTP 指令面，与 Phase 2 的 T5/T6 联动。
- **关键决策**：
  1. 流式泄漏纠正：改为"先全量生成→守卫→再推送"或重试走队列（二选一，推荐前者，简化 SSE 双通道）；
  2. 情绪 turn_id 单调化；结算并入 paused_seconds；
  3. 查体读数从"患者自知"改为"待告知"；拒绝/抵触加工具层门控（配合度阈值）；
  4. 删除 v2 情绪路径与 FATIGUE 假文档（或实现注入）。
- **入口**：`refactor-pipeline.md`。

### Phase 3 — 病例数据治理
- **范围**：C1-C4；`backend/data/cases/*` + `schemas/case_schema.py` + `modules/cases/generation.py`。
- **关键动作**：
  1. 建病例校验器（断言一致性：示例 vs 病史时间线/症状有无/人物关系；年龄-生理区间；nursing_record 类型统一），进 CI；
  2. case2 vs quiz 患者去重或显式标注变体；
  3. case6 前囟等医学硬伤修正（需临床校对）；
  4. AI 生成病例与内置病例同一 schema 校验出口。
- **入口**：`refactor-cases.md`。

### Phase 4 — 生理引擎临床校准
- **范围**：P1-P6；`modules/simulations/*`。
- **关键动作**：
  1. CHF：vol 上限放开 + congestion→SpO2/RR/BP 耦合 + crackles 梯度化 + 结局判定绑定可观测证据；
  2. 乳酸/pH：生产项设上限、pH 生理下限映射（Henderson-Hasselbalch 或 sigmoid）、DKA 加酮体/AG 字段；
  3. 新增"临床数值区间校验"测试（pH∈[7.0,7.5] 且 sev<失败阈值 等）进 CI；
  4. simulations 接入评分闭环或明确降级为"演示沙盒"（产品决策）。
- **入口**：`refactor-pipeline.md`（P 域并入管道域文档或独立）。

### Phase 5 — 前端收敛 + ASR/电话方向（Mantine 已落地）
- **范围**：U1、U4、U5、U6、U7 + 新能力。
- **关键动作**：
  1. U1 滚动条：Mantine ScrollArea（`type="never"` 横向）+ `style={{wordBreak:"break-word"}}`；
  2. U4：中断 chip 加"重试本消息"（复用 correctLastMessage 通道）；假进度上限 90 + 超时倒计时；
  3. **U5 计时器硬截止（D5，30 分钟）**：见附录 A《计时器硬截止实现审计》——核心是删掉 paused 对执行 deadline 的延展、补 chat 准入守卫、收紧结算宽限、前端到点自动结束；
  4. U6：RecordDetail 增加真实情绪轨迹图（后端 emotion 事件已可聚合）或从 README 删除"轨迹可视化"；
  5. U7：ScoreItem 改 UnstyledButton + aria-expanded；
  6. **ASR/电话方向**（导师下一个大方向；定位=实验室技术尝试，见 D6）：
     - 独立 `CallShell` 组件族（通话状态机/VAD 波形/转写流/静音/结束），**与 Mantine 解耦**（Mantine 提供 Modal/Timeline/Notification 复用，但不承载通话核心）；
     - 后端 `CallSession` 状态机：复用 simulations 的 wait/clock 语义（半双工对讲机 MVP，PSTN 明确不做）；
     - ASR 落地顺序：浏览器 Web Speech（MVP，复活"语音输入"叙事）→ volc ASR 流式（生产）→ 电话对讲体验；
     - README 叙事对齐：先改"语音交互—TTS（ASR 规划中）"，上线后补 ASR。
- **入口**：`refactor-frontend.md`。

### Phase 6 — 基建/安全/运维
- **范围**：I1-I6。
- **关键动作**：
  1. 成本闸门：per-user/per-session 配额 + scoring max_tokens 降至 8k + monthly_cost_limit 真正比较降级；
  2. 日志脱敏：LLMCallLog 默认只存统计，prompt 详情二次确认 + 保留期清理任务；
  3. 密钥加密（AES-GCM + env 主密钥）+ 轮换流程；
  4. 队列落 DB 或 shutdown drain；关键计数改 DB 统计（multi-worker 可信）；
  5. 诊断 token 移 Authorization header；限流取真实 IP（反代层）+ IP+账号双维度。
- **入口**：`refactor-infra.md`。

## 5. 依赖与并行边界

```text
Phase 1 (评分) ──┐
                 ├──→ Phase 5 (前端展示双轨 + Mantine 收敛)
Phase 2 (管道) ──┤
Phase 3 (病例) ──┘  （P2/P3 与 P1 无代码交叠，可并行，但统一 CI 校验门）
Phase 4 (引擎) ───────────→ 独立，无前置（除 CI 门）
Phase 6 (基建) ───────────→ 独立，建议与 Phase 1 的成本闸门联动
```

**并行边界**：P1-P4 全部只动后端；前端 Phase 5 冻结，直到 P1/P2 的 API 契约（双轨字段、fallback 标记）落定。

## 6. 验收口径（全部可测量）

| Phase | 验收指标 | 当前基线 | 目标 |
|---|---|---|---|
| 1 | staging 评分故障率（failed + 0 分兜底）/ completed | 15.8% | < 3% |
| 1 | 0 分兜底全部带 fallback 标记且 UI 可见 | 0% 有标记 | 100% |
| 1 | 复核"不改分提交"总分不变（回归测试） | 失败（>100） | 恒等 |
| 1 | 总分 == Σ条目分（任意 20 条随机抽检） | 不成立 | 100% 成立 |
| 1 | case5 max / case1 avg 的难度-得分相关性 | 倒挂 | 难度单调（1<2<3 均值递增）或显式记录豁免 |
| 2 | 泄漏重试后前端显示 == DB 落库（抽检 20 次） | 不一致 | 100% 一致 |
| 2 | 会话 >120 条消息后情绪仍更新 | 冻结 | 正常 |
| 3 | 病例校验器在 CI 全量通过 | 不存在 | 存在且通过 |
| 4 | CHF 病程中 SpO2/RR 随严重度变化 | 恒定 | 变化且与叙事一致 |
| 4 | 全病例 pH ∈ [7.0, 7.5]（sev<失败阈值时） | 6.68 出现 | 全部通过 |
| 5 | 前端无横向滚动条（全路由截图回归） | U1 存在 | 0 |
| 5 | README 叙事与实现逐条对齐 | ASR 等不符 | 对齐 |
| 6 | 单会话评分成本上限生效（测试注入超限） | 无闸门 | 熔断 |

## 7. 风险登记册

| 风险 | 等级 | 缓解 |
|---|---|---|
| 评分语义变更（1→0 分、条目裁剪）导致历史分数不可比 | 高 | raw/display 双轨 + 映射版本号；历史分保留 raw，不做换算迁移 |
| 教师复核写回 Score 后，历史"已复核"语义变化 | 中 | review 写回仅对新评分生效；旧记录显式标注"AI 分" |
| Phase 1 改总分口径引发排行榜/作业口径变更 | 高 | 排行榜/作业消费改为"display（review 优先）"契约，先改后端口径再改前端 |
| 流式防泄漏重构（先全量后推送）增加首字延迟 | 中 | 只对泄漏高风险 case（deep_background 非空）启用；普通会话保持直推 |
| 病例数据修正影响已绑定作业的病例快照 | 中 | 训练已用 case_snapshot，修正只影响新训练；作业页提示"病例已更新" |
| Mantine 收敛期新组件引入无障碍回归 | 低 | CI 门禁：新组件必须 UnstyledButton/Button 语义 |
| ASR 方向范围蔓延（导师方向模糊） | 高 | 锁 MVP 边界：半双工对讲 + Web Speech 先行，PSTN 不做，书面确认 |
| 单 worker 扩容与多 worker 观测改造互踢 | 中 | Phase 6 先落 DB 统计再谈扩容 |

## 8. 分域文档索引

| 文档 | 域 | 状态 |
|---|---|---|
| `refactor-scoring.md` | 评分正确性（Phase 1） | 已交付 |
| `refactor-tools.md` | 通讯/工具指令面（Phase 2.5） | 已交付 |
| `refactor-pipeline.md` | 训练管道 + 生理引擎（Phase 2/4） | 已交付 |
| `refactor-cases.md` | 病例数据（Phase 3） | 已交付 |
| `refactor-frontend.md` | 前端收敛 + ASR/电话（Phase 5） | 已交付 |
| `refactor-infra.md` | 基建/安全/运维（Phase 6） | 已交付 |

> 全部 6 份分域文档已齐。Phase 1（评分）、2（管道）、2.5（工具指令面）、3（病例）、4（引擎）、5（前端）、6（基建）的启动条件与验收均可在各自文档中找到。

---

## 附录 A：计时器硬截止实现审计（D5，30 分钟）

> 结论先行：**当前实现是"活跃计时 + 无限暂停延展"，不是"墙钟硬截止"**。改硬截止需动 5 处，且有一个语义矛盾必须先拍板。

### A.1 现状链路（逐行核对，9410d921）

| 环节 | 位置 | 现状 | 与硬截止的关系 |
|---|---|---|---|
| time_limit 来源 | `router/session.py:209-210` | `config.behavior.time_limit_minutes or case.time_limit_minutes or 20`，钳制 [5,120]；10 个病例全为 20 | 当前窗口 = 20 分钟 |
| deadline 定义 | `timing.py:19-27` | `start + time_limit分钟 + **paused_seconds**` | **暂停延展截止时间** ← 与硬截止冲突 |
| 倒计时展示 | `session_views.py:228-229` | `compute_remaining_seconds`（=deadline-now，含暂停） | 展示口径含暂停延展 |
| chat 准入 | `router/chat.py:43-49` | 只查 `status != IN_PROGRESS`；**`is_training_overdue`（timing.py:30）零调用** | **无 deadline 守卫**（timing.py:4-7 声称"chat guard 派生自同一定义"是假话） |
| 结算扫频 | `settlement.py:29,66-73` | 每 30s；`start_time + time_limit*60 < now - 60s` | **SQL 漏 paused_seconds**（T4）；宽限 60s 偏长 |
| 到点行为（前端） | `TrainingHeader.tsx:66-70` | toast"**训练时间已到，你可以继续对话**或随时结束" | 文案与硬截止相反；无自动结束路径 |
| 倒计时 hook | `useTrainingTimer.ts:9,18,41,62-66` | 归零触发 onTimeUp 一次 | 只提示，不结束 |

### A.2 必须拍板的语义矛盾

**paused_seconds 是否延展截止时间？**
- 现状：延展（`timing.py:26-27`）→ 学生离开 2 小时回来剩余时间不变 = **无限暂停 = 硬截止形同虚设**。
- ✅ **已拍板（2026-08-15）：方案 A —— 执行口径 = 纯墙钟 `start + 30min`，paused 不延展**。离开页面：前端倒计时仍走服务端 remaining（到期即 0），服务端到期即结算；回来时若已超时 → 提示"训练已超时，已自动提交"。
- ✅ **已实施（2026-08-15）**：timing.py 纯墙钟 deadline；session.py 生效下限 max(30,·)；chat.py 消息/修正双准入守卫（409）；settlement 宽限 60→15s；前端到点自动 executeEnd + "已到期" 徽标。验收项见 §6 Phase 5 U5。
- 附带影响：`pause/resume` 端点（`session.py:623-664`）、`beforeunload` beacon、`settlement` SQL、`timing.py` 全部按方案 A 统一（paused_seconds 保留字段但不再进执行 deadline；`display_deadline` 与 `execution_deadline` 合一，均为墙钟）。

### A.3 硬截止 30 分钟落地清单（D5）

1. **统一生效窗口**：`_create_record` 处 `time_limit = max(30, 病例/配置声明值)`（病例可声明更长，不可更短）；clamp 上限 120 保留。10 个病例 JSON 的 `time_limit:20` 无需逐个改（但建议顺手改数据避免歧义）。
2. **deadline 单一口径**：`timing.py` 增加 `execution_deadline(record)`（纯墙钟，不含 paused，供准入+结算）与 `display_deadline(record)`（含 paused，仅供倒计时展示）；按 A.2 拍板结果决定两者关系。
3. **chat 准入守卫**：`send_message`/`correct_last_message` 前置 `is_training_overdue(record)` → 409"训练已超时，已自动提交"（顺带让 `is_training_overdue` 从死代码复活）。
4. **结算修正**：`settlement.py:71` SQL 改用 `execution_deadline` 口径（去掉 paused）；宽限 `EXPIRED_GRACE_SECONDS` 60 → 15（给最后一条消息落库留余量，不让学生再聊 90 秒）。
5. **前端到点自动结束**：`TrainingHeader.tsx:66-70` 改为"时间到 → 禁用输入 + 调 `onEnd()`（自动提交）"，失败回退 toast + 重试按钮；文案删除"可以继续对话"。
6. **倒计时口径**：`useTrainingTimer` 用服务端 remaining（display 口径）但本地到 0 即触发自动结束（不等结算）；时间到后轮询结束态兜底（防 end 请求丢失）。
7. **验收**：staging 起一场训练 → 挂 30 分钟（或临时把窗口调到 1 分钟做 E2E）→ 断言：到点前消息可发、到点后消息 409、60s 内记录自动 completed、前端进入"已自动提交"态、暂停 10 分钟不回页面仍到期。测试：`test_timing_execution_vs_display`、`test_chat_rejects_overdue`、`test_settlement_uses_execution_deadline`。

## 附录 B：simulation 临时位置（D6，技术尝试）

> 定位：技术尝试（确定性生理引擎的验证沙盒），**不进核心产品路径**。核心 = history_taking 训练闭环。

1. **入口归位**：`/simulation` 从公共路由（0f390c01 曾改为免登录——失控迹象）**收回登录保护**，放入主导航新分组「实验室」（`navigation.tsx`），label 带「实验性」徽标；保留原 URL 兼容。
2. **显式标识**：SimulationConsole 顶部加常驻横幅"技术预览：临床推理模拟（实验性）——不产生成绩，功能可能变更"；`SimulationSession` 记录加 `is_experimental=true` 审计标记。
3. **与核心隔离（现状已隔离，明确化）**：不进作业/评分/排行榜/成绩单；不消费评分域改造的契约（S 域双轨与其无关）。
4. **资源边界**：实验入口不计入班级训练统计；后续 ASR/电话方向若以 simulations 为载体（wait/clock 语义适配通话时间线），沿用同一实验室定位。
5. **收尾条件**：若 2 个迭代周期内无教学价值验证（教师/学生反馈、数据使用率），按 roadmap 既有决策（"删除分诊与 MEWS 等无实际使用价值的分支"）评估下架；入口收敛到实验室分组后，教师端无需可见。
6. **验收**：核心训练页无 simulation 入口干扰；实验室分组只此一项；免登录 URL 403；无成绩记录产生。
