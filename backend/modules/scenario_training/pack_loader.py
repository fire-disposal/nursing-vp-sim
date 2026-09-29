"""pack 加载与安装。

加载：按 **revision id** 读库 → 校验 → 按 revision 缓存（修订不可变，故缓存永远不会过期；
多 worker 各缓存各的，新修订是新 id，天然没有陈旧问题——不依赖进程内文件时间戳）。

安装：把一份 JSON 包写进 `st_packs` / `st_pack_revisions`。同一内容（sha 相同）幂等复用，
内容变化则追加新修订号——这正是"改 JSON 就改体验"的落地路径。
"""

from __future__ import annotations

import copy
import inspect
import json
import pathlib
import re
from typing import TYPE_CHECKING, Any, Union, get_args, get_origin

from pydantic import BaseModel, ValidationError
from sqlalchemy import select

from models.scenario_training import StPack, StPackRevision

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from .assets import seed_from_pack
from .schema import PACK_SCHEMA_VERSION, BoardSection, ScenarioPack
from .validation import validate_pack

PACKS_DIR = pathlib.Path(__file__).resolve().parent / "packs"
_CACHE: dict[int, ScenarioPack] = {}


class PackNotFound(RuntimeError):
    """指定的 pack / 修订不存在。"""


class PackInvalid(RuntimeError):
    """pack 未通过加载期校验。"""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("；".join(problems))
        self.problems = problems


def reset_cache() -> None:
    """清空修订缓存（测试与"热载后强制重读"用；修订不可变，正常路径不需要）。"""
    _CACHE.clear()


def load_revision(db: Session, revision_id: int) -> ScenarioPack:
    cached = _CACHE.get(revision_id)
    if cached is not None:
        return cached
    row = db.execute(select(StPackRevision).where(StPackRevision.id == revision_id)).scalar_one_or_none()
    if row is None:
        raise PackNotFound(f"st_pack_revisions.id={revision_id}")
    pack = _validated(row.content)
    _CACHE[revision_id] = pack
    return pack


def _prune_to_model(data: Any, model: type[BaseModel]) -> Any:
    """按目标模型裁掉未知键（递归）——**历史修订带已删除字段时仍必须可读**。

    只有 `pack_schema_version < 当前版本` 的存量内容才走这条路；当前版本的包仍然严格校验，
    作者的拼写错误不会被静默吞掉。

    除"裁未知键"外还有一条**显式**的旧值映射（不猜、不猜语义）：线索板 `source="note"`
    是 v2 的 DM 白板写入版块，v3 已删除该来源（DM 不再写白板）——旧修订里的这类版块整块丢弃，
    而不是留一个永远空着、或让整份历史修订加载失败。
    """
    if not isinstance(data, dict):
        return data
    if model is BoardSection and str(data.get("source")) == "note":
        return None
    fields = model.model_fields
    pruned: dict[str, Any] = {}
    for key, value in data.items():
        field = fields.get(key)
        if field is None:
            continue
        inner = _inner_model(field.annotation)
        if inner is None:
            pruned[key] = value
        elif isinstance(value, list):
            kept = []
            for item in value:
                pruned_item = _prune_to_model(item, inner)
                if pruned_item is not None:
                    kept.append(pruned_item)
            pruned[key] = kept
        elif value is None:
            pruned[key] = None
        else:
            pruned[key] = _prune_to_model(value, inner)
    return pruned


def _inner_model(annotation: Any) -> type[BaseModel] | None:
    """从注解里取出嵌套模型（支持 `Model` / `list[Model]` / `Model | None`）。"""
    origin = get_origin(annotation)
    if origin is list:
        return _inner_model(get_args(annotation)[0])
    if origin is Union:
        for arg in get_args(annotation):
            found = _inner_model(arg)
            if found is not None:
                return found
        return None
    if inspect.isclass(annotation) and issubclass(annotation, BaseModel):
        return annotation
    return None


def _validated(content: dict[str, Any]) -> ScenarioPack:
    payload = content
    if int(content.get("pack_schema_version", 1)) < PACK_SCHEMA_VERSION:
        payload = _prune_to_model(content, ScenarioPack)
    pack = ScenarioPack.model_validate(payload)
    problems = validate_pack(pack)
    if problems:
        raise PackInvalid(problems)
    return pack


# --------------------------------------------------------------------------- #
# 校验问题的**字段定位**（编辑器用）
#
# 校验本身只有一套（`ScenarioPack` + `validate_pack`，与安装/加载逐字相同）；这里只是把
# 它的两种输出翻译成"稳定路径 + 原因"：pydantic 已经带 `loc`，`validate_pack` 的中文串
# 以 `affordance <id>:` 这样的定位前缀开头——**不新增判据**，只做标签化。
# --------------------------------------------------------------------------- #

