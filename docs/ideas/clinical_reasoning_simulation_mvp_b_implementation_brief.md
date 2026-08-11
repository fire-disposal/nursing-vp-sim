# Clinical Reasoning Simulation — MVP-B Implementation Brief

> 用途：直接交给 Codex / 编程 Agent 执行  
> 本轮范围：完成 MVP-A + MVP-B，随后停止  
> 背景规范：`clinical_reasoning_simulation_execution_spec.md`  
> 优先级：若背景规范与本文在范围、复杂度或交付顺序上冲突，**以本文为准**

## 1. 本轮任务

在现有 React + FastAPI 主系统中，实现一个能够从开局完整运行到结局的术后隐匿性出血文字模拟病例。

首版必须验证三个相互关联的核心机制：

1. **时间资源**：玩家是单线程的，主动临床行为消耗时间；后台病程、监护和检查处理并行推进。
2. **时间锚点**：等待或执行耗时行为时，世界事件按时间顺序结算；重要可见事件把控制权交还玩家。
3. **检查资源管理**：检查有申请/采样时间、周转时间、pending 生命周期、费用和复查趋势；同一次结果只能实例化一次。

本轮不是通用模拟平台建设。目标是完成一个小而完整、可以试玩和验证的纵向切片。

## 2. 强制停止边界

完成本文验收项后停止开发并汇报，不得提前实施后续阶段。

本轮明确不做：

- LLM、患者 AI、AI 意图解析、AI 会诊或 AI 报告生成；
- YAML/JSON 病例 DSL、通用病例编辑器或任意规则语言；
- 概率病程、概率 modifier 或批量 seed 仿真；
- Ground Truth、Materialized Data、Player Knowledge、Narrative Context 四套复杂类型或权限系统；
- 通用 `LOCKED / CONSTRAINED / GENERATIVE` 数据生成框架；
- 多病例、多患者、多医护人员或人员排班；
- WebSocket、复杂 SSE 基础设施或分布式任务队列；
- 完整医院检查目录、影像、药理或生理数字孪生；
- 正式卡片式 GUI、xterm.js、动画和复杂视觉设计；
- 综合 AI 评分、完整教学量表或自动诊断建议。

不要为上述能力预建抽象层、空接口、数据库表或占位服务。只有当前 MVP 实际使用的代码才能进入实现。

## 3. 产品范围

### 3.1 玩家身份

玩家是一个抽象的 `Clinical Operator`，不严格映射某个现实岗位权限。玩家一次只能执行一个主动行为。

### 3.2 唯一病例

病例：腹部手术后第 1 日患者发生逐渐加重的隐匿性出血。

教学重点：

- 通过生命体征和引流评估识别早期异常；
- 及时启动监护和 CBC；
- 合理利用检查等待时间；
- 不因等待检查而忽略病情变化；
- 根据趋势复查并及时报告；
- 认识延误与重复检查的时间/费用影响。

### 3.3 可执行动作

首版仅实现以下动作：

```text
/status                  查看当前已知状态，不消耗时间
/assess vitals           测量生命体征，消耗 2 min
/assess drain            评估引流，消耗 3 min
/order cbc               申请并完成采血，消耗 3 min；结果延迟返回
/monitor vitals          开启持续生命体征监护，消耗 2 min
/report doctor           向医生报告，消耗 2 min
/wait                    等待至下一个 Anchor
/wait cbc                尝试等到最近一次 pending CBC 返回，可被更早事件中断
/view cbc                查看最近一次已返回 CBC，不消耗时间
/history                 查看玩家已发生的动作和已公开事件，不消耗时间
```

允许为实现清晰度增加 `/help` 和 `/pending`，但不要增加新的临床行为。

所有命令必须尽早解析为结构化 Action；Engine 不接收斜杠字符串。

```json
{
  "type": "ASSESS",
  "target": "vitals"
}
```

React 命令解析器只是 adapter。未来按钮应能直接发送同一 Action，但本轮不实现按钮。

## 4. 核心玩法规则

### 4.1 世界并发，玩家单线程

主动动作占用玩家时间，但以下过程继续运行：

- 隐藏出血进展；
- 已申请 CBC 的处理；
- 已开启监护的异常检测；
- 已安排的结局检查。

首版不允许玩家同时执行两个主动动作，也不委派给其他人员。

### 4.2 时间资源

游戏时间使用从病例开始计算的整数分钟。界面可显示为 `08:30` 起的时钟。

