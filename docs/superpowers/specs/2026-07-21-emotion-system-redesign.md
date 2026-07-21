# 情感系统翻新 — 设计规格

**日期**: 2026-07-21
**状态**: 待用户复核
**类型**: 重构（非创新性修复已完成并提交）

---

## 1. 现状分析

### 1.1 当前架构

```
case_data.personality (4 维度)
  │  ⚠ 不参与情感计算，仅用于 LLM prompt 文案
  │
student 消息 → LLM 生成患者回复
  │
  ▼
关键词匹配器（side_effects.py）
  ├── _analyze_response_emotion()  中文关键词词典（~40 条）
  └── _apply_action_emotion()      括号动作解析（~15 条）
  │
  ▼
EmotionState (2D: trust/comfort 0-100)
  └── STATE_LABELS 首次匹配表 → 6 态标签
```

### 1.2 已确认的 13 项缺陷

| # | 缺陷 | 影响 |
|---|------|------|
| 1 | **无 LLM 情感分析** — 纯关键词匹配 | 遗漏讽刺、否定、语境、多语言 |
| 2 | **单语言** — 仅中文关键词 | 英文输入被忽略 |
| 3 | **无否定处理** — "我不痛"触发"痛" | 反向情感判定 |
| 4 | **无上下文感知** — 同样的话不同阶段效果相同 | 对话深度不参与计算 |
| 5 | **人格未接入情感** — anxiety_trait/patience 对 delta 无影响 | 性格配置形同虚设 |
| 6 | **无自然衰减** — 信任/舒适只升不降（无刺激时） | 不真实 |
| 7 | **无动量** — 连续正面/负面不累积影响 | 线性累加，无 S 型响应 |
| 8 | **状态标签冲突** — 首次匹配表边界模糊 | trust=20/comfort=70 匹配 defensive 而非 relaxed |
| 9 | **5/6/9 态混乱** — 能力描述写"5 态"、系统 6 态、展示 9 标签 | 文档/UI/代码不一致 |
| 10 | **初始值无个性化** — 恒为 (50, 50) | 焦虑症患者与平和者起点相同 |
| 11 | **单次无上限** — 极端回复理论可达不受限 delta | 潜在的情感雪崩 |
| 12 | **history 无界** — 200 轮对话产生 200 条记录全存 JSONB | DB 膨胀 |
| 13 | **竞态条件** — 并发 get→update→set 后写覆盖 | 并发消息情感丢失 |

### 1.3 追问系统与情感的交互断裂

- `initiative.py::_describe_mood()` 使用 4 态模型（焦虑/防御/放松/正常），与主系统的 6 态不一致
- 追问阈值受 comfort 影响，但 comfort 本身由关键词驱动 → 低质量输入产生低质量情感 → 恶性循环

---

## 2. 设计目标

1. **LLM 原生情感分析** — 用 LLM 理解情感，替换关键词匹配
2. **人格驱动动态模型** — personality 基线偏移 + 反应幅度调制 + 衰减率差异化
3. **S 型信任曲线** — 非线性 delta 响应，模拟真实的"筑墙→突破→天花板"
4. **自然衰减** — 无刺激时信任/舒适回归基线
5. **一致性** — 统一 6 态模型，清除所有不一致
6. **工程健壮性** — Delta 限幅、有界历史、消除竞态

---

## 3. 核心设计

### 3.1 人格-情感映射 (PersonalityProfile)

当前 personality 字段仅用于 LLM prompt 文案。改为同时驱动数值计算：

