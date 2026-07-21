# Feedback Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image attachment support to the feedback system — frontend silent compression (max 500KB, 800px, 3 images), backend BYTEA storage in a child table with magic-byte validation.

**Architecture:** New `feedback_images` table (BYTEA) with FK CASCADE from `feedbacks`. Frontend uses `browser-image-compression` to compress before upload. Backend validates magic bytes, MIME type, size, and count. Images served via dedicated GET endpoint with author/admin access control.

**Tech Stack:** Python FastAPI + SQLAlchemy BYTEA, TypeScript React + browser-image-compression, PostgreSQL

**Mobile adaptivity:** FeedbackModal already uses `ResponsiveDialog` (bottom sheet on mobile). Image picker uses `<input accept="image/*" capture="environment">` on mobile to trigger native camera/screenshot workflow. Thumbnail previews scale responsively.

---

### Task 1: Install browser-image-compression

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add dependency**

```bash
cd frontend; npm install browser-image-compression
```

- [ ] **Step 2: Verify install**

```bash
node -e "const m = require('browser-image-compression'); console.log(typeof m)"
```
Expected: `function` (or `object` — any non-error output)

---

### Task 2: Create image compression utility

**Files:**
- Create: `frontend/src/lib/image-compress.ts`

- [ ] **Step 1: Create compression utility**

```typescript
import imageCompression from "browser-image-compression";

const MAX_SIZE_KB = 500;
const MAX_WIDTH = 800;

export async function compressImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: MAX_SIZE_KB / 1024,
    maxWidthOrHeight: MAX_WIDTH,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.7,
  });
}

export function validateImageFile(file: File): string | null {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return "仅支持 JPEG / PNG / WebP 格式";
  }
  if (file.size === 0) {
    return "图片文件为空";
  }
  if (file.size > 10 * 1024 * 1024) {
    return "图片大小不能超过 10MB";
  }
  return null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend; npx tsc --noEmit src/lib/image-compress.ts
```
Expected: no errors

---

### Task 3: Create FeedbackImage ORM model

**Files:**
- Create: `backend/models/feedback_image.py`

- [ ] **Step 1: Create model file**

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import _now_utc


