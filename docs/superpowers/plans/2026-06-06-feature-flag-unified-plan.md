# Feature Flag 统一管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立集中注册 + 按需覆盖 + 运行时门控的 feature flag 体系。

**Architecture:** `services/feature_flags.py` 作为单一数据源（dataclass 注册表 + resolve/is_enabled），session config JSON 只写覆盖项，chat.py / training.py 调用 is_enabled 门控，schemas.py 新增 FeatureConfigResponse 强类型化 config 字段。

**Tech Stack:** Python 3.12+ / FastAPI / Pydantic / React 18 / TypeScript / biome

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| 创建 | `backend/services/feature_flags.py` | flag 注册表 + resolve + is_enabled |
| 创建 | `backend/tests/test_feature_flags.py` | 单元测试 |
| 修改 | `backend/data/session_configs/*.json` (4 个) | 清理死 flag，只留覆盖项 |
| 修改 | `backend/routers/chat.py` | physical_exam 和 patient_initiative 门控 |
| 修改 | `backend/routers/training.py` | patient_initiative 门控 + update 校验 + state 改造 |
| 修改 | `backend/schemas.py` | 新增 FeatureConfigResponse |
| 修改 | `frontend/src/api/api-types.gen.ts` | 重新生成 |
| 修改 | `frontend/src/pages/AdminDebugPage.tsx` | 动态 feature toggle 列表 |

---

### Task 1: 创建 `feature_flags.py` 服务

**Files:**
- Create: `backend/services/feature_flags.py`

- [ ] **Step 1: 写入服务文件**

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureFlag:
    key: str
    label: str
    default: bool
    description: str


FEATURE_FLAGS: dict[str, FeatureFlag] = {
    "physical_exam": FeatureFlag(
        "physical_exam", "护理查体", False,
        "允许学生触发护理操作（测血压/体温/听诊等），操作结果通过 Author's Note 注入 LLM",
    ),
    "patient_initiative": FeatureFlag(
        "patient_initiative", "患者主动追问", False,
        "患者根据性格/情绪/等待时长主动发言（催促、担忧、非语言线索等）",
    ),
}


def resolve_features(config_snapshot: dict | None) -> dict[str, bool]:
    result = {k: v.default for k, v in FEATURE_FLAGS.items()}
    if config_snapshot:
        result.update(config_snapshot.get("features", {}))
    return result


def is_enabled(record, key: str) -> bool:
    return resolve_features(record.config_snapshot).get(key, False)
```

- [ ] **Step 2: 创建测试文件 `backend/tests/test_feature_flags.py`**

```python
from unittest.mock import MagicMock
from services.feature_flags import FEATURE_FLAGS, resolve_features, is_enabled


class TestResolveFeatures:
    def test_defaults_when_no_snapshot(self):
        result = resolve_features(None)
        assert result == {"physical_exam": False, "patient_initiative": False}

    def test_defaults_when_empty_snapshot(self):
        result = resolve_features({})
        assert result == {"physical_exam": False, "patient_initiative": False}

    def test_override_single_flag(self):
        result = resolve_features({"features": {"physical_exam": True}})
        assert result == {"physical_exam": True, "patient_initiative": False}

    def test_override_all_flags(self):
        result = resolve_features({"features": {"physical_exam": True, "patient_initiative": True}})
        assert result == {"physical_exam": True, "patient_initiative": True}

    def test_unknown_key_ignored(self):
        result = resolve_features({"features": {"unknown_flag": True}})
        assert result == {"physical_exam": False, "patient_initiative": False}


class TestIsEnabled:
    def test_false_by_default(self):
        record = MagicMock()
        record.config_snapshot = None
        assert is_enabled(record, "physical_exam") is False

    def test_true_when_overridden(self):
        record = MagicMock()
        record.config_snapshot = {"features": {"physical_exam": True}}
        assert is_enabled(record, "physical_exam") is True

    def test_unknown_key_returns_false(self):
        record = MagicMock()
        record.config_snapshot = None
        assert is_enabled(record, "nonexistent") is False


