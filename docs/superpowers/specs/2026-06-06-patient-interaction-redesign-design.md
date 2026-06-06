# 患者交互范式重构设计

## 背景

当前患者守卫 (`patient_guard.py`) 设计为关键词违禁词列表——检测到患者提供有价值信息即触发拦截。此方向被否决。`sanitize_patient_reply()` 目前为直通模式，线上未启用。

核心问题不是 guard 不够好，而是整个交互范式需要从"考核优先的内容管控"转向"模拟自然的语境塑造"。

## 设计目标

1. 患者行为由系统层计算的语境（人格+情绪+情境）驱动，LLM 只负责自然语言生成
2. 取消关键词解锁机制，深度背景始终可用，信息透露由患者人格自然决定
3. 引入 SessionConfig 抽象，解耦"患者是谁"和"怎么交互"
4. 支持查体操作（双通道：系统出数据、LLM 出反应）
5. 评分解耦为独立 observer，交互系统不感知考核逻辑

## 模块设计

### 1. SessionConfig（会话配置抽象）

新增顶层抽象，定义对话的性质和启用的特性。与 Case（患者数据）分离。

```yaml
session_config:
  id: "standard-assessment"
  name: "标准化考核"
  mode: assessment              # training | assessment | free_play

  features:
    scoring: true
    hints: false
    patient_initiative: false
    physical_exam: false
    nursing_documentation: false
    dynamic_events: false

  behavior:
    emotion_model: true
    time_limit_minutes: 20
    max_rounds: 30

  assessment:
    rubric_id: 1
    auto_settlement: true
    settlement_timeout_min: 30
```

**与现有模型关系：**

```
TrainingRecord
  case_id          → Case
  config_id         → SessionConfig (新增)
  config_snapshot   → 创建时冻结配置副本 (新增)
```

**预置配置：**

| 预设 | 模式 | 评分 | 提示 | 情绪 | 操作 | 事件 |
|---|---|---|---|---|---|---|
| 正式考核 | assessment | on | off | on | off | off |
| 课堂练习 | training | on | on | on | on | off |
| 自由探索 | free_play | off | on | on | on | off |
| 情境模拟 | training | on | off | on | on | on |

### 2. 双通道交互模型

对话不再是纯文本。操作和对话分为独立通道：

```
学生输入
  ├─ 普通文本 → 对话通道 → LLM 生成患者回复
  └─ 斜杠指令 / UI按钮 / 关键词 → 操作通道
       ├─ 系统查 Case 锚点数据 → 展示在 UI
       └─ 注入操作上下文到 LLM → LLM 生成患者口头反应
```

**职责分离：**

| 通道 | 承载内容 | 生产者 |
|---|---|---|
| 数据通道 | 体征数值、查体发现 | 系统（Case 锚点数据） |
| 对话通道 | 患者口头反应、情绪表达 | LLM |

**触发方式：** UI 按钮 + `/斜杠指令` 双重支持。

**查体数据在 Case 中的锚点：**

```yaml
exam_anchors:
  vital_signs:
    temperature: "38.2-38.8°C"
    pulse: "92-100次/分"
    blood_pressure: "135/28-145/32 mmHg"
  auscultation:
    lungs: "双肺底散在湿啰音"
    heart: "心率偏快，未闻及明显杂音"
```

系统在锚点范围内随机取值，保证不同 session 略有差异但临床合理。

### 3. 应答状态机

轻量的 `conversation → waiting` 循环，处理三种交互类型：

```
message:   学生文本 → LLM 生成回复 → waiting
operation: 学生触发操作 → 系统返回结果 → (可选 LLM 口头反应) → waiting
event:     系统触发事件 → LLM 生成患者话语 → waiting
```

状态机的 context_hint 压缩为一行的 Author's Note 注入。

### 4. Prompt 分层架构

约束：LLM 每次只接收最精炼上下文，总 token < 1300，缓存命中时新增消耗 < 500。

```
层 1: Character Card (静态, 全局缓存)       ~400 tokens
      人格定义 + 示例对话 + 行为边界

层 2: 患者资料 (静态, 会话级缓存)            ~150 tokens
      基本信息 + 主诉 + 病史 + 深度背景 + 沟通风格

层 3: Author's Note (动态, 每轮计算)         ~30 tokens
      情绪状态 + 操作上下文 + 事件提示

层 4: 对话历史 (最近 8 轮)                    ~400-600 tokens

层 5: 当前输入                                ~30-80 tokens
```

**Author's Note 注入策略（借鉴 AI 酒馆）：** 注入到对话历史之后、当前输入之前，作为 LLM 生成回复前的最后一个指导信号。