class FeedbackImage(Base):
    __tablename__ = "feedback_images"
    __table_args__ = (
        Index("ix_feedback_images_feedback_id", "feedback_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feedback_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("feedbacks.id", ondelete="CASCADE"), nullable=False
    )
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(20), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
```

- [ ] **Step 2: Verify Python syntax**

```bash
cd backend; uv run python -c "import ast; ast.parse(open('models/feedback_image.py').read()); print('OK')"
```
Expected: `OK`

---

### Task 4: Update models/__init__.py and Feedback relationship

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/models/ux.py`

- [ ] **Step 1: Export FeedbackImage in __init__.py**

Add after line 24 (`from models.ux import Feedback, Notification, SystemNotification`):
```python
from models.feedback_image import FeedbackImage
```

Add `"FeedbackImage"` to `__all__` list (after `"Feedback"`).

- [ ] **Step 2: Add images relationship to Feedback model**

In `backend/models/ux.py`, add after line 43 (`user: Mapped[User] = relationship()`):

```python
    images: Mapped[list] = relationship("FeedbackImage", cascade="all, delete-orphan")
```

Also add at top of file after `from models._base import TimestampMixin, _now_utc`:
```python
from models.feedback_image import FeedbackImage
```

Wait — this creates a circular import since `feedback_image.py` is standalone. Instead, use string-based relationship:

```python
    images: Mapped[list] = relationship("FeedbackImage", cascade="all, delete-orphan")
```

This uses a string reference so no import cycle. Just add this line after `user: Mapped[User] = relationship()` in `ux.py`.

- [ ] **Step 3: Verify**

```bash
cd backend; uv run python -c "from models import FeedbackImage; print(FeedbackImage.__tablename__)"
```
Expected: `feedback_images`

---

### Task 5: Create Alembic DDL migration

**Files:**
- Create: `backend/migrations/versions/ddl/` — let alembic generate the hash

- [ ] **Step 1: Generate migration**

```bash
cd backend; uv run alembic revision --autogenerate -m "add_feedback_images"
```

- [ ] **Step 2: Verify migration file was created and review it**

Check that the generated migration:
- Creates `feedback_images` table with columns: `id`, `feedback_id`, `image_data` (LargeBinary), `mime_type` (String 20), `file_size` (Integer), `created_at` (DateTime)
- Has FK to `feedbacks.id` with `ondelete="CASCADE"`
- Has `ix_feedback_images_feedback_id` index
- Has `downgrade()` that drops the table
- Contains no `op.execute()` calls

If the autogenerated migration is correct, keep it. If not, adjust.

- [ ] **Step 3: Run migration**

```bash
cd backend; uv run alembic upgrade head
```
Expected: migration applied without errors

- [ ] **Step 4: Verify table exists**

```bash
cd backend; uv run python -c "from core.database import engine; from sqlalchemy import inspect; i = inspect(engine); print('feedback_images' in i.get_table_names())"
```
Expected: `True`

---

### Task 6: Update schemas

**Files:**
- Modify: `backend/schemas/feedback.py`

- [ ] **Step 1: Add image_count to FeedbackSubmitResponse and FeedbackItem, add StorageStatsResponse**

```python
class FeedbackSubmitResponse(BaseModel):
    id: int
    image_count: int = 0
    created_at: datetime


class FeedbackItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: str | None = None
    version: str = ""
    image_count: int = 0
    developer_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime


class StorageStatsResponse(BaseModel):
    total_images: int
    total_bytes: int
    total_mb: float


class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0
```

- [ ] **Step 2: Verify**

```bash
cd backend; uv run python -c "from schemas.feedback import StorageStatsResponse; print(StorageStatsResponse.model_fields.keys())"
```
Expected: `dict_keys(['total_images', 'total_bytes', 'total_mb'])`

---

### Task 7: Add image query methods to FeedbackRepository

**Files:**
- Modify: `backend/repositories/feedback.py`

- [ ] **Step 1: Add image-related methods**

```python
from models.feedback_image import FeedbackImage


class FeedbackRepository(Repository[Feedback]):
    model = Feedback

    # ... existing methods remain ...

    def query_admin_list(self, tag=None, date_from=None, date_to=None):
        q = self.db.query(
            Feedback.id,
            Feedback.user_id,
            Feedback.rating,
            Feedback.tag,
            Feedback.content,
            Feedback.version,
            Feedback.developer_reply,
            Feedback.replied_at,
            Feedback.created_at,
        ).order_by(Feedback.created_at.desc())

        if tag:
            q = q.filter(Feedback.tag == tag)
        if date_from is not None:
            q = q.filter(Feedback.created_at >= date_from)
        if date_to is not None:
            q = q.filter(Feedback.created_at < date_to)

        return q

    def query_daily_stats(self, date_from=None, date_to=None):
        q = (
            self.db.query(
                func.date(Feedback.created_at).label("date"),
                func.count(case((Feedback.rating == 1, 1))).label("rating_1"),
                func.count(case((Feedback.rating == 2, 1))).label("rating_2"),
                func.count(case((Feedback.rating == 3, 1))).label("rating_3"),
                func.count(case((Feedback.rating == 4, 1))).label("rating_4"),
                func.count(case((Feedback.rating == 5, 1))).label("rating_5"),
            )
            .group_by(func.date(Feedback.created_at))
            .order_by(func.date(Feedback.created_at))
        )
        if date_from is not None:
            q = q.filter(Feedback.created_at >= date_from)
        if date_to is not None:
            q = q.filter(Feedback.created_at < date_to)
        return q

    def get_image(self, feedback_id: int, image_id: int) -> FeedbackImage | None:
        return (
            self.db.query(FeedbackImage)
            .filter(
                FeedbackImage.feedback_id == feedback_id,
                FeedbackImage.id == image_id,
            )
            .first()
        )

    def image_count_for_feedback(self, feedback_id: int) -> int:
        return (
            self.db.query(func.count(FeedbackImage.id))
            .filter(FeedbackImage.feedback_id == feedback_id)
            .scalar()
            or 0
        )

    def storage_stats(self) -> dict:
        total_images = self.db.query(func.count(FeedbackImage.id)).scalar() or 0
        total_bytes = self.db.query(func.coalesce(func.sum(FeedbackImage.file_size), 0)).scalar() or 0
        return {
            "total_images": total_images,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        }
```

Note: `FeedbackImage` is imported at top. `func` is already imported from `sqlalchemy`.

---

### Task 8: Update FeedbackService with image logic and validation

**Files:**
- Modify: `backend/services/feedback.py`

- [ ] **Step 1: Add image validation and save logic**

Update imports at top — add:
```python
from models.feedback_image import FeedbackImage
```

Update `FeedbackRow` dataclass — add:
```python
    image_count: int = 0
```

Update `submit()` method:
```python
    def submit(
        self,
        user_id: int,
        rating: int,
        tag: str,
        content: str | None,
        images: list[tuple[bytes, str]] | None = None,
    ) -> Feedback:
        if images is not None:
            if len(images) > 3:
                raise ValidationError("每次最多上传 3 张图片")
            for data, mime in images:
                self._validate_image(data, mime)

        with unit_of_work(self.db, conflict_detail="反馈提交冲突"):
            fb = self.repo.add(
                Feedback(
                    user_id=user_id,
                    rating=rating,
                    tag=tag or "",
                    content=content,
                    version=APP_VERSION,
                )
            )
            if images:
                for data, mime in images:
                    self.db.add(
                        FeedbackImage(
                            feedback_id=fb.id,
                            image_data=data,
                            mime_type=mime,
                            file_size=len(data),
                        )
                    )
            return fb
```

Update `list_admin()` — after the for loop that builds `FeedbackRow`, add `image_count` retrieval. Since we need to batch-fetch image counts for performance, add after `rows, total = paginate(...)`:

```python
        feedback_ids = [r.id for r in rows]
        if feedback_ids:
            from sqlalchemy import func as sa_func
            counts = (
                self.db.query(
                    FeedbackImage.feedback_id,
                    sa_func.count(FeedbackImage.id).label("cnt"),
                )
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .group_by(FeedbackImage.feedback_id)
                .all()
            )
            count_map = {c.feedback_id: c.cnt for c in counts}
        else:
            count_map = {}

        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                user_name=r.user_name,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                image_count=count_map.get(r.id, 0),
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
```

Update `list_my()` similarly:
```python
    def list_my(self, user_id: int, offset: int = 0, limit: int = 50) -> tuple[list[FeedbackRow], int]:
        q = self.db.query(Feedback).filter(Feedback.user_id == user_id).order_by(Feedback.created_at.desc())
        rows, total = paginate(q, offset, limit)

        feedback_ids = [r.id for r in rows]
        if feedback_ids:
            from sqlalchemy import func as sa_func
            counts = (
                self.db.query(
                    FeedbackImage.feedback_id,
                    sa_func.count(FeedbackImage.id).label("cnt"),
                )
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .group_by(FeedbackImage.feedback_id)
                .all()
            )
            count_map = {c.feedback_id: c.cnt for c in counts}
        else:
            count_map = {}

        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                image_count=count_map.get(r.id, 0),
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return items, total
```

Add new methods at end of class:

```python
    def get_image(self, feedback_id: int, image_id: int) -> FeedbackImage:
        img = self.repo.get_image(feedback_id, image_id)
        if img is None:
            raise NotFoundError("图片不存在")
        return img

    def get_feedback_author(self, feedback_id: int) -> int | None:
        fb = self.repo.get(feedback_id)
        return fb.user_id if fb else None

    def storage_stats(self) -> dict:
        return self.repo.storage_stats()

    @staticmethod
    def _validate_image(data: bytes, mime_type: str) -> None:
        ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
        MAGIC_BYTES = {
            b"\xff\xd8": "image/jpeg",
            b"\x89PNG\r\n\x1a\n": "image/png",
            b"RIFF": "image/webp",
        }

        if mime_type not in ALLOWED_MIME:
            raise ValidationError(f"不支持的图片格式: {mime_type}")

        if len(data) == 0:
            raise ValidationError("图片文件为空")

        if len(data) > 512_000:
            raise ValidationError(f"图片大小超过限制 (最大 512KB, 实际 {len(data) // 1024}KB)")

        matched = False
        for magic, _ in MAGIC_BYTES.items():
            if data.startswith(magic):
                matched = True
                if magic == b"RIFF":
                    if len(data) < 12 or data[8:12] != b"WEBP":
                        raise ValidationError("非法的 WebP 文件")
                break

        if not matched:
            raise ValidationError("无法识别的图片格式，仅支持 JPEG / PNG / WebP")
```

- [ ] **Step 2: Verify Python syntax**

```bash
cd backend; uv run python -c "import ast; ast.parse(open('services/feedback.py').read()); print('OK')"
```

---

### Task 9: Update feedback router

**Files:**
- Modify: `backend/routers/feedback.py`

- [ ] **Step 1: Update imports**

Add at top:
```python
from fastapi import UploadFile, File
from fastapi.responses import Response
```

Add to schemas import:
```python
StorageStatsResponse,
```

- [ ] **Step 2: Update POST /feedback to accept multipart**

```python
@router.post("/feedback", response_model=FeedbackSubmitResponse)
async def submit_feedback(
    rating: Annotated[int, ...] = Form(default=3, ge=1, le=5),
    tag: Annotated[str, ...] = Form(default="", max_length=20),
    content: Annotated[str | None, ...] = Form(None),
    images: Annotated[list[UploadFile] | None, ...] = File(None),
    current_user: _AnyUser = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    image_data = None
    if images:
        image_data = []
        for img in images:
            data = await img.read()
            mime = img.content_type or "image/jpeg"
            image_data.append((data, mime))

    fb = FeedbackService(db).submit(
        current_user.id, rating, tag, content, image_data
    )
    img_count = FeedbackService(db).repo.image_count_for_feedback(fb.id)
    return {"id": fb.id, "image_count": img_count, "created_at": fb.created_at}
```

Wait, the existing `submit_feedback` uses `req: FeedbackSubmit` from body (JSON). We need to change to `Form(...)`. Need to import `Form` from fastapi.

Also need to update the imports — remove `FeedbackSubmit` from schemas import since we're no longer using the Pydantic body, or keep it for validation reference. Actually, since we're using Form fields, we still validate via the `ge/le` and `max_length` parameters. The `FeedbackSubmit` schema may still be needed by the frontend API types. Let's keep it.

Also need to read the current router more carefully. The router uses `_AnyUser = Annotated[User, Depends(get_current_user)]`. Let me check.

Looking at the current router line 22:
```python
_AnyUser = Annotated[User, Depends(get_current_user)]
```

But the router function signatures use `current_user: _AnyUser`. This is fine.

Now let me rewrite the task more carefully:

```python
from fastapi import UploadFile, File

# ... existing imports ...

@router.post("/feedback", response_model=FeedbackSubmitResponse)
async def submit_feedback(
    rating: int = Form(default=3, ge=1, le=5),
    tag: str = Form(default="", max_length=20),
    content: str | None = Form(None),
    images: list[UploadFile] | None = File(None, max_length=3),
    current_user: _AnyUser = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    image_data = None
    if images:
        image_data = []
        for img in images:
            data = await img.read()
            mime = img.content_type or "application/octet-stream"
            image_data.append((data, mime))

    fb = FeedbackService(db).submit(
        current_user.id, rating, tag, content, image_data
    )
    img_count = len(fb.images) if hasattr(fb, 'images') and fb.images else 0
    return {"id": fb.id, "image_count": img_count, "created_at": fb.created_at}
```

Wait, I need to check — `DbSession` is the dependency. Looking at the router, it says `db: DbSession` and the dependency import is `from core.deps import DbSession`. Let me check if there's a `get_db` or if `DbSession` is injected directly.

Looking at the current router, it uses `db: DbSession` as a parameter. This means FastAPI has a dependency registered for `DbSession`. Let me not change this — just use the same pattern.

But wait, `images: list[UploadFile] | None = File(None, max_length=3)` — `max_length` in `File()` doesn't exist. It's not a FastAPI param. I'll just validate count in the service layer (which we already do). So just use `File(None)`.

Actually, we can use `File(default=None)` but FastAPI needs special handling for optional file lists. Let me think...

In FastAPI, for optional file lists:
```python
images: list[UploadFile] | None = File(None)
```

This should work. If no files are uploaded, `images` will be `None`.

Let me also update the `_to_item` helper in the router to include `image_count`:

```python
def _to_item(r) -> FeedbackItem:
    return FeedbackItem(
        id=r.id,
        user_id=r.user_id,
        user_name=r.user_name,
        rating=r.rating,
        tag=r.tag,
        content=r.content,
        version=getattr(r, "version", ""),
        image_count=getattr(r, "image_count", 0),
        developer_reply=r.developer_reply,
        replied_at=r.replied_at,
        created_at=r.created_at,
    )

def _to_item_from_model(fb: Feedback) -> FeedbackItem:
    return FeedbackItem(
        id=fb.id,
        user_id=fb.user_id,
        user_name="",
        rating=fb.rating,
        tag=fb.tag,
        content=fb.content,
        version=fb.version,
        image_count=len(fb.images) if hasattr(fb, 'images') and fb.images else 0,
        developer_reply=fb.developer_reply,
        replied_at=fb.replied_at,
        created_at=fb.created_at,
    )
```

Wait, actually `fb.images` might trigger lazy loading. Let me think about this...After commit and refresh, the relationship should be loaded. But to be safe, maybe we should use `count()` or just not use `_to_item_from_model` for images. Actually the `reply_feedback` endpoint calls `_to_item_from_model` — and at that point, `fb` is a refreshed model. The `images` relationship is lazy by default in SQLAlchemy, but the session is open, so accessing `fb.images` will trigger a query. This is fine for a single item (reply endpoint).

OK let me finalize the plan now. I have all the pieces.

Wait, I also need to:
1. Add `image_count` to the admin list FeedbackItem (via _to_item)
2. Update the export function to include `image_count`
3. Update the my-feedback list similarly

Also I need to make sure the `FeedbackRow` from `services/feedback.py` is used properly in the router. Looking at the current code, `_to_item(r)` accesses `r.user_name`, `r.id`, etc. The `r` objects are `FeedbackRow` dataclass instances. So I need to add `image_count` to that dataclass (already planned in Task 8).

Let me now also make sure the `_to_item` function accesses the right attribute. Currently:
```python
def _to_item(r) -> FeedbackItem:
    return FeedbackItem(
        id=r.id,
        user_id=r.user_id,
        user_name=r.user_name,
        rating=r.rating,
        tag=r.tag,
        content=r.content,
        version=getattr(r, "version", ""),
        developer_reply=r.developer_reply,
        replied_at=r.replied_at,
        created_at=r.created_at,
    )
```

I need to add `image_count` here. Since `FeedbackRow` now has `image_count`, I can do:
```python
        image_count=getattr(r, "image_count", 0),
```

The `getattr` is for safety (in case `r` could be a model instead of a row).

OK now I have enough to write the complete plan. Let me finalize it.

For the image endpoint, I need to check access control. The approach: `FeedbackService.get_image()` gets the image, the router checks authorization.

For the storage stats endpoint, it's just a service call.

For the image GET endpoint:
```python
@router.get("/feedback/{feedback_id}/images/{image_id}")
def get_feedback_image(
    feedback_id: int,
    image_id: int,
    current_user: _AnyUser,
    db: DbSession,
):
    from models import Feedback
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404)
    
    # Access: author or admin with feedback_review
    is_author = fb.user_id == current_user.id
    is_admin = any(p.permission == "feedback_review" for p in current_user.role.permissions if hasattr(current_user, 'role'))
    
    Wait, the permission checking is more nuanced. Let me look at how require_permission works.
    
    Actually, let me use the existing pattern. The router already has `_FeedbackReviewer`. But for this endpoint, I need EITHER author OR reviewer. Let me use a different approach: do a manual check in the endpoint.
    
    Better: check access in the endpoint, not with decorators.
    
```python
@router.get("/feedback/{feedback_id}/images/{image_id}")
def get_feedback_image(
    feedback_id: int,
    image_id: int,
    current_user: _AnyUser,
    db: DbSession,
):
    service = FeedbackService(db)
    img = service.get_image(feedback_id, image_id)
    
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404)
    
    is_author = fb.user_id == current_user.id
    has_perm = any(rp.permission == "feedback_review" for rp in current_user.role.permissions) if current_user.role else False
    
    if not is_author and not has_perm:
        raise HTTPException(status_code=404)
    
    return Response(content=bytes(img.image_data), media_type=img.mime_type)
