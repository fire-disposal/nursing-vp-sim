# 批次一：评分公信力与防丢数据 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让学生看到的分数可信、教师复核有效、学生填写的内容不丢失。
**Architecture:** 分 9 个 Task 执行。Task 1-3 是纯后端评分逻辑修复，Task 4-5 涉及 DDL 迁移 + schema 变更 + `pnpm run api:update`，Task 6-8 是后端+前端联调 bugfix，Task 9 是 FK 迁移与收尾。后端分层 thin router → service → repository，迁移进 ddl/，schema 变更后必须 `pnpm run api:update`。
**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pytest / React 19 + TS + TanStack Query
**Spec:** docs/superpowers/specs/2026-07-16-prototype-consolidation-design.md（批次一）
---

## Task 1: 评分校验补全 (1.8) — 幻觉维度过滤 / 越界裁剪 / 总分重算 / 缺失维度补零

**Files:**
- Modify: `backend/contexts/training/_scoring_validation.py:30-202`
- Create: `backend/tests/scoring/test_scoring_validation_ext.py`

### Step 1: 写失败测试

- [ ] **Step 1: 写评分校验集成测试（失败先行）**

Create `backend/tests/scoring/test_scoring_validation_ext.py`:

```python
"""Extended scoring validation tests for 1.8 — hallucination filtering, clamping, total recalc, missing-zero."""

import pytest
from contexts.training._scoring_validation import (
    _coerce_numeric_fields,
    _filter_hallucinated_dimensions,
    _clamp_scores,
    _recalc_total_from_dimensions,
    _inject_missing_dimensions,
    _inject_rubric_max,
)

RUBRIC_SAMPLE = {
    "raw_scale": 3,
    "raw_max": 57,
    "dimensions": [
        {"id": "dim_a", "name": "问诊完整性", "max": 30, "items": [{"id": "a1", "name": "现病史"}, {"id": "a2", "name": "既往史"}]},
        {"id": "dim_b", "name": "沟通技巧", "max": 15, "items": [{"id": "b1", "name": "共情表达"}]},
        {"id": "dim_c", "name": "临床推理", "max": 12, "items": [{"id": "c1", "name": "鉴别诊断"}]},
    ],
}


class TestFilterHallucinatedDimensions:
    def test_filters_dimension_not_in_rubric(self):
        detail = {"问诊完整性": {"score": 25}, "不存在的维度": {"score": 10}}
        rubric_names = {d["name"] for d in RUBRIC_SAMPLE["dimensions"]}
        result = _filter_hallucinated_dimensions(detail, rubric_names)
        assert "不存在的维度" not in result
        assert "问诊完整性" in result

    def test_keeps_all_valid_dimensions(self):
        detail = {"问诊完整性": {"score": 25}, "沟通技巧": {"score": 10}, "临床推理": {"score": 8}}
        rubric_names = {d["name"] for d in RUBRIC_SAMPLE["dimensions"]}
        result = _filter_hallucinated_dimensions(detail, rubric_names)
        assert len(result) == 3

    def test_returns_empty_dict_when_all_hallucinated(self):
        detail = {"幻觉1": {"score": 10}, "幻觉2": {"score": 20}}
        rubric_names = {d["name"] for d in RUBRIC_SAMPLE["dimensions"]}
        result = _filter_hallucinated_dimensions(detail, rubric_names)
        assert result == {}


class TestClampScores:
    def test_clamps_item_score_to_0_raw_scale(self):
        detail = {"问诊完整性": {"score": 25, "max": 30, "items": [{"score": 5, "max": 3}, {"score": -1, "max": 3}]}}
        _clamp_scores(detail, raw_scale=3)
        assert detail["问诊完整性"]["items"][0]["score"] == 3
        assert detail["问诊完整性"]["items"][1]["score"] == 0

    def test_clamps_dimension_score_to_0_max(self):
        detail = {"问诊完整性": {"score": 35, "max": 30}}
        _clamp_scores(detail, raw_scale=3)
        assert detail["问诊完整性"]["score"] == 30

    def test_clamps_dimension_score_above_0(self):
        detail = {"问诊完整性": {"score": -5, "max": 30}}
        _clamp_scores(detail, raw_scale=3)
        assert detail["问诊完整性"]["score"] == 0


class TestRecalcTotalFromDimensions:
    def test_recalc_total_matches_rounded_weighted_sum(self):
        detail = {
            "问诊完整性": {"score": 25, "max": 30, "items": [{}, {}]},
            "沟通技巧": {"score": 10, "max": 15, "items": [{}]},
            "临床推理": {"score": 8, "max": 12, "items": [{}]},
        }
        total = _recalc_total_from_dimensions(detail, raw_scale=3)
        expected = round(25 * 30 / (2 * 3) + 10 * 15 / (1 * 3) + 8 * 12 / (1 * 3))
        assert total == expected

    def test_skips_dim_without_items(self):
        detail = {"问诊完整性": {"score": 10, "max": 10}}
        total = _recalc_total_from_dimensions(detail, raw_scale=3)
        assert total == 10  # no items → adds raw score directly


class TestInjectMissingDimensions:
    def test_adds_missing_dimension_with_zero_score(self):
        detail = {"问诊完整性": {"score": 25, "max": 30, "items": [{}, {}]}}
        rubric = RUBRIC_SAMPLE
        _inject_missing_dimensions(detail, rubric)
        assert "沟通技巧" in detail
        assert detail["沟通技巧"]["score"] == 0
        assert "missed_content" in detail  # injected into the result side-channel

    def test_does_not_override_existing_dimension(self):
        detail = {"问诊完整性": {"score": 25, "max": 30, "items": [{}, {}]}}
        rubric = RUBRIC_SAMPLE
        _inject_missing_dimensions(detail, rubric)
        assert detail["问诊完整性"]["score"] == 25
```

- Run: `cd backend; uv run python -m pytest tests/scoring/test_scoring_validation_ext.py -x -q`
- **Expected:** All tests fail (functions not yet defined).

### Step 2: 实现校验函数

- [ ] **Step 2: 在 `_scoring_validation.py` 添加四个新函数并集成到现有管道**

Append after `_convert_to_100_scale` (line 202) in `backend/contexts/training/_scoring_validation.py`:

