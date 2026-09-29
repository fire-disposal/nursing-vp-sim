"""情境训练 · `st_*` 表。

**内容只有一份，没有修订系统**：
- `st_packs.content` 是病例的**当前内容**（保存即覆盖），`version` 是每次保存递增的整数；
- `st_sessions` 在开局时把当时的内容**快照到自己的行里**（`pack_content` + `pack_version`），
  因此判读与回放读会话自带的那份，**不受后来改内容影响**——可复现性不靠"多行不可变修订"，
  靠"会话自带一份"。同一条理由也让"形状版本门"（旧修订不能开新局）彻底消失：
  内容在写入时已通过校验，运行时读到的必然合法。

事件日志（append-only）仍是世界状态的载体：世界由事件推导，便于回放与判读。
`user_id` / `pack_key` 只存标识、不加外键——与老系统数据不耦合。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base
from models._base import TimestampMixin

SESSION_STATUSES = ("active", "completed", "abandoned")

# 事件种类：**唯一会写入**的这五种；一个业务回合只追加一条 `turn_committed`。
EVENT_KINDS = (
    "session_opened",
    "turn_committed",
    "clarification_exchange",
    "hint_requested",
    "session_closed",
)

REQUEST_KINDS = ("turn", "close")


class StPack(Base, TimestampMixin):
    """一个病例：**当前内容**（可覆盖）+ 整数版本 + 是否上架。

    **没有 title / one_line 列**：展示字段就是内容里的 `title` / `one_line`（一份内容一个真源），
    改名只能通过保存内容 —— 否则"行里的标题"和"内容里的标题"会各说各话，作者改一个被另一个覆盖。
    """

    __tablename__ = "st_packs"
    __table_args__ = (
        UniqueConstraint("key", name="uq_st_packs_key"),
        Index("ix_st_packs_published", "published"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    #: 病例内容（形状见 `modules.scenario_training.schema.ScenarioPack`）。保存即覆盖。
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    #: 保存次数（从 1 起）。只作标识与展示，不是"修订"——没有不可变历史、没有形状版本。
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    #: 上架状态：学生列表只列 `published=true`；下架不删数据（老会话照常可读、可继续）。
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StSession(Base, TimestampMixin):
    """一次情境遭遇：开局时把内容快照进来，此后与病例的后续修改无关。"""

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
    pack_key: Mapped[str] = mapped_column(String(120), nullable=False)
    #: 开局时病例的 `version`（展示用："你在 v7 上玩的"）。
    pack_version: Mapped[int] = mapped_column(Integer, nullable=False)
    #: 开局时病例内容的**快照**：回放、判读、报告都读它。
    pack_content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))


class StAsset(Base, TimestampMixin):
    """病例图片的**字节**，按 `(pack_key, asset_id)` 存放。

    字节由本表提供（管理侧上传，或安装/导入时从病例文件夹的 `img/` 播种，见 `assets.seed_assets`）；
    病例内容只声明"有哪些图片、叫什么"。与反馈系统的图片存储同构，不引入文件系统依赖。
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


class StEvent(Base):
    """只追加的事件。「世界状态」= 事件流的推导结果，不另存一份可变状态。"""

    __tablename__ = "st_events"
    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_st_events_session_seq"),
        Index("ix_st_events_session_kind", "session_id", "kind"),
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{kind}'" for kind in EVENT_KINDS) + ")",
            name="ck_st_events_kind",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)


class StSessionRequest(Base):
    """**请求身份**：一次会改变会话记录的请求（回合 / 澄清 / 求提示 / 结束）的唯一登记。

    存在于数据库提交边界（不是只靠前端 busy）：
    - `session_id + request_id` 唯一 → 相同 ID 同输入重发返回已提交结果，同 ID 异输入拒绝；
    - `input_sha` 是输入身份（不含 `request_id` 与 `expected_seq`）；
    - `result` 存已提交的原结果（含权威视图）→ 断流后按同一 request_id 取回，不必重跑 LLM。
    """

    __tablename__ = "st_session_requests"
    __table_args__ = (
        UniqueConstraint("session_id", "request_id", name="uq_st_session_requests_session_request"),
        Index("ix_st_session_requests_session", "session_id"),
        CheckConstraint("kind IN ('turn', 'close')", name="ck_st_session_requests_kind"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    input_sha: Mapped[str] = mapped_column(String(64), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