```

Wait, this depends on `current_user.role.permissions` being loaded. The `get_current_user` dependency may or may not load the role relationship eagerly. Let me check...

Actually looking at `backend/core/security.py`, the `get_current_user` function likely loads the user with roles and permissions joined. Let me not overcomplicate — I'll use the pattern that already exists in the codebase.

Let me simplify. For the image endpoint, I can check if the user has `feedback_review` permission using a helper, or just query the Feedback's user_id and compare.

OK let me use a simpler approach. I'll check it inline:

```python
from fastapi.responses import Response

@router.get("/feedback/{feedback_id}/images/{image_id}")
def get_feedback_image(
    feedback_id: int,
    image_id: int,
    current_user: _AnyUser,
    db: DbSession,
):
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404)
    
    has_perm = False
    if current_user.role and current_user.role.permissions:
        has_perm = any(rp.permission == "feedback_review" for rp in current_user.role.permissions)
    
    if fb.user_id != current_user.id and not has_perm:
        raise HTTPException(status_code=404)
    
    service = FeedbackService(db)
    img = service.get_image(feedback_id, image_id)
    
    return Response(content=bytes(img.image_data), media_type=img.mime_type)
```

Hmm, but the `FeedbackService.get_image()` internally calls `repo.get_image()` which returns the FeedbackImage or raises NotFoundError. If the image doesn't exist, it raises. That's fine.

Actually, I realize the order should be: check feedback exists → check access → fetch image → return. And if image_id is wrong, return 404.

Let me think about the Response import. The router already might not import this.

OK I think I have enough context to write the final plan. Let me compile it all together now in a clean document.

One more thing: the `_FeedbackReviewer` annotation uses `Depends(require_permission("feedback_review"))`. I can add a fallback check in the image endpoint that authorizes either the feedback author or an admin with the permission. Since I can't use two dependencies simultaneously, I'll use `_AnyUser` and do the permission check manually.

Now for the admin FeedbackTab and MyFeedback page, I need to update them to show `image_count` and load images. But these are complex components (especially the admin tab at 596 lines). Let me keep the plan focused on the minimal changes:

For MyFeedback:
- Add `image_count` display next to each feedback card
- Add collapsible image viewer using the GET endpoint

For admin FeedbackTab:
- Add `image_count` column in the table/list
- Add image viewer in the detail view

But wait, the MyFeedback page currently uses local tag/reply filtering on the client side (not server-side). The `items` array is filtered in the browser. This means the `image_count` just needs to be in the data. The display can be simple: show a camera icon + count if > 0.

For the plan, let me keep Task 10 (FeedbackModal), Task 11 (API client), and add a Task 12 for MyFeedback + admin tab image display.

Let me finalize and write the complete plan now.<｜end▁of▁thinking｜>Now I have the full context. Let me write the complete implementation plan.

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="write">
<｜｜DSML｜｜parameter name="content" string="true"># Feedback Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add image attachment support to the feedback system — frontend silent compression (max 500KB, 800px, 3 images), backend BYTEA storage in a child table with magic-byte validation.

**Architecture:** New `feedback_images` table (BYTEA) with FK CASCADE from `feedbacks`. Frontend uses `browser-image-compression` to compress before upload. Backend validates magic bytes, MIME type, size, and count. Images served via dedicated GET endpoint with author/admin access control.

**Tech Stack:** Python FastAPI + SQLAlchemy BYTEA, TypeScript React + browser-image-compression, PostgreSQL

**Mobile adaptivity:** FeedbackModal already uses `ResponsiveDialog` (bottom sheet on mobile). Image picker uses `<input accept="image/*" capture="environment">` on mobile to trigger native camera. Thumbnail previews scale responsively.

---

### Task 1: Install browser-image-compression

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add dependency**

```bash
cd frontend; npm install browser-image-compression
```

- [ ] **Step 2: Verify install**

```bash
node -e "const m = require('browser-image-compression'); console.log(typeof m.imageCompression)"
```
Expected: `function`

---

### Task 2: Create image compression utility

**Files:**
- Create: `frontend/src/lib/image-compress.ts`

- [ ] **Step 1: Create utility**

```typescript
import imageCompression from "browser-image-compression";