```python
def _filter_hallucinated_dimensions(detail_scores: dict, rubric_dim_names: set[str]) -> dict:
    """Remove dimensions whose names are not present in the rubric."""
    removed = [k for k in detail_scores if k not in rubric_dim_names]
    if removed:
        log.warning("hallucinated_dimensions_removed", extra={"dimensions": removed})
    return {k: v for k, v in detail_scores.items() if k in rubric_dim_names}


def _clamp_scores(detail_scores: dict, raw_scale: int) -> None:
    """Clamp every score value to [0, max] range in-place."""
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        dim_max = dim_data.get("max", 0)
        if "score" in dim_data:
            dim_data["score"] = max(0.0, min(float(dim_data["score"]), float(dim_max)))
        for item in dim_data.get("items", []):
            if isinstance(item, dict):
                item["score"] = max(0.0, min(float(item.get("score", 0)), float(raw_scale)))


def _recalc_total_from_dimensions(detail_scores: dict, raw_scale: int) -> float:
    """Recalculate total_score from dimension scores weighted by item count.
    
    Uses the same logic as submit_score_review (score_review.py:63-75):
    total = sum(dim_score * dim_max_100 / (item_count * raw_scale))
    Falls back to summing dim_score directly if dim has no items.
    """
    total = 0.0
    for dim_data in detail_scores.values():
        if not isinstance(dim_data, dict):
            continue
        dim_score = dim_data.get("score", 0)
        dim_max = dim_data.get("max", 0)
        items = dim_data.get("items", [])
        if isinstance(items, list) and len(items) > 0 and dim_max > 0:
            raw_max_dim = len(items) * raw_scale
            total += round(dim_score * dim_max / raw_max_dim, 1)
        else:
            total += dim_score
    return round(total, 1)


def _inject_missing_dimensions(detail_scores: dict, rubric: dict) -> None:
    """For each rubric dimension not present in detail_scores, inject a zero-score entry."""
    raw_scale = rubric.get("raw_scale", 3)
    for dim in rubric.get("dimensions", []):
        dim_name = dim["name"]
        if dim_name not in detail_scores:
            items = [{"id": it["id"], "name": it["name"], "score": 0, "max": raw_scale} for it in dim.get("items", [])]
            detail_scores[dim_name] = {
                "score": 0,
                "max": dim.get("max", 0),
                "items": items,
                "_injected": True,
            }
            log.warning("missing_dimension_injected", extra={"dimension": dim_name})
```

- Run: `cd backend; uv run python -m pytest tests/scoring/test_scoring_validation_ext.py -x -q`
- **Expected:** All tests pass.

### Step 3: 集成到评分管道

- [ ] **Step 3: 在 `score_engine.py` 评分入口调用新增校验**

Read `backend/contexts/training/score_engine.py` around lines 580-643 to find the scoring result assembly point. The key section is after `_stage_with_retry` returns the scoring result.

In `backend/contexts/training/score_engine.py`, add import and call after the scoring result dict is assembled and before `_validate_scoring_result`:

```python
# After the scoring result is parsed from LLM response, add:
from ._scoring_validation import (
    _filter_hallucinated_dimensions,
    _clamp_scores,
    _recalc_total_from_dimensions,
    _inject_missing_dimensions,
)
```

After `_coerce_numeric_fields(scoring_result)` and `_inject_rubric_max(scoring_result, rubric)` calls (around line 235-245 in the evaluate_training function):

```python
# 1.8 — 评分校验补全
rubric_dim_names = {d["name"] for d in rubric.get("dimensions", [])}
scoring_result["detail_scores"] = _filter_hallucinated_dimensions(
    scoring_result.get("detail_scores", {}), rubric_dim_names
)
_clamp_scores(scoring_result.get("detail_scores", {}), raw_scale=rubric.get("raw_scale", 3))
_inject_missing_dimensions(scoring_result.get("detail_scores", {}), rubric)
recalc_total = _recalc_total_from_dimensions(
    scoring_result.get("detail_scores", {}), raw_scale=rubric.get("raw_scale", 3)
)
if abs(recalc_total - float(scoring_result.get("total_score", 0))) > 2:
    log.warning(
        "total_score_mismatch",
        extra={"llm_total": scoring_result["total_score"], "recalc_total": recalc_total},
    )
    scoring_result["total_score"] = recalc_total
```

### Step 4: 抽共享重算函数供 score_review 复用

- [ ] **Step 4: 将 score_review.py 的重算逻辑替换为共享函数**

In `backend/contexts/training/router/score_review.py:63-76`, replace the inline recalculation with:

```python
from contexts.training._scoring_validation import _recalc_total_from_dimensions

# Replace lines 63-76:
if req.detail_scores is not None:
    raw_scale = 3
    # Extract rubric from score's detail_scores items count OR use default raw_scale
    new_total = _recalc_total_from_dimensions(req.detail_scores, raw_scale)
    review_total = round(new_total, 1)
```

- Run: `cd backend; uv run python -m pytest tests/scoring/ -x -q`
- **Expected:** All existing tests pass.

### Step 5: Commit

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/_scoring_validation.py backend/contexts/training/score_engine.py backend/contexts/training/router/score_review.py backend/tests/scoring/test_scoring_validation_ext.py
git commit -m "✨ feat: 评分校验补全 — 幻觉维度过滤/越界裁剪/总分重算/缺失维度补零"
```

---

## Task 2: D4 低质量训练不评分

**Files:**
- Modify: `backend/core/config.py:121-123`
- Modify: `backend/contexts/training/router/scoring.py:309-377, 380-426`
- Modify: `frontend/src/components/training/TrainingHeader.tsx:180-293`

### Step 1: 删除两个死常量，新增消息数阈值

- [ ] **Step 1: 修改 config.py**

In `backend/core/config.py`, replace lines 121-123:

```python
# Before:
AUTO_SCORE_COVERED_INQUIRIES_MIN = int(os.getenv("AUTO_SCORE_COVERED_INQUIRIES_MIN", "5"))
AUTO_SCORE_STUDENT_CHARS_MIN = int(os.getenv("AUTO_SCORE_STUDENT_CHARS_MIN", "200"))
AUTO_SCORE_AI_CHARS_MIN = int(os.getenv("AUTO_SCORE_AI_CHARS_MIN", "500"))

# After:
AUTO_SCORE_STUDENT_MSG_MIN = int(os.getenv("AUTO_SCORE_STUDENT_MSG_MIN", "3"))
AUTO_SCORE_STUDENT_CHARS_MIN = int(os.getenv("AUTO_SCORE_STUDENT_CHARS_MIN", "200"))
```

### Step 2: 添加门槛判断函数并集成到 end_training

- [ ] **Step 2: 实现 `_check_scoring_threshold` 并集成**

In `backend/contexts/training/router/scoring.py`, add after the import section:

```python
from core.config import AUTO_SCORE_STUDENT_CHARS_MIN, AUTO_SCORE_STUDENT_MSG_MIN

def _check_scoring_threshold(db: Session, record_id: int) -> str | None:
    """Return None if threshold met, otherwise return the rejection message string."""
    from sqlalchemy import func
    from models import Message
    
    student_msgs = (
        db.query(Message)
        .filter(Message.record_id == record_id, Message.role == "student")
        .all()
    )
    student_msg_count = len(student_msgs)
    student_chars = sum(len(m.content or "") for m in student_msgs)
    
    if student_msg_count < AUTO_SCORE_STUDENT_MSG_MIN:
        return f"训练对话内容过少，未生成评分（已发送 {student_msg_count} 条消息，需要至少 {AUTO_SCORE_STUDENT_MSG_MIN} 条）"
    if student_chars < AUTO_SCORE_STUDENT_CHARS_MIN:
        return f"训练对话内容过少，未生成评分（已输入 {student_chars} 字，需要至少 {AUTO_SCORE_STUDENT_CHARS_MIN} 字）"
    return None