主动动作从当前时间开始，完成时推进相应分钟。推进期间必须依次处理到期事件，不能直接把时钟加到结束时间而跳过后台变化。

为控制复杂度，本轮采用以下规则：

- 主动动作视为原子行为，中途不要求玩家选择取消；
- 行为期间发生的隐藏事件正常结算；
- 行为期间发生的 critical 可见事件在动作结束时立即呈现；
- 日志记录事件实际发生时间和玩家重新获得控制的时间，以便观察识别延迟。

### 4.3 Event 与 Anchor

`Event` 是世界在某时间发生的事情；`Anchor` 是需要把控制权交还玩家的时间点。

首版事件至少包括：

```text
BLEEDING_PROGRESS       隐藏出血加重；默认不可见、不打断
CBC_READY               CBC 已产生；可见提示、打断等待
MONITOR_ALERT            监护发现异常；可见、打断等待
SPONTANEOUS_DETERIORATION 病情达到明显阈值；可见、打断等待
CASE_SUCCESS / CASE_FAILURE 结局；可见、打断并结束病例
```

`/wait` 查找并处理事件队列，直到出现第一个可见且 `interrupt=true` 的事件。

`/wait cbc` 表示玩家计划等待 CBC，但若更早发生监护报警或明显恶化，等待必须提前结束，CBC 保持 pending。

多个事件发生在同一分钟时必须使用固定优先级和稳定序号排序。建议优先处理状态变化，再解析观察/监护，最后处理结果通知和结局，以保证行为确定。

### 4.4 可见性最小模型

本轮不建设完整四层隔离，只使用一个轻量 `SessionState`：

```python
class SessionState:
    hidden_state: HiddenClinicalState
    known_state: KnownState
    records: list[ClinicalRecord]
    pending_tasks: list[PendingTask]
    events: list[ScheduledEvent]
    action_log: list[ActionRecord]
```

规则：

- `hidden_state` 只能由 Engine 使用，不能直接序列化给前端；
- 主动评估只公开该评估能观察到的结果；
- 开启监护后，达到阈值才产生公开报警；
- CBC 到期时仅公开“结果已返回”；具体值在 `/view cbc` 后公开；
- `ClinicalRecord` 使用 `revealed: bool` 区分已生成与已查看；
- `/status` 和 API snapshot 只返回 `known_state`、公开事件和允许显示的 pending 摘要。

## 5. 检查资源管理

### 5.1 CBC 生命周期

```text
ORDERED → PROCESSING → READY → REVEALED
```

执行 `/order cbc`：

1. 校验病例未结束；
2. 玩家消耗 3 分钟完成申请和采血；
3. 创建唯一 `order_id`；
4. 记录采样时间；
5. 创建 `PendingTask`，默认周转时间 15 分钟；
6. 调度 `CBC_READY`；
7. 记录费用，建议首版固定为 ¥35。

玩家可以复查 CBC，但同一时刻不应无意义地下达多份重复 CBC。首版规则：已有 `PROCESSING` CBC 时再次申请应被拒绝，并明确提示最近 pending 项。

### 5.2 On-demand Materialization

CBC 在 `CBC_READY` 事件处理时生成，而不是申请时生成。生成只使用：

- `sampled_at` 对应的出血状态快照；
- 上一次 CBC；
- 与上次采样间隔；
- 两次采样之间是否完成有效报告/处置；
- 小范围、可测试的本地规则。

注意：检查结果应反映**采样时**状态，而不是结果返回时状态。下单/采样时保存必要的轻量快照。

本轮只需实现：

```python
materialize_cbc(
    sample_snapshot,
    previous_cbc,
    elapsed_since_previous,
) -> CBCResult
```

建议字段：

```text
Hb          关键趋势字段
WBC         非关键、窄范围确定值或简单规则值
Platelet    固定正常值
```

规则应简单且确定：出血越重，Hb 越低；若持续出血，复查 Hb 不应无依据升高；有效处置后可以趋稳，但本轮无需模拟复杂输血效果。

同一次 `order_id` 一旦产生结果，任何重试、刷新、重复事件处理或 `/view cbc` 都只能返回原记录，不得再次调用 materializer。

### 5.3 费用与资源

费用不作为余额，不阻止玩家申请合理检查。每次成功申请 CBC 累加固定费用，并在结局摘要显示：

- CBC 次数；
- 总检查费用；
- 是否存在 pending 时重复申请；
- 复查间隔。

检查资源管理的主要约束是玩家采样时间、周转时间和 pending 生命周期，而不是 RPG 点数。

## 6. 病程与结局建议

