# 训练配置重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除学生自主练习的 Practice 预设选择环节，改为病例卡片直接配置；后端同步清理 Practice 模型死字段和 feature_flags 副作用。

**Architecture:** 前端新增 TrainingConfigModal（3 选 + 计时器），替换 PracticeSelectModal；后端 capabilities.py 重命名 + `effective_features()` 纯函数；Practice 模型删除 `mode`/`assessment` 列；session.py config 构建统一为工厂函数。

**Tech Stack:** Python 3.13 + FastAPI + SQLAlchemy + Alembic / React 19 + TypeScript + TanStack Query + Tailwind v4

---

## File Structure

### Backend — New

| File | Responsibility |
|------|---------------|
| `backend/core/capabilities.py` | 重命名自 `feature_flags.py`，注册 ALL_CAPABILITIES + `effective_features()` 纯函数 |
| `backend/migrations/versions/XXXX_drop_practice_mode_assessment.py` | DDL: DROP COLUMN mode, assessment |

### Backend — Modified

| File | Change |
|------|--------|
| `backend/models.py:152-180` | Practice 删除 mode/assessment 列+约束 |
| `backend/schemas/practice.py:9-58` | 删除 mode/assessment 字段 |
| `backend/schemas/training.py:9-13` | TrainingStartRequest 新增 features/time_limit_minutes |
| `backend/routers/admin/practices.py:28-146` | 删除 mode/assessment 读写 |
| `backend/contexts/training/router/session.py:141-279` | _resolve_features→effective_features；_build_config 工厂；start_training 新分支 |
| `backend/contexts/training/router/_config.py:7,32` | 导入路径 feature_flags→capabilities |
| `backend/contexts/training/router/chat.py:11` | 同上 |
| `backend/contexts/training/router/progress.py:16` | 同上 |
| `backend/contexts/training/router/physical_exam.py:15` | 同上 |
| `backend/contexts/training/router/scoring.py:234` | 同上 |
| `backend/tests/core/test_feature_flags.py` | 重命名文件 + 增加 effective_features 测试 |

### Backend — Deleted

| File | Reason |
|------|--------|
| `backend/core/feature_flags.py` | 重命名为 capabilities.py |
| `backend/contexts/training/config_loader.py` | 仅被 session_configs 使用 |
| `backend/data/session_configs/` (4 个 JSON) | 已被直接配置替代 |

### Frontend — New

| File | Responsibility |
|------|---------------|
| `frontend/src/components/training/TrainingConfigModal.tsx` | 3 选配置面板：练什么/真实度/训练后 + 时长滑块 |

### Frontend — Modified

| File | Change |
|------|--------|
| `frontend/src/api/cases.ts:18-28` | startTraining 签名扩展 |
| `frontend/src/pages/CaseSelect.tsx:49-278` | PracticeSelectModal → TrainingConfigModal |
| `frontend/src/components/training/TrainingHeader.tsx:23-49` | 训练中开关限制为仅 allow_pause |
| `frontend/src/pages/admin/PracticesPage.tsx:27-361` | 移除 mode 下拉框和 FEATURE_FLAGS 硬编码列表 |

### Frontend — Deleted

| File | Reason |
|------|--------|
| `frontend/src/components/training/PracticeSelectModal.tsx` | 学生不再选模板 |

---

### Task 1: 后端 — capabilities.py 重命名 + effective_features()

**Files:**
- Create: `backend/core/capabilities.py`
- Delete: `backend/core/feature_flags.py`

- [ ] **Step 1: 创建 capabilities.py**