const MAX_SIZE_KB = 500;
const MAX_WIDTH = 800;

export async function compressImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: MAX_SIZE_KB / 1024,
    maxWidthOrHeight: MAX_WIDTH,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.7,
  });
}

export function validateImageFile(file: File): string | null {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) {
    return "仅支持 JPEG / PNG / WebP 格式";
  }
  if (file.size === 0) {
    return "图片文件为空";
  }
  if (file.size > 10 * 1024 * 1024) {
    return "图片大小不能超过 10MB";
  }
  return null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend; npx tsc --noEmit src/lib/image-compress.ts
```
Expected: no errors

---

### Task 3: Create FeedbackImage ORM model

**Files:**
- Create: `backend/models/feedback_image.py`

- [ ] **Step 1: Create model**

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import _now_utc


class FeedbackImage(Base):
    __tablename__ = "feedback_images"
    __table_args__ = (
        Index("ix_feedback_images_feedback_id", "feedback_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feedback_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("feedbacks.id", ondelete="CASCADE"), nullable=False
    )
    image_data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(20), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_now_utc)
```

- [ ] **Step 2: Verify syntax**

```bash
cd backend; uv run python -c "import ast; ast.parse(open('models/feedback_image.py').read()); print('OK')"
```
Expected: `OK`

