# Case Data 与运行时架构重构

## 概述

解决三个核心架构债务：
1. `case_data` 无校验 → Pydantic 读时校验
2. 运行时状态混入配置 → 独立 `runtime_state` 列
3. author_note 全局注册 → pipeline 级 NoteCollector
4. 插件-病例数据无契约 → `required_case_fields`
5. Rubric 双源不交圈 → case 引用中央评分标准

## 结构

```
Five independent phases, sequential but independently deployable:

Phase 1: Validation layer    (case_schema.py + 4 entry-point hooks)
Phase 2: Runtime state       (runtime_state JSONB column + migration)
Phase 3: Note infrastructure (NoteCollector + pipeline assembly)
Phase 4: Plugin contract     (required_case_fields + schema linkage)
Phase 5: Rubric chain        (rubric_ref + freeze at training start)
```

---

## Phase 1: 病例校验层

### 文件

`backend/core/case_schema.py` — 纯 Pydantic 校验，不影响存储格式。

### 核心模型

```python
class PatientInfo(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    age: int = Field(ge=0, le=150)
    gender: Literal["男", "女"]


class PersonalityConfig(BaseModel):
    health_literacy: Literal["low", "normal", "high"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"


class PhaseTransition(BaseModel):
    auto: bool = False
    manual_label: str | None = None
    min_messages: int = 0
    min_operations: int = 0
    auto_after_messages: int = 0


class PhaseConfig(BaseModel):
    id: str
    name: str
    order: int
    operations: list[str] = []
    prompt_profile: str = "patient_chat"
    transition: PhaseTransition = PhaseTransition()


class CaseDataSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")  # 静默忽略未知字段（兼容存量）

    name: str = Field(min_length=1, max_length=100)
    difficulty: int = Field(default=1, ge=1, le=3)
    time_limit: int = Field(default=20, ge=1, le=180)

    patient_info: PatientInfo | None = None
    chief_complaint: str = ""
    opening_line: str = ""

    personality: PersonalityConfig = PersonalityConfig()
    communication_style: str = ""

    # 病史 — 纯文本字段
    present_illness: str = ""
    past_history: str = ""
    medication_history: str = ""
    allergy_history: str = ""
    family_history: str = ""
    social_history: str = ""

    # 隐藏信息 — 统一为 KV 对
    deep_background: dict[str, str] = {}

    # 训练配置
    phases: list[PhaseConfig] | None = None
    required_inquiries: list[str] = []
    rubric_ref: str = "active"

    # 插件
    supported_plugins: list[str] = []

    # 查体
    exam_anchors: dict[str, Any] = {}

    # 示例对话
    example_dialogues: list[dict] = []

    # 以下存量字段不再校验（extra="ignore" 静默忽略）
    # scoring_criteria, hidden_info, hidden_info_rules
```

### 暴露函数

```python
def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    """strict=True 抛异常，False 仅 log.warning（存量数据兼容）"""
    try:
        return CaseDataSchema(**data).model_dump(exclude_none=True)
    except ValidationError as e:
        if strict:
            raise HTTPException(status_code=422, detail=e.errors())
        logging.warning("case_data validation: %s", e)
        return data  # 原样返回


def assert_valid_case_data(data: dict) -> dict:
    return validate_case_data(data, strict=True)
```

### 集成点

| 入口 | 模式 | 行为 |
|------|------|------|
| `POST /cases` | `assert_valid_case_data` | 校验失败抛 422 |
| `PUT /cases/{id}` | `assert_valid_case_data` | 同上 |
| `POST /cases/generate` | `assert_valid_case_data` | LLM 输出后校验，失败可重试 |
| `_create_record()` | `validate_case_data(strict=False)` | warn 不阻断 |
| `get_record_detail()` | `validate_case_data(strict=False)` | warn 不阻断 |

### 不改变

- `Case.case_data` JSONB 存储格式
- 下游 `case_data.get("xxx")` 读取代码
- 存量数据向后兼容

---

## Phase 2: Runtime State 分离

### 模型变更

```python
class TrainingRecord(Base):
    # ... 已有字段不变
    runtime_state: Mapped[dict] = mapped_column(
        JSONB, server_default=sa.text("'{}'::jsonb"), default=dict
    )
```

### 数据流

```python
# context.py
@dataclass
class PipelineContext:
    record: TrainingRecord

    def setup_phases(self):
        rs = self.record.runtime_state or {}
        self.phase_operation_count = rs.get("phase_op_count", 0)
```

### 读写替换

