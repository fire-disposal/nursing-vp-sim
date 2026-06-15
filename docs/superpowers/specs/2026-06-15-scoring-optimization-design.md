# 评分功能总体优化设计

## 背景

评分功能存在三方面问题：
1. **提示词**：冗余（scoring_feedback 传递完整锚点）、约束无校验（evidence 字数）、示例不一致
2. **解析与校验**：无递归深度保护、无 evidence/reason 校验、正则回退脆弱
3. **体验**：进度条伪进度、轮询间隔过长、超时检测过松

## 总体架构

```
优化范围：评分 pipeline 的完整链路
  输入 → Prompt构建 → LLM调用 → JSON解析 → 校验 → 入库 → 进度展示
  
  模块A    模块A       模块C      模块B      模块B    模块A/B   模块D
```

---

## 模块 A：提示词瘦身与加固

### 涉及文件

| 文件 | 改动 |
|------|------|
| `backend/prompts/scoring.py` | 重写 SCORING_SYSTEM / SCORING_FEEDBACK_SYSTEM / 重试提示词 |
| `backend/infrastructure/prompt/static.py` | `build_scoring_criteria()` 支持 level 参数（full/brief） |
| `backend/contexts/training/score_engine.py` | feedback 阶段使用 brief 评分标准 |
| `backend/contexts/training/_scoring_validation.py` | 新增 evidence/reason 校验 |

### A1. Scoring prompt 重写

当前问题：
- 包含完整 inline JSON 范例（~200 tokens），与下方的 schema 模板重复
- "不要 markdown" 指令多余（`response_format="json_object"` 已强制 JSON 输出）
- 范例中 score/max 值可能不匹配真实 rubric

优化后：
- 移除 inline JSON 范例，只依赖动态生成的 JSON schema
- 精简"评分背景"段落
- 合并"评分范例"和"输出格式"为单一的 schema 引用
- 强化 evidence/reason 要求："每条 evidence 必须包含至少 10 个中文字符，直接引用具体对话"

### A2. Feedback prompt 锚点精简

当前 `SCORING_FEEDBACK_SYSTEM` 通过 `{#scoring_criteria#}` 变量获得完整 rubric（含每项 1分/2分/3分锚点）。但反馈生成不需要锚点细节，只需要知道：
1. 有哪些维度
2. 每个维度下有哪些条目
3. 条目的满分值

新增 `build_scoring_criteria(rubric, level="brief")`：
- `level="full"`：现有行为（含锚点），用于 scoring 阶段
- `level="brief"`：只输出维度名 + 条目名 + 满分，用于 feedback 阶段

### A3. 重试提示词增强

当前 `SCORING_RETRY_USER` 只说"格式不完整"，未指出缺失的具体字段。改为：
```
"你上一次的输出存在以下问题：{validation_errors}
请重新输出完整 JSON，确保所有字段完备。"
```

通过 `_validate_scoring_essentials` 在重试前捕获具体错误信息，注入到重试提示词中。

### A4. Evidence/reason 代码级校验

在 `_validate_scoring_result` 中新增 `_validate_items_content(detail_scores)`：

```python
def _validate_items_content(detail_scores: dict) -> list[str]:
    errors = []
    for dim_name, dim_data in detail_scores.items():
        for item in dim_data.get("items", []):
            ev = (item.get("evidence") or "").strip()
            rea = (item.get("reason") or "").strip()
            if len(ev) < 10:
                errors.append(f"{dim_name}.{item.get('name')}: evidence 过短 ({len(ev)}字)")
            if len(rea) < 5:
                errors.append(f"{dim_name}.{item.get('name')}: reason 过短 ({len(rea)}字)")
    return errors
```

---

## 模块 B：解析与校验加固

### 涉及文件

| 文件 | 改动 |
|------|------|
| `backend/contexts/training/_scoring_validation.py` | `_coerce_numeric_fields` 加 depth 限制；新增 evidence 校验 |
| `backend/infrastructure/llm/parsing.py` | `detail_scores` 正则回退安全加固 |

### B1. 递归深度保护