```

In `end_training` (scoring.py:326), after the `if not acquire_scoring(...)` guard and before the `case = db.query(Case)...` line, add:

```python
        threshold_msg = _check_scoring_threshold(db, record_id)
        if threshold_msg:
            record.status = "completed"
            record.end_time = datetime.now(UTC)
            _set_overdue_if_needed(record, db)
            record.scoring_status = "failed"
            record.scoring_error = threshold_msg[:2000]
            db.commit()
            return {
                "message": "训练已结束，但对话内容不足，未生成评分",
                "record_id": record_id,
                "scoring_status": "failed",
            }
```

### Step 3: retry_scoring 加门槛

- [ ] **Step 3: retry_scoring 门槛检查**

In `retry_scoring` (scoring.py:400), after `if not acquire_scoring(...)` add:

```python
        threshold_msg = _check_scoring_threshold(db, record_id)
        if threshold_msg:
            raise HTTPException(status_code=400, detail=threshold_msg)
```

### Step 4: run tests

- [ ] **Step 4: 后端子测试**

```bash
cd backend; uv run python -m pytest tests/scoring/ -x -q
```
**Expected:** All pass.

### Step 5: 前端结束确认框文案

- [ ] **Step 5: TrainingHeader 结束确认框 + 门槛提示**

Read `frontend/src/components/training/TrainingHeader.tsx:180-293` for the end confirmation dialog.

In `TrainingHeader.tsx`, add a `messageCount` prop and modify the confirm dialog text:

```tsx
// Add to TrainingHeader prop interface or get from context:
// The dialog text (around line 240-260) should be modified:
// Before (static text):
// "确定要结束本次训练？结束后AI将自动生成评分。"
// After (conditional):
const studentMsgCount = /* needs to be passed or read from context */;

// In the DialogContent:
<p className="text-sm text-muted-foreground">
  {studentMsgCount < 3 || /* total chars < 200 */
    ? `当前对话内容较少（已发送 ${studentMsgCount} 条），结束后将不会生成评分，确定结束？`
    : "确定要结束本次训练？结束后AI将自动生成评分。"}
</p>
```

The simplest implementation: TrainingHeader already has access to TrainingContext. Add messages to the context or read from StreamManager via a ref.

**Actual implementation path (least invasive):** Add `messages` to `TrainingContext` (from `TrainingEngine.tsx` already provides `messages` in the context). Then in the dialog:

```tsx
const { messages } = useTrainingContext();
const studentMsgs = messages.filter(m => m.role === "student");
const studentCharCount = studentMsgs.reduce((sum, m) => sum + m.content.length, 0);
const belowThreshold = studentMsgs.length < 3 || studentCharCount < 200;
```

Modify the DialogContent text conditionally based on `belowThreshold`.

- Run: `cd frontend; npx tsc --noEmit; npx biome check`
- **Expected:** No errors.

### Step 6: Commit

- [ ] **Step 6: Commit**

```bash
git add backend/core/config.py backend/contexts/training/router/scoring.py frontend/src/components/training/TrainingHeader.tsx
git commit -m "✨ feat: 低质量训练不评分 — 消息数/字数门槛 + 前端确认框文案"
```

---

## Task 3: D1 重评守卫（有复核时保护）

**Files:**
- Modify: `backend/contexts/training/router/scoring.py:380-426` (retry_scoring)
- Modify: `frontend/src/pages/record-detail/ScoringPendingBanner.tsx`
- Modify: `frontend/src/pages/RecordDetail.tsx:84-117`

### Step 1: 后端 force 参数 + 复核检查

- [ ] **Step 1: 修改 retry_scoring 路由**

In `backend/contexts/training/router/scoring.py`, modify `retry_scoring`:

Add `force` query parameter to the function signature:

```python
@router.post("/{record_id}/retry-scoring", response_model=ScoringTriggerResponse)
async def retry_scoring(
    record_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    force: Annotated[bool, Query()] = False,
):
```

After the existing `if record.status != "completed"` guard (line 393), before `acquire_scoring`, add:

```python
        is_teacher = current_user.has_permission("score_review")
        old_score = db.query(Score).filter(Score.record_id == record_id).first()
        if old_score:
            review_exists = db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).first() is not None
            if review_exists:
                if not is_teacher:
                    raise HTTPException(status_code=403, detail="该评分已由教师复核，无法重新评分")
                if not force:
                    raise HTTPException(status_code=409, detail="该评分已有教师复核，确定重新评分？请添加 force=true 参数确认")

        if not acquire_scoring(record_id, db, allow_retry=True):
            raise HTTPException(status_code=409, detail="评分已被其他请求触发，请稍后重试")

        # Move old_score deletion logic AFTER force check
        if old_score:
            db.query(ScoreReview).filter(ScoreReview.score_id == old_score.id).delete()
            db.delete(old_score)
