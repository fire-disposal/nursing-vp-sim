"""backfill case status / revision 1 / metadata single source / revision references

# Manual override reason: data_only

切片 3（docs/15 §六）+ 能力声明换轨（docs/15 §九）的数据步骤 —— 只搬数据，不改结构：

0. 旧形状能力声明先落到现行契约：``case_data.tools.<physical_exam|nursing_record|quiz>``
   与旧顶层 ``exam_anchors`` / ``nursing_record`` / ``quiz`` → ``activities.<id>.config``。
   新运行时只消费 ``activities.<id>.config``，不换轨等于把这些配置丢掉；映射与合并
   优先级（``tools.*`` 覆盖同名键）是 ``backend/scripts/migrate_case_activities.py`` 的
   冻结副本。无法无损映射（``tools`` 非对象 / 未知键 / ``nursing_diagnosis``）时**整条
   迁移在写入前报错停下**并列出病例 id，绝不静默丢配置；已有 ``activities`` 的行原样
   保留既有声明（重跑 / 部分迁移幂等），残留旧形状键只记 warning。downgrade **不**还原
   这个形状：顶层 ``exam_anchors`` 与 ``tools.physical_exam`` 合并后无法再拆回，换轨是
   单向的（旧运行时若要看这份配置需人工处理）。
1. 每个病例产生 revision 1（内容 = 剥掉元数据键、换轨后的 case_data），
   ``cases.current_revision_id`` 指向它；
2. ``status`` 映射：``history_taking`` 行 → published，其余（历史 triage 等已退场类型）
   → archived，并在日志里逐个报出（这些行退场前就已经被列表过滤掉，不进新训练）；
3. ``case_data`` 剥离元数据键 ``name`` / ``difficulty`` / ``time_limit`` / ``training_type``
   （元数据只在 cases 列，docs/15 §六、§十五.3）；内置病例的 ``_seed_hash`` 指纹随之改写：
   原地未改动的行在**换轨后的内容**上按新算法（不含元数据）重算 —— 指纹因此与仓库病例
   （已是 activities 形状）重新对齐，seed 仍认得出「未改动」；教师改过的行保留旧指纹
   （与换轨后内容不符 → seed 继续让路，绝不静默回滚教师工作）；
4. 既有 ``training_records`` / ``assignments`` 回填 ``case_revision_id``（= 其病例的
   current revision）：历史训练永远有明确的复盘版本。

downgrade 逐条反向：还原元数据键与旧指纹、摘掉引用后删除 revision 行（能力声明形状
保持 ``activities``，见上）。

``_content_hash`` 是 ``modules/cases/builtin_sync.content_hash`` 的冻结副本 —— 迁移是
历史，不能随应用代码演进而改变对既有行的判定。

Revision ID: e6b2c3d4e5f6
Revises: e5a1b2c3d4f5
Create Date: 2026-09-25
"""

import hashlib
import json
import logging
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

log = logging.getLogger(__name__)

revision: str = "e6b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "e5a1b2c3d4f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEED_HASH_KEY = "_seed_hash"
#: 只在 cases 列保存的元数据键（training_type 已整体退场）
METADATA_KEYS = ("name", "difficulty", "time_limit", "training_type")

_STATUS_PUBLISHED = "published"
_STATUS_ARCHIVED = "archived"

# ── 能力声明换轨（``tools.*`` / 顶层旧形状 → ``activities.<id>.config``）────────────
#: 现行契约的声明容器与配置键（``modules/training/activities`` 的冻结副本：迁移是历史，
#: 不随应用常量演进而改变对既有行的判定）
ACTIVITIES_FIELD = "activities"
ACTIVITY_CONFIG_KEY = "config"
#: ``tools.<key>`` → Activity id（键名一致，显式列出以免"看名字猜"）
LEGACY_TOOL_FIELDS: dict[str, str] = {
    "physical_exam": "physical_exam",
    "nursing_record": "nursing_record",
    "quiz": "quiz",
}
#: 顶层旧形状（CaseDataSchema 曾在顶层声明 exam_anchors/nursing_record/quiz）
LEGACY_TOP_LEVEL_FIELDS: dict[str, str] = {
    "exam_anchors": "physical_exam",
    "nursing_record": "nursing_record",
    "quiz": "quiz",
}
#: 明确禁止迁入的 Activity（无正式产物 → 迁移后必须仍为 0 例）
FORBIDDEN_ACTIVITY_IDS = ("nursing_diagnosis",)