```python
PERSONALITY_MODIFIERS = {
    "anxiety_trait": {
        "anxious":  {"trust_base": -8, "comfort_base": -12,
                     "neg_amplify": 1.4, "pos_amplify": 0.7, "decay": 0.08},
        "normal":   {"trust_base":  0, "comfort_base":   0,
                     "neg_amplify": 1.0, "pos_amplify": 1.0, "decay": 0.05},
        "calm":     {"trust_base": +5, "comfort_base":  +8,
                     "neg_amplify": 0.7, "pos_amplify": 1.2, "decay": 0.03},
    },
    "patience": {
        "low":      {"comfort_base": -3, "decay": 0.08},
        "normal":   {"comfort_base":  0, "decay": 0.05},
        "high":     {"comfort_base": +3, "decay": 0.02},
    },
    "health_literacy": {
        "low":   {"trust_base": -2},   # 听不懂术语 → 天然戒备
        "normal": {},
        "high":  {"trust_base": +2},
    },
}
```

**合并规则**: 各项叠加，最终基线限制在 [25, 75]。

**示例**:
- anxious + low_patience + low_literacy → trust=50-8-0-2=40, comfort=50-12-3-0=35
- calm + high_patience + high_literacy → trust=50+5+0+2=57, comfort=50+8+3+0=61

### 3.2 S 型信任曲线

当前线性累加 `trust_new = trust + delta` 改为非线性响应：

```
effective_delta = delta × (1 - |trust - 50| / 50)

trust=50 (中性):  effective = delta × 1.0   → 全效
trust=15 (极低):   effective = delta × 0.3   → 难突破，但也难更差（触底）
trust=85 (极高):   effective = delta × 0.3   → 天花板，小失误不崩盘
```

**含义**: 信任很低时患者已筑墙，正面刺激效果打折；信任很高时关系稳固，小失误不致命。中间段最敏感。

### 3.3 LLM 同轮情感输出

在 LLM system prompt 末尾注入情感输出指令。LLM 在生成患者回复的同时，一并输出结构化 JSON 情感块。

**Prompt 追加片段**:

```
【情感输出规则】
在回复末尾附加一个 JSON 块（不要包含在患者话语中）：
{"emotion": {"trust_delta": -3到+3的整数, "comfort_delta": -3到+3的整数,
             "trigger": "破冰/共鸣/刺伤/无"}}

- trust_delta: 对护士专业能力的信任变化
- comfort_delta: 舒适/放松程度的变化
- trigger: 特殊事件标记（破冰=首次共情、共鸣=患者主动透露、刺伤=恐惧性语言、无=无特殊）

当前患者状态：信任{trust} 舒适{comfort} 状态{label}
患者性格：{personality_description}
```

**delta 取值范围 [-3, +3]** — LLM 的输出被约束在窄范围，经过 PersonalityProfile 调制后有效 delta 可达 ±15（例如 anxious 患者负面权重 ×1.4 + 关键词加成效应）。

**容错**: JSON 解析失败时，delta 默认 (0, 0)，trigger 默认 "无"。

### 3.4 衰减计时器

新增强度轻量的后台衰减逻辑。不引入独立的定时器线程 — 在每次 chat 请求处理时，计算距上次情感更新的时间间隔，按比例执行衰减：

```python
elapsed_minutes = (now - emotion.last_updated).total_seconds() / 60
decay = decay_rate × elapsed_minutes
trust  = trust  + decay × (baseline_trust  - trust)
comfort = comfort + decay × (baseline_comfort - comfort)
```

**含义**: 如果患者信任被拉到 78 但学生沉默 3 分钟，信任自然回归基线。持续对话则衰减量极小（每轮通常 <10 秒间隔），不会干扰正常交互。

### 3.5 Delta 限幅与历史有界

- **单次 delta 上限**: LLM 输出 [-3, +3] → 人格调制后 max ±15。防止极端跳变。
- **history 有界**: 最近 10 条记录。`EmotionState.history` 从无界列表改为固定容量 deque。

### 3.6 竞态消除

当前竞态源自 `get → local update → set` 的三步非原子操作。改为在同轮 LLM 回复处理时一次性计算 → 一次 DB 写入。

---

## 4. 删除与清理

