# Feature Flag 接入设计

> 将 session config 中的 feature flags 接入后端行为门控，移除无实现代码的死 flag。

---

## 一、背景

`backend/data/session_configs/` 下 4 个 JSON 配置文件定义了 7 个开关（含 `behavior.emotion_model`），但后端代码**完全不检查它们**。这意味着：
- 标准化考核中护理操作仍可执行（`physical_exam: false` 无效）
- 任何模式下患者都可能主动追问（`patient_initiative: false` 无效）
- `hints`/`nursing_documentation`/`dynamic_events` 无任何实现代码，纯占位

---

## 二、变更范围

### 2.1 接入门控（3 个 flag）

| Flag | 后端门控位置 | 默认值（flag 缺失时） |
|------|-------------|----------------------|
| `physical_exam` | `chat.py` 两个 send 端点中 `detect_operation` + `handle_operation` 块 | `False` |
| `patient_initiative` | `chat.py` 中 `update_initiative_timer()` 调用；`training.py` 中 `trigger_initiative` 端点 | `False` |
| `scoring` | `training.py` 中 `end_training` → `_run_scoring_background` 调用 | `True` |

### 2.2 移除死 flag（3 个）

从 4 个 session config JSON 文件中删除：`hints`、`nursing_documentation`、`dynamic_events`。

### 2.3 不改动

- `behavior.emotion_model`：4/4 config 全开，接入门控需要重构 `_build_llm_messages` 签名，性价比低
- Schema 类型：`TrainingStateResponse.config` 保持 `dict`，不新增 Pydantic model（API 形状未变，前端无需重新生成）

---

## 三、实现细节

### 3.1 辅助函数

新增 `backend/services/feature_flags.py`：

```python
def is_feature_enabled(record, feature_key: str, default: bool = False) -> bool:
    config = record.config_snapshot or {}
    return config.get("features", {}).get(feature_key, default)
```

### 3.2 `physical_exam` 门控

在 `chat.py` 的 `send_message`（行 155）和 `send_message_stream`（行 226）中，将整个 `detect_operation` + `handle_operation` 块包裹在条件里：

```python
from services.feature_flags import is_feature_enabled

if is_feature_enabled(record, "physical_exam"):
    op_type = detect_operation(req.content)
    # ... existing logic ...
```

### 3.3 `patient_initiative` 门控

**chat.py**：`update_initiative_timer(record_id, ...)` 调用（行 196、312）包裹：

```python
if is_feature_enabled(record, "patient_initiative"):
    update_initiative_timer(record_id, len(reply))
```

**training.py**：`trigger_initiative` 端点（行 572）开头加守卫：

```python
if not is_feature_enabled(record, "patient_initiative"):
    return {"triggered": False, "message": None}
```

### 3.4 `scoring` 门控

在 `training.py` 的 `end_training` 中：

```python
features = (record.config_snapshot or {}).get("features", {})
if features.get("scoring", True):
    _run_scoring_background(record_id, case_data)
else:
    record.status = "completed"
    db.commit()
```

默认 `True` 保证旧记录（无 config_snapshot）不会丢失评分。

### 3.5 JSON 配置清理

从 4 个文件中删除 `hints`、`nursing_documentation`、`dynamic_events` 三个 key。

---

## 四、前端影响

无。API 响应形状不变（`config` 字段仍为 `dict`），移除的是后端 JSON 文件中的 key，前端读取时这些 key 本就不存在对应的 UI 行为。不需要重新生成 `api-types.gen.ts`。

---

## 五、测试策略

- 单元测试 `is_feature_enabled()` 对各种 config_snapshot 状态（None、空 dict、缺失 features key）
- 验证 `physical_exam=False` 时操作指令不被拦截（传回 LLM 作为普通消息）
- 验证 `patient_initiative=False` 时 `trigger_initiative` 始终返回 `triggered: False`
- 验证 `scoring=False` 时 end_training 直接标记 completed 不调用评分

---

> 撰写日期: 2026-06-06