_PREFIXED_PARENTS = {
    "affordance": "affordances",
    "reaction": "reactions",
    "cue": "setting.cues",
    "fact": "facts",
    "criterion": "rubric",
    "anchor": "anchors",
    "asset": "assets",
    "device": "presentation.devices",
    "board": "presentation.board",
}
_PREFIXED_RE = re.compile(r"^(affordance|reaction|cue|fact|criterion|anchor|asset|device|board) ([^:]+?):")
_HUD_RE = re.compile(r"^hud slot (\d+):")
_DUPLICATE_RE = re.compile(
    r"^(actor|affordance|cue|reaction|fact|criterion|dim|asset|anchor|device|board section) id 重复"
)
_DUPLICATE_PARENTS = {
    "actor": "actors",
    "affordance": "affordances",
    "cue": "setting.cues",
    "reaction": "reactions",
    "fact": "facts",
    "criterion": "rubric",
    "dim": "dims",
    "asset": "assets",
    "anchor": "anchors",
    "device": "presentation.devices",
    "board section": "presentation.board",
}


def problem_path(message: str) -> str:
    """把一条校验问题映射到**稳定路径**（`affordances[suction].type`）；认不出就返回空串。"""
    match = _PREFIXED_RE.match(message)
    if match is not None:
        parent = _PREFIXED_PARENTS[match.group(1)]
        target = match.group(2)
        if "/" in target:  # device 的通道：`device <设备 id>/<状态键>`
            device, channel = target.split("/", 1)
            return f"{parent}[{device}].channels[{channel}]"
        return f"{parent}[{target}]"
    match = _HUD_RE.match(message)
    if match is not None:
        return f"presentation.hud[{match.group(1)}]"
    match = _DUPLICATE_RE.match(message)
    if match is not None:
        return _DUPLICATE_PARENTS[match.group(1)]
    for prefix, path in (("pack.title", "title"), ("pack.one_line", "one_line")):
        if message.startswith(prefix):
            return path
    if message.startswith("状态键") and "：" in message:
        return f"state_keys.{message.rsplit('：', 1)[1]}"
    if message.startswith("failure"):
        return "failure_when"
    return ""


def validate_content(content: dict[str, Any]) -> list[dict[str, str]]:
    """走**加载期同一套校验**，返回 `[{"path", "message"}]`（空列表 = 可安装）。

    形状错误由 pydantic 报（带 `loc`），引用/词表/可达性错误由 `validate_pack` 报（带定位前缀）。
    """
    try:
        pack = ScenarioPack.model_validate(content)
    except ValidationError as exc:
        return [
            {
                "path": ".".join(str(part) for part in item["loc"]) or "(root)",
                "message": str(item["msg"]),
            }
            for item in exc.errors()
        ]
    return [{"path": problem_path(message), "message": message} for message in validate_pack(pack)]


def _ref_clause(ref: str, content: dict[str, Any]) -> dict[str, Any] | None:
    """旧锚点 `requires` 里的引用 → 新机制的条件子句（动作 / 事实两种命名空间）。"""
    if any(item.get("id") == ref for item in content.get("affordances") or []):
        return {"kind": "action_used", "affordance_id": ref}
    if any(item.get("id") == ref for item in content.get("facts") or []):
        return {"kind": "fact_declared", "fact_id": ref}
    return None


def _apply_unlocks(out: dict[str, Any], unlocked: list[str], clauses: list[dict[str, Any]]) -> None:
    """`unlocks` → 对应 affordance 的 `visible_when`（保持"达成前不可用"的等价门控）。"""
    for affordance in out.get("affordances") or []:
        if affordance.get("id") in unlocked and not affordance.get("visible_when"):
            affordance["visible_when"] = {"all": list(clauses)}