病例先直接定义在 Python 中，不创建 DSL。数值可根据医学专家意见调整，以下只定义工程行为。

### 6.1 隐藏状态

```python
bleeding_severity: float  # 0.0–1.0
reported_to_doctor: bool
monitoring_enabled: bool
case_status: str
```

每隔固定时间调度一次 `BLEEDING_PROGRESS`。未及时报告时严重度逐步增加；报告后可停止或显著减慢进展。不要实现通用 effect 语言。

### 6.2 观察阈值

- 早期：针对性评估引流可发现异常；患者界面不主动泄露。
- 中期：生命体征评估可见 HR 上升、BP 下降趋势。
- 已监护：达到中期阈值时自动产生 `MONITOR_ALERT` Anchor。
- 晚期：即使未监护也产生明显恶化 Anchor。

具体生命体征由简单确定性映射产生并保存到本次评估结果中，不需要生理引擎。

### 6.3 结局

至少实现两个结局：

- **较好结局**：在失败阈值前发现异常并完成 `report doctor`，病情得到控制；
- **延误结局**：未及时识别/报告，出血达到失败阈值。

可以设置一个最低必要检查或识别条件，但不要让“只输入 report”无条件获胜。建议报告内容由当前已知证据决定：玩家至少公开获得一项异常证据后，报告才算有效升级。

## 7. 建议最小数据结构

可与现有项目命名风格对齐，不要求逐字照搬。

```python
@dataclass(frozen=True)
class SimulationAction:
    type: str
    target: str | None = None

@dataclass(order=True)
class ScheduledEvent:
    at_minute: int
    priority: int
    sequence: int
    id: str
    type: str
    payload: dict

@dataclass
class PendingTask:
    id: str
    kind: str
    status: str
    ordered_at: int
    sampled_at: int
    due_at: int
    sample_snapshot: dict

@dataclass
class ClinicalRecord:
    id: str
    order_id: str
    kind: str
    sampled_at: int
    ready_at: int
    result: dict
    revealed: bool

@dataclass
class ActionRecord:
    started_at: int
    completed_at: int
    action: SimulationAction
    outcome: str
```

可以使用现有 Pydantic 模型代替 dataclass。不要为本轮创建复杂继承层级、通用插件系统或 event sourcing 框架。

## 8. Engine 行为边界

核心调用建议保持简单：

```python
result = engine.apply_action(session, action)
```

返回：

```python
class ActionResult:
    accepted: bool
    session_revision: int
    messages: list[DomainMessage]
    case_ended: bool
```

Engine 负责：

- 校验 Action；
- 推进主动行为耗时；
- 处理期间到期事件；
- 更新隐藏/已知状态；
- 创建和完成 CBC pending task；
- 实例化并保存 CBC；
- 识别 Anchor 和结局；
- 写 action/event/cost 日志。

React 和 FastAPI 不得复制上述规则。

## 9. API 与前端

### 9.1 最小 API

```http
POST /api/simulations/sessions
GET  /api/simulations/sessions/{session_id}
POST /api/simulations/sessions/{session_id}/actions
```

如果现有系统已有流式通道可直接复用；否则本轮使用普通 HTTP 即可。等待操作可以在一次请求内快速完成离散事件计算，无需按真实分钟等待，也无需 SSE。

API snapshot 不得包含 `hidden_state`、未公开 CBC 具体值或未来隐藏事件 payload。

### 9.2 React Clinical Console

使用普通 React DOM：

- 等宽字体；
- 可滚动消息列表；
- 单行输入；
- 固定语义前缀和颜色；
- 不依赖颜色传达唯一信息。

消息类型建议：

```text
[SYSTEM]       时间推进、动作反馈
[ASSESSMENT]   主动评估结果
[MONITOR]      监护报警
[LAB]          CBC 状态和结果
[WARNING]      需要注意的变化
[CRITICAL]     明显恶化或失败
[AUDIT]        结局摘要
```

后端返回结构化消息 `{kind, at_minute, text}`；不要返回 ANSI，不要让前端推导临床事实。

## 10. 持久化策略

优先复用现有主系统最简单的持久化能力。至少保存：

- 当前时间；
- hidden/known 状态；
- pending CBC；
- 已生成 ClinicalRecord；
- event queue；
- action/event/cost log；
- case status。

如果接入现有数据库明显阻碍首个可玩闭环，可以先使用 repository interface 的内存实现完成 MVP-A，再在 MVP-B 验收前换成简单数据库实现。

不要求 event sourcing。保存整个 session JSON 或少量规范化表均可，以最贴合现有项目者为准。