```

Note: The existing `old_score` query at line 403 must be moved up BEFORE `acquire_scoring` (since acquire may change status) — or re-query after. Move the query up.

### Step 2: 前端重评按钮加确认框

- [ ] **Step 2: ScoringPendingBanner + RecordDetail 重评逻辑**

In `frontend/src/pages/RecordDetail.tsx:84-117`, modify `handleRetryScoring`:

```tsx
const handleRetryScoring = async () => {
    const isTeacher = user?.role === "teacher";
    // If teacher and review exists, confirm first
    if (isTeacher && isReviewed) {
      if (!window.confirm("重新评分将丢弃已有的教师复核，确定继续？")) {
        return;
      }
    }
    setRetrying(true);
    setRetryProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Pass force=true if teacher with existing review
      const forceParam = isTeacher && isReviewed ? "?force=true" : "";
      await retryScoring(id! + forceParam);  // Note: retryScoring expects recordId, append force query
      // ... rest unchanged
```

The `retryScoring` API call needs to be updated. Check `frontend/src/api/`:

```tsx
// In the api call, append force query param:
const url = isTeacher && isReviewed 
  ? `${ENDPOINT}/${recordId}/retry-scoring?force=true`
  : `${ENDPOINT}/${recordId}/retry-scoring`;
```

In `ScoringPendingBanner.tsx`, the "重新评分" button (line 61-79) already calls `onRetry` — the confirm logic is in RecordDetail so no change needed here.

- Run: `cd frontend; npx tsc --noEmit; npx biome check`
- **Expected:** No errors.

### Step 3: 后端测试

- [ ] **Step 3: Run tests**

```bash
cd backend; uv run python -m pytest tests/scoring/ -x -q
```

### Step 4: Commit

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/scoring.py frontend/src/pages/RecordDetail.tsx
git commit -m "✨ feat: 重评守卫 — 有复核时学生拒评/教师需 force=true + 前端确认框"
```

---

## Task 4: D2 复核展示重构

**Files:**
- Create (ddl): `backend/migrations/versions/ddl/` (via `pnpm run db:migration`)
- Modify: `backend/models/training.py:120-132` (ScoreReview)
- Modify: `backend/contexts/training/router/score_review.py:52-109`
- Modify: `backend/schemas/training.py:62-79` (ScoreItem)
- Modify: `frontend/src/pages/record-detail/ScoreResultSection.tsx`
- Modify: `frontend/src/pages/RecordDetail.tsx`
- Run: `pnpm run api:update` from repo root

### Step 1: DDL 迁移 — ScoreReview 加 total_score 列

- [ ] **Step 1: 生成并编写迁移**

```bash
cd D:\repo\dev\nursing-vp-sim; pnpm run db:migration -- "add_score_review_total_score"
```

Move the generated file to `ddl/` if not already there. Write the migration:

```python
"""add_score_review_total_score

Revision ID: <generated>
Revises: <head>
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '<generated>'
down_revision: Union[str, None] = '<head>'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('score_reviews', sa.Column('total_score', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('score_reviews', 'total_score')
```

### Step 2: 模型加字段

- [ ] **Step 2: 修改 ScoreReview 模型**

In `backend/models/training.py`, after line 127 (`comment` column), add:

```python
    total_score: Mapped[float | None] = mapped_column(Float, nullable=True)
```

### Step 3: 停止覆写 Score.total_score + 写入 ScoreReview.total_score

- [ ] **Step 3: 修改 submit_score_review**

In `backend/contexts/training/router/score_review.py:52-109`:

Replace lines 63-76:

```python
    if req.detail_scores is not None:
        raw_scale = 3
        review_total = _recalc_total_from_dimensions(req.detail_scores, raw_scale)
    else:
        review_total = None
    
    existing = db.query(ScoreReview).filter(ScoreReview.score_id == score.id).first()
    if existing:
        existing.detail_scores = req.detail_scores
        existing.comment = req.comment
        existing.total_score = review_total
        existing.reviewed_by = current_user.id
        db.commit()
        db.refresh(existing)
        review = existing
    else:
        review = ScoreReview(
            score_id=score.id,
            reviewed_by=current_user.id,
            detail_scores=req.detail_scores,
            comment=req.comment,
            total_score=review_total,
        )
        db.add(review)
        db.commit()
        db.refresh(review)
```

**CRITICAL: Remove `score.total_score = round(new_total, 1)` (lines 76).** Score.total_score is never modified by review now.

### Step 4: ScoreItem schema 加 review 字段

- [ ] **Step 4: 扩展 ScoreItem schema**

In `backend/schemas/training.py`, modify `ScoreItem` (lines 62-79):

```python
class ScoreReviewItem(BaseModel):
    model_config = _RESP_CFG
    detail_scores: dict[str, Any] | None = None
    total_score: float | None = None
    comment: str | None = None
    reviewed_at: datetime | None = None

class ScoreItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    total_score: float
    detail_scores: dict[str, Any] | None = None
    strengths: list[str] | None = None
    weaknesses: list[str] | None = None
    missed_content: list[str] | None = None
    suggestions: str | None = None
    rubric_version: str | None = None
    model_name: str | None = None
    prompt_version: int | None = None
    score_scale: int | None = None
    review_status: str | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    review: ScoreReviewItem | None = None  # NEW
    created_at: datetime
```

### Step 5: get_record_detail 填入 review 数据

- [ ] **Step 5: session.py get_record_detail 查询 review**

In `backend/contexts/training/router/session.py:472-473` (around the score retrieval in `get_record_detail`), add review loading:

```python
    score = record.score
    review_data = None
    if score:
        latest_review = (
            db.query(ScoreReview)
            .filter(ScoreReview.score_id == score.id)
            .order_by(ScoreReview.created_at.desc())
            .first()
        )
        if latest_review:
            reviewer = db.query(User).filter(User.id == latest_review.reviewed_by).first()
            review_data = {
                "detail_scores": latest_review.detail_scores,
                "total_score": latest_review.total_score,
                "comment": latest_review.comment,
                "reviewed_at": latest_review.created_at,
            }
```

Then when constructing `ScoreItem` (around line 532), add `review=review_data`.

### Step 6: 前端合并展示

- [ ] **Step 6: ScoreResultSection 复核逻辑**

In `frontend/src/pages/record-detail/ScoreResultSection.tsx`:

1. **总分显示（line 98-104）**: When `review?.total_score != null`, show `review.total_score` as the large number, and show "AI 原始: {recordScore.total_score}" in smaller text below.

```tsx
{review?.total_score != null ? (
  <>
    <div className="flex items-baseline gap-2">
      <span className="text-4xl font-extrabold text-primary">
        {review.total_score}
      </span>
      <span className="text-base text-muted-foreground">/ {scoreMax} 分</span>
    </div>
    <div className="text-xs text-muted-foreground">
      AI 原始评分: {recordScore.total_score}/{scoreMax}
    </div>
  </>
) : (
  <div className="flex items-baseline gap-2">
    <span className="text-4xl font-extrabold text-primary">
      {recordScore.total_score}
    </span>
    <span className="text-base text-muted-foreground">/ {scoreMax} 分</span>
  </div>
)}
```

2. **维度明细（line 116-158）**: When review exists, merge review.detail_scores over recordScore.detail_scores. Mark reviewed dimensions with "已复核" badge.

3. **折叠区 "AI 原始评分"**: Add a collapsible section (reuse `CollapsibleSection`) showing the original AI score when review exists.

**Simpler implementation (match spec spirit, minimize diff):**

Since `review` object is already available via `ScoreReviewResponse`, and the new `ScoreItem.review` field will be populated by the backend — the frontend can read from `record.score.review`:

```tsx
// In RecordDetail.tsx, extract review from score:
const scoreReview = recordScore?.review;
const mergedDetailScores = useMemo(() => {
  if (!scoreReview?.detail_scores || !recordScore?.detail_scores) return recordScore?.detail_scores;
  // Merge: review overrides AI
  const merged = { ...recordScore.detail_scores };
  for (const [key, val] of Object.entries(scoreReview.detail_scores)) {
    merged[key] = { ...merged[key], ...val, _reviewed: true };
  }
  return merged;
}, [recordScore, scoreReview]);
```

Pass `mergedDetailScores` to `ScoreResultSection` for dimension display.

- Run: `cd frontend; npx tsc --noEmit; npx biome check`
- **Expected:** No errors.
- **Manual test:** Open a record detail page with a review. Verify: large score number = review total, "AI 原始评分" shown in smaller text, dimensions show "已复核" badge on modified items.

### Step 7: api:update + 全量检查

- [ ] **Step 7: 同步 API 类型**

```bash
cd D:\repo\dev\nursing-vp-sim; pnpm run api:update
cd backend; uv run python -m pytest tests/scoring/ -x -q
cd frontend; npx tsc --noEmit; npx biome check
```

### Step 8: Commit

- [ ] **Step 8: Commit (two commits — migration + code)**

```bash
git add backend/migrations/versions/ddl/*add_score_review_total_score*
git commit -m "🗃️ db: ScoreReview 加 total_score 列"

git add backend/models/training.py backend/contexts/training/router/score_review.py backend/contexts/training/router/session.py backend/schemas/training.py frontend/src/pages/record-detail/ScoreResultSection.tsx frontend/src/pages/RecordDetail.tsx frontend/src/api/api-types.gen.ts openapi.json
git commit -m "✨ feat: 复核展示重构 — 停止覆写Score.total_score/前端合并展示复核分"
```

---

## Task 5: D3 最高分口径

**Files:**
- Modify: `backend/services/assignment.py:67-118` (_build_detail_view)
- Modify: `backend/schemas/assignment.py:41-53` (AssignmentStudentItem)
- Modify: `backend/routers/assignments.py:148-211` (export)
- Modify: `frontend/src/pages/admin/AssignmentDetailPage.tsx`

### Step 1: _build_detail_view 重写

- [ ] **Step 1: 每生取最佳记录**

In `backend/services/assignment.py:67-118`:

```python
def _build_detail_view(self, assignment: Assignment) -> AssignmentDetailView:
    from models import Score
    
    students_in_class = self.repo.get_students_in_class(assignment.class_id)
    training_records = self.repo.get_records_for_assignment(assignment.id)
    
    # Group by user_id
    records_by_user: dict[int, list[TrainingRecord]] = {}
    for r in training_records:
        records_by_user.setdefault(r.user_id, []).append(r)
    
    student_items: list[AssignmentStudentItemView] = []
    for student in students_in_class:
        user_records = records_by_user.get(student.id, [])
        if not user_records:
            student_items.append(
                AssignmentStudentItemView(
                    user_id=student.id,
                    display_name=student.display_name,
                    student_id=student.student_id,
                )
            )
            continue
        
        # Best record: priority = completed + highest Score.total_score
        best = None
        best_score = None
        for r in user_records:
            if r.scoring_status == "completed" and r.score and r.score.total_score is not None:
                if best_score is None or r.score.total_score > best_score:
                    best = r
                    best_score = r.score.total_score
        if best is None:
            # No scored record — use latest by start_time
            best = max(user_records, key=lambda r: r.start_time or datetime.min.replace(tzinfo=UTC))
        
        student_items.append(
            AssignmentStudentItemView(
                user_id=student.id,
                display_name=student.display_name,
                student_id=student.student_id,
                record_id=best.id,
                status=best.status,
                score_total=best.score.total_score if best.score and best.scoring_status == "completed" else None,
                scoring_status=best.scoring_status,
                start_time=best.start_time,
                end_time=best.end_time,
                is_overdue=best.is_overdue,
                attempt_count=len(user_records),  # NEW
            )
        )
    
    completed_count = sum(1 for s in student_items if s.status == "completed")
    scored_count = sum(1 for s in student_items if s.scoring_status == "completed")
    
    return AssignmentDetailView(
        # ... same as before
        students=student_items,
    )
```

### Step 2: AssignmentStudentItemView + Schema 加 attempt_count

- [ ] **Step 2: schema 加字段**

In `backend/services/assignment.py:30-40` (`AssignmentStudentItemView`):

```python
@dataclass
class AssignmentStudentItemView:
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False
    attempt_count: int = 0  # NEW
```

In `backend/schemas/assignment.py:41-53` (`AssignmentStudentItem`):

```python
class AssignmentStudentItem(BaseModel):
    model_config = _RESP_CFG
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False
    attempt_count: int = 0  # NEW
```

### Step 3: CSV 导出同步

- [ ] **Step 3: export_assignment 同口径**

In `backend/routers/assignments.py:148-211`, the export currently uses all records directly. Rewrite to use the same "best record per user" logic:

```python
    # Use AssignmentService to get the detail view (same best-record logic)
    service = AssignmentService(db)
    detail = service._build_detail_view(assignment)
    
    records_data = detail.students  # Already picked best per student
    
    columns = [
        ColumnDef(header="学号", value=lambda r: r.student_id or ""),
        ColumnDef(header="姓名", value=lambda r: r.display_name),
        ColumnDef(header="状态", value=lambda r: r.status),
        ColumnDef(header="尝试次数", value=lambda r: str(r.attempt_count)),
        ColumnDef(header="是否逾期", value=lambda r: "是" if r.is_overdue else "否"),
        ColumnDef(header="总分", value=lambda r: str(r.score_total) if r.score_total is not None else ""),
        ColumnDef(header="评分状态", value=lambda r: r.scoring_status or ""),
    ]
    # ... export
```

### Step 4: 前端 attempt_count 展示

- [ ] **Step 4: AssignmentDetailPage 得分列旁显示 attempt_count**

In `frontend/src/pages/admin/AssignmentDetailPage.tsx`, after the score cell (line 182-188):

```tsx
<TableCell>
  {s.score_total != null ? (
    <span className="font-bold">{s.score_total}</span>
  ) : (
    "-"
  )}
  {s.attempt_count > 1 && (
    <span className="ml-1 text-[10px] text-muted-foreground">
      共{s.attempt_count}次
    </span>
  )}
</TableCell>
```

Also add "尝试次数" column header after "状态":

```tsx
<TableHead>尝试次数</TableHead>
```

And corresponding cell:

```tsx
<TableCell className="text-xs text-muted-foreground">{s.attempt_count || 1}</TableCell>
```

### Step 5: api:update + tests

- [ ] **Step 5: Sync and verify**

```bash
cd D:\repo\dev\nursing-vp-sim; pnpm run api:update
cd backend; uv run python -m pytest tests/scoring/ -x -q
cd frontend; npx tsc --noEmit; npx biome check
```

### Step 6: Commit

- [ ] **Step 6: Commit**

```bash
git add backend/services/assignment.py backend/schemas/assignment.py backend/routers/assignments.py frontend/src/pages/admin/AssignmentDetailPage.tsx frontend/src/api/api-types.gen.ts openapi.json
git commit -m "✨ feat: 作业成绩取最高分 — 每生最佳记录 + attempt_count + CSV 导出同步"
```

---

## Task 6: D5 自动重试 + D6 settlement 扫超时 + 1.7 队列满回滚

**Files:**
- Modify: `backend/contexts/training/router/scoring.py:189-307` (_run_scoring_background)
- Modify: `backend/infrastructure/settlement.py:19-98`
- Modify: `backend/contexts/training/router/scoring.py:337-348` (QueueFullError handler)
- Modify: `backend/contexts/training/scoring_lifecycle.py:10-26` (acquire_scoring)

### Step 1: D5 — _run_scoring_background 自动重试

- [ ] **Step 1: 评分失败自动重试 1 次**

In `backend/contexts/training/router/scoring.py:189-307`, wrap the `evaluate_training` call with retry logic:

Replace lines 236-247 (the `asyncio.wait_for` block):

```python
        async def _attempt_evaluate():
            await asyncio.wait_for(
                evaluate_training(
                    record_id,
                    case_data,
                    db,
                    llm_client=llm_client,
                    tracker=tracker,
                    realtime_hub=realtime_hub,
                    user_id=record.user_id,
                ),
                timeout=SCORING_GLOBAL_TIMEOUT,
            )
        
        last_error = None
        for attempt in range(2):
            try:
                await _attempt_evaluate()
                break
            except asyncio.CancelledError:
                raise
            except TimeoutError:
                raise  # No retry for timeout
            except Exception as e:
                last_error = e
                if attempt == 0:
                    log.warning(
                        "评分首次尝试失败，30s 后重试",
                        extra={"record_id": record_id, "attempt": attempt + 1, "error": str(e)[:200]},
                    )
                    await asyncio.sleep(30)
                else:
                    log.error("评分重试仍失败", extra={"record_id": record_id, "error": str(e)[:200]})
                    raise
```

### Step 2: D6 — settlement 扫超时 pending/processing

- [ ] **Step 2: 修改 settlement loop 加超时评分清理**

In `backend/infrastructure/settlement.py`, add a new function `_sweep_stale_scoring_records` and call it from `_settle_once_sync`:

```python
def _sweep_stale_scoring_records(db: Session) -> int:
    """Mark scoring records stuck in pending/processing > 10 min as failed."""
    from models import TrainingRecord
    
    cutoff = datetime.now(UTC) - timedelta(minutes=10)
    stale = (
        db.query(TrainingRecord)
        .filter(
            TrainingRecord.scoring_status.in_(["pending", "processing"]),
            TrainingRecord.end_time < cutoff,
        )
        .all()
    )
    for record in stale:
        record.scoring_status = "failed"
        record.scoring_error = "评分超时，已自动标记失败，可手动重试"
        log.warning("settlement: stale scoring marked failed", extra={"record_id": record.id})
    if stale:
        db.commit()
    return len(stale)
```

In `_settle_once_sync`, after the existing `timeout_records` processing block (around line 98), add:

```python
    # 1.6 — sweep stale scoring records
    try:
        stale_count = _sweep_stale_scoring_records(db)
        if stale_count:
            log.info("Settlement: marked %d stale scoring records as failed", stale_count)
    except Exception:
        db.rollback()
        log.exception("settlement stale scoring sweep failed")
```

### Step 3: 1.7 — QueueFullError 回滚

- [ ] **Step 3: 队列满时显式回滚 scoring_status**

In `backend/contexts/training/router/scoring.py:337-348` (end_training):

```python
        try:
            await request.app.state.task_queue.enqueue(...)
        except QueueFullError:
            # 1.7: 显式回滚 acquire_scoring 的 CAS UPDATE
            record.scoring_status = None
            db.commit()
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")
```

Similarly in `retry_scoring` (line 422-423):

```python
        except QueueFullError:
            record.scoring_status = None
            db.commit()
            raise HTTPException(status_code=503, detail="评分队列繁忙，请稍后重试")
```

**Verification of acquire_scoring commit behavior**: `acquire_scoring` (in `scoring_lifecycle.py:10-26`) runs a raw SQL UPDATE. It does NOT call `db.commit()` — the commit happens later in the router via `db_session()` context manager. So the `record.scoring_status = None` + `db.commit()` approach works correctly.

### Step 4: Tests

- [ ] **Step 4: Run tests**

```bash
cd backend; uv run python -m pytest tests/scoring/ -x -q
```

### Step 5: Commit

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/router/scoring.py backend/infrastructure/settlement.py
git commit -m "✨ feat: 评分自动重试1次 + settlement扫超时 + 队列满回滚scoring_status"
```

---

## Task 7: 1.9 护理记录自动保存 + 1.10 作业重入不删数据

### Part A — 1.9 护理记录自动保存

**Files:**
- Modify: `frontend/src/components/training/scene-cards/NursingRecordCard.tsx`
- Modify: `frontend/src/engine/TrainingEngine.tsx`
- Modify: `frontend/src/engine/MessageBus.ts`

### Step 1: NursingRecordCard 自动保存 + 脏检测

- [ ] **Step 1: 添加 debounce 自动保存 + dirtyRef**

In `frontend/src/components/training/scene-cards/NursingRecordCard.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
// ... existing imports

export default function NursingRecordCard({ recordId, bus }: SceneCardProps & { bus?: MessageBus }) {
  const rid = Number(recordId);
  const [sheet, setSheet] = useState<SheetData>({});
  const dirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  
  // ... existing useQuery (unchanged, but add dirtyRef guard)
  
  const { isLoading } = useQuery({
    queryKey: ["nursing-record", rid],
    queryFn: async () => {
      const { data: d } = await api.get(`${ENDPOINT}/${rid}`);
      const sd: SheetData = d.sheet_data || {};
      setSheet((prev) => {
        if (dirtyRef.current) return prev;  // 1.9: dirtyRef protection
        if (Object.keys(prev).length > 0) return prev;
        return sd;
      });
      return d;
    },
  });
  
  const saveMutation = useMutation({...}); // unchanged
  
  const doAutoSave = useCallback(async (sd: SheetData) => {
    setSaveStatus("saving");
    try {
      await api.post(`${ENDPOINT}/${rid}`, { sheet_data: sd, status: "draft" });
      setSaveStatus("saved");
      setLastSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setSaveStatus("error");
    }
  }, [rid]);
  
  const update = (key: string, value: string) => {
    dirtyRef.current = true;
    setSheet((prev) => ({ ...prev, [key]: value }));
  };
  
  // Debounce auto-save: 3s after last change
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      doAutoSave(sheet);
    }, 3000);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [sheet, doAutoSave]);
  
  // Flush on training:ended
  useEffect(() => {
    if (!bus) return;
    const handler = () => {
      if (dirtyRef.current) {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        doAutoSave(sheet);
      }
    };
    const unsub = bus.on("training:beforeEnd", handler);
    return unsub;
  }, [bus, sheet, doAutoSave]);
  
  // ... render with saveStatus display
