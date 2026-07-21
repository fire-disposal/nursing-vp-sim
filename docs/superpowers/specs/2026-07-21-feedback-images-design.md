# Feedback Image Attachments Design

**Date**: 2026-07-21
**Status**: Approved

## 1. Overview

Add image attachment support to the feedback system so users can submit screenshots alongside text feedback. Images are compressed silently in the browser, validated on the backend, and stored as BYTEA in a new `feedback_images` table — no external storage dependencies.

## 2. Data Model

### New table: `feedback_images`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | Integer | PK, auto-increment |
| `feedback_id` | Integer | FK → `feedbacks.id` ON DELETE CASCADE, NOT NULL |
| `image_data` | LargeBinary | NOT NULL |
| `mime_type` | String(20) | NOT NULL, one of `image/jpeg` `image/png` `image/webp` |
| `file_size` | Integer | NOT NULL, byte count as received by backend |
| `created_at` | DateTime(tz=True) | NOT NULL, UTC |

Index: `ix_feedback_images_feedback_id` on `feedback_id`.

### Relationship

`Feedback.images = relationship("FeedbackImage", cascade="all, delete-orphan")`

## 3. API Design

### 3.1 Submit Feedback (modified)

**POST /api/feedback** — Content-Type: `multipart/form-data`

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `rating` | int (1-5) | yes | |
| `tag` | string | yes | 20 chars |
| `content` | string | no | |
| `images` | file[] | no | 3 files |

Response adds `image_count: int` field.

### 3.2 Get Image (new)

**GET /api/feedback/{feedback_id}/images/{image_id}**

Returns raw image bytes with correct `Content-Type` header.
Access: feedback author OR admin with `feedback_review` permission.
Not found / not authorized → 404.

### 3.3 Storage Stats (new)

**GET /api/admin/feedback/storage-stats** — admin only

```json
{
  "total_images": 1234,
  "total_bytes": 45678901,
  "total_mb": 43.5
}
```

### 3.4 Existing Endpoints Unchanged

- **My feedback list**: `FeedbackItem` gains optional `image_count` field
- **Admin feedback list**: same, `image_count` added
- **CSV/XLSX export**: includes `image_count` column, no image data
- **Bot API**: no image data returned

## 4. Backend Validation

| Layer | Check |
|-------|-------|
| Magic bytes | JPEG (0xFF 0xD8), PNG (0x89 0x50 0x4E 0x47), WebP (RIFF....WEBP) |
| MIME type | Whitelist: `image/jpeg`, `image/png`, `image/webp` |
| File size | Single image ≤ 512,000 bytes (512 KB) |
| File count | Per request ≤ 3 images |
| Empty file | Reject 0-byte uploads |

Errors return 400 with descriptive message (e.g. "无效的图片格式", "图片大小超过限制").

## 5. Frontend Design

### 5.1 Image Compression (`src/lib/image-compress.ts`)

Uses `browser-image-compression` library. Pipeline:

1. File selected via `<input accept="image/*">`
2. `imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 800, useWebWorker: true })`
3. Library handles EXIF orientation, size retry, format negotiation
4. Output: compressed `File` object, ready for FormData

### 5.2 FeedbackModal Changes

Below the textarea:
- **Add button**: `+ 添加截图` triggers file picker, hidden when 3 images selected
- **Thumbnail previews**: 80x80 thumbnails in a horizontal row, each with × remove button
- **Loading state**: spinner on thumbnail while compression runs
- **Submit**: all form fields + compressed images in FormData via axios
- **Submit button disabled** during upload

### 5.3 Image Display

- My Feedback page: each row shows `📷 N` if `image_count > 0`; click to expand and load thumbnails via GET endpoint
- Admin FeedbackTab: same pattern in the list and reply modal

## 6. Security

- **Magic bytes validation**: prevents MIME type spoofing, rejects non-image files
- **Access control**: image endpoint checks user is author or has `feedback_review` permission; returns 404 for unauthorized (no information leak)
- **SQL injection**: ORM parameterized queries only
- **No inline base64**: images served through dedicated endpoint, no XSS surface

## 7. Storage & Maintenance

- Images stored in PostgreSQL BYTEA alongside the main database — backed up with regular DB dumps
- No external storage dependency (no S3/MinIO/filesystem volumes)
- Storage stats endpoint available for monitoring growth
- Images deleted on feedback CASCADE delete
- Long-term: if storage becomes a concern, add periodic cleanup by age or reply status

## 8. Files Changed

### New files
| File | Purpose |
|------|---------|
| `backend/models/feedback_image.py` | ORM model |
| `backend/migrations/versions/ddl/<hash>_add_feedback_images.py` | DDL migration |
| `frontend/src/lib/image-compress.ts` | Compression utility |

### Modified files
| File | Changes |
|------|---------|
| `backend/models/__init__.py` | Export FeedbackImage |
| `backend/models/ux.py` | Add images relationship to Feedback |
| `backend/schemas/feedback.py` | Add image_count, StorageStatsResponse |
| `backend/routers/feedback.py` | Multipart POST, GET image, GET storage stats |
| `backend/services/feedback.py` | Image save/retrieve logic, stats query |
| `backend/repositories/feedback.py` | Image queries |
| `frontend/src/components/FeedbackModal.tsx` | Image picker, preview, compressed upload |
| `frontend/src/api/admin/feedback.ts` | Image URL builder |
| `frontend/package.json` | Add browser-image-compression |