| 位置 | 当前 | 改为 |
|------|------|------|
| `physical_exam/routes.py` | `snapshot["_exam_results"]` | `record.runtime_state["exam_results"]` |
| `persister.py` | `snapshot["_phase_op_count"]` | `ctx.record.runtime_state["phase_op_count"]` |
| `exam_emotion_bridge` | `snapshot_updates["_exam_impact_note"]` | `record.runtime_state["exam_impact_note"]` |
| `sources.py:ExamResultsSource` | `snapshot.get("_exam_results")` | `runtime_state.get("exam_results")` |
| `sources.py:ExamImpactSource` | `snapshot.get("_exam_impact_note")` | `runtime_state.get("exam_impact_note")` |
| `progress.py` | `practice_snapshot.get("_phase_op_count")` | `runtime_state.get("phase_op_count")` |

### 存量迁移

Alembic migration 中执行：

```python
def upgrade():
    op.add_column("training_records",
        sa.Column("runtime_state", postgresql.JSONB, server_default="{}")
    )
    # 数据迁移
    conn = op.get_bind()
    rows = conn.execute(text("SELECT id, practice_snapshot FROM training_records")).fetchall()
    for row in rows:
        snap = row.practice_snapshot or {}
        runtime = {}
        for old_key, new_key in [
            ("_exam_results", "exam_results"),
            ("_phase_op_count", "phase_op_count"),
        ]:
            if old_key in snap:
                runtime[new_key] = snap.pop(old_key)
        if snap and "_exam_impact_note" in snap:
            runtime["exam_impact_note"] = snap.pop("_exam_impact_note")
        # 清理所有下划线开头的键
        for key in list(snap):
            if key.startswith("_"):
                del snap[key]
        conn.execute(
            text("UPDATE training_records SET practice_snapshot = :snap, runtime_state = :rt WHERE id = :id"),
            {"snap": snap, "rt": runtime, "id": row.id}
        )
```

---

## Phase 3: author_note 重构

### 接口

```python
# contexts/patient/sources.py — 精简为接口 + 各 Source 实现
class NoteSource(ABC):
    name: str
    priority: int = 0
    max_tokens: int = 100

    @abstractmethod
    async def collect(self, ctx: PipelineContext) -> str | None:
        ...
```

### NoteCollector

```python
# contexts/patient/note_collector.py
MAX_AUTHOR_NOTE_TOKENS = 300

class NoteCollector:
    def __init__(self):
        self._sources: list[NoteSource] = []

    def add(self, source: NoteSource) -> None:
        self._sources.append(source)

    async def collect(self, ctx: PipelineContext) -> str:
        notes: list[tuple[int, str, str]] = []  # (priority, name, text)
        for src in self._sources:
            try:
                text = await src.collect(ctx)
                if text and text.strip():
                    notes.append((src.priority, src.name, text.strip()))
            except Exception:
                log.exception("NoteSource %s failed", src.name)
        notes.sort(key=lambda x: x[0])
        return self._budget_join(notes)

    def _budget_join(self, notes: list) -> str:
        budget = MAX_AUTHOR_NOTE_TOKENS
        selected = []
        for _, name, text in notes:
            cost = _estimate_tokens(text)
            if cost > budget:
                if not selected:  # 高优先级超预算 → 截断
                    selected.append(_truncate_tokens(text, budget))
                break
            selected.append(text)
            budget -= cost
        return "【" + " | ".join(selected) + "】" if selected else ""
```

### Token 估算

```python
def _estimate_tokens(text: str) -> int:
    """启发式 token 估算，不需外部依赖"""
    char_count = len(text)
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    return cjk * 2 + (char_count - cjk) // 2

def _truncate_tokens(text: str, max_tokens: int) -> str:
    """简截断：用中文字符数做近似"""
    max_chars = max_tokens // 2
    return text[:max_chars] + "…" if len(text) > max_chars else text
```

### Pipeline 装配

```python
# plugins/manager.py
def build_pipeline(self, feature_flags):
    middlewares = [...]  # 同现有

    collector = NoteCollector()
    # 核心 sources（始终存在）
    collector.add(EmotionNoteSource())
    collector.add(IdentityGuardSource())
    collector.add(ExamResultsSource())
    collector.add(ExamImpactSource())
    # 插件 sources
    for plugin in self.get_active(feature_flags):
        for ns in plugin.get_note_sources():
            collector.add(ns)

    return middlewares, collector
```

### Plugin 基类扩展