写 `backend/core/capabilities.py`：
```python
from dataclasses import dataclass

ALL_CAPABILITY_KEYS = (
    "allow_pause",
    "patient_initiative",
    "emotion",
    "exam_emotion_bridge",
    "physical_exam",
    "questionnaire",
)


@dataclass(frozen=True)
class Capability:
    key: str
    label: str
    default: bool
    description: str


ALL_CAPABILITIES: dict[str, Capability] = {
    "allow_pause": Capability(
        key="allow_pause",
        label="允许暂停计时",
        default=False,
        description="允许学生在训练中暂停倒计时。后台结算仍以服务器时间为准。",
    ),
    "patient_initiative": Capability(
        key="patient_initiative",
        label="患者主动追问",
        default=False,
        description="患者根据性格/情绪/等待时长主动发言",
    ),
    "emotion": Capability(
        key="emotion",
        label="患者情绪状态机",
        default=False,
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化",
    ),
    "exam_emotion_bridge": Capability(
        key="exam_emotion_bridge",
        label="查体-情绪联动",
        default=False,
        description="查体操作影响患者心态：缺乏解释或不相关检查会降低信任/舒适度",
    ),
    "physical_exam": Capability(
        key="physical_exam",
        label="护理查体",
        default=False,
        description="允许学生触发护理操作（测血压/体温/听诊等）",
    ),
    "questionnaire": Capability(
        key="questionnaire",
        label="问卷评估",
        default=False,
        description="训练结束后向学生推送问卷调查",
    ),
}


def all_capabilities() -> dict[str, Capability]:
    return dict(ALL_CAPABILITIES)


def effective_features(
    student_choices: dict[str, bool] | None = None,
    case_plugins: list[str] | None = None,
) -> dict[str, bool]:
    result = {k: False for k in ALL_CAPABILITY_KEYS}
    if student_choices:
        for k, v in student_choices.items():
            if k in result:
                result[k] = v
    if case_plugins:
        for pid in case_plugins:
            if pid in result:
                result[pid] = True
    if result.get("patient_initiative"):
        result["emotion"] = True
    return result


def resolve_features(practice_snapshot: dict | None) -> dict[str, bool]:
    result = {k: v.default for k, v in ALL_CAPABILITIES.items()}
    if practice_snapshot:
        for k, v in practice_snapshot.get("features", {}).items():
            if k in result:
                result[k] = v
    return result


def is_enabled(record, key: str) -> bool:
    return resolve_features(record.practice_snapshot).get(key, False)
```

- [ ] **Step 2: 删除旧文件**

```bash
Remove-Item -LiteralPath "backend\core\feature_flags.py"
```

- [ ] **Step 3: 更新所有 imports（6 处）**

逐个文件替换 `from core.feature_flags import` → `from core.capabilities import`：

`backend/contexts/training/router/_config.py:7`：
```
from core.capabilities import ALL_CAPABILITIES, resolve_features
```
并将第 32 行 `set(FEATURE_FLAGS.keys())` 改为 `set(ALL_CAPABILITIES.keys())`

`backend/contexts/training/router/chat.py:11`：
```
from core.capabilities import resolve_features
```

`backend/contexts/training/router/progress.py:16`：
```
from core.capabilities import is_enabled, resolve_features
```

`backend/contexts/training/router/physical_exam.py:15`：
```
from core.capabilities import resolve_features
```

`backend/contexts/training/router/scoring.py:234`：
```
from core.capabilities import resolve_features
```

`backend/contexts/training/router/session.py:16`：
```
from core.capabilities import ALL_CAPABILITIES, resolve_features
```

- [ ] **Step 4: 更新测试文件**

`backend/tests/core/test_feature_flags.py` → 重命名为 `test_capabilities.py`，import 改为：
```python
from core.capabilities import ALL_CAPABILITIES, all_capabilities, effective_features, is_enabled, resolve_features
```
函数内 `FEATURE_FLAGS` → `ALL_CAPABILITIES`，`all_feature_flags()` → `all_capabilities()`

新增测试 `TestEffectiveFeatures`：
```python
class TestEffectiveFeatures:
    def test_default_all_false(self):
        result = effective_features()
        assert result == {k: False for k in ALL_CAPABILITY_KEYS}

    def test_student_choices_override(self):
        result = effective_features({"physical_exam": True})
        expected = {k: False for k in ALL_CAPABILITY_KEYS}
        expected["physical_exam"] = True
        assert result == expected

    def test_case_plugins_force_enable(self):
        result = effective_features({}, ["physical_exam"])
        expected = {k: False for k in ALL_CAPABILITY_KEYS}
        expected["physical_exam"] = True
        assert result == expected

    def test_initiative_depends_emotion(self):
        result = effective_features({"patient_initiative": True})
        assert result["patient_initiative"] is True
        assert result["emotion"] is True

    def test_student_choice_wins_over_plugin(self):
        result = effective_features({"physical_exam": False}, ["physical_exam"])
        assert not result["physical_exam"]
```