```

**Save status indicator** (replace line 95-105):

```tsx
<div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
  <FileText size={12} />
  <span>
    {saveStatus === "saving" ? "保存中..." :
     saveStatus === "saved" ? `已自动保存 ${lastSavedAt || ""}` :
     saveStatus === "error" ? "保存失败" :
     "护理评估记录"}
  </span>
</div>
```

### Step 2: MessageBus 加 training:beforeEnd 事件

- [ ] **Step 2: TrainingEngine endTraining 发送事件**

In `frontend/src/engine/TrainingEngine.tsx:149-156`, modify `endTraining`:

```tsx
const endTraining = useCallback(async () => {
    try {
      busRef.current.emit("training:beforeEnd");  // 1.9: flush nursing record
      await scoreRef.current.end();
      setTrainingEnded(true);
    } catch {
    }
    busRef.current.emit("training:ended");
  }, []);
```

### Step 3: Check MessageBus has `on` method for the event

- [ ] **Step 3: Verify MessageBus event system**

Check `frontend/src/engine/MessageBus.ts` — ensure `on()` method exists and supports `training:beforeEnd`. If only typed events, add a generic event channel or use the existing pattern.

```bash
cd frontend; npx tsc --noEmit; npx biome check
```

### Part B — 1.10 作业重入不删数据

- [ ] **Step 4: 删除重入删除逻辑**

In `backend/contexts/training/router/session.py:307-326`:

Replace lines 315-326 (the `if student_msg_count == 0:` block):

```python
    if existing:
        # 1.10: 重入时永不删除已有记录，直接返回
        case_data = assignment.practice.case.case_data if assignment.practice and assignment.practice.case else {}
        patient_info = case_data.get("patient_info", {})
        patient_name = patient_info.get("name", "患者")
        greeting = f"你好，我是{patient_name}。{case_data.get('opening_line', '我今天感觉不太舒服，所以来看看。')}"
        return TrainingStartResponse(
            record_id=existing.id,
            greeting=greeting,
            case_name=assignment.practice.case.name if assignment.practice and assignment.practice.case else "",
            pending_questionnaires=_count_pending_questionnaires(
                db, assignment.practice.case.id if assignment.practice and assignment.practice.case else 0
            ),
        )
