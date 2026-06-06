# Feature Flag 统一管理设计

> 建立集中注册 + 按需覆盖 + 运行时门控的 feature flag 体系，取代散落的 dict.get() 和死 flag。

---

## 一、现有问题

1. **无单一定义源**：4 个 JSON 各自抄一遍 7 个 flag，新增/修改 flag 需改 4 个文件
2. **无类型约束**：`TrainingStateResponse.config` 是裸 `dict`，`update_training_features` 接受任意 dict
3. **死 flag 污染**：`hints`/`nursing_documentation`/`dynamic_events` 零代码实现但存在于所有 config
4. **门控检查缺失**：`physical_exam` 和 `patient_initiative` 有实现代码但不检查 flag

---

## 二、新增文件

### 2.1 `backend/services/feature_flags.py`

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
        "允许学生触发护理操作（测血压/体温/听诊等）",
    ),
    "patient_initiative": FeatureFlag(
        "patient_initiative", "患者主动追问", False,
        "患者根据性格/情绪/等待时长主动发言",
    ),
}

def resolve_features(config_snapshot: dict | None) -> dict[str, bool]:
    """用 session config 覆盖默认值，返回完整 features dict"""
    result = {k: v.default for k, v in FEATURE_FLAGS.items()}
    if config_snapshot:
        result.update(config_snapshot.get("features", {}))
    return result

def is_enabled(record, key: str) -> bool:
    return resolve_features(record.config_snapshot).get(key, False)
```

---

## 三、修改文件

### 3.1 Session Config JSON（4 个文件）

原则：只写需要覆盖默认值的 flag，删除无实现代码的死 flag。

**free-exploration.json：**
```json
{
  "id": "free-exploration",
  "name": "自由探索",
  "mode": "free_play",
  "features": { "physical_exam": true },
  "behavior": { "emotion_model": true, "time_limit_minutes": 60, "max_rounds": 60 }
}
```

**scenario-simulation.json：**
```json
{
  "id": "scenario-simulation",
  "name": "情境模拟",
  "mode": "training",
  "features": { "physical_exam": true, "patient_initiative": true },
  "behavior": { "emotion_model": true, "time_limit_minutes": 30, "max_rounds": 45 }
}
```

**standard-assessment.json：** 保留但标注预留，不设任何 features（全部用默认值）：
```json
{
  "id": "standard-assessment",
  "name": "标准化考核（预留）",
  "mode": "assessment",
  "behavior": { "emotion_model": true, "time_limit_minutes": 20, "max_rounds": 30 },
  "assessment": { "rubric_id": 1, "auto_settlement": true, "settlement_timeout_min": 30 }
}
```

**classroom-practice.json：** 同上预留。

### 3.2 `backend/routers/chat.py`

```python
from services.feature_flags import is_enabled

# send_message 中（行 155 附近）：
if is_enabled(record, "physical_exam"):
    op_type = detect_operation(req.content)
    # ... 现有逻辑 ...

# 两处 update_initiative_timer 调用（行 196、312）：
if is_enabled(record, "patient_initiative"):
    update_initiative_timer(record_id, len(reply))
```

### 3.3 `backend/routers/training.py`

**trigger_initiative 端点守卫：**
```python
if not is_enabled(record, "patient_initiative"):
    return {"triggered": False, "message": None}
```

**update_training_features 校验：**
```python
from services.feature_flags import FEATURE_FLAGS

valid_keys = set(FEATURE_FLAGS.keys())
for k in features:
    if k not in valid_keys:
        raise HTTPException(status_code=400, detail=f"未知功能开关: {k}")
```

**get_training_state 中使用 resolve_features：**
```python
from services.feature_flags import resolve_features

"config": {
    "id": record.config_id,
    "mode": config.get("mode"),
    "features": resolve_features(record.config_snapshot),
}
```

### 3.4 `backend/schemas.py`

新增：
```python
class FeatureConfigResponse(BaseModel):
    model_config = _RSP_CFG
    id: str | None = None
    mode: str | None = None
    features: dict[str, bool]
```

`TrainingStateResponse` 中 `config: dict` 改为 `config: FeatureConfigResponse`。

---

## 四、前端影响

1. Schema 变更 → 运行 `npm run generate:api` 重新生成 `api-types.gen.ts`
2. `AdminDebugPage.tsx`：feature toggle 列表从 `Object.entries(state.config.features)` 动态渲染，不硬编码 key 名

---

> 撰写日期: 2026-06-06