## 11. 实施顺序

严格按以下顺序推进，每一步都保持可运行：

1. 定义唯一 Python 病例和 Session/Action/Event 最小模型；
2. 完成 Engine 的评估、监护、报告和基础病程；
3. 完成主动动作耗时与 `/wait` Anchor；
4. 用后端测试跑通较好/延误两条路径；
5. 接入 FastAPI 最小端点；
6. 完成 React Clinical Console 和斜杠 parser；
7. 增加 CBC pending 生命周期与费用；
8. 增加结果到期时 materialization、持久化和 `/view cbc`；
9. 增加第二次 CBC 的趋势规则；
10. 完成刷新恢复、失败路径和最终验收测试；
11. 停止，提交试玩说明与未决问题，不进入后续 MVP。

## 12. 必测行为

### 12.1 时间与 Anchor

- `/assess drain` 精确消耗 3 分钟；
- 主动动作期间到期的隐藏病程事件不会丢失；
- `/wait` 到达下一个可见中断事件；
- `/wait cbc` 会被更早的监护报警打断；
- 被打断时 CBC 仍为 pending，之后可继续等待；
- 时钟永不倒退，同时刻事件顺序稳定。

### 12.2 信息可见性

- 开局 API 和 Console 不出现隐藏出血严重度；
- 未评估引流时不显示早期引流异常；
- 未开启监护时，中期隐藏变化不会产生监护报警；
- CBC ready 但未 view 时不返回具体数值；
- `/status` 不泄露未来事件或隐藏字段。

### 12.3 CBC

- 成功申请后创建一个 pending task 和一次费用；
- pending 时重复申请被拒绝且不重复收费；
- `CBC_READY` 只生成一次结果；
- 多次 `/view cbc` 返回相同记录；
- 刷新/重新加载 session 后结果不变；
- 第二次 CBC 使用新的采样状态和前次值，持续出血时 Hb 不无依据上升；
- 检查反映采样时状态而非返回时状态。

### 12.4 结局

- 有异常证据并及时报告可到达较好结局；
- 无依据立即报告不能直接获胜；
- 持续等待或忽略异常可到达延误结局；
- 结局后临床 Action 被拒绝；
- 结局摘要包含关键时间、CBC 次数和费用。

## 13. 验收试玩脚本

至少手动演示以下三局。

### 场景一：主动评估与及时报告

```text
/assess vitals
/assess drain
/order cbc
/monitor vitals
/wait
/view cbc
/report doctor
```

预期：玩家在合理时间发现异常，CBC 正确返回并只生成一次，完成有效报告，进入较好结局。

### 场景二：等待被中断

```text
/order cbc
/monitor vitals
/wait cbc
```

预期：若监护报警早于 CBC，等待在报警时中断；CBC 仍 pending。玩家处理后再次等待，才能到达 CBC Anchor。

### 场景三：延误

```text
/wait
/wait
/wait
```

预期：隐藏病程先演化，达到明显阈值后形成可见恶化 Anchor；继续忽略最终进入延误结局。早期隐藏事实不得提前显示。

## 14. 最终 Definition of Done

本轮只有同时满足以下条件才算完成：

1. 唯一病例可以从创建 session 玩到较好和延误两个结局；
2. 玩家主动行为消耗时间，后台事件并行结算；
3. `/wait` 和 `/wait cbc` 正确执行 Anchor 与中断；
4. CBC 具备申请、采样、pending、ready、reveal、费用和一次复查；
5. 同次 CBC 只生成一次，复查依据采样时状态和历史值；
6. 隐藏病情和未查看检查不会通过 API 或 Console 泄露；
7. React Console 能执行全部指定命令并清晰显示结构化消息；
8. 自动测试覆盖第 12 节关键路径；
9. 刷新/重新加载后 session 和检查结果保持一致；
10. 未实现第 2 节禁止项；
11. 交付简短试玩说明、已知限制和建议观察的问题；
12. 完成后停止，不进入 DSL、AI 或下一阶段开发。

## 15. 编程 Agent 最终交付格式

完成后仅报告：

- 实现了哪些用户可见行为；
- 关键文件和运行方式；
- 自动测试结果；
- 三个验收场景的结果；
- 已知限制或医学参数待确认项；
- 是否严格停留在 MVP-B 范围内。

不要以“未来扩展需要”为理由继续实现下一阶段。若现有代码结构导致本文某项无法完成，应先说明具体阻塞和最小替代方案，而不是扩大范围。