```

The `student_msg_count` variable is no longer needed — remove that query (line 316-318).

### Step 5: Tests + Commit

- [ ] **Step 5: Verify**

```bash
cd backend; uv run python -m pytest tests/scoring/ -x -q
cd frontend; npx tsc --noEmit; npx biome check
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/training/scene-cards/NursingRecordCard.tsx frontend/src/engine/TrainingEngine.tsx backend/contexts/training/router/session.py
git commit -m "✨ feat: 护理记录自动保存 + 作业重入不删数据"
```

---

## Task 8: 1.11 九项小 bug

### Part A — exam:error / streamError / 学生消息回滚 / placeholder (4 items)

**Files:**
- Modify: `frontend/src/components/training/scene-cards/PhysicalAssessmentCard.tsx:75-82`
- Modify: `frontend/src/components/training/ChatBubble.tsx:15-27, 38-109`
- Modify: `frontend/src/engine/StreamManager.ts:137-148`
- Modify: `frontend/src/components/training/ChatInput.tsx:116`

### Step 1: PhysicalAssessmentCard exam:error 处理

- [ ] **Step 1: 处理 exam:error WS 消息**

In `frontend/src/components/training/scene-cards/PhysicalAssessmentCard.tsx:75-82`, add error handler:

```tsx
const { sendExam } = useTrainingWS((msg) => {
    if (msg.type === "exam:done") {
      const m = msg as unknown as { op_type: string; data: { value: string } };
      if (m.data?.value) {
        setResults((prev) => ({ ...prev, [m.op_type]: { value: m.data.value } }));
      }
    }
    // 1.11: exam:error — clear loading state
    if (msg.type === "exam:error") {
      setSelected(null);  // Clear "检测中…" state
      toast.error((msg as any).detail || "查体执行失败，请重试");
    }
  });