class MigrationDataError(RuntimeError):
    """存量 ``case_data`` 无法无损换轨 —— 停手而不是静默丢配置。"""


def _content_hash(payload: dict[str, Any], *, ignore_metadata: bool) -> str:
    """内容指纹（``ignore_metadata`` = 现行算法；否则为元数据入指纹的旧算法）。"""
    if ignore_metadata:
        payload = {k: v for k, v in payload.items() if k not in METADATA_KEYS}
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _split_payload(raw: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """拆出 (剥离元数据的内容, 含元数据的原 payload[去指纹], 指纹)。"""
    payload = dict(raw or {})
    bookmark = payload.pop(SEED_HASH_KEY, None)
    content = {k: v for k, v in payload.items() if k not in METADATA_KEYS}
    return content, payload, bookmark if isinstance(bookmark, str) else None


def _validate_legacy_tools(case_id: int, content: dict[str, Any]) -> None:
    """``tools`` 存在即校验：非对象 / 未知键 / 禁止迁入的 Activity 一律报错。

    宁可停手也不静默丢弃：未知的工具配置一旦被换轨代码忽略，就等于在新运行时里消失。
    """
    tools = content.get("tools")
    if tools is None:
        return
    if not isinstance(tools, dict):
        raise MigrationDataError(f"病例 #{case_id}: tools 必须是对象，当前为 {type(tools).__name__}")
    for key in tools:
        if key in FORBIDDEN_ACTIVITY_IDS:
            raise MigrationDataError(f"病例 #{case_id}: tools.{key} 不得迁移（无正式产物，迁移后必须仍为 0 例）")
        if key not in LEGACY_TOOL_FIELDS:
            raise MigrationDataError(f"病例 #{case_id}: tools.{key} 无迁移映射（未知工具配置，不能静默丢弃）")


def _collect_legacy_configs(case_id: int, content: dict[str, Any]) -> dict[str, Any]:
    """把旧形状字段收集成 ``activity_id → config``（``tools.*`` 是较新格式，同名键优先）。"""
    configs: dict[str, Any] = {}
    tools = content.get("tools")
    if isinstance(tools, dict):  # 键合法性已由 _validate_legacy_tools 保证
        for key, payload in tools.items():
            configs[LEGACY_TOOL_FIELDS[key]] = payload
    for key, activity_id in LEGACY_TOP_LEVEL_FIELDS.items():
        if key not in content:
            continue
        payload = content[key]
        if activity_id not in configs:
            configs[activity_id] = payload
            continue
        tools_payload = configs[activity_id]
        if not isinstance(tools_payload, dict) or not isinstance(payload, dict):
            raise MigrationDataError(f"病例 #{case_id}: 顶层 {key} 与 tools.{activity_id} 类型不一致，无法合并")
        configs[activity_id] = {**payload, **tools_payload}
    return configs


def _migrate_case_activities(case_id: int, content: dict[str, Any]) -> dict[str, Any]:
    """把旧形状能力声明换成 ``activities.<id>.config``（纯函数，不改入参）。

    ``backend/scripts/migrate_case_activities.py`` 的冻结副本（同一映射、同一合并优先级、
    同一字段落位），外加迁移需要的报错口径：

    * 已含 ``activities`` 的行原样返回 —— 重跑 / 部分迁移幂等，既有声明绝不被改写；残留的
      旧形状键保留在 payload 里（不丢数据）并记 warning；
    * ``tools`` 非对象 / 未知键 / ``nursing_diagnosis`` → :class:`MigrationDataError`；
    * 顶层与 ``tools`` 都声明同一 Activity 时按 key 合并，``tools.*`` 覆盖同名键。
    """
    _validate_legacy_tools(case_id, content)
    if ACTIVITIES_FIELD in content:
        leftover = sorted(key for key in ("tools", *LEGACY_TOP_LEVEL_FIELDS) if key in content)
        if leftover:
            log.warning(
                "病例 #%s 已含 %s 声明，残留旧形状键未合并（保留原样）: %s",
                case_id,
                ACTIVITIES_FIELD,
                ", ".join(leftover),
            )
        return content

    configs = _collect_legacy_configs(case_id, content)
    if not configs:
        return content

    declared = {activity_id: {ACTIVITY_CONFIG_KEY: payload} for activity_id, payload in configs.items()}
    legacy_keys = set(LEGACY_TOP_LEVEL_FIELDS)
    rewritten: dict[str, Any] = {}
    inserted = False
    for key, value in content.items():
        # ``activities`` 落在第一个被移除的 legacy 键的位置，其余 legacy 键删除
        if key == "tools" or key in legacy_keys:
            if not inserted:
                rewritten[ACTIVITIES_FIELD] = declared
                inserted = True
            continue
        rewritten[key] = value
    if not inserted:
        rewritten[ACTIVITIES_FIELD] = declared
    return rewritten


def upgrade() -> None:
    bind = op.get_bind()
    migrated: set[int] = set()
    # 幂等：已经有 revision 行的病例不再重复处理（重跑/半途失败后的续跑）
    if bind.dialect.has_table(bind, "case_revisions"):
        migrated = set(bind.execute(sa.text("SELECT DISTINCT case_id FROM case_revisions")).scalars().all())

    rows = (
        bind.execute(
            sa.text(
                "SELECT id, name, difficulty, time_limit_minutes, created_at, case_data, "
                "coalesce(training_type, 'history_taking') AS training_type FROM cases ORDER BY id"
            )
        )
        .mappings()
        .all()
    )

    retired: list[str] = []
    # 先整表换轨，再落库：任何一行无法无损转换都在写任何表之前停手（事务回滚 = 不留半迁移数据）
    prepared: list[tuple[Any, dict[str, Any], str]] = []
    failures: list[str] = []
    for row in rows:
        content, payload, bookmark = _split_payload(row["case_data"])
        try:
            content = _migrate_case_activities(row["id"], content)
        except MigrationDataError as exc:
            failures.append(str(exc))
            continue
        if bookmark is not None:
            # 旧指纹按「含元数据」算法在**换轨前**的 payload 上判定（指纹当初就是按旧内容生成的）；
            # 未改动的行改写为新算法，且新指纹取**换轨后**的内容（与仓库病例的 activities 形状对齐），
            # 教师改过的行保留旧指纹 —— 它与换轨后内容不符，seed 继续让路，绝不静默回滚教师工作。
            clean = bookmark == _content_hash(payload, ignore_metadata=False)
            content[SEED_HASH_KEY] = _content_hash(content, ignore_metadata=True) if clean else bookmark
        status = _STATUS_PUBLISHED if row["training_type"] == "history_taking" else _STATUS_ARCHIVED
        if status == _STATUS_ARCHIVED:
            retired.append(f"#{row['id']} {row['name']} (training_type={row['training_type']})")
        prepared.append((row, content, status))

    if failures:
        raise MigrationDataError(
            "case_data 无法无损换轨到 activities 声明，已停止（未写入任何行）: " + "; ".join(failures)
        )

    for row, content, status in prepared:
        if row["id"] in migrated:
            continue
        revision_id = bind.execute(
            sa.text(
                "INSERT INTO case_revisions (case_id, revision_no, content, created_by, created_at, published_at) "
                "VALUES (:case_id, 1, CAST(:content AS jsonb), NULL, :created_at, :created_at) RETURNING id"
            ),
            {
                "case_id": row["id"],
                "content": json.dumps(content, ensure_ascii=False),
                "created_at": row["created_at"],
            },
        ).scalar()
        bind.execute(
            sa.text(
                "UPDATE cases SET case_data = CAST(:content AS jsonb), status = :status, "
                "current_revision_id = :revision_id WHERE id = :id"
            ),
            {
                "content": json.dumps(content, ensure_ascii=False),
                "status": status,
                "revision_id": revision_id,
                "id": row["id"],
            },
        )

    # 历史训练与作业钉住其病例的 current revision（内容不变：旧记录的内容仍以 case_snapshot 为准）
    bind.execute(
        sa.text(
            "UPDATE training_records tr SET case_revision_id = c.current_revision_id "
            "FROM cases c WHERE c.id = tr.case_id AND tr.case_revision_id IS NULL"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE assignments a SET case_revision_id = c.current_revision_id "
            "FROM cases c WHERE c.id = a.case_id AND a.case_revision_id IS NULL"
        )
    )

    if retired:
        # 非 history_taking 的历史行必须报出：它们已归档（不进新训练），内容与版本仍保留
        log.warning("病例归档（training_type 已退场）: %d 行 → %s", len(retired), "; ".join(retired))
    log.info("病例版本回填完成: %d 个病例处理", len(rows))


def downgrade() -> None:
    bind = op.get_bind()
    # 退场类型的历史值不可还原（列在 contract 步骤里以 server_default 重建）：给归档行写回
    # 一个非 history_taking 的占位，使回滚后的旧代码（按 training_type 过滤）仍然不把
    # 这些行暴露给学生/作业 —— 宁可标记近似，也不要在回滚后突然放出退场病例。
    retired = bind.execute(sa.text("SELECT id FROM cases WHERE status = 'archived' ORDER BY id")).scalars().all()
    if retired:
        bind.execute(sa.text("UPDATE cases SET training_type = 'triage' WHERE status = 'archived'"))
        log.warning("归档行的原 training_type 不可还原，回滚为占位 'triage': ids=%s", list(retired))
    rows = (
        bind.execute(
            sa.text("SELECT id, name, difficulty, time_limit_minutes, case_data FROM cases ORDER BY id")
        )
        .mappings()
        .all()
    )
    for row in rows:
        content, _, bookmark = _split_payload(row["case_data"])
        restored = {
            **content,
            "name": row["name"],
            "difficulty": row["difficulty"],
            "time_limit": row["time_limit_minutes"],
        }
        if bookmark is not None:
            # 现行指纹按「不含元数据」算法判定：未改动的行还原为旧算法指纹
            clean = bookmark == _content_hash(content, ignore_metadata=True)
            restored[SEED_HASH_KEY] = _content_hash(restored, ignore_metadata=False) if clean else bookmark
        bind.execute(
            sa.text("UPDATE cases SET case_data = CAST(:content AS jsonb), status = 'draft' WHERE id = :id"),
            {"content": json.dumps(restored, ensure_ascii=False), "id": row["id"]},
        )

    # 删版本行前先摘掉所有引用（FK 是 RESTRICT）
    bind.execute(sa.text("UPDATE training_records SET case_revision_id = NULL WHERE case_revision_id IS NOT NULL"))
    bind.execute(sa.text("UPDATE assignments SET case_revision_id = NULL WHERE case_revision_id IS NOT NULL"))
    bind.execute(sa.text("UPDATE cases SET current_revision_id = NULL WHERE current_revision_id IS NOT NULL"))
    bind.execute(sa.text("DELETE FROM case_revisions"))
    log.info("病例版本回填已回滚: %d 个病例", len(rows))