```python
class Plugin(ABC):
    def get_note_sources(self) -> list[NoteSource]:
        return []
```

### 删除

- `register_source()` 函数
- `collect_author_note()` 函数
- `_sources` 模块全局变量

---

## Phase 4: 插件-病例数据契约

### Plugin 基类

```python
class Plugin(ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    description: ClassVar[str] = ""
    requires: ClassVar[list[str]] = []
    required_case_fields: ClassVar[list[str]] = []   # ← 新增
    feature_flag: ClassVar[FeatureFlag | None] = None
```

### 各插件声明

| 插件 | `required_case_fields` | 原因 |
|------|------------------------|------|
| `physical-exam` | `["exam_anchors"]` | 体检需要查体锚点数据 |
| `initiative` | `["personality"]` | 主动追问依赖人格模型 |
| `emotion` | `[]` | 无需特定 case_data 字段 |
| `exam-emotion-bridge` | `["exam_anchors"]` | 联动体检结果 |
| `portrait` | `[]` | 纯前端插件 |

### Schema 联动

```python
def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    schema_validated = CaseDataSchema(**data)  # Pydantic 校验
    supported = data.get("supported_plugins", [])
    if supported:
        from plugins.manager import get_plugin_manager
        pm = get_plugin_manager()
        if not pm._plugins:
            pm.discover()
        for plugin_id in supported:
            plugin = pm._plugins.get(plugin_id)
            if plugin is None:
                if strict: raise ValidationError(f"未知插件: {plugin_id}")
                continue
            for field in plugin.required_case_fields:
                if field not in data:
                    msg = f"插件 '{plugin_id}' 需要字段 '{field}'"
                    if strict: raise ValidationError(msg)
                    logging.warning(msg)
    return schema_validated.model_dump(exclude_none=True)
```

---

## Phase 5: Rubric 链路闭环

### 问题

- `case_data.scoring_criteria` 被 LLM 生成但评分引擎从不使用
- 评分引擎 `load_rubric_dict()` 读全局 active rubric，与 case 无关联
- `Score.rubric_version` 已存在但未与 case 关联

### 方案

```python
class CaseDataSchema(BaseModel):
    # ... 其他字段
    rubric_ref: str = "active"  # 引用中央评分标准的版本 ID
```

### 训练启动时冻结

```python
# session.py:_create_record()
def _resolve_rubric_ref(rubric_ref: str) -> str:
    from repositories.rubric import load_active_rubric, load_rubric
    if rubric_ref == "active":
        active = load_active_rubric()
        if active:
            return f"{active.name}@{active.version}"
        return "nursing_history_v1@1.0"
    return rubric_ref

# 创建记录时
record.rubric_frozen = _resolve_rubric_ref(
    case_data.get("rubric_ref", "active")
)
```

### 评分引擎使用冻结版本

```python
# score_engine.py
rubric = load_rubric_by_version(record.rubric_frozen)
# 不再调用 load_rubric_dict()
```

### 存储

`models.py`:

```python
class TrainingRecord(Base):
    rubric_frozen: Mapped[str | None] = mapped_column(String(80), nullable=True)
```

migration: `alembic revision --autogenerate -m "add rubric_frozen to training_records"`

### LLM 生成 prompt 调整

`prompts/case_generation.py`:
- 移除 `scoring_criteria` 示例结构
- 改为说明：`评分标准由中央 rubric 管理，case 通过 rubric_ref 引用`

---

## 向后兼容

| 存量数据 | 处理 |
|----------|------|
| `case_data.scoring_criteria` | Pydantic `extra="ignore"` 静默忽略 |
| `case_data.hidden_info` / `hidden_info_rules` | 同上 |
| `practice_snapshot._exam_results` | Phase 2 migration 迁移至 `runtime_state` |
| `practice_snapshot._phase_op_count` | 同上 |
| 缺少 `rubric_ref` 的存量 case | `rubric_ref` 默认 `"active"`，向后兼容 |
| LLM 已生成的带 `scoring_criteria` 的 case | 无影响，数据保留但不再参与评分 |

## 实施顺序

```
Phase 1 ─→ Phase 2 ─→ Phase 3 ─→ Phase 4 ─→ Phase 5
 校验层      状态分离     Note 重构    插件契约      Rubric 闭环

每 Phase 独立 PR，可独立部署，不阻塞日常开发。
估计总工时：Phase 1 (2-3天) + Phase 2 (2天) + Phase 3 (3天) + Phase 4 (1天) + Phase 5 (1-2天)
```