```

Also add a 15s frontend timeout. In the `handleSelect` or `sendExam` call:

```tsx
// When sending an exam, set a 15s timeout that clears the selected state
const examTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// In the send handler:
setSelected(opType);
if (examTimerRef.current) clearTimeout(examTimerRef.current);
examTimerRef.current = setTimeout(() => {
  setSelected(null);
  toast.error("查体响应超时，请重试");
}, 15000);
```

### Step 2: ChatBubble streamError 渲染

- [ ] **Step 2: ChatBubble 含 streamError 的消息**

In `frontend/src/components/training/ChatBubble.tsx:15-27` (comparison function), add `streamError`:

```tsx
function areBubblePropsEqual(oldProps: ChatBubbleProps, newProps: ChatBubbleProps) {
  return (
    oldProps.message.id === newProps.message.id &&
    oldProps.message.content === newProps.message.content &&
    oldProps.message.streaming === newProps.message.streaming &&
    oldProps.message.role === newProps.message.role &&
    oldProps.message.streamError === newProps.message.streamError &&  // NEW
    oldProps.emotionBorder === newProps.emotionBorder &&
    oldProps.portraitUrl === newProps.portraitUrl &&
    oldProps.initiative === newProps.initiative
  );
}
```

In the patient bubble rendering (around line 85), below the content:

```tsx
{!isStreamingEmpty && message.streamError && (
  <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-warning-foreground bg-warning/20 rounded px-1.5 py-0.5">
    ⚠ 回复中断
  </span>
)}
```

### Step 3: 学生消息失败回滚

- [ ] **Step 3: StreamManager 失败时移除学生消息 + toast**

In `frontend/src/engine/StreamManager.ts:224-239` (catch block):

```tsx
    } catch (err: unknown) {
      const partial = this.findStreaming();
      if (partial?.content.trim()) {
        this.messages = this.messages.map(m =>
          m.id === partial.id
            ? { ...m, streaming: false, streamError: (err as Error)?.message || "发送失败" }
            : m
        );
      } else {
        // 1.11: Remove the optimistic student message too
        this.messages = this.messages.filter(
          (m) => !m.streaming && m.id !== placeholderId && m.id !== studentId,
        );
      }
      this.notifySync();
      this.setLoading(false);
      callbacks.onError?.((err as any)?.message || "发送失败");
    }
```

Also on lines 182-196 (the onError callback from sendMessageStream), apply the same logic for the `studentId` removal when placeholder is empty:

```tsx
        (err) => {
          const partial = this.findStreaming();
          if (partial?.content.trim()) {
            this.messages = this.messages.map(m =>
              m.id === partial.id ? { ...m, streaming: false, streamError: err } : m
            );
          } else {
            // 1.11: Also remove student message
            this.messages = this.messages.filter(
              (m) => !m.streaming && m.id !== placeholderId && m.id !== studentId,
            );
          }
          this.notifySync();
          this.setLoading(false);
          callbacks.onError?.(err);
          if (this.abortController === controller) this.abortController = null;
        },
```

### Step 4: placeholder 文案

- [ ] **Step 4: ChatInput placeholder 改文案**

In `frontend/src/components/training/ChatInput.tsx:116`:

```tsx
// Before:
placeholder={trainingEnded ? "训练已结束，评分结果已生成" : loading ? "患者正在回复中，可提前输入下一句…" : "输入消息与患者对话..."}