def _convert_anchor(anchor: Any, out: dict[str, Any], notes: list[str]) -> dict[str, Any]:
    """一个旧锚点 → 一条 teaching_focus；每一步删除/改写都产出一条可解释的 `notes`。"""
    aid = str(anchor.get("id") or "focus")
    requires = [str(item) for item in anchor.get("requires") or []]
    unlocked = [str(item) for item in anchor.get("unlocks") or []]
    blocked = [str(item) for item in anchor.get("blocked_by") or []]
    clauses = [clause for clause in (_ref_clause(ref, out) for ref in requires) if clause is not None]
    missing = [ref for ref in requires if _ref_clause(ref, out) is None]
    if missing:
        notes.append(f"锚点 {aid}：requires 里的 {missing} 既不是动作也不是事实，已跳过该条件（请手工确认）")
    if unlocked:
        _apply_unlocks(out, unlocked, clauses)
        notes.append(
            f"锚点 {aid}：unlocks={unlocked} 已转成对应动作的 visible_when（达成前不可用，只是不再由锚点状态机管）"
        )
    if blocked:
        notes.append(
            f"锚点 {aid}：blocked_by={blocked} 已记入 evidence_refs——新机制没有 blocked 状态机，"
            "请把『世界诚实抵抗』表达成 reaction"
        )
    if str(anchor.get("cue") or "").strip():
        notes.append(f"锚点 {aid}：cue 未自动迁移（新机制没有『世界必须呈现的信号』字段），原文：{anchor['cue']}")
    if anchor.get("deadline_turns") is not None:
        notes.append(f"锚点 {aid}：deadline_turns={anchor['deadline_turns']} 已删除（不含催办计时）")
    if str(anchor.get("stage") or "").strip():
        notes.append(f"锚点 {aid}：stage='{anchor['stage']}' 已删除（教学关注点不排序、不分阶段）")
    return {
        "id": aid,
        "intent": str(anchor.get("goal") or anchor.get("cue") or aid),
        "relevant_when": None,
        "addressed_when": {"all": clauses} if clauses else None,
        "evidence_refs": [*requires, *blocked],
    }


def _drop_note_sections(out: dict[str, Any], notes: list[str]) -> None:
    """线索板里 `source='note'` 的版块删除：新机制里 DM 不写白板（docs/23 §5.2）。"""
    presentation = out.get("presentation") or {}
    board = list(presentation.get("board") or [])
    kept = [section for section in board if section.get("source") != "note"]
    if len(kept) != len(board):
        notes.append("线索板中 source='note' 的版块已删除：新机制里 DM 不写白板（docs/23 §5.2）")
        presentation["board"] = kept
        out["presentation"] = presentation


def _drop_actor_entities(out: dict[str, Any], notes: list[str]) -> None:
    """角色上的 `entity` 字段已随独立角色实体路径移除。"""
    for actor in out.get("actors") or []:
        if actor.pop("entity", None) is not None:
            notes.append(f"角色 {actor.get('id')}：entity 字段已删除（独立角色实体路径已移除）")


def _note_missing_targets(out: dict[str, Any], notes: list[str]) -> None:
    """多对象在场时动作必须声明 targets，否则平台拦不住『静默换人』。"""
    multi = len([actor for actor in out.get("actors") or [] if actor.get("presence") != "inaccessible"]) > 1
    if not multi:
        return
    missing = [
        str(affordance.get("id"))
        for affordance in out.get("affordances") or []
        if not affordance.get("targets") and affordance.get("type") in {"act", "measure", "observe"}
    ]
    if missing:
        notes.append(
            f"本包有多个在场对象，这些动作却没声明 targets：{missing}——请补 TargetRef，"
            "否则平台无法拦住『静默换人』（有意不绑定对象的动作可以留空）"
        )