- [ ] **Step 5: 运行测试验证**

```bash
cd backend; uv run python -m pytest tests/core/test_capabilities.py -x -q --tb=short
```

Expected: 所有新增+已有测试 PASS

- [ ] **Step 6: 运行全量后端测试**

```bash
cd backend; uv run python -m pytest -x -q --tb=short
```

Expected: 全 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/core/capabilities.py backend/core/feature_flags.py backend/contexts/training/router/_config.py backend/contexts/training/router/chat.py backend/contexts/training/router/progress.py backend/contexts/training/router/physical_exam.py backend/contexts/training/router/scoring.py backend/contexts/training/router/session.py backend/tests/core/test_feature_flags.py
git commit -m "♻️ refactor: feature_flags → capabilities + effective_features 纯函数"
```

---

### Task 2: 后端 — Practice 模型删除 mode/assessment + migration

**Files:**
- Modify: `backend/models.py:152-180`
- Modify: `backend/schemas/practice.py:9-58`
- Modify: `backend/routers/admin/practices.py:28-146`
- Create: `backend/migrations/versions/XXXX_drop_practice_mode_assessment.py`

- [ ] **Step 1: 修改 models.py**

`backend/models.py:152-161` — 删除 `mode` 列定义、CheckConstraint、`assessment` 列定义。

将：
```python
class Practice(Base):
    __tablename__ = "practices"
    __table_args__ = (
        Index("ix_practices_case_id", "case_id"),
        Index("ix_practices_school_id", "school_id"),
        CheckConstraint(
            "mode IN ('training', 'assessment', 'free_play')",
            name="ck_practices_mode",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)
    mode: Mapped[str] = mapped_column(String(20), default="training")
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    behavior: Mapped[dict] = mapped_column(JSONB, default=dict)
    assessment: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

改为：
```python
class Practice(Base):
    __tablename__ = "practices"
    __table_args__ = (
        Index("ix_practices_case_id", "case_id"),
        Index("ix_practices_school_id", "school_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    case_id: Mapped[int] = mapped_column(Integer, ForeignKey("cases.id", ondelete="RESTRICT"))
    school_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True)
    features: Mapped[dict] = mapped_column(JSONB, default=dict)
    behavior: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
```

- [ ] **Step 2: 修改 schemas/practice.py**

删除 `PracticeCreate`、`PracticeUpdate`、`PracticeItem`、`PracticeBrief` 中的 `mode` 和 `assessment` 字段。

`backend/schemas/practice.py` 完整内容：
```python
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field
from schemas.common import _REQ_CFG, _RESP_CFG


class PracticeCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    case_id: int
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)


class PracticeUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    case_id: int | None = None
    features: dict[str, bool] | None = None
    behavior: dict[str, Any] | None = None
    is_active: bool | None = None


class PracticeItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    case_id: int
    case_name: str = ""
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    training_count: int = 0
    created_at: datetime
    updated_at: datetime


PracticeResponse = PracticeItem


class PracticeBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)
```

- [ ] **Step 3: 修改 admin/practices.py**

`_to_item` 函数删除 `mode` 和 `assessment` 字段：
```python
def _to_item(p: Practice, training_count: int = 0) -> PracticeItem:
    return PracticeItem(
        id=p.id,
        name=p.name,
        description=p.description,
        case_id=p.case_id,
        case_name=p.case.name if p.case else "",
        features=p.features or {},
        behavior=p.behavior or {},
        is_active=p.is_active,
        training_count=training_count,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )
```

`create_practice` 删除 `mode=data.mode,` 和 `assessment=data.assessment,`。

`update_practice` 中：
- `for field in ("name", "description", "case_id", "mode", "is_active"):` → 删除 `"mode"`
- 删除 `if data.assessment is not None: p.assessment = data.assessment`

- [ ] **Step 4: 生成 migration**

```bash
cd backend; uv run alembic revision --autogenerate -m "drop_practice_mode_assessment"
```

验证生成的 migration 文件包含 `op.drop_column("practices", "mode")` 和 `op.drop_column("practices", "assessment")`，以及 `op.drop_constraint("ck_practices_mode")`。

- [ ] **Step 5: 运行 migration roundtrip 测试**

```bash
cd backend; uv run alembic downgrade -1; uv run alembic upgrade head
```

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/schemas/practice.py backend/routers/admin/practices.py backend/migrations/versions/
git commit -m "🗃️ db: Practice 删除 mode/assessment 死字段"
```

---

### Task 3: 后端 — 删除 session_configs + config_loader

**Files:**
- Delete: `backend/data/session_configs/standard-assessment.json`
- Delete: `backend/data/session_configs/scenario-simulation.json`
- Delete: `backend/data/session_configs/free-exploration.json`
- Delete: `backend/data/session_configs/classroom-practice.json`
- Delete: `backend/contexts/training/config_loader.py`

- [ ] **Step 1: 删除文件**

```bash
Remove-Item -LiteralPath "backend\data\session_configs" -Recurse -Force
Remove-Item -LiteralPath "backend\contexts\training\config_loader.py"
```

- [ ] **Step 2: 移除 session.py 中的 config_loader 引用**

`session.py` 顶部删除 `from .config_loader import get_config`，以及第 259 行 `config = get_config("standard-assessment") or {}`。

- [ ] **Step 3: Commit**

```bash
git add backend/data/session_configs/ backend/contexts/training/config_loader.py backend/contexts/training/router/session.py
git commit -m "🔥 remove: session_configs JSON 降级预设 + config_loader"
```

---

### Task 4: 后端 — TrainingStartRequest 扩展 + start_training 重构

**Files:**
- Modify: `backend/schemas/training.py:9-13`
- Modify: `backend/contexts/training/router/session.py:220-279`

- [ ] **Step 1: 扩展 TrainingStartRequest**

`backend/schemas/training.py`：
```python
class TrainingStartRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    practice_id: int | None = None
    features: dict[str, bool] | None = None
    time_limit_minutes: int | None = None
```

- [ ] **Step 2: 抽取 _build_config 工厂 + 重构 start_training**

`backend/contexts/training/router/session.py` 在 `_create_record` 之前添加：
```python
def _build_config(practice: Practice | None = None, features: dict | None = None, time_limit_minutes: int | None = None) -> dict:
    if practice:
        return {
            "id": practice.id,
            "name": practice.name,
            "features": practice.features or {},
            "behavior": practice.behavior or {},
        }
    return {
        "id": 0,
        "name": "自定义配置",
        "features": features or {},
        "behavior": {"time_limit_minutes": time_limit_minutes or 20},
    }
```

`start_training` 重写为：
```python
@router.post("/start", response_model=TrainingStartResponse)
def start_training(
    req: TrainingStartRequest,
    current_user: Annotated[User, Depends(require_permission("training_access"))],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    effective_school = resolve_school_filter(current_user)
    case_query = db.query(Case).filter(Case.id == req.case_id)
    if effective_school is not None:
        case_query = case_query.filter((Case.school_id == effective_school) | (Case.school_id.is_(None)))
    case = case_query.first()
    if not case:
        raise NotFoundError(detail="病例不存在")

    practice = None
    if req.practice_id:
        practice = db.query(Practice).filter(Practice.id == req.practice_id, Practice.case_id == req.case_id).first()
        if not practice:
            raise HTTPException(status_code=400, detail="练习模板不存在或不属于该病例")
    elif req.features is None:
        practice = db.query(Practice).filter(Practice.case_id == req.case_id, Practice.is_active == True).first()

    config = _build_config(practice, req.features, req.time_limit_minutes)

    record, greeting = _create_record(
        db,
        current_user.id,
        case,
        case.case_data or {},
        config,
        practice_id=practice.id if practice else None,
        app_state=request.app.state,
    )

    log.info(
        f"训练开始: record_id={record.id} case_id={case.id} case_name={case.name}",
        extra={
            "user_id": current_user.id,
            "user_role": current_user.role.name if current_user.role else "",
            "action": "training_start",
        },
    )
    return TrainingStartResponse(record_id=record.id, greeting=greeting, case_name=case.name)
```

- [ ] **Step 3: 运行全量测试**

```bash
cd backend; uv run python -m pytest tests/training/ -x -q --tb=short
```

- [ ] **Step 4: ruff 检查**

```bash
cd backend; uv run ruff check
```

- [ ] **Step 5: Commit**

```bash
git add backend/schemas/training.py backend/contexts/training/router/session.py
git commit -m "✨ feat: start_training 支持直接配置 features + time_limit"
```

---

### Task 5: 前端 — TrainingConfigModal

**Files:**
- Create: `frontend/src/components/training/TrainingConfigModal.tsx`

- [ ] **Step 1: 写入组件**

写完整内容如下：

```typescript
import { Clock, MessageCircle, Minus, Pause, Plus, Smile, Stethoscope, Star, User } from "lucide-react";
import { useCallback, useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

interface PatientInfo {
    name: string;
    difficulty: number;
    description?: string | null;
    patient_summary?: { gender?: string; age?: number; chief_complaint?: string } | null;
}

interface Props {
    open: boolean;
    caseInfo: PatientInfo;
    onClose: () => void;
    onStart: (features: Record<string, boolean>, timeLimit: number) => void;
    loading?: boolean;
}

export default function TrainingConfigModal({ open, caseInfo, onClose, onStart, loading }: Props) {
    const [exam, setExam] = useState(false);
    const [advanced, setAdvanced] = useState(false);
    const [questionnaire, setQuestionnaire] = useState(false);
    const [timeLimit, setTimeLimit] = useState(20);

    const handleStart = useCallback(() => {
        const features: Record<string, boolean> = {};
        features.physical_exam = exam;
        if (advanced) {
            features.emotion = true;
            features.patient_initiative = true;
            if (exam) features.exam_emotion_bridge = true;
        }
        if (questionnaire) features.questionnaire = true;
        onStart(features, timeLimit);
    }, [exam, advanced, questionnaire, timeLimit, onStart]);

    const summary = caseInfo.patient_summary;
    const diffStars = Array.from({ length: 3 }, (_, i) => i < (caseInfo.difficulty || 1));

    const adjustTime = (delta: number) => setTimeLimit((t) => Math.min(60, Math.max(5, t + delta)));

    return (
        <Modal open={open} onClose={onClose} title="训练配置" maxWidth={480}>
            <div className="flex flex-col gap-5 pb-1">
                {/* Case Preview */}
                <div className="rounded-xl border bg-gradient-to-br from-primary/5 to-primary/[0.02] p-4">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <h3 className="font-semibold text-base">{caseInfo.name}</h3>
                            {caseInfo.description && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{caseInfo.description}</p>
                            )}
                        </div>
                        <div className="flex gap-0.5 shrink-0">
                            {diffStars.map((filled, i) => (
                                <Star key={i} size={14} fill={filled ? "#f59e0b" : "none"} color={filled ? "#f59e0b" : "#d1d5db"} />
                            ))}
                        </div>
                    </div>
                    {summary && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                            {summary.gender && (
                                <span className="inline-flex items-center gap-1"><User size={12} />{summary.gender === "男" ? "男性" : summary.gender === "女" ? "女性" : summary.gender}</span>
                            )}
                            {typeof summary.age === "number" && <span>{summary.age}岁</span>}
                            {summary.chief_complaint && <span className="truncate max-w-[200px]">主诉：{summary.chief_complaint}</span>}
                        </div>
                    )}
                </div>

                {/* Section: 练什么 */}
                <div>
                    <span className="text-sm font-medium mb-3 block">你要练什么？</span>
                    <button
                        type="button"
                        onClick={() => setExam((v) => !v)}
                        className={cn(
                            "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
                            exam ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/20 hover:bg-muted/50",
                        )}
                    >
                        <div className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", exam ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                            <Stethoscope size={18} />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-medium">护理查体</p>
                            <p className="text-[11px] text-muted-foreground">执行生命体征、体格检查等操作</p>
                        </div>
                        <div className={cn("h-5 w-9 rounded-full transition-colors shrink-0", exam ? "bg-primary" : "bg-muted-foreground/25")}>
                            <div className={cn("size-4 rounded-full bg-white shadow-sm transition-transform mt-0.5", exam ? "translate-x-[18px]" : "translate-x-[2px]")} />
                        </div>
                    </button>
                </div>

                {/* Section: 真实度 */}
                <div>
                    <span className="text-sm font-medium mb-3 block">患者要有多真实？</span>
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setAdvanced(false)}
                            className={cn("flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all", !advanced ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/20 hover:bg-muted/50")}
                        >
                            <Smile size={18} className={!advanced ? "text-primary" : "text-muted-foreground"} />
                            <div>
                                <p className="text-sm font-medium">基础</p>
                                <p className="text-[11px] text-muted-foreground">纯问诊，患者被动应答</p>
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => setAdvanced(true)}
                            className={cn("flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all", advanced ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border hover:border-primary/20 hover:bg-muted/50")}
                        >
                            <MessageCircle size={18} className={advanced ? "text-primary" : "text-muted-foreground"} />
                            <div>
                                <p className="text-sm font-medium">进阶</p>
                                <p className="text-[11px] text-muted-foreground">情绪变化 + 主动追问{exam ? " + 查体联动" : ""}</p>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Section: 训练后 */}
                <div>
                    <span className="text-sm font-medium mb-3 block">训练结束后</span>
                    <button
                        type="button"
                        onClick={() => setQuestionnaire((v) => !v)}
                        className={cn(
                            "flex items-center gap-3 w-full rounded-lg border p-3 text-left transition-all",
                            questionnaire ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/20 hover:bg-muted/50",
                        )}
                    >
                        <div className={cn("flex size-9 items-center justify-center rounded-lg shrink-0", questionnaire ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                            <Pause size={18} />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-medium">填写评估问卷</p>
                            <p className="text-[11px] text-muted-foreground">训练结束后弹出评估问卷</p>
                        </div>
                        <div className={cn("h-5 w-9 rounded-full transition-colors shrink-0", questionnaire ? "bg-primary" : "bg-muted-foreground/25")}>
                            <div className={cn("size-4 rounded-full bg-white shadow-sm transition-transform mt-0.5", questionnaire ? "translate-x-[18px]" : "translate-x-[2px]")} />
                        </div>
                    </button>
                </div>

                {/* Time */}
                <div>
                    <span className="text-sm font-medium mb-3 block">时长限制</span>
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                        <Clock size={18} className="text-muted-foreground shrink-0" />
                        <div className="flex-1">
                            <input type="range" min={5} max={60} step={5} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))}
                                className="w-full h-2 rounded-full appearance-none bg-muted cursor-pointer accent-primary" />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                            <button type="button" onClick={() => adjustTime(-5)} className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><Minus size={14} /></button>
                            <span className="w-10 text-center text-sm font-semibold tabular-nums">{timeLimit}</span>
                            <button type="button" onClick={() => adjustTime(5)} className="size-7 flex items-center justify-center rounded-md hover:bg-muted"><Plus size={14} /></button>
                            <span className="text-xs text-muted-foreground">分钟</span>
                        </div>
                    </div>
                </div>

                <Button onClick={handleStart} disabled={loading} className="w-full h-11 text-base font-semibold" size="lg">
                    {loading ? "启动中..." : "开始训练"}
                </Button>
            </div>
        </Modal>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/TrainingConfigModal.tsx
git commit -m "✨ feat: TrainingConfigModal — 3选配置面板"
```

---

### Task 6: 前端 — CaseSelect 替换 PracticeSelectModal

**Files:**
- Modify: `frontend/src/pages/CaseSelect.tsx`

- [ ] **Step 1: 更新 imports + 状态 + mutation**

`CaseSelect.tsx` — 将 `import PracticeSelectModal` 替换为 `import TrainingConfigModal`。

`selectedCase` 状态扩展为：
```typescript
const [selectedCase, setSelectedCase] = useState<{
    id: number;
    name: string;
    difficulty: number;
    description?: string | null;
    patient_summary?: CaseBrief["patient_summary"];
} | null>(null);
```

`startMutation` 的 `mutationFn` 改为：
```typescript
mutationFn: ({ caseId, features, timeLimit }: { caseId: number; features: Record<string, boolean>; timeLimit: number }) =>
    startTraining(caseId, null, features, timeLimit),
```

- [ ] **Step 2: 更新病例卡片点击**

`onClick={() => setSelectedCase({ id: c.id, name: c.name })}` → 
```typescript
onClick={() => setSelectedCase({ id: c.id, name: c.name, difficulty: c.difficulty || 1, description: c.description, patient_summary: c.patient_summary })}
```

- [ ] **Step 3: 替换 Modal**

将 `PracticeSelectModal` 替换为：
```typescript
{selectedCase && (
    <TrainingConfigModal
        open={!!selectedCase}
        caseInfo={selectedCase}
        onClose={() => setSelectedCase(null)}
        onStart={(features, timeLimit) => {
            startMutation.mutate({ caseId: selectedCase.id, features, timeLimit });
            setSelectedCase(null);
        }}
        loading={startMutation.isPending}
    />
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CaseSelect.tsx frontend/src/components/training/PracticeSelectModal.tsx
git commit -m "✨ feat: CaseSelect 替换 PracticeSelectModal → TrainingConfigModal"
```

---

### Task 7: 前端 — API 客户端 + TrainingHeader + PracticesPage

**Files:**
- Modify: `frontend/src/api/cases.ts:18-28`
- Modify: `frontend/src/components/training/TrainingHeader.tsx:23-49`
- Modify: `frontend/src/pages/admin/PracticesPage.tsx:27-361`
- Delete: `frontend/src/components/training/PracticeSelectModal.tsx`

- [ ] **Step 1: 更新 startTraining API**

`frontend/src/api/cases.ts`：
```typescript
export const startTraining = (
    caseId: number | string,
    practiceId?: number | null,
    features?: Record<string, boolean> | null,
    timeLimitMinutes?: number | null,
) =>
    api.post<Schemas["TrainingStartResponse"]>(
        "/training/start" satisfies ApiPath as string,
        {
            case_id: caseId,
            ...(practiceId ? { practice_id: practiceId } : {}),
            ...(features ? { features } : {}),
            ...(timeLimitMinutes != null ? { time_limit_minutes: timeLimitMinutes } : {}),
        },
    );
```

- [ ] **Step 2: TrainingHeader 限制开关**

`FEATURE_META` 移除非 `allow_pause` 条目，只保留：
```typescript
const FEATURE_META: Record<string, { label: string; desc: string }> = {
    allow_pause: { label: "允许暂停计时", desc: "允许学生在训练中暂停倒计时" },
};
```

`handleToggleFeature` 中增加过滤，非 `allow_pause` 直接 return：
```typescript
if (key !== "allow_pause") return;
```

- [ ] **Step 3: PracticesPage 移除 mode**

`MODES` 字典删除。`FEATURE_FLAGS` 数组删除（改用后端 capabilities 数据或精简列表）。

表单 `PracticeForm` 删除 `mode` 字段。`emptyForm` 删除 `mode: "training"`。

创建/编辑表单删除 mode 下拉框：
```html
{/* 删除整个 mode select */}
```

`_to_item` 相关代码不变（后端已处理）。

创建 payload：
```typescript
const payload = { name: name.trim(), description: form.description.trim() || null, case_id, features, behavior: { time_limit_minutes: time_limit, max_rounds } };
```

编辑 payload 同。

- [ ] **Step 4: 删除 PracticeSelectModal**

```bash
Remove-Item -LiteralPath "frontend\src\components\training\PracticeSelectModal.tsx"
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/cases.ts frontend/src/components/training/TrainingHeader.tsx frontend/src/pages/admin/PracticesPage.tsx frontend/src/components/training/PracticeSelectModal.tsx
git commit -m "✨ feat: API/TrainingHeader/PracticesPage 同步配置重设计"
```

---

### Task 8: 验证

- [ ] **Step 1: 全量后端验证**

```bash
cd backend; uv run ruff check; uv run python -m pytest -x -q --tb=short
```

- [ ] **Step 2: 全量前端验证**

```bash
cd frontend; npx tsc --noEmit; npx biome check
```

- [ ] **Step 3: 确认所有测试通过 + lint 零警告**