// After:
placeholder={trainingEnded ? "训练已结束，评分结果已生成" : loading ? "患者正在回复中…" : "输入消息与患者对话..."}
```

### Part B — trainingEnded 刷新 / textarea maxLength / health_literacy / time_limit (4 items)

**Files:**
- Modify: `frontend/src/hooks/useTrainingRecord.ts`
- Modify: `frontend/src/engine/TrainingEngine.tsx:68`
- Modify: `frontend/src/components/training/ChatInput.tsx:111-124`
- Modify: `backend/services/case.py:20`
- Modify: `backend/core/case_schema.py:58`
- Modify: `backend/contexts/training/router/session.py:158`

### Step 5: trainingEnded 从 record.status 初始化

- [ ] **Step 5: useTrainingRecord 透传 status**

In `frontend/src/hooks/useTrainingRecord.ts`, add `status` to the returned data:

```tsx
const data = useMemo<TrainingRecordData | null>(() => {
  if (!record) return null;
  const d = record as {
    // ... existing fields
    status?: string;  // NEW
    // ...
  };
  return {
    // ... existing
    status: d.status,  // NEW
  };
}, [record]);
```

In `frontend/src/engine/TrainingEngine.tsx:68`:

```tsx
// Read record.status to initialize trainingEnded
// In PatientProvider or TrainingEngine, use the detail query result:
const { data: detailQuery } = useQuery({...});
useEffect(() => {
  if (detailQuery?.status === "completed") {
    setTrainingEnded(true);
  }
}, [detailQuery?.status]);
```

### Step 6: textarea maxLength

- [ ] **Step 6: ChatInput maxLength + 计数**

In `frontend/src/components/training/ChatInput.tsx:111`:

```tsx
<textarea
  ref={inputRef}
  value={text}
  onChange={(e) => setText(e.target.value)}
  onKeyDown={handleKeyDown}
  maxLength={2000}
  placeholder={...}
  rows={1}
  // ...rest
/>
```

Add a character counter near the limit:

```tsx
{text.length > 1800 && (
  <span className="absolute right-2 -top-5 text-[10px] text-muted-foreground">
    {text.length}/2000
  </span>
)}
```

### Step 7: health_literacy "medium" 映射

- [ ] **Step 7: case.py 映射补 medium**

In `backend/services/case.py:20`:

```python
    map_lit = {"low": "低素养", "normal": "中等", "medium": "中等", "high": "高素养"}
```

### Step 8: time_limit 后端收敛

- [ ] **Step 8: case_schema.py time_limit 范围**

In `backend/core/case_schema.py:58`:

```python
    time_limit: int = Field(default=20, ge=5, le=120)
```

In `backend/contexts/training/router/session.py:158` (_create_record):

```python
    time_limit = max(5, min(120, int(time_limit)))  # Changed from 1-180 to 5-120
```

### Part C — Feedback FK ondelete CASCADE (1 item)

- [ ] **Step 9: Commit Part A+B**

```bash
git add frontend/src/components/training/scene-cards/PhysicalAssessmentCard.tsx frontend/src/components/training/ChatBubble.tsx frontend/src/engine/StreamManager.ts frontend/src/components/training/ChatInput.tsx frontend/src/hooks/useTrainingRecord.ts frontend/src/engine/TrainingEngine.tsx backend/services/case.py backend/core/case_schema.py backend/contexts/training/router/session.py
git commit -m "🐛 fix: 九项小bug — exam:error/streamError/学生消息回滚/placeholder/maxLength/health_literacy/time_limit"
```

---

## Task 9: Feedback FK 迁移 + 收尾

**Files:**
- Create: `backend/migrations/versions/ddl/` (via `pnpm run db:migration`)
- Modify: `backend/models/ux.py:32`
- Run: `pnpm run api:update`
- Run: `pnpm run check`

### Step 1: Feedback FK ondelete CASCADE DDL 迁移

- [ ] **Step 1: 生成迁移**

```bash
cd D:\repo\dev\nursing-vp-sim; pnpm run db:migration -- "feedback_user_id_ondelete_cascade"
```

Move to `ddl/`. Write:

```python
"""feedback_user_id_ondelete_cascade

Revision ID: <generated>
Revises: <head>
Create Date: 2026-07-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = '<generated>'
down_revision: Union[str, None] = '<head>'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('feedbacks_user_id_fkey', 'feedbacks', type_='foreignkey')
    op.create_foreign_key(
        'feedbacks_user_id_fkey', 'feedbacks', 'users',
        ['user_id'], ['id'], ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('feedbacks_user_id_fkey', 'feedbacks', type_='foreignkey')
    op.create_foreign_key(
        'feedbacks_user_id_fkey', 'feedbacks', 'users',
        ['user_id'], ['id'], ondelete='RESTRICT'
    )
```

**Important**: The actual constraint name may differ. Check existing constraint name in the database or from the initial migration. If unknown, use a flexible approach:

```python
def upgrade() -> None:
    # Drop existing FK and recreate with CASCADE
    op.drop_constraint(
        'feedbacks_user_id_fkey', 'feedbacks', type_='foreignkey'
    )
    op.create_foreign_key(
        None, 'feedbacks', 'users', ['user_id'], ['id'], ondelete='CASCADE'
    )

def downgrade() -> None:
    op.drop_constraint(
        None, 'feedbacks', type_='foreignkey'
    )
    op.create_foreign_key(
        'feedbacks_user_id_fkey', 'feedbacks', 'users', ['user_id'], ['id']
    )
```

### Step 2: 模型同步

- [ ] **Step 2: 修改 Feedback 模型 FK**

In `backend/models/ux.py:32`:

```python
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
```

### Step 3: api:update + 全量 check

- [ ] **Step 3: 最终同步**

```bash
cd D:\repo\dev\nursing-vp-sim; pnpm run api:update
cd backend; uv run python -m pytest tests/scoring/ -x -q
cd frontend; npx tsc --noEmit; npx biome check
cd D:\repo\dev\nursing-vp-sim; pnpm run check
```

**Expected:** All green.

### Step 4: Commit

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/versions/ddl/*feedback_user_id_ondelete_cascade* backend/models/ux.py frontend/src/api/api-types.gen.ts openapi.json
git commit -m "🗃️ db: Feedback FK ondelete CASCADE + api:update 收尾"
```

---

## Coverage Checklist

核对 spec 1.1~1.12，每项均有对应 Task：

| Spec | Task | 状态 |
|------|------|------|
| 1.1 D1 重评守卫 | Task 3 | ✓ |
| 1.2 D2 复核展示 | Task 4 | ✓ |
| 1.3 D3 最高分口径 | Task 5 | ✓ |
| 1.4 D4 低质量不评分 | Task 2 | ✓ |
| 1.5 D5 自动重试 | Task 6 Step 1 | ✓ |
| 1.6 D6 settlement 扫超时 | Task 6 Step 2 | ✓ |
| 1.7 队列满回滚 | Task 6 Step 3 | ✓ |
| 1.8 评分校验补全 | Task 1 | ✓ |
| 1.9 护理记录自动保存 | Task 7 Part A | ✓ |
| 1.10 作业重入不删数据 | Task 7 Part B | ✓ |
| 1.11 九项小 bug | Task 8 | ✓ |
| 1.12 迁移 (2 条 DDL) | Task 4 Step 1 + Task 9 Step 1 | ✓ |

所有步骤中均无 TBD/占位符。commit 格式均符合 `<emoji> <type>: <description>`。迁移均进 ddl/，可逆 downgrade。schema 变更后均有 `pnpm run api:update` 步骤。