def convert_legacy(content: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """旧形状（v1/v2）→ 当前形状的**显式转换**：每一步都可解释，绝不静默丢东西。

    docs/23 §9.4：「旧锚点不是机械改名：依赖变成实际行为条件，此类压力变成 reaction，
    教学意图变成 teaching_focus；不能静默丢掉旧 `unlocks` 或阈值。」因此：
    - `requires` → `addressed_when`（动作/事实条件）；
    - `unlocks` → 对应 affordance 的 `visible_when`（保持"达成前不可用"的等价门控）；
    - `goal` → `intent`；`stage`/`deadline_turns`/`cue`/`blocked_by` 各自产出一条 `notes`
      （删除或改写都必须让操作者看见，尤其是 `cue` 的原文与 `blocked_by` 的引用）。
    """
    version = int(content.get("pack_schema_version", 1))
    if version >= PACK_SCHEMA_VERSION:
        raise PackInvalid([f"这已经是当前形状（v{version}），不需要转换"])
    notes: list[str] = []
    out = copy.deepcopy(content)
    out["pack_schema_version"] = PACK_SCHEMA_VERSION

    anchors = list(out.pop("anchors", None) or [])
    focus = [_convert_anchor(anchor, out, notes) for anchor in anchors]
    if anchors:
        notes.append(f"共 {len(anchors)} 个锚点 → teaching_focus（教学意图保留，推进权与解锁权取消）")
    out["teaching_focus"] = focus

    _drop_note_sections(out, notes)
    _drop_actor_entities(out, notes)
    if out.get("image_generation") == "allowed":
        notes.append("image_generation='allowed' 保留在声明里，但新演出阶段不再请求生成图片（docs/23 §4.4）")
    _note_missing_targets(out, notes)
    return out, notes


def latest_revision(db: Session, pack_key: str) -> tuple[StPack, StPackRevision] | None:
    pack = db.execute(select(StPack).where(StPack.key == pack_key)).scalar_one_or_none()
    if pack is None:
        return None
    revision = db.execute(
        select(StPackRevision)
        .where(StPackRevision.pack_id == pack.id)
        .order_by(StPackRevision.revision_no.desc())
        .limit(1)
    ).scalar_one_or_none()
    if revision is None:
        return None
    return pack, revision


def _student_meta(content: dict[str, Any]) -> dict[str, str]:
    """列表投影里的**学生语义**字段：你将扮演谁（`player.role`）、在哪儿（`setting.place`）。

    学生选情境时要读的是"我是谁、在哪"，不是编辑态字段——`state`（experimental 等）与
    `revision_no` 属作者态，学生面不展示（UI 审计 C4）。

    这里**只取两个展示字段、不整包校验**：列表是入口页的读取路径，不该因为某个历史修订
    校验不过而整个 500；内容合法性在安装与加载期已由 `validate_pack` 把关。缺字段给空串，
    由界面决定不显示。
    """
    player = content.get("player")
    setting = content.get("setting")
    return {
        "player_role": str(player.get("role") or "") if isinstance(player, dict) else "",
        "place": str(setting.get("place") or "") if isinstance(setting, dict) else "",
    }


def list_packs(db: Session) -> list[dict[str, Any]]:
    """供前端/开发选择：每个 pack 的最新修订摘要。"""
    packs = db.execute(select(StPack).order_by(StPack.key)).scalars().all()
    out: list[dict[str, Any]] = []
    for pack in packs:
        revision = db.execute(
            select(StPackRevision)
            .where(StPackRevision.pack_id == pack.id)
            .order_by(StPackRevision.revision_no.desc())
            .limit(1)
        ).scalar_one_or_none()
        out.append(
            {
                "key": pack.key,
                "title": pack.title,
                "state": pack.state,
                "one_line": pack.one_line,
                "revision_id": revision.id if revision else None,
                "revision_no": revision.revision_no if revision else None,
                **_student_meta(revision.content if revision is not None else {}),
            }
        )
    return out


def install(db: Session, pack: ScenarioPack, *, note: str = "") -> tuple[StPack, StPackRevision, bool]:
    """写入或追加修订。返回 (pack, revision, created)。"""
    problems = validate_pack(pack)
    if problems:
        raise PackInvalid(problems)

    sha = pack.content_sha()
    row = db.execute(select(StPack).where(StPack.key == pack.key)).scalar_one_or_none()
    if row is None:
        row = StPack(key=pack.key, title=pack.title, state=pack.state.value, one_line=pack.one_line)
        db.add(row)
        db.flush()
    else:
        # `state` 是**管理端拥有的运行期事实**（experimental / reviewed），不是包内容字段：
        # 只在新建成行时用包里的值当初值，之后重传包/补传图片**不覆盖**它——
        # 否则管理员标成 reviewed 之后，下一次上传会被包 JSON 静默回退成 experimental。
        # 标题与一句话描述是展示字段，仍随包内容更新（作者改文案要能生效）。
        row.title = pack.title
        row.one_line = pack.one_line

    latest = db.execute(
        select(StPackRevision)
        .where(StPackRevision.pack_id == row.id)
        .order_by(StPackRevision.revision_no.desc())
        .limit(1)
    ).scalar_one_or_none()
    # 资源播种与修订是否变化无关（幂等：已有字节的跳过）——首次安装/补种都靠它
    seed_from_pack(db, pack)
    if latest is not None and latest.content_sha == sha:
        return row, latest, False

    next_no = (latest.revision_no + 1) if latest is not None else 1
    revision = StPackRevision(
        pack_id=row.id,
        revision_no=next_no,
        pack_schema_version=pack.pack_schema_version,
        content=pack.model_dump(mode="json"),
        content_sha=sha,
        note=note,
    )
    db.add(revision)
    db.flush()
    return row, revision, True


def load_pack_file(name: str) -> ScenarioPack:
    """按文件名或 pack key 读包（`sputum-ineffective` 与 `sputum_ineffective` 都能命中）。"""
    stem = name.removesuffix(".json")
    candidates = [PACKS_DIR / f"{stem}.json", PACKS_DIR / f"{stem.replace('-', '_')}.json"]
    path = next((item for item in candidates if item.is_file()), None)
    if path is None:
        raise PackNotFound(f"找不到包文件：{name}（尝试过 {[item.name for item in candidates]}）")
    return ScenarioPack.model_validate(json.loads(path.read_text(encoding="utf-8")))


def count_pack_files() -> int:
    return len(list(PACKS_DIR.glob("*.json")))