```python
def _coerce_numeric_fields(obj: dict, depth: int = 0):
    if depth > 10:
        log.warning("coerce_numeric_fields 超过最大递归深度")
        return
    ...
    _coerce_numeric_fields(value, depth + 1)
```

### B2. detail_scores 正则回退加固

当前实现：
```python
m = re.search(r'"detail_scores"\s*:\s*(\{)', text, re.DOTALL)
```
用大括号计数 → 若 value 内含 `{` 则偏移。

改为：用 `json.JSONDecoder.raw_decode()` 对起始位置安全解析，限制最大嵌套深度 15。

```python
def _extract_json_value(text: str, start: int) -> tuple[dict, int] | None:
    try:
        decoder = json.JSONDecoder()
        obj, end = decoder.raw_decode(text, start)
        return obj, end
    except json.JSONDecodeError:
        return None
```

---

## 模块 C：评分速度优化

### 涉及文件

| 文件 | 改动 |
|------|------|
| `backend/core/config.py` | `SCORING_TIMEOUT_SECONDS` 300→180 |
| `backend/contexts/training/score_engine.py` | feedback prompt 使用 brief criteria（模块 A 依赖） |
| `frontend/src/engine/ScoreManager.ts` | 轮询 3s→1.5s（模块 D 携带） |

### 速度预期提升

| 措施 | 预期提速 | 说明 |
|------|---------|------|
| feedback prompt tokens 减少 30-40% | ~15-25% | 最直接影响 LLM 处理时间 |
| 超时 300→180 | 失败检测快 40% | 非正常场景 |
| 轮询 3s→1.5s | 用户感知 ~1.5s 提升 | 正常场景 |

---

## 模块 D：评分进度实时展示

详见 `2026-06-15-scoring-progress-design.md`，摘要：

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/infrastructure/scoring_progress.py` | ScoringProgressTracker |

### 修改文件

| 文件 | 修改 |
|------|------|
| `backend/contexts/training/score_engine.py` | inject tracker, 各阶段 update progress |
| `backend/contexts/training/router/scoring.py` | tracker 生命周期 + `/scoring-status` 返回 progress |
| `backend/main.py` | `app.state.scoring_tracker = ScoringProgressTracker()` |
| `frontend/src/engine/ScoreManager.ts` | 重写：基于后端 progress |
| `frontend/src/plugins/scoring-display/ScoringOverlay.tsx` | 重写：真实阶段+百分比 |

### 阶段映射

```
loading(0-5%) → scoring(10-60%) → feedback(60-90%) → saving(95%) → completed(100%)
```

`_score_stage` 和 `_feedback_stage` 内部各自更新 tracker，通过 `asyncio.gather` 自然获得阶段性进度更新。

---

## 模块 E：边缘场景兜底

### 涉及文件

| 文件 | 改动 |
|------|------|
| `backend/infrastructure/settlement.py` | 超时会话标记 completed 后触发评分 |
| `backend/contexts/training/router/scoring.py` | 抽取 `_trigger_scoring_if_needed()` 工具函数 |

### E1. 超时自动评分

`settlement_loop` 中 `_settle_once` 当前将超时会话标记为 completed 但不触发评分。修改为：

```python
record.status = "completed"
record.end_time = datetime.now(UTC)
# 若未评分，触发评分
if record.scoring_status is None:
    await trigger_scoring(record.id, ...)
```

`trigger_scoring` 复用 `_run_scoring_background` 的逻辑，提取为独立函数。

---

## 总体实施顺序

```
模块A ──→ 模块B ──→ 模块C ──→ 模块D ──→ 模块E
  │                    │
  └── feedback prompt  └── SCORING_TIMEOUT
      瘦身是模块C的前提        + 轮询间隔
```

各模块可独立测试：

| 模块 | 测试方法 |
|------|---------|
| A | `pytest -m "not pg" -k scoring` + 手动比对 prompt 渲染输出 |
| B | 单元测试 + 异常输入测试 |
| C | 计时测试（对比 token 节省和 LLM 响应时间） |
| D | 前端手动测试 + 后端单元测试 |
| E | 集成测试（模拟超时会话） |