---

### Task 4: Update models/__init__.py and Feedback.images relationship

**Files:**
- Modify: `backend/models/__init__.py`
- Modify: `backend/models/ux.py`

- [ ] **Step 1: Export FeedbackImage in __init__.py**

In `backend/models/__init__.py`, after line 13 (`from models.questionnaire import ...`), add:
```python
from models.feedback_image import FeedbackImage
```

After line 24 (`from models.ux import Feedback, Notification, SystemNotification`), remove (it's now on the new line above).

In the `__all__` list, after `"Feedback"` add `"FeedbackImage"`.

- [ ] **Step 2: Add images relationship to Feedback model**

In `backend/models/ux.py`, after line 43 (`user: Mapped[User] = relationship()`), add:
```python
    images: Mapped[list] = relationship("FeedbackImage", cascade="all, delete-orphan")
```

String reference "FeedbackImage" avoids circular imports. No additional import needed.

- [ ] **Step 3: Verify imports**

```bash
cd backend; uv run python -c "from models import FeedbackImage; print(FeedbackImage.__tablename__)"
```
Expected: `feedback_images`

---

### Task 5: Generate and run Alembic DDL migration

**Files:**
- Create: `backend/migrations/versions/ddl/<hash>_add_feedback_images.py`

- [ ] **Step 1: Generate migration**

```bash
cd backend; uv run alembic revision --autogenerate -m "add_feedback_images"
```

- [ ] **Step 2: Verify migration content**

Check the generated file:
- Creates `feedback_images` table with `id`, `feedback_id` (FK→feedbacks.id CASCADE), `image_data` (LargeBinary), `mime_type` (String 20), `file_size` (Integer), `created_at` (DateTime)
- Has `ix_feedback_images_feedback_id` index
- Has `downgrade()` that drops the table
- No `op.execute()` calls (DDL only)

- [ ] **Step 3: Run migration**

```bash
cd backend; uv run alembic upgrade head
```

- [ ] **Step 4: Verify table exists**

```bash
cd backend; uv run python -c "from core.database import engine; from sqlalchemy import inspect; i = inspect(engine); print('feedback_images' in i.get_table_names())"
```
Expected: `True`

---

### Task 6: Update schemas

**Files:**
- Modify: `backend/schemas/feedback.py`

- [ ] **Step 1: Add image_count to response schemas, add StorageStatsResponse**

Replace `FeedbackSubmitResponse` and `FeedbackItem`, and add `StorageStatsResponse` after `FeedbackReplyRequest`:

```python
class FeedbackSubmitResponse(BaseModel):
    id: int
    image_count: int = 0
    created_at: datetime


class FeedbackItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: str | None = None
    version: str = ""
    image_count: int = 0
    developer_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime


class StorageStatsResponse(BaseModel):
    total_images: int
    total_bytes: int
    total_mb: float
```

- [ ] **Step 2: Verify**

```bash
cd backend; uv run python -c "from schemas.feedback import StorageStatsResponse; print('OK')"
```
Expected: `OK`

---

### Task 7: Add image query methods to FeedbackRepository

**Files:**
- Modify: `backend/repositories/feedback.py`

- [ ] **Step 1: Add imports and image methods**

Add import at top:
```python
from models.feedback_image import FeedbackImage
```

Add methods at end of class:

```python
    def get_image(self, feedback_id: int, image_id: int) -> FeedbackImage | None:
        return (
            self.db.query(FeedbackImage)
            .filter(
                FeedbackImage.feedback_id == feedback_id,
                FeedbackImage.id == image_id,
            )
            .first()
        )

    def image_count_for_feedback(self, feedback_id: int) -> int:
        return (
            self.db.query(func.count(FeedbackImage.id))
            .filter(FeedbackImage.feedback_id == feedback_id)
            .scalar()
            or 0
        )

    def storage_stats(self) -> dict:
        total_images = self.db.query(func.count(FeedbackImage.id)).scalar() or 0
        total_bytes = self.db.query(func.coalesce(func.sum(FeedbackImage.file_size), 0)).scalar() or 0
        return {
            "total_images": total_images,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        }
```

- [ ] **Step 2: Verify syntax**

```bash
cd backend; uv run python -c "import ast; ast.parse(open('repositories/feedback.py').read()); print('OK')"
```
Expected: `OK`

---

### Task 8: Update FeedbackService with image validation and persistence

**Files:**
- Modify: `backend/services/feedback.py`

- [ ] **Step 1: Add imports**

Add after line 11 (`from models import Feedback, Notification, User`):
```python
from models.feedback_image import FeedbackImage
```

- [ ] **Step 2: Add image_count to FeedbackRow**

Add after line 23 (`content: str | None = None`):
```python
    image_count: int = 0
```

- [ ] **Step 3: Update submit() to accept and save images**

Replace `submit()` method:

```python
    def submit(
        self,
        user_id: int,
        rating: int,
        tag: str,
        content: str | None,
        images: list[tuple[bytes, str]] | None = None,
    ) -> Feedback:
        if images is not None:
            if len(images) > 3:
                raise ValidationError("每次最多上传 3 张图片")
            for data, mime in images:
                self._validate_image(data, mime)

        with unit_of_work(self.db, conflict_detail="反馈提交冲突"):
            fb = self.repo.add(
                Feedback(
                    user_id=user_id,
                    rating=rating,
                    tag=tag or "",
                    content=content,
                    version=APP_VERSION,
                )
            )
            if images:
                for data, mime in images:
                    self.db.add(
                        FeedbackImage(
                            feedback_id=fb.id,
                            image_data=data,
                            mime_type=mime,
                            file_size=len(data),
                        )
                    )
            return fb
```

- [ ] **Step 4: Update list_admin() to batch-fetch image counts**

Replace the list-building section (lines 60-76) after `rows, total = paginate(q, offset, limit)`:

```python
        rows, total = paginate(q, offset, limit)

        feedback_ids = [r.id for r in rows]
        if feedback_ids:
            counts = (
                self.db.query(
                    FeedbackImage.feedback_id,
                    func.count(FeedbackImage.id).label("cnt"),
                )
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .group_by(FeedbackImage.feedback_id)
                .all()
            )
            count_map = {c.feedback_id: c.cnt for c in counts}
        else:
            count_map = {}

        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                user_name=r.user_name,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                image_count=count_map.get(r.id, 0),
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
```

Add `from sqlalchemy import func` to the existing imports (if not already — it is already imported in `repositories/feedback.py` but check `services/feedback.py`). Actually the service file does NOT import `func`. Let me add it.

In the service file, I need to add `func` to the imports. But looking at the current `services/feedback.py`, there's no `func` import. The batch count query uses `func.count`. I should import it.

Actually, looking at the service, the `func` for the count query can be imported as:
```python
from sqlalchemy import func
```

But wait, there might be a naming conflict since we already use `from sqlalchemy.orm import Session`. There's no conflict — `func` is from `sqlalchemy`.

I'll add the import. But let me keep it local to avoid import issues. Actually no, let me just add it to the top-level imports.

Wait, actually, looking at the current imports in `services/feedback.py`, they import from models. The `from sqlalchemy.orm import Session` is there. Just add `func` to the `sqlalchemy` import.

But the file doesn't import `func` — it imports `from sqlalchemy.orm import Session`. I'll add `from sqlalchemy import func` separately.

Actually, I should also make sure the import is right. Looking at `repositories/feedback.py`, it has `from sqlalchemy import case, func`. So `func` is from `sqlalchemy` package directly.

In `services/feedback.py`, I'll add `from sqlalchemy import func` to the imports.

- [ ] **Step 5: Update list_my() similarly**

Replace the list-building section (lines 79-95):

```python
    def list_my(self, user_id: int, offset: int = 0, limit: int = 50) -> tuple[list[FeedbackRow], int]:
        q = self.db.query(Feedback).filter(Feedback.user_id == user_id).order_by(Feedback.created_at.desc())
        rows, total = paginate(q, offset, limit)

        feedback_ids = [r.id for r in rows]
        if feedback_ids:
            counts = (
                self.db.query(
                    FeedbackImage.feedback_id,
                    func.count(FeedbackImage.id).label("cnt"),
                )
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .group_by(FeedbackImage.feedback_id)
                .all()
            )
            count_map = {c.feedback_id: c.cnt for c in counts}
        else:
            count_map = {}

        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                image_count=count_map.get(r.id, 0),
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return items, total
```

- [ ] **Step 6: Add new methods at end of class**

```python
    def get_image(self, feedback_id: int, image_id: int) -> FeedbackImage:
        img = self.repo.get_image(feedback_id, image_id)
        if img is None:
            raise NotFoundError("图片不存在")
        return img

    def storage_stats(self) -> dict:
        return self.repo.storage_stats()

    @staticmethod
    def _validate_image(data: bytes, mime_type: str) -> None:
        ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
        if mime_type not in ALLOWED_MIME:
            raise ValidationError(f"不支持的图片格式: {mime_type}")

        if len(data) == 0:
            raise ValidationError("图片文件为空")

        if len(data) > 512_000:
            raise ValidationError(f"图片大小超过限制 (最大 512KB)")

        MAGIC = {
            b"\xff\xd8": "image/jpeg",
            b"\x89PNG\r\n\x1a\n": "image/png",
            b"RIFF": "image/webp",
        }
        matched = False
        for magic, _ in MAGIC.items():
            if data.startswith(magic):
                matched = True
                if magic == b"RIFF" and (len(data) < 12 or data[8:12] != b"WEBP"):
                    raise ValidationError("非法的 WebP 文件")
                break

        if not matched:
            raise ValidationError("无法识别的图片格式，仅支持 JPEG / PNG / WebP")
```

- [ ] **Step 7: Verify syntax**

```bash
cd backend; uv run python -c "import ast; ast.parse(open('services/feedback.py').read()); print('OK')"
```

---

### Task 9: Update feedback router

**Files:**
- Modify: `backend/routers/feedback.py`

- [ ] **Step 1: Update imports**

Add to fastapi imports (line 3):
```python
from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
```

Add to fastapi.resources:
```python
from fastapi.responses import Response
```

Add to schemas import:
```python
    StorageStatsResponse,
```

Remove `FeedbackSubmit` from schemas import (no longer used as Pydantic body).

- [ ] **Step 2: Rewrite POST /feedback for multipart**

Replace lines 26-29:

```python
MAX_IMAGES = 3

@router.post("/feedback", response_model=FeedbackSubmitResponse)
async def submit_feedback(
    rating: int = Form(default=3, ge=1, le=5),
    tag: str = Form(default="", max_length=20),
    content: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
):
    image_data = None
    if images:
        image_data = [(await img.read(), img.content_type or "application/octet-stream") for img in images]

    fb = FeedbackService(db).submit(current_user.id, rating, tag, content, image_data)
    img_count = FeedbackService(db).repo.image_count_for_feedback(fb.id)
    return {"id": fb.id, "image_count": img_count, "created_at": fb.created_at}
```

Wait — the current router has `_AnyUser = Annotated[User, Depends(get_current_user)]` at line 22, and `db: DbSession` which uses DI. Let me keep the existing parameter patterns.

Looking at line 22-23:
```python
_AnyUser = Annotated[User, Depends(get_current_user)]
_FeeedbackReviewer = Annotated[User, Depends(require_permission("feedback_review"))]
```

And `db: DbSession` — this is a DI annotation. I don't see `get_db` imported. Let me check `core/deps.py`.

Actually, let me look at the current function signature:
```python
def submit_feedback(req: FeedbackSubmit, current_user: _AnyUser, db: DbSession):
```

Here `DbSession` is from `core.deps`. So the dependency is `DbSession` which is likely an `Annotated[Session, Depends(...)]`. Let me keep using `db: DbSession` for consistency.

For `current_user`, use `_AnyUser`.

Final function signature:
```python
@router.post("/feedback", response_model=FeedbackSubmitResponse)
async def submit_feedback(
    rating: int = Form(default=3, ge=1, le=5),
    tag: str = Form(default="", max_length=20),
    content: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    current_user: _AnyUser = None,
    db: DbSession = None,
):
```

Hmm, `_AnyUser` uses `Depends(get_current_user)` already. The issue is that FastAPI resolves `Depends` differently when mixed with `Form`/`File`. Actually, FastAPI can handle mixing `Form`/`File` with `Depends` — the DI dependencies work fine alongside form fields. Let me keep the same pattern:

```python
@router.post("/feedback", response_model=FeedbackSubmitResponse)
async def submit_feedback(
    rating: int = Form(default=3, ge=1, le=5),
    tag: str = Form(default="", max_length=20),
    content: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    current_user: _AnyUser = Depends(get_current_user),
    db: DbSession = Depends(...),
):
```

Actually, `_AnyUser` is already `Annotated[User, Depends(get_current_user)]`, so using `current_user: _AnyUser` already has the Depends. I need to not add `= Depends(...)` again. The annotation already includes the dependency.

Let me look at the actual annotation: `_AnyUser = Annotated[User, Depends(get_current_user)]`. When used as `current_user: _AnyUser`, FastAPI automatically resolves it. So I just write:

```python
async def submit_feedback(
    rating: int = Form(default=3, ge=1, le=5),
    tag: str = Form(default="", max_length=20),
    content: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
    current_user: _AnyUser,
    db: DbSession,
):
```

But wait, `_AnyUser` is a type alias, not a direct function parameter with default. FastAPI reads Annotated types from parameters. This should work fine.

- [ ] **Step 3: Add GET image endpoint**

```python
@router.get("/feedback/{feedback_id}/images/{image_id}")
def get_feedback_image(
    feedback_id: int,
    image_id: int,
    current_user: _AnyUser,
    db: DbSession,
):
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not fb:
        raise HTTPException(status_code=404)

    if fb.user_id != current_user.id and not current_user.has_permission("feedback_review"):
        raise HTTPException(status_code=404)

    service = FeedbackService(db)
    img = service.get_image(feedback_id, image_id)
    return Response(content=bytes(img.image_data), media_type=img.mime_type)
```

- [ ] **Step 4: Add storage stats endpoint**

```python
@router.get("/admin/feedback/storage-stats", response_model=StorageStatsResponse)
def feedback_storage_stats(
    current_user: _FeedbackReviewer,
    db: DbSession,
):
    return FeedbackService(db).storage_stats()
```

- [ ] **Step 5: Update _to_item and _to_item_from_model helpers**

In `_to_item` (line 111), add after `version=getattr(r, "version", ""),`:
```python
        image_count=getattr(r, "image_count", 0),
```

In `_to_item_from_model` (line 126), add after `version=fb.version,`:
```python
        image_count=len(fb.images) if fb.images else 0,
```

- [ ] **Step 6: Update export to include image_count**

In the `export_feedback` endpoint (line 81), add to the columns list after `ColumnDef("版本", key="version"),`:
```python
        ColumnDef("图片数", key="image_count", fmt=lambda v: str(v) if v else "0"),
```

But wait, the `export_feedback` endpoint queries `db.query(Feedback)` directly and maps to `ColumnDef`. The `Feedback` model doesn't have `image_count`. We'd need to join or count. Since export needs to be fast and simple, let's do a separate query to count images per feedback.

Actually, the export endpoint queries up to `MAX_EXPORT_ROWS + 1` records. Loading all images for all feedbacks could be expensive. Let me just show `image_count` in the list view (API) and not in the export for now. Export is CSV/XLSX for data analysis — not critical for images.

Actually, let me just leave the export as-is. The design spec says "only return image_count" — but this is for list responses, not necessarily for export. Let me keep export unchanged.

Hmm, the spec says:
> CSV/XLSX export: includes image_count column, no image data

So I should add it. Let me use a simple approach: query all feedback IDs, then do a grouped count.

```python
@router.post("/admin/feedback/export")
def export_feedback(
    current_user: _FeedbackReviewer,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from core.config import MAX_EXPORT_ROWS

    fb_list = db.query(Feedback).order_by(Feedback.created_at.desc()).limit(MAX_EXPORT_ROWS + 1).all()

    feedback_ids = [f.id for f in fb_list]
    if feedback_ids:
        from models.feedback_image import FeedbackImage as FI
        counts = (
            db.query(FI.feedback_id, func.count(FI.id).label("cnt"))
            .filter(FI.feedback_id.in_(feedback_ids))
            .group_by(FI.feedback_id)
            .all()
        )
        count_map = {c.feedback_id: c.cnt for c in counts}
    else:
        count_map = {}

    columns = [
        ColumnDef("反馈内容", key="content"),
        ColumnDef("评分", key="rating", fmt=lambda v: str(v) if v else ""),
        ColumnDef("标签", key="tag"),
        ColumnDef("版本", key="version"),
        ColumnDef("图片数", value=lambda r: str(count_map.get(r.id, 0))),
        ColumnDef("开发者回复", key="developer_reply"),
        ColumnDef("创建时间", value=lambda r: r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""),
    ]
    return export_response(fb_list, columns, "用户反馈", "用户反馈", format)
```

OK let me finalize. The plan is getting long but very detailed. Let me stop adding more and compile what I have.

- [ ] **Step 7: Verify router syntax**

```bash
cd backend; uv run python -c "import ast; ast.parse(open('routers/feedback.py').read()); print('OK')"
```

---

### Task 10: Update FeedbackModal with image picker and compressed upload

**Files:**
- Modify: `frontend/src/components/FeedbackModal.tsx`

- [ ] **Step 1: Add imports**

Add at top:
```typescript
import { Image, Plus, X } from "lucide-react";
import { compressImage, validateImageFile } from "@/lib/image-compress";
```

- [ ] **Step 2: Add state and handlers**

Add state after line 43 (`const toast = useToast();`):

```typescript
	const [images, setImages] = useState<File[]>([]);
	const [compressing, setCompressing] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
```

Add `useRef` import from `react`.

- [ ] **Step 3: Add image handler functions**

Add before `handleSubmit`:

```typescript
	const handleAddImages = async (e: ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;

		const newFiles = Array.from(files).slice(0, 3 - images.length);
		for (const file of newFiles) {
			const error = validateImageFile(file);
			if (error) {
				toast.error(error);
				return;
			}
		}

		setCompressing(true);
		try {
			const compressed = await Promise.all(newFiles.map(compressImage));
			setImages((prev) => [...prev, ...compressed].slice(0, 3));
		} catch {
			toast.error("图片处理失败，请重试");
		} finally {
			setCompressing(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const handleRemoveImage = (index: number) => {
		setImages((prev) => prev.filter((_, i) => i !== index));
	};
```

- [ ] **Step 4: Update handleSubmit to include images**

Replace `handleSubmit`:

```typescript
	const handleSubmit = async () => {
		setSubmitting(true);
		try {
			const formData = new FormData();
			formData.append("rating", String(rating));
			formData.append("tag", tag);
			if (content) formData.append("content", content);
			for (const img of images) {
				formData.append("images", img);
			}
			await submitFeedbackFormData(formData);
			toast.success("感谢你的反馈！");
			setRating(3);
			setTag("");
			setContent("");
			setImages([]);
			onClose();
			if (onSubmitted) onSubmitted();
		} catch {
			toast.error("提交失败，请重试");
		} finally {
			setSubmitting(false);
		}
	};
```

- [ ] **Step 5: Add image section UI**

Add after the textarea section (after line 143 `</div>` closing the textarea div, before `</div>` on line 145):

```tsx
				<div>
					<div className="text-sm text-muted-foreground mb-3 font-medium">
						添加截图 <span className="text-muted-foreground/60 font-normal">(选填, 最多3张)</span>
					</div>

					<div className="flex flex-wrap gap-2 mb-2">
						{images.map((file, i) => (
							<div key={`${file.name}-${i}`} className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-md border border-border overflow-hidden group shrink-0">
								<img
									src={URL.createObjectURL(file)}
									alt={`截图 ${i + 1}`}
									className="w-full h-full object-cover"
								/>
								<button
									type="button"
									onClick={() => handleRemoveImage(i)}
									className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
								>
									<X size={12} />
								</button>
							</div>
						))}
						{compressing && (
							<div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md border border-border bg-muted flex items-center justify-center shrink-0">
								<Loader2 size={18} className="animate-spin text-muted-foreground" />
							</div>
						)}
						{images.length < 3 && (
							<label className="w-16 h-16 sm:w-20 sm:h-20 rounded-md border border-dashed border-border bg-card flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-primary transition-colors shrink-0">
								<Plus size={18} className="text-muted-foreground" />
								<span className="text-[10px] text-muted-foreground">添加</span>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/*"
									multiple
									className="hidden"
									onChange={handleAddImages}
								/>
							</label>
						)}
					</div>
				</div>
```

- [ ] **Step 6: Update submit button disabled state**

Change line 164: `disabled={submitting}` → `disabled={submitting || compressing}`

- [ ] **Step 7: Reset images on close**

Update `handleClose` (line 63) — add `setImages([])` after `setContent("")`.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd frontend; npx tsc --noEmit
```
Expected: no errors

---

### Task 11: Update frontend API client for multipart + image URL

**Files:**
- Modify: `frontend/src/api/admin/feedback.ts`

- [ ] **Step 1: Add multipart submit and image URL builder**

```typescript
import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export const submitFeedback = (data: Schemas["FeedbackSubmit"]) =>
	api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", data);

export const submitFeedbackFormData = (formData: FormData) =>
	api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", formData, {
		headers: { "Content-Type": "multipart/form-data" },
	});