class TestFeatureFlagsRegistry:
    def test_all_flags_have_keys(self):
        for key, flag in FEATURE_FLAGS.items():
            assert flag.key == key

    def test_all_flags_have_labels(self):
        for flag in FEATURE_FLAGS.values():
            assert flag.label
            assert flag.description
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd backend; python -m pytest tests/test_feature_flags.py -v
```
Expected: 10 passed.

- [ ] **Step 4: 提交**

```bash
git add backend/services/feature_flags.py backend/tests/test_feature_flags.py
git commit -m "feat: add feature flag registry with resolve and is_enabled"
```

---

### Task 2: 清理 session config JSON 文件

**Files:**
- Modify: `backend/data/session_configs/free-exploration.json`
- Modify: `backend/data/session_configs/scenario-simulation.json`
- Modify: `backend/data/session_configs/standard-assessment.json`
- Modify: `backend/data/session_configs/classroom-practice.json`

- [ ] **Step 1: 写入 4 个 JSON 文件**

**free-exploration.json:**
```json
{
  "id": "free-exploration",
  "name": "自由探索",
  "mode": "free_play",
  "features": { "physical_exam": true },
  "behavior": { "emotion_model": true, "time_limit_minutes": 60, "max_rounds": 60 }
}
```

**scenario-simulation.json:**
```json
{
  "id": "scenario-simulation",
  "name": "情境模拟",
  "mode": "training",
  "features": { "physical_exam": true, "patient_initiative": true },
  "behavior": { "emotion_model": true, "time_limit_minutes": 30, "max_rounds": 45 },
  "assessment": { "rubric_id": 1, "auto_settlement": true, "settlement_timeout_min": 30 }
}
```

**standard-assessment.json:**
```json
{
  "id": "standard-assessment",
  "name": "标准化考核（预留）",
  "mode": "assessment",
  "behavior": { "emotion_model": true, "time_limit_minutes": 20, "max_rounds": 30 },
  "assessment": { "rubric_id": 1, "auto_settlement": true, "settlement_timeout_min": 30 }
}
```

**classroom-practice.json:**
```json
{
  "id": "classroom-practice",
  "name": "课堂练习（预留）",
  "mode": "training",
  "features": { "physical_exam": true },
  "behavior": { "emotion_model": true, "time_limit_minutes": 30, "max_rounds": 40 },
  "assessment": { "rubric_id": 1, "auto_settlement": true, "settlement_timeout_min": 30 }
}
```

- [ ] **Step 2: 提交**

```bash
git add backend/data/session_configs/*.json
git commit -m "refactor: clean up session config flags, keep only overrides"
```

---

### Task 3: 门控 `physical_exam` 在 chat.py

**Files:**
- Modify: `backend/routers/chat.py`

- [ ] **Step 1: 添加 import**

在文件顶部现有 imports 后添加：
```python
from services.feature_flags import is_enabled
```

- [ ] **Step 2: 门控 `send_message` 中的操作检测（行 154-167）**

将：
```python
    # Detect and handle operations (/bp, /vitals, etc.)
    op_type = detect_operation(req.content)
    operation_result = None
    operation_note = ""
    student_content = req.content
    if op_type:
        operation_result = handle_operation(op_type, case_data)
        log.info("操作触发: record_id=%d op=%s", record_id, op_type)
        if operation_result:
            op_label = operation_result.get("label", "")
            op_value = operation_result.get("value", "")
            op_unit = operation_result.get("unit", "")
            operation_note = f"护士刚给你做了{op_label}，结果是{op_value}{op_unit}。"
            student_content = "（护士正在为你做检查，你看到了结果）"
```

改为：
```python
    operation_result = None
    operation_note = ""
    student_content = req.content
    if is_enabled(record, "physical_exam"):
        op_type = detect_operation(req.content)
        if op_type:
            operation_result = handle_operation(op_type, case_data)
            log.info("操作触发: record_id=%d op=%s", record_id, op_type)
            if operation_result:
                op_label = operation_result.get("label", "")
                op_value = operation_result.get("value", "")
                op_unit = operation_result.get("unit", "")
                operation_note = f"护士刚给你做了{op_label}，结果是{op_value}{op_unit}。"
                student_content = "（护士正在为你做检查，你看到了结果）"
```

- [ ] **Step 3: 门控 `send_message_stream` 中的操作检测（行 226-238）**

同样包裹在 `if is_enabled(record, "physical_exam"):` 中。

- [ ] **Step 4: 提交**

```bash
git add backend/routers/chat.py
git commit -m "feat: gate physical_exam feature flag in chat endpoints"
```

---

### Task 4: 门控 `patient_initiative` 在各端点

**Files:**
- Modify: `backend/routers/chat.py`
- Modify: `backend/routers/training.py`

- [ ] **Step 1: 门控 chat.py 中两处 `update_initiative_timer`**

行 196:
```python
# 改前
update_initiative_timer(record_id, len(reply))
# 改后
if is_enabled(record, "patient_initiative"):
    update_initiative_timer(record_id, len(reply))
```

行 312（stream 端点同样）：
```python
if is_enabled(record, "patient_initiative"):
    update_initiative_timer(record_id, len(full_reply))
```

- [ ] **Step 2: 门控 training.py 中 `trigger_initiative` 端点**

在 `trigger_initiative` 函数开头，record 查询（行 579）和权限检查之后，添加守卫：

```python
from services.feature_flags import FEATURE_FLAGS, is_enabled, resolve_features

# 在 record = ... 和权限检查之后、should_initiate 之前：
if not is_enabled(record, "patient_initiative"):
    return {"triggered": False, "message": None}
```

- [ ] **Step 3: 提交**

```bash
git add backend/routers/chat.py backend/routers/training.py
git commit -m "feat: gate patient_initiative feature flag"
```

---

### Task 5: Schema 改进 + update 端点校验

**Files:**
- Modify: `backend/schemas.py`
- Modify: `backend/routers/training.py`

- [ ] **Step 1: schemas.py 新增 `FeatureConfigResponse`**

在 `InitiativeStateResponse` 之前添加：
```python
class FeatureConfigResponse(BaseModel):
    id: str | None = None
    mode: str | None = None
    features: dict[str, bool] = Field(default_factory=dict)
```

修改 `TrainingStateResponse`（行 1028）：
```python
# 改前
config: dict = Field(default_factory=dict)
# 改后
config: FeatureConfigResponse
```

注意需要在 schemas.py 顶部确认 `Field` 已 import。

- [ ] **Step 2: training.py `get_training_state` 使用 `resolve_features`**

将行 559-563：
```python
"config": {
    "id": record.config_id,
    "mode": config.get("mode"),
    "features": config.get("features", {}),
},
```

改为：
```python
"config": {
    "id": record.config_id,
    "mode": config.get("mode"),
    "features": resolve_features(record.config_snapshot),
},
```

因为 schema 现在要求 `features` 为 `dict[str, bool]`，`resolve_features` 保证每个 key 都有值。

- [ ] **Step 3: `update_training_features` 添加校验**

在函数体开头，参数解包后添加：
```python
valid_keys = set(FEATURE_FLAGS.keys())
for k in features:
    if k not in valid_keys:
        raise HTTPException(status_code=400, detail=f"未知功能开关: {k}")
```

- [ ] **Step 4: 运行后端测试确认不改坏**

```bash
cd backend; python -m pytest tests/ -v --timeout=30 2>&1 | tail -20
```
Expected: 全绿（新增 test_feature_flags 的 10 个测试 + 已有测试）。

- [ ] **Step 5: 提交**

```bash
git add backend/schemas.py backend/routers/training.py
git commit -m "feat: add FeatureConfigResponse schema, validate feature toggle keys"
```

---

### Task 6: 重新生成前端 API 类型

**Files:**
- Modify: `frontend/src/api/api-types.gen.ts`

- [ ] **Step 1: 启动后端并生成类型**

```bash
cd frontend; npm run generate:api
```
前提：后端在 `localhost:8000` 运行。

- [ ] **Step 2: 提交**

```bash
git add frontend/src/api/api-types.gen.ts
git commit -m "chore: regenerate API types for FeatureConfigResponse"
```

---

### Task 7: AdminDebugPage 动态 feature toggle 列表

**Files:**
- Modify: `frontend/src/pages/AdminDebugPage.tsx`

- [ ] **Step 1: feature toggle 从硬编码改为动态**

当前代码（行 557-579）硬编码遍历 `state.config.features` 的所有 key。由于 `FeatureConfigResponse.features` 现在是 `dict[str, bool]` 且 `resolve_features` 保证完整的 key 集合，遍历逻辑不变。只需确认 `TrainingState` 接口中的 `config.features` 类型匹配。

`TrainingState` 接口（行 17-24）：
```typescript
interface TrainingState {
  ...
  config: { id: string; mode: string; features: Record<string, boolean> };
  ...
}
```

这个接口不依赖自动生成的类型，手动定义。`Record<string, boolean>` 匹配新的 `dict[str, bool]`，无需改动。

- [ ] **Step 2: 确认 typecheck 通过**

```bash
cd frontend; npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: 提交**

```bash
git add frontend/src/pages/AdminDebugPage.tsx
git commit -m "refactor: feature toggle list driven by resolved features dict"
```

---

### Task 8: 全量验证

- [ ] **Step 1: 后端测试**

```bash
cd backend; python -m pytest tests/ -v
```

- [ ] **Step 2: 前端 typecheck + lint**

```bash
cd frontend; npx tsc --noEmit; npx biome check src/ --write
```

- [ ] **Step 3: 前端构建**

```bash
cd frontend; npm run build
```

- [ ] **Step 4: 检查 git status**

```bash
git diff --stat
```

- [ ] **Step 5: 提交最终验证**

```bash
git add -A
git commit -m "feat: unified feature flag management with gating and schema"
```
