"""情境训练（experimental）· `st_*` 表。

隔离硬红线（docs/20 §2.4）：本轨只读写 `st_*`；**不建指向老表的 FK**、不做跨表 JOIN、不写老表。
因此 `user_id` / `pack_revision_id` 只存整数标识、不加外键——账号与 LLM 基础设施共享，
**数据不耦合**：删改老表结构不会波及本轨，本轨的坏实验也碰不到老数据。

事件日志（append-only）是本轨的状态载体：世界状态由事件推导，便于反应链、回放与经历量化。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import TimestampMixin

SESSION_STATUSES = ("active", "completed", "abandoned")
PACK_STATES = ("experimental", "reviewed")

# 事件种类（封闭集合，本轨唯一的状态写入渠道）
EVENT_KINDS = (
    "session_opened",
    "student_action",
    "action_attributed",
    "dm_step",
    "dm_turn",
    "anchor_satisfied",
    "anchor_blocked",
    "anchor_proposal_rejected",
    "effects_applied",
    "cues_revealed",
    "entity_line",
    "judge_result",
    "session_closed",
)


class StPack(Base, TimestampMixin):
    """一套情境（逻辑容器）。内容在 `st_pack_revisions`，可热载。"""

    __tablename__ = "st_packs"
    __table_args__ = (
        UniqueConstraint("key", name="uq_st_packs_key"),
        Index("ix_st_packs_state", "state"),
        CheckConstraint(
            "state IN ('experimental', 'reviewed')",
            name="ck_st_packs_state",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'experimental'"))
    one_line: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))


class StPackRevision(Base, TimestampMixin):
    """不可变的内容修订。会话只认自己钉住的那一版（热载不影响进行中的会话）。"""

    __tablename__ = "st_pack_revisions"
    __table_args__ = (
        UniqueConstraint("pack_id", "revision_no", name="uq_st_pack_revisions_pack_rev"),
        Index("ix_st_pack_revisions_pack", "pack_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pack_id: Mapped[int] = mapped_column(Integer, nullable=False)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    pack_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    content_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))


class StSession(Base, TimestampMixin):
    """一次情境遭遇。`pack_revision_id` 在开启时冻结。"""

    __tablename__ = "st_sessions"
    __table_args__ = (
        Index("ix_st_sessions_user", "user_id"),
        Index("ix_st_sessions_status", "status"),
        CheckConstraint(
            "status IN ('active', 'completed', 'abandoned')",
            name="ck_st_sessions_status",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    pack_revision_id: Mapped[int] = mapped_column(Integer, nullable=False)
    pack_key: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))


class StAsset(Base, TimestampMixin):
    """场景资源包的**字节**（图片等），按 `(pack_key, asset_id)` 存放。

    运行时的唯一来源是这里：pack 修订只声明"有哪些资源、叫什么、什么时候值得展示"，
    字节由本表提供（管理侧上传，或安装时从仓库文件播种，见 `assets.seed_from_pack`）。
    与反馈系统的图片存储同构（`LargeBinary`），不引入文件系统依赖。
    """

    __tablename__ = "st_assets"
    __table_args__ = (
        UniqueConstraint("pack_key", "asset_id", name="uq_st_assets_pack_asset"),
        Index("ix_st_assets_pack", "pack_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pack_key: Mapped[str] = mapped_column(String(120), nullable=False)
    asset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    filename: Mapped[str] = mapped_column(String(200), nullable=False, server_default=text("''"))
    mime_type: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=text("'application/octet-stream'")
    )
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class StGeneratedAsset(Base, TimestampMixin):
    """DM 运行期**按需生成**的资源字节（目前是图片）。

    与 `st_assets` 同构（字节存库、运行时不读文件系统），但**属于一次会话**：生成发生在会话里，
    提示词来自该会话的 DM 回合，`session_id` / `pack_revision_id` 与其余 `st_*` 一样只存整数标识、不加 FK。

    去重口径：**同一会话内同一份字节只留一行**（`uq_st_generated_assets_session_sha`）——
    重复请求同一张图命中已有行，不重复存；删掉行即回收字节（无生命周期 = 无孤儿文件）。
    """

    __tablename__ = "st_generated_assets"
    __table_args__ = (
        UniqueConstraint("session_id", "sha256", name="uq_st_generated_assets_session_sha"),
        Index("ix_st_generated_assets_session", "session_id"),
        Index("ix_st_generated_assets_pack", "pack_key"),
        Index("ix_st_generated_assets_kind_sha", "kind", "sha256"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    pack_key: Mapped[str] = mapped_column(String(120), nullable=False)
    pack_revision_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'image'"))
    prompt: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("''"))
    mime_type: Mapped[str] = mapped_column(
        String(40), nullable=False, server_default=text("'application/octet-stream'")
    )
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class StEvent(Base):
    """只追加的事件。「世界状态」= 事件流的推导结果，不另存一份可变状态。"""

    __tablename__ = "st_events"
    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_st_events_session_seq"),
        Index("ix_st_events_session_kind", "session_id", "kind"),
        CheckConstraint(
            "kind IN ("
            "'session_opened', 'student_action', 'action_attributed', 'dm_step', 'dm_turn', "
            "'anchor_satisfied', 'anchor_blocked', 'anchor_proposal_rejected', "
            "'effects_applied', 'cues_revealed', 'entity_line', 'judge_result', 'session_closed'"
            ")",
            name="ck_st_events_kind",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)