```
[Character Card]
[患者资料]
[对话历史: 1-8 轮]
【Author's Note: 当前情绪 relaxed。刚完成查体。】
[学生输入]
```

**缓存策略：** 沿用现有 `build_patient_chat_messages` 的 prefix cache 策略。层 1 + 层 2 为缓存前缀，DeepSeek context caching 命中后不产生额外推理成本。

### 5. 患者人格模型

**4 维度人格（Case 中定义，非实时计算）：**

| 维度 | 值 | 对对话的影响 |
|---|---|---|
| health_literacy | low / normal / high | 症状描述的语言层次 |
| verbosity | terse / normal / verbose | 回复长度和跑题倾向 |
| anxiety_trait | calm / normal / anxious | 反问频率、担忧表达 |
| patience | low / normal / high | 持续回答的耐受轮数 |

**情绪状态机（实时调制，规则驱动，非 LLM）：**

```
意图分类 → 每轮对人格基线做 delta 调整
  共情/安抚: +0.5~1
  追问/冷漠: -0.5~1
  操作触发(采血/查体): -0.5（患者不适感）
  事件触发: 按事件类型调整

输出 → Author's Note 一行：
  【当前: 焦虑升高，患者反复询问严重程度，回答更简短。】
```

**不建模的极端状态：** withdrawn（沉默）和 hostile（敌对）在临床问诊中极少出现，不为边缘 case 增加模型复杂度。

### 6. 知识注入（替代 hidden_info）

取消关键词解锁机制。Case 中的深度背景始终在层 2（患者资料）中，LLM 按患者人格自然选择性使用。

```yaml
# 旧（废弃）
hidden_info_rules:
  - trigger: "吸烟"
    content: "患者有30年吸烟史"

# 新
deep_background:
  smoking: "30年吸烟史，1包/天，咳嗽加重后自行减量"
  alcohol: "偶尔饮酒，近一周未饮"
  occupation: "建筑工人，粉尘接触"
  medications: "自行服用甘草片止咳，效果不佳"
```

信息始终可用，学生问到了就能得到回答。是否主动提及由人格决定（verbose 的可能主动跑题说出来，terse 的不主动提），不再是"被解锁才能说"。

### 7. 评分解耦

```
交互系统（对话管道）     观察系统（评分管道）
      │                      │
      │ 写入消息              │ 只读消息
      ↓                      ↑
      └── TrainingRecord ────┘
```

交互系统完全不知道评分存在。评分系统是后置的 conversation reader。当前 architecture 已基本满足，新增 SessionConfig 模式时不引入新耦合。

### 8. Guard 缩减

放弃所有违禁词检测（诊断泄露、教学泄露、隐藏信息泄露）。这些靠 prompt 工程预防。

**唯一保留：身份泄露检测。**

```
检测到 "我是AI" / "虚拟患者" / "评分标准" / "教学反馈"
  → 不替换文本
  → 追加 Author's Note: "【注意：你在扮演患者，你是真实的人。自然回应。】"
  → 重试同一轮 LLM 调用
  → 重试仍泄露 → 日志记录，不拦截（暴露 prompt 缺陷，工程师修）
```

## 数据模型变更

### Case 数据新增字段

```yaml
# 新增
personality:
  health_literacy: normal
  verbosity: normal
  anxiety_trait: normal
  patience: normal

deep_background: {}         # 替代 hidden_info_rules
exam_anchors: {}            # 查体锚点数据

# 保留
name, description, chief_complaint, present_illness, ...
required_inquiries, communication_style
```

### SessionConfig 模型

新建 `session_configs` 表或 JSON 配置文件（建议先用 JSON 预设，后续可数据库化）。

### TrainingRecord 新增字段

```
config_id        → FK → session_configs
config_snapshot  → JSONB (创建时冻结)
```

## LLM 性能约束

- 每轮上下文 < 1300 tokens
- 缓存命中后新增推理 < 500 tokens
- 情绪引擎纯规则匹配，不调用 LLM
- 意图分类纯规则匹配，不调用 LLM
- 身份泄露检测纯规则匹配，重试次数上限 1

## 实现优先级

| 优先级 | 模块 | 依赖 |
|---|---|---|
| P0 | Prompt 分层 + 人格模型 | 无 |
| P0 | Guard 缩减（删除违禁词检测） | 无 |
| P1 | 知识注入（替代 hidden_info） | P0 |
| P1 | SessionConfig 抽象 | 无 |
| P1 | 评分解耦确认 | 无 |
| P2 | 双通道操作（查体） | P0 + SessionConfig |
| P2 | 情绪状态机集成 | P0（人格模型） |
| P3 | 动态事件触发器 | P2 |
| P3 | 护理文书 | SessionConfig |