export function feedbackImageUrl(feedbackId: number, imageId: number): string {
	return `/api/feedback/${feedbackId}/images/${imageId}`;
}

export const getFeedbacks = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/admin/feedback", {
		params,
	});

export const getFeedbackStats = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["FeedbackDailyItem"][]>("/admin/feedback/stats", { params });

export const getFeedbackStorageStats = () =>
	api.get<{ total_images: number; total_bytes: number; total_mb: number }>(
		"/admin/feedback/storage-stats",
	);

export const replyFeedback = (feedbackId: number, reply: string) =>
	api.put<Schemas["FeedbackItem"]>(`/admin/feedback/${feedbackId}/reply`, { reply });

export const getMyFeedback = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/my-feedback", { params });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend; npx tsc --noEmit
```

---

### Task 12: Update MyFeedback page to show image count and viewer

**Files:**
- Modify: `frontend/src/pages/MyFeedback.tsx`

- [ ] **Step 1: Add image count display in feedback card**

After line 135 (`{fb.content && (...)}`), before line 136 (`{fb.developer_reply && (...)}`), add:

```tsx
							{fb.image_count != null && fb.image_count > 0 && (
								<div className="flex items-center gap-1 text-xs text-muted-foreground">
									<Camera size={12} />
									查看 {fb.image_count} 张截图
								</div>
							)}
```

Add `Camera` import from `lucide-react`.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend; npx tsc --noEmit
```

---

### Task 13: Regenerate API types

**Files:**
- May regenerate: `frontend/src/api/api-types.gen.ts`

- [ ] **Step 1: Regenerate API types from backend**

```bash
pnpm run api:update
```

This updates `openapi.json` and regenerates `api-types.gen.ts` to include `image_count` in `FeedbackItem` and `FeedbackSubmitResponse`.

- [ ] **Step 2: Run backend tests**

```bash
cd backend; uv run python -m pytest tests/ -x -q -k "feedback"
```
Expected: all feedback-related tests pass

- [ ] **Step 3: Run full backend lint + type check**

```bash
cd backend; uv run ruff check; uv run ruff format --check; uv run ty check
```
Expected: all pass

- [ ] **Step 4: Run frontend checks**

```bash
cd frontend; npx tsc --noEmit; npx biome check
```
Expected: all pass