| 删除项 | 位置 | 原因 |
|--------|------|------|
| `_analyze_response_emotion()` | `side_effects.py` | 关键词词典，被 LLM 分析替代 |
| `_apply_action_emotion()` | `side_effects.py` | 动作解析，被 LLM 分析替代 |
| `_describe_mood()` 4 态模型 | `initiative.py` | 与主系统不一致，改为读 emotion.state |
| `STATE_LABELS` 首次匹配表 | `emotion.py` | 改为区间连续映射 |
| `CAPABILITY_BADGES` | `TrainingSelect.tsx` | 已在前期提交中泛化 |

### 能力描述修正

`capabilities.py` 第 31 行: `description="5态情绪模型"` → `"6态情绪模型"`

---

## 5. 保持不变的接口

| 保留项 | 原因 |
|--------|------|
| 6 态标签 (withdrawn/defensive/anxious/neutral/relaxed/open) | UI/TTS/立绘均绑定此 6 个枚举值 |
| Trust/Comfort 二维模型 | 护患关系最自然的轴：专业信任 + 人际舒适 |
| EmotionCache DB 持久化 (TrainingSessionState) | 工作正常，schema 不变 |
| EmotionIndicator UI 组件 | 翻新的是数据来源，UI 不变 |
| SSE emotion_change 事件格式 | 前端订阅不变 |
| TTS 情感映射 (mapper.py) | 6 态→速率/响度的映射保持不变 |

---

## 6. 工程改动清单

### 6.1 后端

| 文件 | 改动 | 量级 |
|------|------|------|
| `profiles/history_taking/emotion.py` | **重写**: PersonalityProfile + EmotionEngine + 删除 STATE_LABELS 首次匹配表 + history 有界化 | ~200行 |
| `pipeline/middleware/side_effects.py` | 删除两个关键词匹配器；情感分析改为从 LLM 响应提取结构化字段 + 衰减计算 | 删除~100行, 新增~30行 |
| `infrastructure/llm/prompts/emotion.py` | **新建**: LLM prompt 片段（情感输出格式指令） | ~20行 |
| `prompts/history_taking/system.txt` 或 prompt_builder | 注入情感输出指令到 system prompt | 追加~10行 |
| `infrastructure/llm/capabilities.py` | 修正描述 "5态" → "6态" | 1行 |
| `profiles/history_taking/initiative.py` | `_describe_mood()` 改为读主系统的 emotion.state | ~5行 |

### 6.2 前端

| 文件 | 改动 | 量级 |
|------|------|------|
| (无需改动) | 情感数据流格式不变 | 0行 |

### 6.3 测试

| 文件 | 改动 | 量级 |
|------|------|------|
| `tests/training/test_emotion.py` | 更新单元测试适配新模型 | ~50行 |
| 新建 `tests/training/test_personality_profile.py` | PersonalityProfile 的计算正确性 | ~30行 |

---

## 7. 验收标准

1. PersonalityProfile 各维度组合产生差异化的基线值（非恒 50/50）
2. LLM 生成的患者回复包含可解析的 emotion JSON，解析失败时回退为 (0, 0)
3. 同一句学生发言对 anxious 患者产生更大的负面 delta（人格调制生效）
4. 长沉默后 trust/comfort 向基线回归（衰减生效）
5. S 型曲线：trust=20 时正面 delta 效果打折（非线性验证）
6. history 记录 ≤ 10 条（有界化验证）
7. emotion state 标签与 6 态枚举一致
8. 追问系统的 mood 描述与主系统一致
9. 前端 EmotionIndicator / 气泡 / 立绘显示正常（回归验证）
10. 所有已有测试通过 + 新测试通过

---

## 8. 风险与注意事项

- **LLM JSON 输出稳定性**: 需要 prompt 工程 + 解析容错 + 回退策略
- **非单独 LLM 调用**: 同轮输出增加了 prompt 长度 ~100 tokens，对延迟影响可忽略
- **衰减计算粒度**: 使用距上次更新时间的真实间隔，不依赖后台循环
- **正向兼容**: 接口不变，前端零改动，SSE 事件格式不变
- **现有训练会话**: 旧记录的 `TrainingSessionState.emotion_state` 不包含 baseline，需要迁移或容忍缺失（新记录正常）
